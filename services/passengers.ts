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

export const PassengersAPI = {
  async getMe(): Promise<Passenger | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from("passengers").select("*").eq("id", user.id).maybeSingle();
    return data;
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
