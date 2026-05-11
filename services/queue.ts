import { supabase } from "./supabase";
import { QueueEntry, SeatStatus } from "../constants/types";

export const QueueAPI = {
  async getZoneQueue(zoneId: string): Promise<QueueEntry[]> {
    const { data } = await supabase
      .from("queue_entries")
      .select("*, driver:drivers(*), vehicle:vehicles(*)")
      .eq("zone_id", zoneId)
      .order("position", { ascending: true });
    return data || [];
  },

  async joinQueue(zoneId: string, vehicleId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    const { data: entries } = await supabase
      .from("queue_entries").select("position").eq("zone_id", zoneId)
      .order("position", { ascending: false }).limit(1);
    const position = entries?.[0]?.position ? entries[0].position + 1 : 1;
    const { data, error } = await supabase
      .from("queue_entries")
      .insert({ zone_id: zoneId, driver_id: user.id, vehicle_id: vehicleId, position, status: "waiting" })
      .select().single();
    return { data, error: error?.message };
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

  async leaveQueue(entryId: string) {
    const { error } = await supabase.from("queue_entries").delete().eq("id", entryId);
    return { error: error?.message };
  },

  subscribeToZone(zoneId: string, callback: (payload: any) => void) {
    return supabase
      .channel("zone-" + zoneId)
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries", filter: "zone_id=eq." + zoneId }, callback)
      .subscribe();
  },
};
