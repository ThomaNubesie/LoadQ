import { supabase } from "./supabase";

export interface Trip {
  id:                 string;
  passenger_id:       string;
  driver_id:          string;
  queue_entry_id?:    string | null;
  zone_id:            string;
  destination_region: string;
  price_paid:         number;
  created_at:         string;
  driver?: {
    id:         string;
    full_name:  string;
    avatar_url: string | null;
  };
}

export interface NetworkStat {
  zone_id:            string;
  destination_region: string;
  day:                string;
  trip_count:         number;
  gross:              number;
  avg_price:          number;
}

export const TripsAPI = {
  // Past 7 days of trips for the signed-in passenger.
  async listMine(): Promise<Trip[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from("trips")
      .select("*, driver:drivers(id, full_name, avatar_url)")
      .eq("passenger_id", user.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    return (data as Trip[]) ?? [];
  },

  // Aggregate stats across the network for the past 7 days.
  async listNetwork(): Promise<NetworkStat[]> {
    const { data } = await supabase
      .from("network_trip_stats")
      .select("*")
      .order("day", { ascending: false });
    return (data as NetworkStat[]) ?? [];
  },

  // The passenger's currently active trip, if any. Determined by: confirmed
  // seat_claim joined to a queue_entry that is still status='loading' or
  // 'called_back'. Returns null when there's no active trip.
  async myActiveTrip(): Promise<ActiveTrip | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: claim } = await supabase
      .from("seat_claims")
      .select(`
        id, queue_entry_id,
        queue_entry:queue_entries (
          id, status, destination_region,
          driver:drivers(id, full_name)
        )
      `)
      .eq("passenger_id", user.id)
      .eq("status", "confirmed")
      .order("confirmed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!claim?.queue_entry) return null;
    const qe: any = claim.queue_entry;
    if (qe.status !== "loading" && qe.status !== "called_back") return null;
    return {
      queue_entry_id:     qe.id,
      driver_id:          qe.driver?.id ?? null,
      driver_name:        qe.driver?.full_name ?? "Driver",
      destination_region: qe.destination_region ?? null,
    };
  },
};

export interface ActiveTrip {
  queue_entry_id:     string;
  driver_id:          string | null;
  driver_name:        string;
  destination_region: string | null;
}
