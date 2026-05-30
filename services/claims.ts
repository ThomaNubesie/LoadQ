import { supabase } from "./supabase";

export type ClaimStatus = "pending" | "confirmed" | "rejected" | "cancelled";

export interface SeatClaim {
  id:              string;
  passenger_id:    string;
  queue_entry_id:  string;
  status:          ClaimStatus;
  claimed_at:      string;
  confirmed_at?:   string | null;
  rejected_at?:    string | null;
  cancelled_at?:   string | null;
  passenger?: {
    id:         string;
    full_name:  string;
    avatar_url: string | null;
  };
}

export const ClaimsAPI = {
  // Passenger creates a pending claim on a driver's queue entry.
  async claim(queueEntryId: string): Promise<{ data?: SeatClaim; error?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const { data: passenger } = await supabase
      .from("passengers").select("blocked").eq("id", user.id).maybeSingle();
    if (passenger?.blocked) {
      return { error: "Your account has been blocked. Contact support for help." };
    }

    const { data, error } = await supabase
      .from("seat_claims")
      .insert({ passenger_id: user.id, queue_entry_id: queueEntryId, status: "pending" })
      .select()
      .single();
    return { data: data as SeatClaim | undefined, error: error?.message };
  },

  // Passenger cancels their own pending claim.
  async cancel(claimId: string): Promise<{ error?: string }> {
    const { error } = await supabase
      .from("seat_claims")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", claimId)
      .eq("status", "pending");
    return { error: error?.message };
  },

  // Passenger's open claim for a given queue entry (used to disable "Claim seat" button).
  async findOpenClaim(queueEntryId: string): Promise<SeatClaim | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("seat_claims")
      .select("*")
      .eq("passenger_id", user.id)
      .eq("queue_entry_id", queueEntryId)
      .in("status", ["pending", "confirmed"])
      .maybeSingle();
    return (data as SeatClaim) ?? null;
  },

  // Driver: list pending claims on one of their queue entries.
  async listPending(queueEntryId: string): Promise<SeatClaim[]> {
    const { data } = await supabase
      .from("seat_claims")
      .select("*, passenger:passengers(id, full_name, avatar_url)")
      .eq("queue_entry_id", queueEntryId)
      .eq("status", "pending")
      .order("claimed_at", { ascending: true });
    return (data as SeatClaim[]) ?? [];
  },

  // Driver: list confirmed claims on a queue entry, ordered by confirmation
  // time. Index N in this array corresponds to seat index N on the car —
  // first passenger to confirm gets seat 0, etc. Used by my-loading to overlay
  // each filled seat with the passenger's initials.
  async listConfirmedFor(queueEntryId: string): Promise<SeatClaim[]> {
    const { data } = await supabase
      .from("seat_claims")
      .select("*, passenger:passengers(id, full_name, avatar_url)")
      .eq("queue_entry_id", queueEntryId)
      .eq("status", "confirmed")
      .order("confirmed_at", { ascending: true });
    return (data as SeatClaim[]) ?? [];
  },

  // Driver confirms a claim:
  //   - mark claim status='confirmed'
  //   - increment queue_entries.seats_boarded and seats_locked
  //   - insert a trip row so the passenger sees it in "My trips"
  async confirm(claim: SeatClaim, zoneId: string, destinationRegion: string, pricePerSeat: number): Promise<{ error?: string }> {
    // 1. Mark the claim confirmed
    const { error: upd } = await supabase
      .from("seat_claims")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("id", claim.id);
    if (upd) return { error: upd.message };

    // 2. Bump seat counts on the queue entry AND assign the passenger to the
    //    first empty seat slot. Keeping seat_states in sync with the counts
    //    means the driver's my-loading view shows the reservation immediately
    //    (filled seat with passenger initials) — they don't have to manually
    //    tap a seat to mirror what just happened in the DB.
    const { data: entry } = await supabase
      .from("queue_entries")
      .select("seats_boarded, seats_locked, driver_id, seat_states, vehicle:vehicles(seats)")
      .eq("id", claim.queue_entry_id).single();
    if (entry) {
      const cap = ((entry as any).vehicle?.seats ?? 4) - 1; // exclude driver
      const len = Math.max(cap, 1);
      const raw = (entry as any).seat_states;
      let arr: string[];
      if (Array.isArray(raw)) arr = raw as string[];
      else if (typeof raw === "string") { try { const p = JSON.parse(raw); arr = Array.isArray(p) ? p : []; } catch { arr = []; } }
      else arr = [];
      const states: string[] = Array.from({ length: len }, (_, i) =>
        (arr[i] === "boarded" || arr[i] === "locked" || arr[i] === "disputed") ? arr[i] : "empty");
      const firstEmpty = states.indexOf("empty");
      if (firstEmpty >= 0) states[firstEmpty] = "locked";
      await supabase.from("queue_entries").update({
        seats_boarded: (entry.seats_boarded ?? 0) + 1,
        seats_locked:  (entry.seats_locked  ?? 0) + 1,
        seat_states:   states,
      }).eq("id", claim.queue_entry_id);

      // 3. Record the trip for analytics.
      await supabase.from("trips").insert({
        passenger_id:       claim.passenger_id,
        driver_id:          entry.driver_id,
        queue_entry_id:     claim.queue_entry_id,
        zone_id:            zoneId,
        destination_region: destinationRegion,
        price_paid:         pricePerSeat,
      });
    }
    return {};
  },

  // Driver rejects a claim: no seat change, no trip.
  async reject(claimId: string): Promise<{ error?: string }> {
    const { error } = await supabase
      .from("seat_claims")
      .update({ status: "rejected", rejected_at: new Date().toISOString() })
      .eq("id", claimId);
    return { error: error?.message };
  },
};
