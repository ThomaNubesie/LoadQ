// Watchdog: drives the LoadQ 5 AM queue day. Runs as a Supabase Edge Function
// on a cron (every minute, see ./README.md). All driver-facing copy is
// bilingual (EN + FR) and friendly.
//
// Day shape (zone-local): joining opens 00:00, the loading clock starts 05:00,
// the window closes 20:00, and the queue is purged at midnight. The shared
// rules mirror utils/queueDay.ts (kept in sync by hand — this file is Deno and
// can't import the app bundle).
//
// Each tick, per (zone, destination) sub-queue:
//   • Active loader present?  No → start a 10-min grace (warn), then standby.
//                             Yes → clear the grace marker.
//   • Active loader overtime? deadline passed → 3 nudges, 10 min apart, then
//                             release the spot.
//   • No active loader?       Promote the first PRESENT waiting driver; every
//                             absent driver ahead of them is skipped to
//                             'standby'. First loader of the day gets 4h, the
//                             rest 3h.
//   • Standby driver present again? Return them to 'waiting' — they keep their
//                             (earlier) position, so they sit at the front of
//                             the line behind the current loader.
//
// "Present" = a GPS fix inside the zone radius, no older than 10 minutes.
//
// Zone timezones/coords/radius come from public.zones (authoritative).
//
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIN_MS         = 60 * 1000;
const DEFAULT_CAP_MS = 3 * 60 * MIN_MS;        // 3h fallback if load_deadline is null
const FALLBACK_TZ    = "America/Toronto";      // if a zone row is missing a tz

// Day boundaries (zone-local).
let LOAD_OPEN_HOUR  = 5;                        // 05:00 clock start — overridden by public.queue_window
let LOAD_CLOSE_HOUR = 23;                       // 23:00 window close — overridden by public.queue_window
const PURGE_HOUR      = 0;                      // 00:00–00:59 daily purge

// Per-day loading window length.
const FIRST_LOADER_MIN = 240;                  // day's first loader: 4h
const OTHER_LOADER_MIN = 180;                  // everyone else: 3h

// Presence + grace.
const PRESENCE_FRESH_MS = 10 * MIN_MS;         // GPS fix must be this fresh
const GRACE_MS          = 10 * MIN_MS;         // mid-load away grace before standby

// Time-up escalation: nudge cadence and how many nudges before release.
const NUDGE_GAP_MS = 10 * MIN_MS;
const MAX_NUDGES   = 3;

// Low-time reminders for the loading driver (minutes remaining). Deduped.
const LOW_TIME_MINUTES = [30, 10];

// "Head back": notify waiting drivers when the loader is within this much time
// of the deadline OR at/above this fill ratio.
const HEAD_BACK_LEAD_MS = 60 * MIN_MS;
const HEAD_BACK_FILL    = 0.70;

interface DriverLoc {
  current_lat: number | null;
  current_lng: number | null;
  location_at: string | null;
}

interface LoadingRow {
  id: string;
  zone_id: string;
  driver_id: string;
  destination_region: string | null;
  load_start_at: string | null;
  load_deadline: string | null;
  left_zone_at: string | null;
  vehicle_id: string | null;
  seats_boarded: number | null;
  expiry_stage: number | null;
  expiry_msg_at: string | null;
  vehicles: { seats: number } | null;
  drivers: DriverLoc | null;
}

interface ZoneRow {
  id: string;
  timezone: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  manual_queue: boolean | null;
}

type PushMsg = { to: string; title: string; body: string; sound: "default" };

function bi(en: string, fr: string): string {
  return `${en}\n${fr}`;
}

// Insert an alert row (idempotent via the alerts (user_id, ref) unique index)
// and, only when newly created, queue a push to that user's device.
async function recordAndQueue(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  kind: string,
  ref: string,
  title: string,
  body: string,
  pushQueue: PushMsg[],
) {
  const { data, error } = await supabase
    .from("alerts")
    .upsert({ user_id: userId, kind, ref, title, body },
            { onConflict: "user_id,ref", ignoreDuplicates: true })
    .select("id");
  if (error || !data || data.length === 0) return;
  const { data: drv } = await supabase
    .from("drivers").select("push_token").eq("id", userId).maybeSingle();
  const token = (drv as { push_token: string | null } | null)?.push_token;
  if (token) pushQueue.push({ to: token, title, body, sound: "default" });
}

async function flushPush(pushQueue: PushMsg[]) {
  for (let i = 0; i < pushQueue.length; i += 100) {
    const chunk = pushQueue.slice(i, i + 100);
    try {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(chunk),
      });
    } catch { /* push is best-effort */ }
  }
}

function partsInTz(d: Date, tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  return {
    hour:   Number(parts.find(p => p.type === "hour")?.value   ?? "0"),
    minute: Number(parts.find(p => p.type === "minute")?.value ?? "0"),
  };
}

// Loading window is [05:00, 20:00) in the zone's local time.
function isWindowClosedInTz(d: Date, tz: string): boolean {
  const { hour } = partsInTz(d, tz);
  return hour < LOAD_OPEN_HOUR || hour >= LOAD_CLOSE_HOUR;
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// "Present": a fresh (≤10 min) GPS fix inside the zone radius.
function presentInZone(loc: DriverLoc | null, zone: ZoneRow | undefined, now: Date): boolean {
  // Manual-order zones: advance strictly by queue position, ignoring GPS. Every
  // driver counts as "present" so promotion/standby follow the order the operator
  // set on-site — no false "absent" from stale or missing GPS.
  if (zone && zone.manual_queue) return true;
  if (!loc || loc.current_lat == null || loc.current_lng == null || !loc.location_at) return false;
  if (!zone || zone.latitude == null || zone.longitude == null) return false;
  if (now.getTime() - new Date(loc.location_at).getTime() > PRESENCE_FRESH_MS) return false;
  const radius = zone.radius_meters ?? 150;
  return haversineM(loc.current_lat, loc.current_lng, zone.latitude, zone.longitude) <= radius;
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Queue hours are remote-controlled via public.queue_window — change them with
  // a single DB update, no redeploy and no app build.
  const { data: qw } = await supabase
    .from("queue_window").select("load_open_hour, close_hour").eq("id", 1).maybeSingle();
  if (qw) {
    const c = qw as { load_open_hour?: number; close_hour?: number };
    if (typeof c.load_open_hour === "number") LOAD_OPEN_HOUR = c.load_open_hour;
    if (typeof c.close_hour === "number") LOAD_CLOSE_HOUR = c.close_hour;
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const pushQueue: PushMsg[] = [];

  const { data: zoneRows, error: zoneErr } = await supabase
    .from("zones").select("id, timezone, name, latitude, longitude, radius_meters, manual_queue");
  if (zoneErr) {
    return new Response(JSON.stringify({ error: `zones lookup failed: ${zoneErr.message}` }), { status: 500 });
  }
  const zoneById = new Map<string, ZoneRow>((zoneRows as ZoneRow[] ?? []).map(z => [z.id, z]));
  const tzFor = (zoneId: string) => zoneById.get(zoneId)?.timezone ?? FALLBACK_TZ;

  const { data: loadingEntries, error } = await supabase
    .from("queue_entries")
    .select("id, zone_id, driver_id, destination_region, load_start_at, load_deadline, left_zone_at, vehicle_id, seats_boarded, expiry_stage, expiry_msg_at, vehicles(seats), drivers(current_lat, current_lng, location_at)")
    .eq("status", "loading");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const rows = (loadingEntries as unknown as LoadingRow[]) ?? [];
  const removed: string[]   = [];
  const released: string[]  = [];
  const standbyed: string[] = [];

  const affectedRoutes = new Set<string>();
  const routeKey = (zoneId: string, destRegion: string | null) => `${zoneId}::${destRegion ?? ""}`;

  // ── Loop 1: per loading driver — presence grace, reminders, escalation ─────
  for (const e of rows) {
    const tz         = tzFor(e.zone_id);
    const zone       = zoneById.get(e.zone_id);
    const zoneClosed = isWindowClosedInTz(now, tz);
    const deadlineMs = e.load_deadline
      ? new Date(e.load_deadline).getTime()
      : (e.load_start_at ? new Date(e.load_start_at).getTime() + DEFAULT_CAP_MS : null);
    const expired    = deadlineMs !== null && now.getTime() >= deadlineMs;

    // ── Presence grace (Q2): a loader who leaves the zone gets a 10-min grace,
    //    then drops to standby and the slot frees. Only while the window is open.
    if (!zoneClosed) {
      const present = presentInZone(e.drivers, zone, now);
      if (!present) {
        const since = e.left_zone_at ? new Date(e.left_zone_at).getTime() : null;
        if (since == null) {
          await supabase.from("queue_entries").update({ left_zone_at: now.toISOString() }).eq("id", e.id);
          await recordAndQueue(supabase, e.driver_id, "left_zone",
            `leftzone:${e.id}:${e.load_start_at ?? day}`,
            "Return to the zone",
            bi(`You've left ${zone?.name ?? "the loading zone"} while loading. Come back within 10 minutes or you'll be put on standby and the next driver will load.`,
               `Vous avez quitté ${zone?.name ?? "la zone"} pendant le chargement. Revenez dans 10 minutes ou vous serez mis en attente et le prochain chauffeur chargera.`),
            pushQueue);
          continue;
        }
        if (now.getTime() - since >= GRACE_MS) {
          affectedRoutes.add(routeKey(e.zone_id, e.destination_region));
          const { error: sbErr } = await supabase.from("queue_entries")
            .update({ status: "standby", left_zone_at: null, expiry_stage: 0, expiry_msg_at: null })
            .eq("id", e.id);
          if (!sbErr) {
            standbyed.push(e.id);
            await recordAndQueue(supabase, e.driver_id, "standby",
              `standby:${e.id}:${day}`,
              "You're on standby",
              bi("You left the zone while loading, so we moved you to standby and let the next driver load. Return to the zone and you'll be reinserted at the front automatically.",
                 "Vous avez quitté la zone pendant le chargement; nous vous avons mis en attente et laissé charger le prochain chauffeur. Revenez à la zone et vous serez réinséré à l'avant automatiquement."),
              pushQueue);
          }
          continue;
        }
        // Still within grace — wait.
        continue;
      } else if (e.left_zone_at != null) {
        // Back in the zone — clear the grace marker.
        await supabase.from("queue_entries").update({ left_zone_at: null }).eq("id", e.id);
      }
    }

    // EOD: zone closed (8 PM) AND clock run out → close the session.
    if (zoneClosed) {
      if (!expired) continue;
      affectedRoutes.add(routeKey(e.zone_id, e.destination_region));
      await supabase.from("loading_history").insert({
        driver_id: e.driver_id, zone_id: e.zone_id, destination_region: e.destination_region,
        vehicle_id: e.vehicle_id, load_start_at: e.load_start_at,
        ended_at: now.toISOString(), end_reason: "eod_close", seats_filled: e.seats_boarded ?? 0,
      });
      const { error: delErr } = await supabase.from("queue_entries").delete().eq("id", e.id);
      if (!delErr) {
        removed.push(e.id);
        await recordAndQueue(supabase, e.driver_id, "removed",
          `removed:${e.id}:${day}`,
          "Loading closed for the day",
          bi("Loading is closed for today and your time has ended. Rejoin tomorrow — the queue resets at midnight and loading starts at 5 AM.",
             "Le chargement est terminé pour aujourd'hui. Réinscrivez-vous demain — la file repart à minuit et le chargement commence à 5 h."),
          pushQueue);
      }
      continue;
    }

    // Window open, not yet expired → low-time reminders only.
    if (!expired) {
      if (deadlineMs !== null) {
        const remainingMin = Math.round((deadlineMs - now.getTime()) / MIN_MS);
        for (const mins of LOW_TIME_MINUTES) {
          if (remainingMin <= mins && remainingMin > mins - 1) {
            await recordAndQueue(supabase, e.driver_id, "lowtime",
              `lowtime:${e.id}:${e.load_start_at}:${mins}`,
              `About ${mins} minutes left to load`,
              bi(`About ${mins} minutes left to load. Finish boarding when you can.`,
                 `Il vous reste environ ${mins} minutes pour charger.`),
              pushQueue);
          }
        }
      }
      continue;
    }

    // Window open AND expired → 3-nudge escalation, then release.
    const stage = e.expiry_stage ?? 0;
    const lastMsgMs = e.expiry_msg_at ? new Date(e.expiry_msg_at).getTime() : 0;
    const dueForNext = stage === 0 || (now.getTime() - lastMsgMs >= NUDGE_GAP_MS);
    if (!dueForNext) continue;

    if (stage < MAX_NUDGES) {
      const next = stage + 1;
      let title: string, body: string;
      if (next === 1) {
        title = "Your loading time is up";
        body  = bi("Whenever you're ready, tap Depart (with your passengers) or Cancel so the next driver can go.",
                   "Dès que vous êtes prêt, touchez Partir (avec vos passagers) ou Annuler pour laisser passer le prochain chauffeur.");
      } else if (next === 2) {
        title = "Just checking in (2 of 3)";
        body  = bi("Still here? Tap Depart or Cancel when you can.",
                   "Toujours là ? Touchez Partir ou Annuler quand vous pouvez.");
      } else {
        title = "Last little nudge (3 of 3)";
        body  = bi("If we don't hear back, we'll free up your spot for now.",
                   "Sans réponse, nous libérerons votre place pour le moment.");
      }
      await supabase.from("queue_entries")
        .update({ expiry_stage: next, expiry_msg_at: now.toISOString() })
        .eq("id", e.id);
      await recordAndQueue(supabase, e.driver_id, "expiry_nudge",
        `expiry:${e.id}:${e.load_start_at}:${next}`, title, body, pushQueue);
      continue;
    }

    // stage === MAX_NUDGES and 10 min elapsed → release the spot.
    affectedRoutes.add(routeKey(e.zone_id, e.destination_region));
    await supabase.from("loading_history").insert({
      driver_id: e.driver_id, zone_id: e.zone_id, destination_region: e.destination_region,
      vehicle_id: e.vehicle_id, load_start_at: e.load_start_at,
      ended_at: now.toISOString(), end_reason: "released", seats_filled: e.seats_boarded ?? 0,
    });
    const { error: relErr } = await supabase.from("queue_entries")
      .update({ status: "ended", end_reason: "released" })
      .eq("id", e.id);
    if (!relErr) {
      released.push(e.id);
      removed.push(e.id);
      await recordAndQueue(supabase, e.driver_id, "released",
        `released:${e.id}:${e.load_start_at ?? now.toISOString()}`,
        "Your spot was freed up",
        bi("Your loading time ran out, so we released your place to keep the line moving. To come back, join again from the Queue tab (you start at the back).",
           "Votre temps de chargement est écoulé, alors nous avons libéré votre place pour faire avancer la file. Pour revenir, réinscrivez-vous depuis l'onglet File (vous repartez à la fin)."),
        pushQueue);
    }
  }

  // ── Loop 2: daily cycle (midnight purge, 8 PM close → end waiting+standby) ──
  for (const z of (zoneRows as ZoneRow[] ?? [])) {
    const tz = tzFor(z.id);
    const { hour } = partsInTz(now, tz);

    if (hour === PURGE_HOUR) {
      // Midnight: wipe the whole zone for a fresh day (joining reopens at 00:00).
      const { data: all } = await supabase
        .from("queue_entries").select("id").eq("zone_id", z.id);
      const ids = ((all ?? []) as { id: string }[]).map(r => r.id);
      if (ids.length === 0) continue;
      await supabase.from("queue_entries").delete().in("id", ids);
      for (const id of ids) removed.push(id);
      continue;
    }

    if (!isWindowClosedInTz(now, tz)) continue;
    // Window closed (8 PM–midnight): end anyone still waiting or on standby.
    const { data: leftovers } = await supabase
      .from("queue_entries").select("id, driver_id")
      .eq("zone_id", z.id).in("status", ["waiting", "standby"]);
    const list = (leftovers ?? []) as { id: string; driver_id: string }[];
    if (list.length === 0) continue;
    const { error: updErr } = await supabase
      .from("queue_entries").update({ status: "ended", end_reason: "window_closed" })
      .in("id", list.map(w => w.id));
    if (updErr) continue;
    for (const w of list) {
      removed.push(w.id);
      await recordAndQueue(supabase, w.driver_id, "removed",
        `closed:${w.id}:${day}`,
        "Loading closed for the day",
        bi("Loading is now closed for today. The queue resets at midnight; loading starts again at 5 AM.",
           "Le chargement est fermé pour aujourd'hui. La file repart à minuit; le chargement reprend à 5 h."),
        pushQueue);
    }
  }

  // ── Standby reinsertion: a standby driver who is present again returns to
  //    'waiting'. They keep their (earlier) position, so they naturally sit at
  //    the front of the line behind the current loader. ─────────────────────────
  const { data: standbyRows } = await supabase
    .from("queue_entries")
    .select("id, zone_id, destination_region, drivers(current_lat, current_lng, location_at)")
    .eq("status", "standby");
  for (const s of (standbyRows ?? []) as unknown as
       { id: string; zone_id: string; destination_region: string | null; drivers: DriverLoc | null }[]) {
    if (isWindowClosedInTz(now, tzFor(s.zone_id))) continue;
    if (!presentInZone(s.drivers, zoneById.get(s.zone_id), now)) continue;
    const { error: reErr } = await supabase.from("queue_entries")
      .update({ status: "waiting" }).eq("id", s.id);
    if (!reErr) affectedRoutes.add(routeKey(s.zone_id, s.destination_region));
  }

  // Any (zone, destination) with waiting drivers but no loader needs a
  // promotion check — catches fresh sub-queues at 5 AM with no freed slot.
  const { data: waitingPairs } = await supabase
    .from("queue_entries").select("zone_id, destination_region").eq("status", "waiting");
  for (const w of (waitingPairs ?? []) as { zone_id: string; destination_region: string | null }[]) {
    affectedRoutes.add(routeKey(w.zone_id, w.destination_region));
  }

  // ── Present-gated promotion per free sub-queue ─────────────────────────────
  // Among waiting drivers ordered by position, skip absent ones to 'standby'
  // and promote the first PRESENT one. If nobody is present, everyone checked
  // goes to standby and the slot stays open for next tick.
  const promoted: string[] = [];
  for (const key of affectedRoutes) {
    const [zoneId, destRegionRaw] = key.split("::");
    const destRegion = destRegionRaw === "" ? null : destRegionRaw;
    const zone = zoneById.get(zoneId);
    if (isWindowClosedInTz(now, tzFor(zoneId))) continue;

    let stillLoadingQuery = supabase
      .from("queue_entries").select("id").eq("zone_id", zoneId).eq("status", "loading");
    stillLoadingQuery = destRegion
      ? stillLoadingQuery.eq("destination_region", destRegion)
      : stillLoadingQuery.is("destination_region", null);
    const { data: stillLoading } = await stillLoadingQuery.limit(1);
    if (stillLoading && stillLoading.length > 0) continue;

    let waitQuery = supabase
      .from("queue_entries")
      .select("id, driver_id, position, load_minutes_override, drivers(current_lat, current_lng, location_at)")
      .eq("zone_id", zoneId).eq("status", "waiting");
    waitQuery = destRegion
      ? waitQuery.eq("destination_region", destRegion)
      : waitQuery.is("destination_region", null);
    const { data: waiters } = await waitQuery.order("position", { ascending: true });
    const candidates = (waiters ?? []) as unknown as
      { id: string; driver_id: string; position: number; load_minutes_override: number | null; drivers: DriverLoc | null }[];

    // Walk the line: absent drivers are skipped to standby; the first present
    // one is promoted.
    let chosen: { id: string; driver_id: string; load_minutes_override?: number | null } | null = null;
    const skipAbsent: { id: string; driver_id: string }[] = [];
    for (const c of candidates) {
      if (presentInZone(c.drivers, zone, now)) { chosen = c; break; }
      skipAbsent.push(c);
    }

    // Park absent drivers ahead of the chosen one (or everyone, if none present).
    for (const a of skipAbsent) {
      const { error: sbErr } = await supabase.from("queue_entries")
        .update({ status: "standby" }).eq("id", a.id);
      if (!sbErr) {
        standbyed.push(a.id);
        await recordAndQueue(supabase, a.driver_id, "standby",
          `standby:${a.id}:${day}`,
          "You're on standby",
          bi(`Loading started but you weren't in the ${zone?.name ?? "loading"} zone, so you were skipped. Return to the zone and you'll be reinserted at the front automatically.`,
             `Le chargement a commencé mais vous n'étiez pas dans la zone ${zone?.name ?? ""}, vous avez donc été ignoré. Revenez à la zone et vous serez réinséré à l'avant automatiquement.`),
          pushQueue);
      }
    }

    if (!chosen) continue; // nobody present — leave the slot open for next tick

    let loadMins: number;
    if (typeof chosen.load_minutes_override === "number") {
      loadMins = chosen.load_minutes_override;
    } else {
      const { data: minsData } = await supabase.rpc("loadq_load_minutes", { p_zone: zoneId });
      loadMins = typeof minsData === "number" ? minsData : OTHER_LOADER_MIN;
    }
    const loadStart  = new Date();
    const loadDeadline = new Date(loadStart.getTime() + loadMins * MIN_MS);
    const hrs = Math.round(loadMins / 60);
    const { error: promErr } = await supabase.from("queue_entries").update({
      status:         "loading",
      load_start_at:  loadStart.toISOString(),
      load_deadline:  loadDeadline.toISOString(),
      last_active_at: loadStart.toISOString(),
      left_zone_at:   null,
      expiry_stage:   0,
      expiry_msg_at:  null,
    }).eq("id", chosen.id);
    if (!promErr) {
      promoted.push(chosen.id);
      await recordAndQueue(supabase, chosen.driver_id, "slot_open",
        `slot_open:${chosen.id}:${loadStart.toISOString()}`,
        "It's your turn to load",
        bi(`Your loading slot is open — you have ${hrs} hours. You're at the zone, so you're good to go.`,
           `Votre place de chargement est ouverte — vous avez ${hrs} heures. Vous êtes à la zone, c'est parti.`),
        pushQueue);
    }
  }

  // ── "Head back" — when a loader is at ≤1h left OR ≥70% full, message every
  //    waiting driver on that route, urgency scaled to their place in line. ──
  const handled = new Set<string>([...removed, ...released, ...standbyed]);
  for (const e of rows) {
    if (handled.has(e.id)) continue;
    if (isWindowClosedInTz(now, tzFor(e.zone_id))) continue;

    const deadlineMs = e.load_deadline
      ? new Date(e.load_deadline).getTime()
      : (e.load_start_at ? new Date(e.load_start_at).getTime() + DEFAULT_CAP_MS : null);
    const totalSeats   = e.vehicles?.seats ?? 0;
    const passengerCap = Math.max(totalSeats - 1, 1);
    const fillRatio    = (e.seats_boarded ?? 0) / passengerCap;
    const lowOnTime    = deadlineMs !== null && (deadlineMs - now.getTime()) <= HEAD_BACK_LEAD_MS;
    if (!lowOnTime && fillRatio < HEAD_BACK_FILL) continue;

    let waitQuery = supabase
      .from("queue_entries").select("id, driver_id")
      .eq("zone_id", e.zone_id).eq("status", "waiting");
    waitQuery = e.destination_region
      ? waitQuery.eq("destination_region", e.destination_region)
      : waitQuery.is("destination_region", null);
    const { data: waiters } = await waitQuery.order("position", { ascending: true });

    const zoneName = zoneById.get(e.zone_id)?.name ?? "the loading zone";
    const list = (waiters ?? []) as { id: string; driver_id: string }[];
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      let title: string, body: string;
      if (i === 0) {
        title = "You're up next!";
        body  = bi(`The car ahead is almost full. When you can, make your way to the ${zoneName} zone.`,
                   `La voiture devant est presque pleine. Dès que possible, rendez-vous à la zone ${zoneName}.`);
      } else if (i === 1) {
        title = "A good time to head back";
        body  = bi(`The line's moving along. Whenever it suits you, start making your way to ${zoneName}.`,
                   `La file avance bien. Quand cela vous convient, commencez à revenir vers ${zoneName}.`);
      } else {
        title = "Just a heads up";
        body  = bi("The line's moving — no rush at all. We'll give you a friendly nudge as you move up.",
                   "La file avance — aucune urgence. Nous vous ferons un petit rappel à mesure que vous avancez.");
      }
      await recordAndQueue(supabase, w.driver_id, "headback",
        `headback:${e.id}:${e.load_start_at ?? ""}:${w.id}`, title, body, pushQueue);
    }
  }

  await flushPush(pushQueue);

  return new Response(JSON.stringify({
    now: now.toISOString(),
    removed, released, standbyed, promoted, pushed: pushQueue.length,
  }), { headers: { "Content-Type": "application/json" } });
});
