// Scheduled door-to-door home pickup (days ahead). One driver claims/accepts and
// does the whole trip: home -> city -> drop-off address. Backend: loadq-scheduled
// edge fn (quote) + loadq_scheduled_* RPCs. Payment = Interac at booking; the usual
// loadq-interac-inbound matcher clears it (it's a loadq_ride_requests row).
import { supabase } from "./supabase";

export interface ScheduledQuote {
  ok: boolean;
  request_id: string;
  pay_ref: string;
  interac_to: string;
  scheduled_date: string;
  closest_zone: string;
  home_distance_km: number;
  service_cents: number;
  fare_to_city_cents: number;
  home_distance_cents: number;
  total_cents: number;
  error?: string;
}

export interface ScheduledOpen {
  request_id: string;
  scheduled_date: string;
  origin: string;
  origin_lat: number | null;
  origin_lng: number | null;
  dropoff: string;
  dest_region: string;
  fare_cents: number;
}

export interface ScheduledMine {
  request_id: string;
  scheduled_date: string;
  status: string;
  origin: string;
  origin_lat: number | null;
  origin_lng: number | null;
  dropoff: string;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dest_region: string;
  fare_cents: number;
  rider: string | null;
  rider_phone: string | null;
}

export const ScheduledAPI = {
  // Rider: price + create a scheduled door-to-door request (pay Interac at booking).
  async quote(originAddress: string, dropoffAddress: string, destinationRegion: string, scheduledDate: string, name?: string | null, phone?: string | null): Promise<ScheduledQuote | { error: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.functions.invoke("loadq-scheduled", {
      body: { action: "quote", passenger_id: user?.id ?? null, origin_address: originAddress, dropoff_address: dropoffAddress, destination_region: destinationRegion, scheduled_date: scheduledDate, name: name ?? null, phone: phone ?? null },
    });
    if (error) return { error: error.message };
    if (data?.error) return { error: data.detail || data.error };
    return data as ScheduledQuote;
  },

  // Driver: open scheduled trips to claim ahead.
  async open(): Promise<ScheduledOpen[]> {
    const { data } = await supabase.rpc("loadq_scheduled_open");
    return (data as ScheduledOpen[]) ?? [];
  },

  // Driver: claim a scheduled trip.
  async claim(requestId: string): Promise<{ ok?: boolean; error?: string }> {
    const { data, error } = await supabase.rpc("loadq_scheduled_claim", { p_request: requestId });
    if (error) return { error: error.message };
    return data as any;
  },

  // Driver: my claimed upcoming scheduled trips.
  async mine(): Promise<ScheduledMine[]> {
    const { data } = await supabase.rpc("loadq_scheduled_mine");
    return (data as ScheduledMine[]) ?? [];
  },

  // Driver: decline a claimed trip (allowed until the cutoff).
  async decline(requestId: string): Promise<{ ok?: boolean; error?: string; cutoff_hours?: number }> {
    const { data, error } = await supabase.rpc("loadq_scheduled_decline", { p_request: requestId });
    if (error) return { error: error.message };
    return data as any;
  },

  // Rider: cancel — returns the refund tier + amount per policy.
  async cancel(requestId: string): Promise<{ ok?: boolean; error?: string; refund_cents?: number; tier?: string; hours_before?: number }> {
    const { data, error } = await supabase.rpc("loadq_scheduled_cancel", { p_request: requestId });
    if (error) return { error: error.message };
    return data as any;
  },
};
