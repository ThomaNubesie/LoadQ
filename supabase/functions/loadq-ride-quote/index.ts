// loadq-ride-quote — route-pickup quote for LoadQ.
// POST { request_id, chosen_pickup?: {label,lat,lng} }
//  - geocodes the passenger origin + destination
//  - routes each live departure-zone -> destination (Google Routes API)
//  - measures the origin's distance to those routes
//  - <= 5 mi off-route  -> quote an on-route pickup at the address (finalized)
//  - >  5 mi            -> return gas stations within 5 mi of the route (Places API New)
//  - chosen_pickup      -> finalize a station pickup
// Also persists departure_zone_id (the matched zone) so loadq-ride-cascade knows
// which queued drivers to offer for the route pickup.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const GKEY = Deno.env.get("GOOGLE_MAPS_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const MI5 = 8047; // 5 miles in metres

const REGION_CITY: Record<string, string> = {
  montreal: "Montréal, QC, Canada", ottawa: "Ottawa, ON, Canada", quebec: "Québec City, QC, Canada",
  gatineau: "Gatineau, QC, Canada", toronto: "Toronto, ON, Canada",
};

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const u = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GKEY}`;
  const d = await (await fetch(u)).json();
  if (d.status !== "OK" || !d.results?.length) return null;
  const l = d.results[0].geometry.location; return { lat: l.lat, lng: l.lng };
}

async function computeRoute(o: { lat: number; lng: number }, d: { lat: number; lng: number }) {
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GKEY,
      "X-Goog-FieldMask": "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration" },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
      destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
      travelMode: "DRIVE",
    }),
  });
  const j = await r.json();
  if (!j.routes?.length) return null;
  return { poly: decodePolyline(j.routes[0].polyline.encodedPolyline), meters: j.routes[0].distanceMeters };
}

async function nearbyGas(c: { lat: number; lng: number }, radius: number) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GKEY,
      "X-Goog-FieldMask": "places.displayName,places.shortFormattedAddress,places.location" },
    body: JSON.stringify({ includedTypes: ["gas_station"], maxResultCount: 20,
      locationRestriction: { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: Math.min(radius, 20000) } } }),
  });
  const j = await r.json();
  return (j.places ?? []).map((p: any) => ({
    label: p.displayName?.text ?? "Gas station", address: p.shortFormattedAddress ?? "",
    lat: p.location.latitude, lng: p.location.longitude,
  }));
}

function decodePolyline(str: string): [number, number][] {
  let idx = 0, lat = 0, lng = 0; const out: [number, number][] = [];
  while (idx < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

// metres from a point to a polyline (min over segments, local equirectangular projection)
function distToPolyline(pt: { lat: number; lng: number }, poly: [number, number][]): number {
  const R = 6371000, rad = Math.PI / 180, coslat = Math.cos(pt.lat * rad);
  const X = (lng: number) => lng * rad * R * coslat, Y = (lat: number) => lat * rad * R;
  const px = X(pt.lng), py = Y(pt.lat); let best = Infinity;
  for (let i = 0; i + 1 < poly.length; i++) {
    const ax = X(poly[i][1]), ay = Y(poly[i][0]), bx = X(poly[i + 1][1]), by = Y(poly[i + 1][0]);
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy, d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    if (!b.request_id) return json({ error: "request_id required" }, 400);

    const { data: reqRow } = await admin.from("loadq_ride_requests").select("*").eq("id", b.request_id).maybeSingle();
    if (!reqRow) return json({ error: "request not found" }, 404);
    if (reqRow.kind !== "route_pickup") return json({ error: "quote is for route_pickup requests" }, 400);

    // resolve coordinates
    let origin = reqRow.origin_lat != null ? { lat: reqRow.origin_lat, lng: reqRow.origin_lng } : null;
    if (!origin) { origin = await geocode(reqRow.origin_address ?? ""); if (!origin) return json({ error: "could not geocode origin address" }, 422); }
    let dest = reqRow.dest_lat != null ? { lat: reqRow.dest_lat, lng: reqRow.dest_lng } : null;
    if (!dest) {
      const q = reqRow.dest_address || REGION_CITY[reqRow.dest_region ?? ""] || reqRow.dest_region;
      dest = await geocode(q ?? ""); if (!dest) return json({ error: "could not geocode destination" }, 422);
    }
    await admin.from("loadq_ride_requests").update({
      origin_lat: origin.lat, origin_lng: origin.lng, dest_lat: dest.lat, dest_lng: dest.lng,
    }).eq("id", reqRow.id);

    // Fare = the matched departure zone's seat fare (loadq_route_fares) + the
    // route-pickup request fee (loadq_settings.route_pickup_fee_cents, default
    // $12.99). Looked up per zone+destination, not destination alone, so a
    // Toronto→Montréal pickup isn't priced like an Ottawa→Montréal one.
    const { data: feeRow } = await admin.from("loadq_settings").select("value").eq("key", "route_pickup_fee_cents").maybeSingle();
    const PICKUP_FEE_CENTS = feeRow?.value ? parseInt(String(feeRow.value), 10) : 1299;
    const fareForZone = async (zid: string | null | undefined): Promise<number | null> => {
      if (!zid) return null;
      const { data } = await admin.from("loadq_route_fares").select("fare_cents")
        .eq("zone_id", zid).eq("destination_region", reqRow.dest_region).maybeSingle();
      return data?.fare_cents ?? null;
    };

    // finalize a station pickup chosen by the passenger (zone already matched)
    if (b.chosen_pickup?.lat != null) {
      const cp = b.chosen_pickup;
      const base_fare_cents = await fareForZone(reqRow.departure_zone_id);
      const fare_cents = (base_fare_cents ?? 0) + PICKUP_FEE_CENTS;
      await admin.rpc("loadq_ride_set_quote", {
        p_request_id: reqRow.id, p_pickup_type: "station", p_pickup_label: cp.label ?? "Meeting point",
        p_pickup_lat: cp.lat, p_pickup_lng: cp.lng, p_off_route_km: cp.off_route_km ?? null,
        p_fare_cents: fare_cents, p_matched_trip_id: null,
      });
      return json({ mode: "confirmed", pickup: cp, fare_cents, fee_cents: PICKUP_FEE_CENTS, base_fare_cents });
    }

    // candidate departure zones = live zones feeding this destination (fallback: all active zones)
    let zoneIds: string[] = [];
    const { data: liveZ } = await admin.from("queue_entries").select("zone_id")
      .eq("destination_region", reqRow.dest_region).in("status", ["waiting", "loading", "standby"]);
    zoneIds = [...new Set((liveZ ?? []).map((r: any) => r.zone_id))];
    let zq = admin.from("zones").select("id,name,latitude,longitude").not("latitude", "is", null);
    zq = zoneIds.length ? zq.in("id", zoneIds) : zq.eq("is_active", true);
    const { data: zones } = await zq;
    if (!zones?.length) return json({ error: "no candidate routes available" }, 422);

    // route each zone -> destination, keep the one the origin is closest to
    let best: { km: number; poly: [number, number][]; zone: string } | null = null;
    for (const z of zones) {
      const rt = await computeRoute({ lat: z.latitude, lng: z.longitude }, dest);
      if (!rt) continue;
      const m = distToPolyline(origin, rt.poly);
      if (!best || m < best.km) best = { km: m, poly: rt.poly, zone: z.id };
    }
    if (!best) return json({ error: "could not compute a route" }, 422);

    // Persist the matched departure zone so loadq-ride-cascade knows which
    // queued drivers to offer this route pickup to.
    await admin.from("loadq_ride_requests").update({ departure_zone_id: best.zone }).eq("id", reqRow.id);

    // Price from the matched zone's fare row.
    const base_fare_cents = await fareForZone(best.zone);
    const fare_cents = (base_fare_cents ?? 0) + PICKUP_FEE_CENTS;

    if (best.km <= MI5) {
      const off_km = Math.round((best.km / 1000) * 10) / 10;
      await admin.rpc("loadq_ride_set_quote", {
        p_request_id: reqRow.id, p_pickup_type: "on_route", p_pickup_label: reqRow.origin_address,
        p_pickup_lat: origin.lat, p_pickup_lng: origin.lng, p_off_route_km: off_km,
        p_fare_cents: fare_cents, p_matched_trip_id: null,
      });
      return json({ mode: "on_route", pickup: { label: reqRow.origin_address, ...origin }, off_route_km: off_km, fare_cents, fee_cents: PICKUP_FEE_CENTS, base_fare_cents });
    }

    // >5mi: gas stations near origin that are within 5 mi of the route
    const raw = await nearbyGas(origin, Math.min(best.km + 3000, 15000));
    const R = 6371000, rad = Math.PI / 180;
    const hav = (a: any, b: any) => { const dLa = (b.lat - a.lat) * rad, dLo = (b.lng - a.lng) * rad, la1 = a.lat * rad, la2 = b.lat * rad;
      const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
    const stations = raw
      .map((s: any) => ({ ...s, off_route_km: Math.round((distToPolyline(s, best!.poly) / 1000) * 10) / 10,
                          dist_to_you_km: Math.round((hav(origin, s) / 1000) * 10) / 10 }))
      .filter((s: any) => s.off_route_km * 1000 <= MI5)
      .sort((a: any, b: any) => a.dist_to_you_km - b.dist_to_you_km)
      .slice(0, 3);
    return json({ mode: "stations", address_off_route_km: Math.round((best.km / 1000) * 10) / 10, stations, fare_cents, fee_cents: PICKUP_FEE_CENTS, base_fare_cents });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
