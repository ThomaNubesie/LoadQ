// loadq-ride-card — on-demand card pre-authorization (manual capture).
//   action=authorize (passenger JWT): create/reuse a manual-capture PaymentIntent
//     for the ride fare + a Stripe customer + ephemeral key → returns the bits
//     PaymentSheet needs. Funds are only HELD, never taken.
//   action=confirm   (passenger JWT): read the PI back from Stripe; if it's
//     authorized (requires_capture) mark the ride paid so dispatch can offer.
//   action=capture   (x-kolis-secret): capture the held funds (on completion).
//   action=release   (x-kolis-secret): cancel the hold (on cancel/expiry).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-12-18.acacia", httpClient: Stripe.createFetchHttpClient() });
const SECRET = "kolis_notify_9f3a2c7b1e6d4084";
const APIV = "2024-12-18.acacia";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-kolis-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function userId(req: Request): Promise<string | null> {
  const authz = req.headers.get("Authorization") || "";
  if (!authz) return null;
  const c = createClient(URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authz } } });
  const { data } = await c.auth.getUser();
  return data.user?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const action = b.action as string;
    if (!b.request_id) return json({ error: "request_id required" }, 400);
    const { data: r } = await admin.from("loadq_ride_requests").select("*").eq("id", b.request_id).maybeSingle();
    if (!r) return json({ error: "request not found" }, 404);

    // ── passenger actions (own request, via JWT) ──────────────────────────
    if (action === "authorize" || action === "confirm") {
      const uid = await userId(req);
      if (!uid || uid !== r.passenger_id) return json({ error: "unauthorized" }, 401);
      if (r.payment_method !== "card") return json({ error: "not a card ride" }, 400);
      if (!r.fare_cents) return json({ error: "no fare yet" }, 400);

      if (action === "authorize") {
        // customer
        const { data: p } = await admin.from("passengers").select("stripe_customer_id, full_name, email, phone").eq("id", uid).maybeSingle();
        let customer = p?.stripe_customer_id as string | null;
        if (!customer) {
          const c = await stripe.customers.create({ name: p?.full_name ?? undefined, email: p?.email ?? undefined, phone: p?.phone ?? undefined, metadata: { passenger_id: uid } });
          customer = c.id;
          await admin.from("passengers").update({ stripe_customer_id: customer }).eq("id", uid);
        }
        const ek = await stripe.ephemeralKeys.create({ customer }, { apiVersion: APIV });
        // reuse an open PI of the right amount, else make a new manual-capture one
        let pi: any = null;
        if (r.stripe_pi_id) { try { pi = await stripe.paymentIntents.retrieve(r.stripe_pi_id); } catch { /* gone */ } }
        const reusable = pi && pi.amount === r.fare_cents && ["requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status);
        if (!reusable) {
          pi = await stripe.paymentIntents.create({
            amount: r.fare_cents, currency: "cad", customer, capture_method: "manual",
            automatic_payment_methods: { enabled: true }, metadata: { request_id: r.id, passenger_id: uid },
          });
          await admin.from("loadq_ride_requests").update({ stripe_pi_id: pi.id }).eq("id", r.id);
        }
        return json({ client_secret: pi.client_secret, customer, ephemeral_key: ek.secret, publishable_key: Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? null });
      }

      // confirm: verify the hold server-side
      if (!r.stripe_pi_id) return json({ ok: false, error: "no payment intent" }, 400);
      const pi = await stripe.paymentIntents.retrieve(r.stripe_pi_id);
      if (pi.status === "requires_capture") {
        await admin.from("loadq_ride_requests").update({ payment_status: "paid" }).eq("id", r.id);
        return json({ ok: true, status: pi.status });
      }
      return json({ ok: false, status: pi.status });
    }

    // ── admin/cron actions (x-kolis-secret) ───────────────────────────────
    if (action === "capture" || action === "release") {
      if (req.headers.get("x-kolis-secret") !== SECRET) return json({ error: "forbidden" }, 403);
      if (!r.stripe_pi_id) return json({ ok: false, error: "no payment intent" });
      const pi = await stripe.paymentIntents.retrieve(r.stripe_pi_id);
      if (action === "capture") {
        if (pi.status === "requires_capture") { await stripe.paymentIntents.capture(pi.id); await admin.from("loadq_ride_requests").update({ payment_status: "captured" }).eq("id", r.id); }
        return json({ ok: true, status: "captured" });
      }
      // release the hold
      if (["requires_capture", "requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status)) {
        await stripe.paymentIntents.cancel(pi.id);
      }
      await admin.from("loadq_ride_requests").update({ payment_status: "released" }).eq("id", r.id);
      return json({ ok: true, status: "released" });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
