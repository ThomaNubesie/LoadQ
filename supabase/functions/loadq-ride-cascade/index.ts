// loadq-ride-cascade — 1-minute dispatch tick.
//   1. Expire stale offers (loadq_ride_offers_expire).
//   2. On-demand: re-call loadq-ride-dispatch for requests needing the next
//      front-most eligible driver.
//   3. Route-pickup: offer the front-most queued driver at the matched departure
//      zone heading to the destination (cascading to the next untried driver).
// Neither a decline nor an expiry advances the cascade on its own, so this tick
// is what keeps the offer loop moving. Gated by x-kolis-secret (cron only).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SECRET = "kolis_notify_9f3a2c7b1e6d4084";
const RESOLVED = ["assigned", "en_route", "picked_up", "completed", "cancelled", "expired"];
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.headers.get("x-kolis-secret") !== SECRET) return json({ error: "forbidden" }, 403);
  try {
    // 1. Expire stale offers.
    const { data: expired } = await admin.rpc("loadq_ride_offers_expire");

    // 2. Re-dispatch on-demand requests that need the next offer.
    const { data: reqs } = await admin
      .from("loadq_ride_requests")
      .select("id, kind, status, payment_method, payment_status")
      .eq("kind", "on_demand");

    let dispatched = 0, skipped = 0;
    const now = Date.now();
    for (const r of reqs ?? []) {
      if (RESOLVED.includes(r.status)) { skipped++; continue; }
      if (r.payment_method === "interac" && r.payment_status !== "paid") { skipped++; continue; }
      const { data: offers } = await admin
        .from("loadq_ride_offers").select("status, expires_at").eq("request_id", r.id);
      const hasLive = (offers ?? []).some((o: any) => o.status === "offered" && new Date(o.expires_at).getTime() > now);
      if (hasLive) { skipped++; continue; }
      await fetch(`${URL}/functions/v1/loadq-ride-dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-kolis-secret": SECRET },
        body: JSON.stringify({ request_id: r.id }),
      }).catch(() => {});
      dispatched++;
    }

    // 3. Route-pickup: offer the front-most queued driver at the matched zone
    //    heading to the destination; cascade to the next untried driver.
    const { data: rp } = await admin
      .from("loadq_ride_requests")
      .select("id, status, dest_region, departure_zone_id, payment_method, payment_status")
      .eq("kind", "route_pickup");
    let offered = 0;
    for (const r of rp ?? []) {
      if (RESOLVED.includes(r.status)) { skipped++; continue; }
      if (!r.departure_zone_id) { skipped++; continue; }              // not quoted/matched yet
      if (r.payment_method === "interac" && r.payment_status !== "paid") { skipped++; continue; }
      const { data: offers } = await admin
        .from("loadq_ride_offers").select("driver_id, status, expires_at").eq("request_id", r.id);
      if ((offers ?? []).some((o: any) => o.status === "offered" && new Date(o.expires_at).getTime() > now)) { skipped++; continue; }
      const tried = new Set((offers ?? []).map((o: any) => o.driver_id));
      const { data: q } = await admin
        .from("queue_entries").select("driver_id, position, status")
        .eq("zone_id", r.departure_zone_id).eq("destination_region", r.dest_region)
        .in("status", ["loading", "waiting", "standby"]).order("position");
      const next = (q ?? []).find((e: any) => !tried.has(e.driver_id));
      if (!next) { skipped++; continue; }                            // no eligible/untried driver
      await admin.rpc("loadq_ride_offer_next", { p_request_id: r.id, p_driver_id: next.driver_id, p_rank: next.position, p_window_seconds: 60 });
      offered++;
    }

    return json({ ok: true, expired: expired ?? 0, dispatched, offered, skipped });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
