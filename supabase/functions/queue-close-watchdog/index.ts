// Watchdog: drives the loading window, the time-up escalation, and the
// "head back" calls. Runs as a Supabase Edge Function on a cron (every minute,
// see ./README.md). All driver-facing copy is bilingual (EN + FR) and friendly.
//
// Per queue_entry with status='loading':
//   • before the deadline      → low-time reminders at 30 / 10 min left
//   • deadline passes          → 3 gentle nudges, 10 min apart (expiry_stage 1→3)
//   • still no Depart/Cancel    → release the spot (status='ended', removed).
//                                 GPS only tailors the message (near vs away);
//                                 the spot is freed either way.
//   • zone clock hits 8 PM EOD  → close out as before
//
// Loading window length is per-zone & per-day: the first two loaders of the day
// get 240 min (4h), everyone after gets 180 min (3h) — see loadq_load_minutes().
// load_deadline on the row is the source of truth here.
//
// "Head back" — when the front loader is at ≤1h left OR ≥70% full, every waiting
// driver on that route is messaged, with urgency scaled to their place in line
// (next = warmest, then medium, then a gentle heads-up).
//
// Zone timezones/coords come from public.zones (authoritative). Update rows in
// that table — never hardcode a map here.
//
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIN_MS        = 60 * 1000;
const DEFAULT_CAP_MS = 3 * 60 * MIN_MS;        // fallback if load_deadline is null
const FALLBACK_TZ   = "America/Toronto";       // if a zone row is missing a tz

// Time-up escalation: nudge cadence and how many nudges before release.
const NUDGE_GAP_MS = 10 * MIN_MS;              // 10 min between nudges
const MAX_NUDGES   = 3;                        // 3 nudges, then release

// Low-time reminders for the loading driver — minutes remaining at which to
// nudge. Deduped per loading session so each fires once.
const LOW_TIME_MINUTES = [30, 10];

// "Head back" trigger: notify all waiting drivers when the loader is within
// this much time of the deadline OR at/above this fill ratio.
const HEAD_BACK_LEAD_MS = 60 * MIN_MS;         // 1 hour left
const HEAD_BACK_FILL    = 0.70;                // 70% of passenger seats

// A driver location is "fresh enough" to tailor the release message if it was
// reported within this window. Older than that → treat as "away".
const LOCATION_FRESH_MS = 20 * MIN_MS;
const AT_ZONE_METERS    = 1000;                // ≤1 km counts as "at the zone"

interface LoadingRow {
  id: string;
  zone_id: string;
  driver_id: string;
  destination_region: string | null;
  load_start_at: string | null;
  load_deadline: string | null;
  vehicle_id: string | null;
  seats_boarded: number | null;
  expiry_stage: number | null;
  expiry_msg_at: string | null;
  vehicles: { seats: number } | null;
}

interface ZoneRow {
  id: string;
  timezone: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface DriverLoc {
  current_lat: number | null;
  current_lng: number | null;
  location_at: string | null;
}

type PushMsg = { to: string; title: string; body: string; sound: "default" };

// Combine an EN + FR message into one bilingual body (title stays EN-short).
function bi(en: string, fr: string): string {
  return `${en}\n${fr}`;
}

// Insert an alert row (idempotent via the alerts (user_id, ref) unique index)
// and, only when it was newly created, queue a push to that user's device.
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
  if (error || !data || data.length === 0) return; // duplicate / failure → no push
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

function isWindowClosedInTz(d: Date, tz: string): boolean {
  // Loading window is [04:00, 20:00) in the zone's local time.
  const { hour } = partsInTz(d, tz);
  return hour < 4 || hour >= 20;
}

// Great-circle distance in metres.
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

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const now = new Date();
  const pushQueue: PushMsg[] = [];

  // Fetch all zones once → tz + name + coords.
  const { data: zoneRows, error: zoneErr } = await supabase
    .from("zones").select("id, timezone, name, latitude, longitude");
  if (zoneErr) {
    return new Response(JSON.stringify({ error: `zones lookup failed: ${zoneErr.message}` }), { status: 500 });
  }
  const zoneById = new Map<string, ZoneRow>((zoneRows as ZoneRow[] ?? []).map(z => [z.id, z]));
  const tzFor = (zoneId: string) => zoneById.get(zoneId)?.timezone ?? FALLBACK_TZ;

  const { data: loadingEntries, error } = await supabase
    .from("queue_entries")
    .select("id, zone_id, driver_id, destination_region, load_start_at, load_deadline, vehicle_id, seats_boarded, expiry_stage, expiry_msg_at, vehicles(seats)")
    .eq("status", "loading");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const rows = (loadingEntries as LoadingRow[]) ?? [];
  const moved: string[]   = [];   // kept for response shape; escalation no longer moves-to-back
  const removed: string[] = [];
  const released: string[] = [];

  // Track which (zone, destination) sub-queues had their loading slot freed so
  // we can promote a waiting driver inside the SAME sub-queue.
  const affectedRoutes = new Set<string>();   // "zoneId::destinationRegion"
  const routeKey = (zoneId: string, destRegion: string | null) => `${zoneId}::${destRegion ?? ""}`;

  // ── Loop 1: per loading driver — reminders, escalation, EOD close ──────────
  for (const e of rows) {
    const tz         = tzFor(e.zone_id);
    const zoneClosed = isWindowClosedInTz(now, tz);
    const deadlineMs = e.load_deadline
      ? new Date(e.load_deadline).getTime()
      : (e.load_start_at ? new Date(e.load_start_at).getTime() + DEFAULT_CAP_MS : null);
    const expired    = deadlineMs !== null && now.getTime() >= deadlineMs;

    // EOD: zone closed (8 PM) AND the clock has run out → close the session.
    // A driver still mid-clock when the zone closes keeps loading until their
    // deadline elapses on a later tick (P79).
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
          `removed:${e.id}:${now.toISOString().slice(0, 10)}`,
          "Loading closed for the day",
          bi("Loading is closed for today and your time has ended. Rejoin tomorrow — the queue resets at 4 AM.",
             "Le chargement est terminé pour aujourd'hui. Réinscrivez-vous demain — la file repart à 4 h."),
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

    // stage === MAX_NUDGES and 10 min elapsed → release the spot (removed).
    // GPS only changes the wording: near the zone vs. away.
    affectedRoutes.add(routeKey(e.zone_id, e.destination_region));
    const { data: drvLoc } = await supabase
      .from("drivers").select("current_lat, current_lng, location_at")
      .eq("id", e.driver_id).maybeSingle();
    const loc  = drvLoc as DriverLoc | null;
    const zone = zoneById.get(e.zone_id);
    let atZone = false;
    if (loc?.current_lat != null && loc?.current_lng != null && loc?.location_at &&
        zone?.latitude != null && zone?.longitude != null &&
        now.getTime() - new Date(loc.location_at).getTime() <= LOCATION_FRESH_MS) {
      atZone = haversineM(loc.current_lat, loc.current_lng, zone.latitude, zone.longitude) <= AT_ZONE_METERS;
    }

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
      const title = "Your spot was freed up";
      const body = atZone
        ? bi("Looks like you're near the zone — if you're ready, just tap Depart next time, or Cancel if plans changed. We've freed your spot for now; rejoin from the Queue tab.",
             "Vous semblez près de la zone — si vous êtes prêt, touchez Partir la prochaine fois, ou Annuler si vos plans ont changé. Nous avons libéré votre place; réinscrivez-vous depuis l'onglet File.")
        : bi("We couldn't reach you, so we released your place to keep the line moving. To come back, just join again from the Queue tab — the normal rejoin rules apply (you start at the back).",
             "Nous n'avons pas pu vous joindre, alors nous avons libéré votre place pour faire avancer la file. Pour revenir, réinscrivez-vous depuis l'onglet File (vous repartez à la fin).");
      await recordAndQueue(supabase, e.driver_id, "released",
        `released:${e.id}:${e.load_start_at ?? now.toISOString()}`, title, body, pushQueue);
    }
  }

  // ── Loop 2: daily cycle (8 PM close → greying, 3 AM purge) ────────────────
  for (const z of (zoneRows as ZoneRow[] ?? [])) {
    if (!isWindowClosedInTz(now, tzFor(z.id))) continue;
    const { hour } = partsInTz(now, tzFor(z.id));
    const isPurgeHour = hour === 3; // 3:00–3:59 AM local

    if (isPurgeHour) {
      const { data: all } = await supabase
        .from("queue_entries").select("id").eq("zone_id", z.id);
      const ids = ((all ?? []) as { id: string }[]).map(r => r.id);
      if (ids.length === 0) continue;
      await supabase.from("queue_entries").delete().in("id", ids);
      for (const id of ids) removed.push(id);
    } else {
      const { data: waiters } = await supabase
        .from("queue_entries").select("id, driver_id")
        .eq("zone_id", z.id).eq("status", "waiting");
      const waitList = (waiters ?? []) as { id: string; driver_id: string }[];
      if (waitList.length === 0) continue;
      const { error: updErr } = await supabase
        .from("queue_entries").update({ status: "ended", end_reason: "window_closed" })
        .in("id", waitList.map(w => w.id));
      if (updErr) continue;
      for (const w of waitList) {
        removed.push(w.id);
        await recordAndQueue(supabase, w.driver_id, "removed",
          `closed:${w.id}:${now.toISOString().slice(0, 10)}`,
          "Loading closed for the day",
          bi("Loading is now closed for today. The queue resets at 4 AM tomorrow.",
             "Le chargement est fermé pour aujourd'hui. La file repart à 4 h demain."),
          pushQueue);
      }
    }
  }

  // Any (zone, destination) that has waiting drivers but no loader should have
  // its front driver promoted — catches fresh sub-queues with no freed slot.
  const { data: waitingPairs } = await supabase
    .from("queue_entries").select("zone_id, destination_region").eq("status", "waiting");
  for (const w of (waitingPairs ?? []) as { zone_id: string; destination_region: string | null }[]) {
    affectedRoutes.add(routeKey(w.zone_id, w.destination_region));
  }

  // ── Promote the next waiting driver per freed sub-queue ───────────────────
  const promoted: string[] = [];
  for (const key of affectedRoutes) {
    const [zoneId, destRegionRaw] = key.split("::");
    const destRegion = destRegionRaw === "" ? null : destRegionRaw;
    if (isWindowClosedInTz(now, tzFor(zoneId))) continue;

    let stillLoadingQuery = supabase
      .from("queue_entries").select("id").eq("zone_id", zoneId).eq("status", "loading");
    stillLoadingQuery = destRegion
      ? stillLoadingQuery.eq("destination_region", destRegion)
      : stillLoadingQuery.is("destination_region", null);
    const { data: stillLoading } = await stillLoadingQuery.limit(1);
    if (stillLoading && stillLoading.length > 0) continue;

    let nextQuery = supabase
      .from("queue_entries").select("id, driver_id")
      .eq("zone_id", zoneId).eq("status", "waiting");
    nextQuery = destRegion
      ? nextQuery.eq("destination_region", destRegion)
      : nextQuery.is("destination_region", null);
    const { data: next } = await nextQuery
      .order("position", { ascending: true }).limit(1).maybeSingle();
    if (!next) continue;

    // Per-day window length: first two loaders of the day get 4h, else 3h.
    const { data: minsData } = await supabase.rpc("loadq_load_minutes", { p_zone: zoneId });
    const loadMins   = typeof minsData === "number" ? minsData : 180;
    const loadStart  = new Date();
    const loadDeadline = new Date(loadStart.getTime() + loadMins * MIN_MS);
    const hrs = Math.round(loadMins / 60);
    const { error: promErr } = await supabase.from("queue_entries").update({
      status:        "loading",
      load_start_at: loadStart.toISOString(),
      load_deadline: loadDeadline.toISOString(),
      expiry_stage:  0,
      expiry_msg_at: null,
    }).eq("id", next.id);
    if (!promErr) {
      promoted.push(next.id);
      const nextRow = next as { id: string; driver_id: string };
      await recordAndQueue(supabase, nextRow.driver_id, "slot_open",
        `slot_open:${nextRow.id}:${loadStart.toISOString()}`,
        "It's your turn to load",
        bi(`Your loading slot is open. Head to the loading zone now — you have ${hrs} hours.`,
           `Votre place de chargement est ouverte. Rendez-vous à la zone maintenant — vous avez ${hrs} heures.`),
        pushQueue);
    }
  }

  // ── "Head back" — when a loader is at ≤1h left OR ≥70% full, message every
  //    waiting driver on that route, urgency scaled to their place in line. ──
  const handled = new Set<string>([...removed, ...released]);
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
    moved, removed, released, promoted, pushed: pushQueue.length,
  }), { headers: { "Content-Type": "application/json" } });
});
