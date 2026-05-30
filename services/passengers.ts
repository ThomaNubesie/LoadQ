import { supabase } from "./supabase";

export interface Passenger {
  id:         string;
  full_name:  string;
  phone?:     string | null;
  email?:     string | null;
  avatar_url?: string | null;
  dob?:       string | null;
  sex?:       "male" | "female" | "other" | null;
  referred_by?: string | null;
  blocked?:     boolean;
  created_at: string;
}

export interface PassengerStats {
  passenger:    Passenger | null;
  trips_count:  number;
  member_since: string | null; // ISO date of created_at
  // Static "trust" tier derived from trips_count. A real rating system
  // (driver-rates-passenger) is planned post-v1.1.1. Until then this gives
  // the driver a meaningful trust signal at a glance.
  trust_tier:   "new" | "verified" | "trusted";
}

export const PassengersAPI = {
  async getMe(): Promise<Passenger | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from("passengers").select("*").eq("id", user.id).maybeSingle();
    return data;
  },

  // Fetch a passenger's profile + minimal stats for the driver-side popup.
  // Stats are: trips taken (lifetime, from trips table), member-since date,
  // and a static trust tier based on trip count.
  async getStats(passengerId: string): Promise<PassengerStats> {
    const [{ data: p }, { count }] = await Promise.all([
      supabase.from("passengers").select("*").eq("id", passengerId).maybeSingle(),
      supabase.from("trips").select("id", { count: "exact", head: true }).eq("passenger_id", passengerId),
    ]);
    const trips = count ?? 0;
    const tier: PassengerStats["trust_tier"] =
      trips >= 5 ? "trusted" : trips >= 1 ? "verified" : "new";
    return {
      passenger:    (p as Passenger) ?? null,
      trips_count:  trips,
      member_since: (p as Passenger | null)?.created_at ?? null,
      trust_tier:   tier,
    };
  },

  async createOrUpdate(fields: Partial<Passenger>): Promise<{ data?: Passenger; error?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const { data: existing } = await supabase
      .from("passengers").select("id").eq("id", user.id).maybeSingle();

    if (existing) {
      const { data, error } = await supabase
        .from("passengers").update(fields).eq("id", user.id).select().single();
      return { data: data as Passenger | undefined, error: error?.message };
    }
    const { data, error } = await supabase
      .from("passengers").insert({ id: user.id, ...fields }).select().single();
    return { data: data as Passenger | undefined, error: error?.message };
  },

  async uploadAvatar(localUri: string): Promise<{ url?: string; error?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const ext = (localUri.split(".").pop() || "jpg").toLowerCase().split("?")[0];
    const path = `${user.id}/avatar.${ext}`;
    const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;

    // RN's fetch().blob() returns 0-byte Blobs for local file:// URIs in many
    // Expo versions. Read with FileSystem instead.
    const FileSystem = await import("expo-file-system/legacy");
    const { decode } = await import("base64-arraybuffer");

    let arrayBuffer: ArrayBuffer;
    try {
      const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: "base64" as any });
      arrayBuffer = decode(base64);
    } catch (e: any) {
      return { error: `Could not read image: ${e?.message ?? "unknown"}` };
    }
    if (arrayBuffer.byteLength === 0) {
      return { error: "Image file appears to be empty (0 bytes)" };
    }

    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, arrayBuffer, { upsert: true, contentType });
    if (upErr) return { error: upErr.message };

    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = `${pub.publicUrl}?v=${Date.now()}`;

    const { error: updErr } = await supabase
      .from("passengers").update({ avatar_url: url }).eq("id", user.id);
    if (updErr) return { error: updErr.message };

    return { url };
  },
};
