// loadq-interac-inbound — auto-match an Interac deposit to a ride OR pickup request
// and mark it paid. Called by the Gmail Apps Script that reads Interac "you
// received $X" emails. POST ?key=<LOADQ_INTERAC_TOKEN> { reference|text, amount_cents?, amount? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TOKEN = Deno.env.get("LOADQ_INTERAC_TOKEN") || "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  if (!TOKEN || key !== TOKEN) return json({ error: "unauthorized" }, 401);
  try {
    const b = await req.json().catch(() => ({}));
    let reference: string | null = b.reference ?? null;
    if (!reference && typeof b.text === "string") { const m = b.text.match(/\bLQ-[A-Z0-9]{4,6}\b/i); if (m) reference = m[0]; }
    if (!reference) return json({ matched: false, reason: "no_reference" });
    reference = reference.toUpperCase();
    const amount_cents = b.amount_cents != null ? Math.round(Number(b.amount_cents))
      : (b.amount != null ? Math.round(Number(b.amount) * 100) : null);

    // 1) Try a RIDE request first.
    const { data: ride } = await admin.rpc("loadq_ride_match_interac", { p_reference: reference, p_amount_cents: amount_cents });
    if (ride && (ride.matched === true || ride.ok === true || ride.paid === true)) {
      return json({ matched: true, kind: "ride", ...ride });
    }

    // 2) Fall back to a PICKUP request (feeder pooled pickup uses the same LQ- refs).
    try {
      const { data: pickup } = await admin.rpc("loadq_pickup_mark_paid", { p_ref: reference });
      if (pickup && pickup.ok === true) return json({ matched: true, kind: "pickup", ...pickup });
    } catch { /* no pickup match */ }

    return json({ matched: false, reference, ride });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
