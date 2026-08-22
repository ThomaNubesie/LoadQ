// Two-way reviews for scheduled door-to-door + feeder trips (public). Backend:
// loadq_submit_review / loadq_reviews_for / loadq_my_unrated_trips.
import { supabase } from "./supabase";

export interface UnratedTrip {
  trip_ref: string;
  trip_kind: "scheduled" | "feeder";
  rate_role: "driver" | "passenger"; // who the caller is rating
  counterparty: string | null;
  origin: string | null;
  dropoff: string | null;
  created_at: string;
}
export interface Review {
  stars: number;
  tags: string[] | null;
  text: string | null;
  trip_kind: string;
  created_at: string;
  rater: string | null;
}

export const ReviewsAPI = {
  async submit(tripRef: string, tripKind: "scheduled" | "feeder" | "board", stars: number, tags: string[] = [], text?: string | null): Promise<{ ok?: boolean; error?: string }> {
    const { data, error } = await supabase.rpc("loadq_submit_review", { p_trip_ref: tripRef, p_trip_kind: tripKind, p_stars: stars, p_tags: tags, p_text: text ?? null });
    if (error) return { error: error.message };
    return data as any;
  },
  async unrated(): Promise<UnratedTrip[]> {
    const { data } = await supabase.rpc("loadq_my_unrated_trips");
    return (data as UnratedTrip[]) ?? [];
  },
  async forUser(userId: string, role: "driver" | "passenger"): Promise<Review[]> {
    const { data } = await supabase.rpc("loadq_reviews_for", { p_user: userId, p_role: role });
    return (data as Review[]) ?? [];
  },
};
