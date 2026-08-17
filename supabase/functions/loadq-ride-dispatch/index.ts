// loadq-ride-dispatch — on-demand pickup: offer the trip to a queue driver with enough
// positional slack to fetch the client and return to the loading zone, cascading to the next.
// Fare = Uber-comparable estimate (client -> zone) + $2 request fee.
// POST { request_id }   (re-call to advance the cascade after a decline/expiry)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const GKEY = Deno.env.get("GOOGLE_MAPS_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// SMS the driver that a request is waiting (in addition to push).
const TW_SID = Deno.env.get("KOLIS_TWILIO_SID"), TW_TOKEN = Deno.env.get("KOLIS_TWILIO_TOKEN"), TW_FROM = Deno.env.get("KOLIS_TWILIO_FROM");
async function sms(driverId: string, body: string) {
  try {
    if (!TW_SID || !TW_TOKEN || !TW_FROM) return;
    const { data: d } = await admin.from("drivers").select("phone").eq("id", driverId).maybeSingle();
    let to = d?.phone ? String(d.phone).replace(/[^\d+]/g, "") : ""; if (!to) return;
    if (!to.startsWith("+")) to = to.length === 10 ? "+1" + to : "+" + to;
    const f = new URLSearchParams({ To: to, Body: body }); TW_FROM.startsWith("MG") ? f.set("MessagingServiceSid", TW_FROM) : f.set("From", TW_FROM);
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString() }).catch(() => {});
  } catch { /* SMS is best-effort */ }
}

async function geocode(a: string) {
  const d = await (await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(a)}&key=${GKEY}`)).json();
  if (d.status !== "OK" || !d.results?.length) return null;
  const l = d.results[0].geometry.location; return { lat: l.lat, lng: l.lng };
}
async function route(o: any, d: any) {
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GKEY, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration" },
    body: JSON.stringify({ origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } }, destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } }, travelMode: "DRIVE" }),
  });
  const j = await r.json(); if (!j.routes?.length) return null;
  return { meters: j.routes[0].distanceMeters, sec: parseInt(String(j.routes[0].duration).replace("s", "")) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    if (!b.request_id) return json({ error: "request_id required" }, 400);
    const { data: r } = await admin.from("loadq_ride_requests").select("*").eq("id", b.request_id).maybeSingle();
    if (!r) return json({ error: "request not found" }, 404);
    if (r.kind !== "on_demand") return json({ error: "dispatch is for on_demand requests" }, 400);
    if (["assigned", "en_route", "picked_up", "completed", "cancelled", "expired"].includes(r.status))
      return json({ status: r.status, message: "request already resolved" });
    if (!r.departure_zone_id) return json({ error: "departure_zone_id (loading point) required" }, 400);

    // settings / rate card
    const { data: st } = await admin.from("loadq_settings").select("key,value")
      .in("key", ["ondemand_base_cents", "ondemand_per_km_cents", "ondemand_per_min_cents", "ondemand_min_cents", "ondemand_fee_cents", "dispatch_slack_per_car_mins", "dispatch_safety_mins", "dispatch_min_position"]);
    const S: Record<string, number> = {}; (st ?? []).forEach((x: any) => S[x.key] = parseInt(x.value));
    const MIN_POS = S.dispatch_min_position || 6; // only offer to position >= this (protect front loaders)

    // zone + coords
    const { data: zone } = await admin.from("zones").select("id,name,latitude,longitude").eq("id", r.departure_zone_id).maybeSingle();
    if (!zone?.latitude) return json({ error: "loading zone has no coordinates" }, 422);
    const zpt = { lat: zone.latitude, lng: zone.longitude };

    // client origin
    let origin = r.origin_lat != null ? { lat: r.origin_lat, lng: r.origin_lng } : await geocode(r.origin_address ?? "");
    if (!origin) return json({ error: "could not geocode pickup address" }, 422);

    // fare (compute once): client -> zone leg, distance + time
    const method = r.payment_method || "interac";
    let fare_cents = r.fare_cents;
    let pay_ref = r.pay_ref;
    const leg = await route(origin, zpt);
    if (!leg) return json({ error: "could not route pickup -> loading zone" }, 422);
    const one_way_min = leg.sec / 60;
    const round_trip_min = one_way_min * 2 + S.dispatch_safety_mins;

    // AVAILABILITY GATE FIRST — never price or charge a rider unless a queue driver
    // is on duty with enough slack to fetch them and return. No eligible driver =>
    // no_driver, and NO fare/hold is created (the app stops before authorizing a card).
    const { data: offers } = await admin.from("loadq_ride_offers").select("driver_id,status,expires_at").eq("request_id", r.id);
    const now = Date.now();
    if ((offers ?? []).some((o: any) => o.status === "offered" && new Date(o.expires_at).getTime() > now))
      return json({ status: "pending", message: "an offer is already out" });
    const alreadyTried = new Set((offers ?? []).map((o: any) => o.driver_id));

    const { data: q } = await admin.from("queue_entries").select("driver_id,position,status")
      .eq("zone_id", zone.id).in("status", ["waiting", "standby"]).order("position");
    const eligible = (q ?? [])
      .map((e: any) => ({ ...e, slack_min: Math.max(0, (e.position - 1)) * S.dispatch_slack_per_car_mins }))
      .filter((e: any) => e.position >= MIN_POS && e.slack_min >= round_trip_min && !alreadyTried.has(e.driver_id));

    if (!eligible.length)
      return json({ status: "no_driver", round_trip_min: Math.round(round_trip_min),
        message: "no queue driver is available right now" });

    // A driver is available — now it's safe to price + collect payment.
    if (fare_cents == null) {
      const km = leg.meters / 1000;
      const est = S.ondemand_base_cents + Math.round(km * S.ondemand_per_km_cents) + Math.round(one_way_min * S.ondemand_per_min_cents);
      fare_cents = Math.max(est, S.ondemand_min_cents) + S.ondemand_fee_cents;
      pay_ref = pay_ref || ("LQ-" + Math.random().toString(36).slice(2, 7).toUpperCase());
      await admin.from("loadq_ride_requests").update({
        origin_lat: origin.lat, origin_lng: origin.lng, pickup_label: r.origin_address,
        pickup_lat: origin.lat, pickup_lng: origin.lng, fare_cents, pay_ref, payment_method: method,
        status: r.payment_status === "paid" ? "paid" : "awaiting_payment",
      }).eq("id", r.id);
    }

    // Collect/authorize payment before offering a driver (interac clears, card holds).
    if ((method === "interac" || method === "card") && r.payment_status !== "paid") {
      const resp: Record<string, unknown> = { status: "awaiting_payment", fare_cents, pay_ref };
      if (method === "interac") {
        resp.interac_to = Deno.env.get("KOLIS_INTERAC_ADDRESS") || "shaloderick@gmail.com";
        resp.message = "Send the e-Transfer with this reference in the message — a driver is offered once it clears.";
      } else {
        resp.message = "Authorize your card to hold the fare — a driver is offered once the hold is placed.";
      }
      return json(resp);
    }

    const pick = eligible[0]; // front-most eligible driver
    const { data: offerId } = await admin.rpc("loadq_ride_offer_next", {
      p_request_id: r.id, p_driver_id: pick.driver_id, p_rank: pick.position, p_window_seconds: 60,
    });
    await sms(pick.driver_id, `LoadQ: new ride request${zone?.name ? " at " + zone.name : ""} — $${((fare_cents || 0) / 100).toFixed(2)}. Open LoadQ to accept (60s).`);
    return json({ status: "offered", offer_id: offerId, driver_id: pick.driver_id, driver_position: pick.position,
      driver_slack_min: pick.slack_min, round_trip_min: Math.round(round_trip_min), fare_cents,
      zone: zone.name });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
