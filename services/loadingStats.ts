// Loading-times stats: system-wide historic departure distribution for a zone,
// by hour of day (America/Toronto), optionally filtered to a weekday. Feeds the
// "Loading times" graph shown on both the passenger and driver sides.
import { supabase } from "./supabase";

export interface LoadingStats {
  zone_id: string;
  dow:     number | null;
  total:   number;
  hours:   { hour: number; departures: number }[];
}

export const LoadingStatsAPI = {
  async get(zoneId: string, dow: number | null): Promise<LoadingStats | null> {
    const { data } = await supabase.rpc("loadq_loading_stats", { p_zone_id: zoneId, p_dow: dow });
    return (data as LoadingStats) ?? null;
  },
};
