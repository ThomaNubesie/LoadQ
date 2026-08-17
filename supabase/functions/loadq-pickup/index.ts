// LoadQ pooled pickup — quote a rider's on-demand pickup (fare + Interac ref) and
// batch paid requests into one driver's van, lined up along the route via Google Routes.
// Auto-batch · ~5 min detour cap per stop · each rider pays own fare (ride + $2 + HST).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const GKEY = Deno.env.get("GOOGLE_MAPS_KEY")!;
const INTERAC_TO = "shaloderick@gmail.com";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// SMS a driver (best-effort) — used to alert a feeder driver of a new run.
const TW_SID = Deno.env.get("KOLIS_TWILIO_SID"), TW_TOKEN = Deno.env.get("KOLIS_TWILIO_TOKEN"), TW_FROM = Deno.env.get("KOLIS_TWILIO_FROM");
async function smsDriver(driverId: string, body: string) {
  try {
    if (!TW_SID || !TW_TOKEN || !TW_FROM) return;
    const { data: d } = await admin.from("drivers").select("phone").eq("id", driverId).maybeSingle();
    let to = d?.phone ? String(d.phone).replace(/[^\d+]/g, "") : ""; if (!to) return;
    if (!to.startsWith("+")) to = to.length === 10 ? "+1" + to : "+" + to;
    const f = new URLSearchParams({ To: to, Body: body }); TW_FROM.startsWith("MG") ? f.set("MessagingServiceSid", TW_FROM) : f.set("From", TW_FROM);
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString() }).catch(() => {});
  } catch { /* best-effort */ }
}

// Departure/loading zone per destination (fallback if no active queue driver is found for it).
const LOADING_ZONE_FALLBACK: Record<string, string> = { montreal: "ottawa-universal-grocery" };

async function setting(key: string, dflt: number) {
  const { data } = await admin.from("loadq_settings").select("value").eq("key", key).maybeSingle();
  const n = data ? Number(data.value) : NaN; return isFinite(n) ? n : dflt;
}
async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GKEY}`);
  const j = await r.json(); const loc = j?.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}
const pt = (lat: number, lng: number) => ({ location: { latLng: { latitude: lat, longitude: lng } } });
async function routes(body: unknown, fieldMask: string) {
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GKEY, "X-Goog-FieldMask": fieldMask }, body: JSON.stringify(body),
  });
  return await r.json();
}
const durMin = (d: string | number | undefined) => { if (d == null) return 0; const s = typeof d === "string" ? parseInt(d) : d; return Math.round(s / 60); };
function payRef(): string { let n = ""; for (let i = 0; i < 5; i++) n += Math.floor(Math.random() * 10); return "LQ-" + n; }

async function rateCard() {
  return {
    perKm: await setting("ondemand_per_km_cents", 100), perMin: await setting("ondemand_per_min_cents", 30),
    flat: await setting("pickup_flat_cents", 1000), farBase: await setting("pickup_far_base_cents", 200),
    radiusKm: await setting("pickup_radius_km", 5), hst: await setting("pickup_hst_rate", 0.13),
  };
}
async function loadingZone(dest: string): Promise<{ lat: number; lng: number; id: string } | null> {
  let zid = LOADING_ZONE_FALLBACK[dest];
  if (!zid) {
    const { data: qe } = await admin.from("queue_entries").select("zone_id").eq("destination_region", dest).neq("status", "ended").limit(1).maybeSingle();
    zid = qe?.zone_id;
  }
  if (!zid) return null;
  const { data: z } = await admin.from("zones").select("latitude,longitude").eq("id", zid).maybeSingle();
  return (z?.latitude != null && z?.longitude != null) ? { lat: z.latitude, lng: z.longitude, id: zid } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = req.method === "POST" ? await req.json().catch(() => ({} as any)) : Object.fromEntries(new URL(req.url).searchParams);
    const action = b.action || "quote";

    // ---------- QUOTE ----------
    if (action === "quote") {
      const address = String(b.address || "").trim();
      const dest = String(b.destination_region || "").toLowerCase().trim();
      if (!address || !dest) return json({ error: "address and destination_region required" }, 400);
      const geo = await geocode(address);
      if (!geo) return json({ error: "could not geocode pickup" }, 422);
      const lz = await loadingZone(dest);
      if (!lz) return json({ error: "no loading zone for destination" }, 422);
      const rj = await routes({ origin: pt(lz.lat, lz.lng), destination: pt(geo.lat, geo.lng), travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" }, "routes.duration,routes.distanceMeters");
      const rt = rj?.routes?.[0]; if (!rt) return json({ error: "no_route", detail: rj?.error?.message }, 502);
      const km = (rt.distanceMeters || 0) / 1000, min = durMin(rt.duration);
      const rc = await rateCard();
      const within = km <= rc.radiusKm;
      const reserve = within ? rc.flat : Math.round(rc.farBase + rc.perKm * km + rc.perMin * min);
      const tax = Math.round(reserve * rc.hst), total = reserve + tax;
      const ref = payRef();
      const { data: ins, error } = await admin.from("loadq_pickup_requests").insert({
        contact_name: b.name || null, contact_phone: b.phone || null, passenger_id: b.passenger_id || null, pickup_address: address,
        pickup_lat: geo.lat, pickup_lng: geo.lng, destination_region: dest, seats: b.seats || 1,
        ride_cents: null, fee_cents: reserve, tax_cents: tax, total_cents: total, pay_ref: ref, status: "quoted",
      }).select("id").single();
      if (error) return json({ error: "save_failed", detail: error.message }, 500);
      return json({ ok: true, request_id: ins.id, pay_ref: ref, interac_to: INTERAC_TO, within_5km: within, pickup_distance_km: Math.round(km * 10) / 10, pickup_eta_min: min, reserve_cents: reserve, tax_cents: tax, total_cents: total });
    }

    // ---------- BATCH ----------
    if (action === "batch") {
      const capMin = await setting("pickup_detour_cap_min", 5);
      const { data: pend } = await admin.from("loadq_pickup_requests").select("*").eq("status", "pending").not("paid_at", "is", null);
      if (!pend || !pend.length) return json({ ok: true, batched: 0, note: "no paid pending requests" });
      const byDest: Record<string, any[]> = {};
      for (const r of pend) (byDest[r.destination_region] ||= []).push(r);
      const results: any[] = [];

      for (const [dest, reqs] of Object.entries(byDest)) {
        const lz = await loadingZone(dest);
        if (!lz) { results.push({ dest, skipped: "no loading zone" }); continue; }
        let driver: any = null;
        const { data: pds } = await admin.from("loadq_pickup_drivers").select("driver_id,vehicle_id,lat,lng").eq("on_duty", true).is("active_run_id", null);
        for (const d of pds ?? []) {
          if (d.lat == null || d.lng == null) continue;
          const { data: veh } = await admin.from("vehicles").select("id,seats").eq("id", d.vehicle_id).maybeSingle();
          if (veh?.seats) { driver = { ...d, seats: veh.seats }; break; }
        }
        if (!driver) { results.push({ dest, skipped: "no on-duty pickup driver" }); continue; }

        const cap = driver.seats as number;
        const take = reqs.slice(0, cap).filter(r => r.pickup_lat != null && r.pickup_lng != null);
        if (!take.length) { results.push({ dest, skipped: "no geocoded requests" }); continue; }

        const rj = await routes({
          origin: pt(driver.lat, driver.lng), destination: pt(lz.lat, lz.lng),
          intermediates: take.map((r: any) => pt(r.pickup_lat, r.pickup_lng)),
          travelMode: "DRIVE", optimizeWaypointOrder: true, routingPreference: "TRAFFIC_UNAWARE",
        }, "routes.duration,routes.legs.duration,routes.optimizedIntermediateWaypointIndex");
        const rt = rj?.routes?.[0]; if (!rt) { results.push({ dest, skipped: "no_route", detail: rj?.error?.message }); continue; }
        const idx: number[] = Array.isArray(rt.optimizedIntermediateWaypointIndex) ? rt.optimizedIntermediateWaypointIndex : take.map((_: any, i: number) => i);
        const legMin: number[] = (rt.legs || []).map((l: any) => durMin(l.duration));
        let ordered = idx.map((i: number) => take[i]).filter((r: any) => r && r.id); // drop any out-of-range index
        if (!ordered.length) ordered = take;                                          // never empty a valid batch
        let total = durMin(rt.duration);
        const budget = cap * capMin + 45;
        while (ordered.length > 1 && total > budget) { ordered = ordered.slice(0, -1); total = legMin.slice(0, ordered.length + 1).reduce((a: number, b: number) => a + b, 0); }

        const { data: run, error: runErr } = await admin.from("loadq_pickup_runs").insert({
          driver_id: driver.driver_id, vehicle_id: driver.vehicle_id, loading_zone_id: lz.id,
          destination_region: dest, loop_min: total, seats_total: cap, seats_filled: 0, status: "active",
        }).select("id").single();
        if (runErr || !run) { results.push({ dest, skipped: "run_insert_failed", detail: runErr?.message }); continue; }
        await admin.from("loadq_pickup_drivers").update({ active_run_id: run.id }).eq("driver_id", driver.driver_id);
        let cum = 0;
        for (let s = 0; s < ordered.length; s++) {
          cum += legMin[s] || 0;
          await admin.from("loadq_pickup_requests").update({ run_id: run.id, seq: s + 1, status: "batched", eta_min: cum }).eq("id", ordered[s].id);
        }
        // Alert the feeder driver by SMS (in addition to the in-app run).
        await smsDriver(driver.driver_id, `LoadQ: new pickup run — ${ordered.length} rider${ordered.length > 1 ? "s" : ""} to collect, then drop at the loading point. Open LoadQ.`);
        results.push({ dest, pickup_driver: driver.driver_id, run_id: run.id, stops: ordered.length, run_min: total, dropoff: lz.id });
      }
      return json({ ok: true, batched: results.reduce((n, r) => n + (r.stops || 0), 0), runs: results });
    }

    // ---------- REMIND ----------
    if (action === "remind") {
      const cutoff = new Date(Date.now() - 5 * 60000).toISOString();
      const { data: due } = await admin.from("loadq_pickup_requests")
        .select("id,contact_phone,destination_region,total_cents,pay_ref,remind_count,reminded_at")
        .eq("status", "quoted").is("paid_at", null).not("contact_phone", "is", null)
        .lt("created_at", cutoff).lt("remind_count", 2);
      const SID = Deno.env.get("KOLIS_TWILIO_SID"), TK = Deno.env.get("KOLIS_TWILIO_TOKEN"), FR = Deno.env.get("KOLIS_TWILIO_FROM");
      let sent = 0;
      for (const r of due ?? []) {
        if (r.reminded_at && (Date.now() - new Date(r.reminded_at).getTime()) < 15 * 60000) continue;
        const amt = "$" + ((r.total_cents || 0) / 100).toFixed(2);
        const dest = (r.destination_region || "").replace(/^\w/, c => c.toUpperCase());
        const body =
          `Rappel — votre trajet LoadQ vers ${dest} (${amt}) attend votre paiement. Envoyez un virement Interac à ${INTERAC_TO} en inscrivant le code ${r.pay_ref} dans le message. Votre conducteur part dès la réception.`
          + `\n\nReminder — your LoadQ pickup to ${dest} (${amt}) is awaiting payment. Send an Interac e-Transfer to ${INTERAC_TO} with code ${r.pay_ref} in the message. Your driver is dispatched once it clears.`;
        if (SID && TK && FR) {
          const f = new URLSearchParams({ To: r.contact_phone, Body: body });
          FR.startsWith("MG") ? f.set("MessagingServiceSid", FR) : f.set("From", FR);
          await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${SID}:${TK}`), "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString() }).catch(() => {});
        }
        await admin.from("loadq_pickup_requests").update({ remind_count: (r.remind_count || 0) + 1, reminded_at: new Date().toISOString() }).eq("id", r.id);
        sent++;
      }
      return json({ ok: true, reminded: sent });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: "server", detail: String(e) }, 500);
  }
});
