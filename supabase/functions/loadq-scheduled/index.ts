// loadq-scheduled — quote + create a SCHEDULED door-to-door home pickup (days ahead).
// One driver later claims/accepts and does the whole trip: home -> city -> drop-off.
// Price = $12.99 service + intercity fare (route_fares for the closest zone) +
// home-distance cost (per-km/min from the closest active zone point to the home).
// Stored as a loadq_ride_requests row (kind='scheduled'); Interac clears it via the
// usual loadq-interac-inbound matcher. POST { action:'quote', ... }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const GKEY = Deno.env.get("GOOGLE_MAPS_KEY")!;
const INTERAC_TO = Deno.env.get("KOLIS_INTERAC_ADDRESS") || "shaloderick@gmail.com";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function setting(key: string, dflt: number) {
  const { data } = await admin.from("loadq_settings").select("value").eq("key", key).maybeSingle();
  const n = data ? Number(data.value) : NaN; return isFinite(n) ? n : dflt;
}
async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GKEY}`);
  const j = await r.json(); const loc = j?.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}
async function driveKmMin(o: { lat: number; lng: number }, d: { lat: number; lng: number }) {
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GKEY, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration" },
    body: JSON.stringify({ origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } }, destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } }, travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" }),
  });
  const j = await r.json(); const rt = j?.routes?.[0]; if (!rt) return null;
  return { km: (rt.distanceMeters || 0) / 1000, min: Math.round(parseInt(String(rt.duration)) / 60) };
}
function payRef(): string { let n = ""; for (let i = 0; i < 5; i++) n += Math.floor(Math.random() * 10); return "LQ-" + n; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = req.method === "POST" ? await req.json().catch(() => ({} as any)) : Object.fromEntries(new URL(req.url).searchParams);
    const action = b.action || "quote";
    if (action !== "quote") return json({ error: "unknown_action" }, 400);

    const originAddr = String(b.origin_address || b.address || "").trim();
    const dropoffAddr = String(b.dropoff_address || "").trim();
    const dest = String(b.destination_region || "").toLowerCase().trim();
    const schedDate = String(b.scheduled_date || "").trim(); // YYYY-MM-DD
    if (!originAddr || !dropoffAddr || !dest || !schedDate) return json({ error: "origin_address, dropoff_address, destination_region, scheduled_date required" }, 400);

    const o = await geocode(originAddr);
    if (!o) return json({ error: "could not geocode home address" }, 422);
    const dp = await geocode(dropoffAddr);
    if (!dp) return json({ error: "could not geocode drop-off address" }, 422);

    // Closest active zone to the home.
    const { data: zoneRows } = await admin.rpc("_loadq_closest_zone", { p_lat: o.lat, p_lng: o.lng });
    const zone = Array.isArray(zoneRows) ? zoneRows[0] : zoneRows;
    if (!zone?.zone_id) return json({ error: "no active zone to price against" }, 422);

    // Home-distance cost: driving distance from the closest zone point to the home.
    const leg = await driveKmMin({ lat: zone.lat, lng: zone.lng }, o);
    if (!leg) return json({ error: "could not route zone -> home" }, 422);
    const perKm = await setting("ondemand_per_km_cents", 100);
    const perMin = await setting("ondemand_per_min_cents", 30);
    const home_distance_cents = Math.round(leg.km * perKm + leg.min * perMin);

    // Intercity fare from the closest zone to the destination region.
    const { data: rf } = await admin.from("loadq_route_fares").select("fare_cents").eq("zone_id", zone.zone_id).eq("destination_region", dest).maybeSingle();
    let fare_to_city_cents = rf?.fare_cents ?? null;
    if (fare_to_city_cents == null) {
      const { data: any } = await admin.from("loadq_route_fares").select("fare_cents").eq("destination_region", dest).order("fare_cents", { ascending: false }).limit(1).maybeSingle();
      fare_to_city_cents = any?.fare_cents ?? await setting("scheduled_default_fare_cents", 4300);
    }

    const seats = Math.max(1, Math.min(8, parseInt(String(b.seats ?? 1)) || 1));
    const service_cents = await setting("scheduled_service_cents", 1299);
    const fare_total_cents = fare_to_city_cents * seats; // only the intercity fare scales per seat
    const total = service_cents + fare_total_cents + home_distance_cents;
    const ref = payRef();

    const { data: ins, error } = await admin.from("loadq_ride_requests").insert({
      passenger_id: b.passenger_id || null, kind: "scheduled",
      origin_address: originAddr, origin_lat: o.lat, origin_lng: o.lng,
      pickup_lat: o.lat, pickup_lng: o.lng, pickup_label: originAddr,
      dest_region: dest, dest_address: dropoffAddr, dest_lat: dp.lat, dest_lng: dp.lng,
      departure_zone_id: zone.zone_id, scheduled_date: schedDate, seats,
      time_block: ["05-09","09-13","13-17","17-22"].includes(String(b.time_block)) ? String(b.time_block) : null,
      fare_cents: total, pay_ref: ref, payment_method: "interac", status: "awaiting_payment",
      notes: (b.name || b.phone) ? `${b.name ?? ""} ${b.phone ?? ""}`.trim() : null,
    }).select("id").single();
    if (error) return json({ error: "save_failed", detail: error.message }, 500);

    return json({
      ok: true, request_id: ins.id, pay_ref: ref, interac_to: INTERAC_TO, scheduled_date: schedDate, seats,
      closest_zone: zone.zone_id, home_distance_km: Math.round(leg.km * 10) / 10,
      service_cents, fare_per_seat_cents: fare_to_city_cents, fare_to_city_cents: fare_total_cents,
      home_distance_cents, total_cents: total,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
