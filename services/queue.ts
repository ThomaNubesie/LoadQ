import { supabase } from "./supabase";
import { QueueEntry, SeatStatus } from "../constants/types";
import { isWithinLoadingWindow } from "../utils/loadingTimer";
import { getZoneTimezone } from "../hooks/useZones";
import { DriversAPI } from "./drivers";

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

  // The signed-in user's current queue entry, across ALL zones.
  async getMyEntry(): Promise<QueueEntry | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("queue_entries")
      .select("*, driver:drivers(*), vehicle:vehicles(*)")
      .eq("driver_id", user.id)
      .order("joined_at", { ascending: false })
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

    // Position is scoped to this specific route (zone + destination).
    const { data: entries } = await supabase
      .from("queue_entries").select("position")
      .eq("zone_id", zoneId)
      .eq("destination_region", destinationRegion)
      .order("position", { ascending: false }).limit(1);
    const position = entries?.[0]?.position ? entries[0].position + 1 : 1;

    // Auto-promote: if there's no driver currently loading on this route,
    // this new entry goes straight into 'loading' state with a fresh 2h timer.
    // Otherwise they wait in line.
    const { data: existingLoading } = await supabase
      .from("queue_entries").select("id")
      .eq("zone_id", zoneId)
      .eq("destination_region", destinationRegion)
      .eq("status", "loading")
      .limit(1);
    const isFirstLoader = !existingLoading || existingLoading.length === 0;

    const now            = new Date();
    const loadDeadline   = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const insertPayload: Record<string, unknown> = {
      zone_id:            zoneId,
      driver_id:          user.id,
      vehicle_id:         vehicleId,
      destination_region: destinationRegion,
      position,
      status:             isFirstLoader ? "loading" : "waiting",
    };
    if (isFirstLoader) {
      insertPayload.load_start_at = now.toISOString();
      insertPayload.load_deadline = loadDeadline.toISOString();
    }
    const { data, error } = await supabase
      .from("queue_entries")
      .insert(insertPayload)
      .select().single();
    return { data, error: error?.message };
  },

  async startLoading(entryId: string) {
    // Window check is done by the caller (which knows the zone) and by the
    // watchdog Edge Function. No global guard here so the watchdog's
    // auto-promotion (which already did a per-zone TZ check) is not blocked.
    const loadStart    = new Date();
    const loadDeadline = new Date();
    loadDeadline.setHours(loadDeadline.getHours() + 3);
    const { error } = await supabase
      .from("queue_entries")
      .update({
        status:        "loading",
        load_start_at: loadStart.toISOString(),
        load_deadline: loadDeadline.toISOString(),
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
    // New position = back of the destination's sub-queue.
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
    return { error: error?.message };
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
