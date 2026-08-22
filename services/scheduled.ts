// Scheduled door-to-door home pickup (days ahead). One driver claims/accepts and
// does the whole trip: home -> city -> drop-off address. Backend: loadq-scheduled
// edge fn (quote) + loadq_scheduled_* RPCs. Payment = Interac at booking; the usual
// loadq-interac-inbound matcher clears it (it's a loadq_ride_requests row).
import { supabase } from "./supabase";

// Booking time blocks. Value stored on the request; label shown in UI.
export const TIME_BLOCKS: { value: string; en: string; fr: string }[] = [
  { value: "05-09", en: "5:00–9:00 AM",  fr: "5 h – 9 h" },
  { value: "09-13", en: "9:00 AM–1:00 PM", fr: "9 h – 13 h" },
  { value: "13-17", en: "1:00–5:00 PM",  fr: "13 h – 17 h" },
  { value: "17-22", en: "5:00–10:00 PM", fr: "17 h – 22 h" },
];
export function timeBlockLabel(v: string | null, fr = false): string {
  const b = TIME_BLOCKS.find((x) => x.value === v);
  return b ? (fr ? b.fr : b.en) : "";
}

export interface ScheduledQuote {
  ok: boolean;
  request_id: string;
  pay_ref: string;
  interac_to: string;
  scheduled_date: string;
  seats: number;
  time_block: string | null;
  pickup_time: string | null;
  ride_type: string;
  closest_zone: string;
  home_distance_km: number;
  service_cents: number;
  fare_per_seat_cents: number;
  fare_to_city_cents: number;
  home_distance_cents: number;
  subtotal_cents: number;
  tax_cents: number;
  tax_rate: number;
  total_cents: number;
  error?: string;
}

export interface ScheduledOpen {
  request_id: string;
  scheduled_date: string;
  seats: number;
  time_block: string | null;
  pickup_time: string | null;
  ride_type: string | null;
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
  seats: number;
  time_block: string | null;
  pickup_time: string | null;
  ride_type: string | null;
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

export interface ScheduledRider {
  request_id: string;
  scheduled_date: string;
  status: string;
  seats: number;
  time_block: string | null;
  pickup_time: string | null;
  ride_type: string | null;
  origin: string;
  dropoff: string;
  dest_region: string;
  fare_cents: number;
  paid: boolean;
  has_driver: boolean;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_loc_at: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_id: string | null;
}

export const ScheduledAPI = {
  // Rider: price + create a scheduled door-to-door request (pay Interac at booking).
  async quote(originAddress: string, dropoffAddress: string, destinationRegion: string, scheduledDate: string, seats: number = 1, timeBlock?: string | null, opts?: { rideType?: "share" | "whole"; pickupTime?: string | null; name?: string | null; phone?: string | null }): Promise<ScheduledQuote | { error: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.functions.invoke("loadq-scheduled", {
      body: { action: "quote", passenger_id: user?.id ?? null, origin_address: originAddress, dropoff_address: dropoffAddress, destination_region: destinationRegion, scheduled_date: scheduledDate, seats, time_block: timeBlock ?? null, ride_type: opts?.rideType ?? "share", pickup_time: opts?.pickupTime ?? null, name: opts?.name ?? null, phone: opts?.phone ?? null },
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

  // Rider: my upcoming scheduled trips (for My Trips).
  async rider(): Promise<ScheduledRider[]> {
    const { data } = await supabase.rpc("loadq_scheduled_rider");
    return (data as ScheduledRider[]) ?? [];
  },

  // Driver: share live GPS during an active scheduled trip.
  async ping(requestId: string, lat: number, lng: number): Promise<void> {
    try { await supabase.rpc("loadq_scheduled_ping", { p_request: requestId, p_lat: lat, p_lng: lng }); } catch { /* best-effort */ }
  },

  // Driver: advance the trip (en_route | arrived | picked_up | completed) + notify rider.
  async advance(requestId: string, to: "en_route" | "arrived" | "picked_up" | "completed"): Promise<{ ok?: boolean; error?: string }> {
    const { data, error } = await supabase.rpc("loadq_scheduled_advance", { p_request: requestId, p_to: to });
    if (error) return { error: error.message };
    const res = data as any;
    if (res?.ok && res.passenger_id) {
      const msg: Record<string, { t: string; b: string }> = {
        en_route:  { t: "Your driver is on the way", b: "Your LoadQ driver is heading to your pickup." },
        arrived:   { t: "Your driver has arrived", b: "Your driver is at the pickup point." },
        picked_up: { t: "You're on board", b: "En route to your drop-off address." },
        completed: { t: "Trip complete", b: "You've arrived. Thanks for riding with LoadQ!" },
      };
      const m = msg[to];
      if (m) { try { await supabase.functions.invoke("send-push", { body: { recipient_id: res.passenger_id, title: m.t, body: m.b, data: { route: "/(passenger)/my-trip" } } }); } catch { /* best-effort */ } }
    }
    return res;
  },

  // Rider: cancel — returns the refund tier + amount per policy.
  async cancel(requestId: string): Promise<{ ok?: boolean; error?: string; refund_cents?: number; tier?: string; hours_before?: number }> {
    const { data, error } = await supabase.rpc("loadq_scheduled_cancel", { p_request: requestId });
    if (error) return { error: error.message };
    return data as any;
  },
};
