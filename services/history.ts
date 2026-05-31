import { supabase } from "./supabase";

export interface LoadingHistoryRow {
  id:                 string;
  driver_id:          string;
  zone_id:            string;
  destination_region: string | null;
  vehicle_id:         string | null;
  load_start_at:      string | null;
  ended_at:           string;
  end_reason:         "departed" | "timeout_2h" | "eod_close";
  seats_filled:       number;
  created_at:         string;
  driver?: { id: string; full_name: string; avatar_url: string | null };
}

export const HistoryAPI = {
  // Driver's own loading sessions in the last 7 days.
  async listMine(): Promise<LoadingHistoryRow[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from("loading_history")
      .select("*")
      .eq("driver_id", user.id)
      .gte("ended_at", since)
      .order("ended_at", { ascending: false });
    return (data as LoadingHistoryRow[]) ?? [];
  },

  // Entire history across all drivers — RLS only returns rows if the caller
  // is an admin. Capped at 500 most-recent to keep the payload sane.
  async listAll(): Promise<LoadingHistoryRow[]> {
    const { data } = await supabase
      .from("loading_history")
      .select("*, driver:drivers(id, full_name, avatar_url)")
      .order("ended_at", { ascending: false })
      .limit(500);
    return (data as LoadingHistoryRow[]) ?? [];
  },

  // Passenger-facing zone activity feed: every session that ended in this
  // zone since `sinceMs`, with driver display info. RLS allows
  // authenticated users to read these rows (events are public once a
  // driver's loading window has closed).
  async listForZone(zoneId: string, sinceMs: number): Promise<LoadingHistoryRow[]> {
    const sinceIso = new Date(sinceMs).toISOString();
    const { data } = await supabase
      .from("loading_history")
      .select("*, driver:drivers(id, full_name, avatar_url)")
      .eq("zone_id", zoneId)
      .gte("ended_at", sinceIso)
      .order("ended_at", { ascending: false })
      .limit(200);
    return (data as LoadingHistoryRow[]) ?? [];
  },
};
