// Watchdog: enforces the 2-hour loading cap and 11:59 PM EOD close.
//
// Runs as a Supabase Edge Function on a cron (every minute, see ./README.md).
// For every queue_entry with status='loading':
//   - elapsed since load_start_at >= 2h          → move to back of queue
//   - clock at the zone's local time is closed   → delete entry
// After freeing a zone's loading slot (while its window is open), promote the
// front-most 'waiting' entry in that zone to 'loading'.
//
// Zone timezones come from public.zones (the authoritative source). Update
// rows in that table — never edit a hardcoded map here.
//
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const FALLBACK_TZ  = "America/Toronto"; // used only if a queue entry references a zone_id that's not in public.zones

interface LoadingRow {
  id: string;
  zone_id: string;
  driver_id: string;
  destination_region: string | null;
  load_start_at: string | null;
  vehicle_id: string | null;
  seats_boarded: number | null;
  pushback_count: number | null;
  vehicles: { seats: number } | null;
}

type PushMsg = { to: string; title: string; body: string; sound: "default" };

// How many waiting drivers behind an almost-full loader get the "head back"
// nudge, and how many free seats still counts as "almost full".
const RETURN_NOTIFY_AHEAD   = 5;
const ALMOST_FULL_SEATS_LEFT = 1;

// Insert an alert row (idempotent via the alerts (user_id, ref) unique index)
// and, only when it was newly created, queue a push to that user's device.
// The watchdog runs every minute, so the dedupe guarantees one push per event.
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

interface ZoneRow {
  id: string;
  timezone: string;
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
  if (hour < 4) return true;
  if (hour >= 20) return true;
  return false;
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const now           = new Date();
  const affectedZones = new Set<string>();
  const pushQueue: PushMsg[] = [];

  // Fetch all zones once → map zone_id → tz.
  const { data: zoneRows, error: zoneErr } = await supabase
    .from("zones").select("id, timezone");
  if (zoneErr) {
    return new Response(JSON.stringify({ error: `zones lookup failed: ${zoneErr.message}` }), { status: 500 });
  }
  const tzByZone = new Map<string, string>((zoneRows as ZoneRow[] ?? []).map(z => [z.id, z.timezone]));
  const tzFor = (zoneId: string) => tzByZone.get(zoneId) ?? FALLBACK_TZ;

  const { data: loadingEntries, error } = await supabase
    .from("queue_entries")
    .select("id, zone_id, driver_id, destination_region, load_start_at, vehicle_id, seats_boarded, pushback_count, vehicles(seats)")
    .eq("status", "loading");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const rows = (loadingEntries as LoadingRow[]) ?? [];
  const moved: string[]   = [];
  const removed: string[] = [];
  // Track which (zone, destination) pairs had their loading slot freed
  // so we can promote a waiting driver inside the SAME sub-queue.
  const affectedRoutes = new Set<string>();   // "zoneId::destinationRegion"
  const routeKey = (zoneId: string, destRegion: string | null) => `${zoneId}::${destRegion ?? ""}`;

  for (const e of rows) {
    const zoneClosed  = isWindowClosedInTz(now, tzFor(e.zone_id));
    const elapsedOver = !!e.load_start_at &&
      (now.getTime() - new Date(e.load_start_at).getTime() >= TWO_HOURS_MS);

    // P79: When the zone closes at 8 PM, a driver who's still actively loading
    // keeps their 2-hour clock. They get cleared once the clock elapses on a
    // later watchdog tick. Only act now if either the clock is expired OR the
    // entry isn't loading at all (which never enters this branch — rows is
    // pre-filtered to status='loading').
    if (!elapsedOver) continue;

    affectedZones.add(e.zone_id);
    affectedRoutes.add(routeKey(e.zone_id, e.destination_region));

    // Log the loading session to permanent history before mutating it.
    await supabase.from("loading_history").insert({
      driver_id:          e.driver_id,
      zone_id:            e.zone_id,
      destination_region: e.destination_region,
      vehicle_id:         e.vehicle_id,
      load_start_at:      e.load_start_at,
      ended_at:           now.toISOString(),
      end_reason:         zoneClosed ? "eod_close" : "timeout_2h",
      seats_filled:       e.seats_boarded ?? 0,
    });

    if (zoneClosed) {
      const { error: delErr } = await supabase.from("queue_entries").delete().eq("id", e.id);
      if (!delErr) {
        removed.push(e.id);
        await recordAndQueue(
          supabase, e.driver_id, "removed",
          `removed:${e.id}:${now.toISOString().slice(0, 10)}`,
          "Loading closed for the day",
          "Loading window closed and your 2-hour clock has ended. Rejoin tomorrow.",
          pushQueue,
        );
      }
    } else {
      // P85: Two-strike rule. If this is the driver's SECOND timeout in this
      // queue entry (pushback_count was already 1), remove them instead of
      // moving them back. First-time timeout → move to back AND bump count.
      const previousPushbacks = e.pushback_count ?? 0;
      if (previousPushbacks >= 1) {
        const { error: delErr } = await supabase.from("queue_entries").delete().eq("id", e.id);
        if (!delErr) {
          removed.push(e.id);
          await recordAndQueue(
            supabase, e.driver_id, "removed",
            `removed:${e.id}:${e.load_start_at ?? now.toISOString()}`,
            "Removed from the queue",
            "Your loading time expired twice in a row. You've been removed from the queue — please rejoin when you're ready to load.",
            pushQueue,
          );
        }
      } else {
        // First timeout — move to back of THIS route's sub-queue, bump count.
        let maxQuery = supabase
          .from("queue_entries").select("position")
          .eq("zone_id", e.zone_id);
        maxQuery = e.destination_region
          ? maxQuery.eq("destination_region", e.destination_region)
          : maxQuery.is("destination_region", null);
        const { data: maxRow } = await maxQuery
          .order("position", { ascending: false })
          .limit(1).maybeSingle();
        const newPos = (maxRow?.position ?? 0) + 1;
        const { error: updErr } = await supabase.from("queue_entries").update({
          status:         "waiting",
          position:       newPos,
          load_start_at:  null,
          load_deadline:  null,
          seats_boarded:  0,
          seats_locked:   0,
          seat_states:    null,
          pushback_count: previousPushbacks + 1,
        }).eq("id", e.id);
        if (!updErr) {
          moved.push(e.id);
          await recordAndQueue(
            supabase, e.driver_id, "moved_back",
            `moved_back:${e.id}:${e.load_start_at ?? now.toISOString()}`,
            "Loading time up — last chance",
            "Your 2-hour loading window ended. You've been moved to the back of the queue. If you time out again, you'll be removed.",
            pushQueue,
          );
        }
      }
    }
  }

  // EOD purge — NO ROLLOVER for waiting drivers. When a zone's window closes,
  // wipe everyone EXCEPT a driver who is actively loading with an unexpired
  // 2-hour clock — they get to finish, even if the clock runs past 8 PM. Those
  // entries are picked up by the loading-entries loop above once their clock
  // elapses (next watchdog tick).
  const TWO_HOURS = TWO_HOURS_MS;
  for (const z of (zoneRows as ZoneRow[] ?? [])) {
    if (!isWindowClosedInTz(now, tzFor(z.id))) continue;
    const { data: leftover } = await supabase
      .from("queue_entries")
      .select("id, driver_id, status, load_start_at")
      .eq("zone_id", z.id);
    const left = (leftover ?? []) as { id: string; driver_id: string; status: string; load_start_at: string | null }[];
    if (left.length === 0) continue;

    // Split: keepers (still-running 2h clocks) vs purgees (everyone else).
    const toRemove: typeof left = [];
    const keepers:  typeof left = [];
    for (const l of left) {
      const isLoadingActive =
        l.status === "loading" &&
        l.load_start_at &&
        (now.getTime() - new Date(l.load_start_at).getTime() < TWO_HOURS);
      (isLoadingActive ? keepers : toRemove).push(l);
    }
    if (toRemove.length === 0) continue;

    const { error: purgeErr } = await supabase
      .from("queue_entries").delete().in("id", toRemove.map(t => t.id));
    if (purgeErr) continue;
    for (const l of toRemove) {
      removed.push(l.id);
      await recordAndQueue(
        supabase, l.driver_id, "removed",
        `removed:${l.id}:${now.toISOString().slice(0, 10)}`,
        "Loading closed for the day",
        "Loading is now closed (8:00 PM). The queue resets — rejoin when loading reopens.",
        pushQueue,
      );
    }
  }

  // Sweep for orphan sub-queues: any (zone, destination) that has waiting
  // drivers but no loading driver should have its front driver promoted.
  // Catches cases where a sub-queue starts fresh (no slot was "freed").
  const { data: waitingPairs } = await supabase
    .from("queue_entries").select("zone_id, destination_region")
    .eq("status", "waiting");
  for (const w of (waitingPairs ?? []) as { zone_id: string; destination_region: string | null }[]) {
    affectedRoutes.add(routeKey(w.zone_id, w.destination_region));
  }

  // Promote next waiting driver per (zone, destination) — each route is its own
  // independent sub-queue, so freeing Ottawa→Montreal only promotes within that
  // route, not within Ottawa→Toronto.
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

    const loadStart    = new Date();
    const loadDeadline = new Date(loadStart.getTime() + TWO_HOURS_MS);
    const { error: promErr } = await supabase.from("queue_entries").update({
      status:        "loading",
      load_start_at: loadStart.toISOString(),
      load_deadline: loadDeadline.toISOString(),
    }).eq("id", next.id);
    if (!promErr) {
      promoted.push(next.id);
      const nextRow = next as { id: string; driver_id: string };
      await recordAndQueue(
        supabase, nextRow.driver_id, "slot_open",
        `slot_open:${nextRow.id}:${loadStart.toISOString()}`,
        "It's your turn to load",
        "Your loading slot is open. Head to the loading zone now — you have 2 hours.",
        pushQueue,
      );
    }
  }

  // "Almost full → head back" nudge. For every driver still loading whose
  // vehicle has <= ALMOST_FULL_SEATS_LEFT free seats, push the next few
  // waiting drivers in that same route so they start driving back. Dedupe is
  // keyed to this loading session (load_start_at), so each waiting driver gets
  // exactly one nudge per front-driver stint, not one every minute.
  const movedOrRemoved = new Set<string>([...moved, ...removed]);
  for (const e of rows) {
    if (movedOrRemoved.has(e.id)) continue;
    if (isWindowClosedInTz(now, tzFor(e.zone_id))) continue;
    const capacity = e.vehicles?.seats ?? 0;
    if (capacity <= 0) continue;
    if (capacity - (e.seats_boarded ?? 0) > ALMOST_FULL_SEATS_LEFT) continue;

    let aheadQuery = supabase
      .from("queue_entries").select("id, driver_id")
      .eq("zone_id", e.zone_id).eq("status", "waiting");
    aheadQuery = e.destination_region
      ? aheadQuery.eq("destination_region", e.destination_region)
      : aheadQuery.is("destination_region", null);
    const { data: ahead } = await aheadQuery
      .order("position", { ascending: true }).limit(RETURN_NOTIFY_AHEAD);

    for (const w of (ahead ?? []) as { id: string; driver_id: string }[]) {
      await recordAndQueue(
        supabase, w.driver_id, "return",
        `return:${e.id}:${e.load_start_at ?? ""}:${w.id}`,
        "You're up soon — head back",
        "The driver ahead of you is almost full. Head back to the loading zone.",
        pushQueue,
      );
    }
  }

  await flushPush(pushQueue);

  return new Response(JSON.stringify({
    now: now.toISOString(),
    moved,
    removed,
    promoted,
    pushed: pushQueue.length,
  }), { headers: { "Content-Type": "application/json" } });
});
