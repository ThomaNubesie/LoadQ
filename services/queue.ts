import { supabase } from "./supabase";
import { QueueEntry, SeatStatus } from "../constants/types";
import { isWithinLoadingWindow } from "../utils/loadingTimer";
import { getZoneTimezone } from "../hooks/useZones";
import { DriversAPI } from "./drivers";

// Postgres unique_violation. A queue_entries_zone_dest_position_uniq collision
// means another driver grabbed the same position in the same instant — the
// caller should recompute its slot and retry.
function isUniqueViolation(err: any): boolean {
  return err?.code === "23505" || /duplicate key|unique constraint/i.test(err?.message ?? "");
}

export const QueueAPI = {
  // Profile validation gate. A driver may only join the queue once an admin
  // has verified them AND their profile/vehicle/billing are in good standing.
  async canJoin(): Promise<{ ok: boolean; reason?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "Not authenticated" };

    const driver = await DriversAPI.getMe();
    if (!driver) return { ok: false, reason: "Driver profile not found" };

    if (driver.blocked) {
      return { ok: false, reason: "Your account has been blocked. Contact support for help." };
    }
    if (!driver.verified) {
      return { ok: false, reason: "Your account is pending verification. An admin will review it shortly." };
    }
    if (!driver.full_name?.trim() || !driver.phone?.trim() || !driver.dob || !driver.sex) {
      return { ok: false, reason: "Complete your profile (name, phone, date of birth, sex) before joining." };
    }

    const { data: activeVehicle } = await supabase
      .from("vehicles").select("id")
      .eq("driver_id", user.id).eq("is_active", true).limit(1).maybeSingle();
    if (!activeVehicle) {
      return { ok: false, reason: "Add and select an active vehicle before joining." };
    }

    const entitled = await DriversAPI.hasActiveSubscription();
    if (!entitled) {
      return { ok: false, reason: "Your subscription is inactive. Subscribe or restore to join the queue." };
    }
    return { ok: true };
  },

  // The signed-in user's current ACTIVE queue entry, across ALL zones. We
  // exclude status='ended' because those are yesterday's greyed-out rows kept
  // for the daily history view (P96) — they must NOT count as "I'm already in
  // queue", otherwise the driver is permanently blocked from rejoining the
  // next day until the 3 AM purge fires.
  async getMyEntry(): Promise<QueueEntry | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("queue_entries")
      .select("*, driver:drivers(*), vehicle:vehicles(*)")
      .eq("driver_id", user.id)
      .neq("status", "ended")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  },

  async getZoneQueue(zoneId: string): Promise<QueueEntry[]> {
    const { data } = await supabase
      .from("queue_entries")
      .select("*, driver:drivers(*), vehicle:vehicles(*)")
      .eq("zone_id", zoneId)
      .order("position", { ascending: true });
    return data || [];
  },

  async joinQueue(zoneId: string, vehicleId: string, destinationRegion: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    if (!destinationRegion) return { error: "Destination is required" };
    if (!isWithinLoadingWindow(new Date(), getZoneTimezone(zoneId))) {
      return { error: "Queue closed (4:00 AM – 8:00 PM local)" };
    }

    const gate = await this.canJoin();
    if (!gate.ok) return { error: gate.reason };

    // 60-minute depart cooldown per zone: after a driver Departs from a
    // zone, they can't rejoin THAT zone for 60 minutes. Prevents
    // queue-jumping where a driver picks up one passenger, drops them at
    // an arbitrary nearby spot, and immediately rejoins the front of the
    // line. Loading-history.end_reason='departed' is the source of truth.
    const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentDepart } = await supabase
      .from("loading_history")
      .select("ended_at")
      .eq("driver_id", user.id)
      .eq("zone_id", zoneId)
      .eq("end_reason", "departed")
      .gte("ended_at", sixtyMinAgo)
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentDepart?.ended_at) {
      const elapsed   = Date.now() - new Date(recentDepart.ended_at).getTime();
      const remaining = Math.ceil((60 * 60 * 1000 - elapsed) / 60_000);
      return { error: `You departed this zone recently. Wait ${remaining} min before rejoining.` };
    }

    // Position is scoped to this specific route (zone + destination) and
    // tracks the day's chronological progression — we INCLUDE status='ended'
    // rows when computing max+1 so the numbers reflect the order of arrival
    // across the whole day. Example: if A=1, B=2, C=3 (current loader) and
    // A+B have departed, a new joiner is #4, not #2. The departed rows stay
    // visible in the list (greyed) with their original numbers so the daily
    // history is intact. Reset happens via the 3 AM purge.
    //
    // A DB unique index (queue_entries_zone_dest_position_uniq) guarantees no
    // two drivers ever share a position. Because max+1 is computed client-side
    // it can race, so we retry on a unique violation: each attempt re-reads the
    // now-committed rows, so the loser of the race lands on the next free slot
    // (and re-evaluates whether it's still the first loader on this route).
    const now = new Date();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: entries } = await supabase
        .from("queue_entries").select("position")
        .eq("zone_id", zoneId)
        .eq("destination_region", destinationRegion)
        .order("position", { ascending: false }).limit(1);
      const position = entries?.[0]?.position ? entries[0].position + 1 : 1;

      // Auto-promote: if there's no driver currently loading on this route,
      // this new entry goes straight into 'loading' with a fresh timer.
      // Otherwise they wait in line.
      const { data: existingLoading } = await supabase
        .from("queue_entries").select("id")
        .eq("zone_id", zoneId)
        .eq("destination_region", destinationRegion)
        .eq("status", "loading")
        .limit(1);
      const isFirstLoader = !existingLoading || existingLoading.length === 0;

      const insertPayload: Record<string, unknown> = {
        zone_id:            zoneId,
        driver_id:          user.id,
        vehicle_id:         vehicleId,
        destination_region: destinationRegion,
        position,
        status:             isFirstLoader ? "loading" : "waiting",
      };
      if (isFirstLoader) {
        // loadq_load_minutes is the single source of truth for window length
        // (4h for the day's first loader in the 4–6am window, else 2h). The
        // watchdog uses the same RPC when it promotes the next driver.
        const loadMins = await this.loadMinutes(zoneId);
        insertPayload.load_start_at = now.toISOString();
        insertPayload.load_deadline = new Date(now.getTime() + loadMins * 60 * 1000).toISOString();
      }
      const { data, error } = await supabase
        .from("queue_entries")
        .insert(insertPayload)
        .select().single();
      if (!error) return { data };
      // Someone took this slot between our read and write — recompute & retry.
      if (!isUniqueViolation(error) || attempt === 4) return { error: error.message };
    }
    return { error: "Couldn't reserve a queue spot — please try again." };
  },

  // Per-day load window in minutes for a zone (240 for the day's first loader
  // when they start in the 4–6am window, else 120). Falls back to 120 if the
  // RPC is unavailable.
  async loadMinutes(zoneId: string): Promise<number> {
    const { data, error } = await supabase.rpc("loadq_load_minutes", { p_zone: zoneId });
    return !error && typeof data === "number" ? data : 120;
  },

  // Report the driver's current GPS so the watchdog can tailor a release
  // message (near the zone vs. away). Best-effort; never throws.
  async reportLocation(lat: number, lng: number) {
    try { await supabase.rpc("loadq_report_location", { p_lat: lat, p_lng: lng }); }
    catch { /* best-effort */ }
  },

  async startLoading(entryId: string, zoneId?: string) {
    // Window check is done by the caller (which knows the zone) and by the
    // watchdog Edge Function. No global guard here so the watchdog's
    // auto-promotion (which already did a per-zone TZ check) is not blocked.
    const loadStart    = new Date();
    const loadMins     = zoneId ? await this.loadMinutes(zoneId) : 120;
    const loadDeadline = new Date(loadStart.getTime() + loadMins * 60 * 1000);
    const { error } = await supabase
      .from("queue_entries")
      .update({
        status:        "loading",
        load_start_at: loadStart.toISOString(),
        load_deadline: loadDeadline.toISOString(),
        expiry_stage:  0,
        expiry_msg_at: null,
      })
      .eq("id", entryId);
    return { error: error?.message };
  },

  async updateSeatStates(entryId: string, seatStates: SeatStatus[], seated: number) {
    const { error } = await supabase
      .from("queue_entries")
      .update({ seat_states: seatStates, seats_boarded: seated })
      .eq("id", entryId);
    return { error: error?.message };
  },

  async confirmSeats(queueEntryId: string, seatsClaimed: number, confirmed: boolean, disputed: boolean) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    const { data, error } = await supabase
      .from("seat_confirmations")
      .insert({ queue_entry_id: queueEntryId, confirming_driver_id: user.id, seats_claimed: seatsClaimed, confirmed, disputed })
      .select().single();
    if (confirmed) {
      await supabase.from("queue_entries").update({ seats_locked: seatsClaimed }).eq("id", queueEntryId);
    }
    return { data, error: error?.message };
  },

  // Change destination — only allowed within 1h of load_start_at AND when no
  // passengers have boarded yet. Re-positions at the back of the new sub-queue.
  async changeDestination(entry: QueueEntry, newDestination: string): Promise<{ error?: string }> {
    if ((entry.seats_boarded ?? 0) > 0) {
      return { error: "Can't change destination — passengers already boarded." };
    }
    if (entry.load_start_at) {
      const elapsed = Date.now() - new Date(entry.load_start_at).getTime();
      if (elapsed > 60 * 60 * 1000) {
        return { error: "Can't change destination — more than 1 hour since loading started." };
      }
    }
    // New position = back of the destination's sub-queue. Retry on a unique
    // violation in case another driver lands on the same slot concurrently.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: maxRow } = await supabase
        .from("queue_entries").select("position")
        .eq("zone_id", entry.zone_id)
        .eq("destination_region", newDestination)
        .order("position", { ascending: false }).limit(1).maybeSingle();
      const newPos = (maxRow?.position ?? 0) + 1;
      const { error } = await supabase.from("queue_entries").update({
        destination_region: newDestination,
        position:           newPos,
      }).eq("id", entry.id);
      if (!error) return {};
      if (!isUniqueViolation(error) || attempt === 4) return { error: error.message };
    }
    return { error: "Couldn't change destination — please try again." };
  },

  // Fire-and-forget watchdog invocation. Used by clients to force the
  // 2h/EOD enforcement immediately instead of waiting for the next cron tick.
  triggerWatchdog() {
    supabase.functions.invoke("queue-close-watchdog", { body: {} }).catch(() => {});
  },

  async leaveQueue(entryId: string) {
    // P96: persist for the day — mark ended instead of deleting.
    const { error } = await supabase
      .from("queue_entries")
      .update({ status: "ended", end_reason: "cancelled" })
      .eq("id", entryId);
    return { error: error?.message };
  },

  // Driver-initiated departure: log the session to loading_history, delete
  // their entry, then trigger the watchdog so the next waiting driver in the
  // same sub-queue is promoted without waiting for the next cron tick.
  async depart(entryId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    // Read the entry first so we can log its details to history.
    const { data: entry } = await supabase
      .from("queue_entries")
      .select("driver_id, zone_id, destination_region, vehicle_id, load_start_at, seats_boarded")
      .eq("id", entryId).maybeSingle();

    if (entry && user && entry.driver_id === user.id) {
      await supabase.from("loading_history").insert({
        driver_id:          entry.driver_id,
        zone_id:            entry.zone_id,
        destination_region: entry.destination_region,
        vehicle_id:         entry.vehicle_id,
        load_start_at:      entry.load_start_at,
        ended_at:           new Date().toISOString(),
        end_reason:         "departed",
        seats_filled:       entry.seats_boarded ?? 0,
      });
    }

    // P96: persist for the day — mark ended instead of deleting.
    const { error } = await supabase
      .from("queue_entries")
      .update({ status: "ended", end_reason: "departed" })
      .eq("id", entryId);
    if (error) return { error: error.message };
    supabase.functions.invoke("queue-close-watchdog", { body: {} }).catch(() => {});
    return {};
  },

  subscribeToZone(zoneId: string, callback: (payload: any) => void) {
    const name = `zone-${zoneId}`;
    // Remove existing channel first to avoid duplicate error
    const existing = supabase.getChannels().find(ch => ch.topic === `realtime:${name}`);
    if (existing) supabase.removeChannel(existing);
    const channel = supabase
      .channel(name)
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries", filter: `zone_id=eq.${zoneId}` }, callback)
      .subscribe();
    return { unsubscribe: () => supabase.removeChannel(channel) };
  },
};
