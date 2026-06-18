import { supabase } from "./supabase";
import { Driver, Vehicle, VehicleType } from "../constants/types";
import { getSeatsForType, getSeatsForModel } from "../constants/vehicles";
import { BillingAPI } from "./billing";

export const DriversAPI = {
  async getMe(): Promise<Driver | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from("drivers").select("*").eq("id", user.id).single();
    return data;
  },

  async createOrUpdate(fields: Partial<Driver>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const { data: existing } = await supabase
      .from("drivers").select("id").eq("id", user.id).maybeSingle();

    if (existing) {
      // Don't re-write phone on update — drivers.phone has a UNIQUE constraint,
      // and auth.users.phone is the source of truth.
      const { phone: _ignored, ...rest } = fields;
      const { data, error } = await supabase
        .from("drivers").update(rest).eq("id", user.id).select().single();
      return { data, error: error?.message };
    }

    // Every new driver starts a 30-day app-managed free trial. Explicit
    // values in `fields` still win (spread last).
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("drivers")
      .insert({
        id: user.id,
        subscription_status: "trialing",
        trial_ends_at: trialEndsAt,
        ...fields,
      })
      .select().single();
    return { data, error: error?.message };
  },

  async getVehicles(): Promise<Vehicle[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase.from("vehicles").select("*")
      .eq("driver_id", user.id).order("created_at", { ascending: false });
    return data || [];
  },

  async addVehicle(vehicle: { type: VehicleType; make: string; model: string; year: number; plate: string; color?: string }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    // P108: enforce max 2 vehicles per driver. DB trigger is the source of
    // truth, but check client-side too for a friendlier message.
    const { count } = await supabase
      .from("vehicles").select("id", { count: "exact", head: true })
      .eq("driver_id", user.id);
    if ((count ?? 0) >= 2) {
      return { error: "You already have the maximum of 2 vehicles. Contact admin to change a vehicle." };
    }
    const modelSeats = getSeatsForModel(vehicle.make, vehicle.model);
    const seats = modelSeats || getSeatsForType(vehicle.type);
    const { data, error } = await supabase
      .from("vehicles").insert({ ...vehicle, driver_id: user.id, seats }).select().single();
    return { data, error: error?.message };
  },

  async getVehicle(vehicleId: string): Promise<Vehicle | null> {
    const { data } = await supabase.from("vehicles").select("*").eq("id", vehicleId).maybeSingle();
    return data;
  },

  async updateVehicle(vehicleId: string, fields: Partial<Pick<Vehicle, "color" | "plate" | "make" | "model" | "year" | "type">>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    const patch: Record<string, unknown> = { ...fields };
    if (typeof patch.plate === "string") patch.plate = (patch.plate as string).trim().toUpperCase();
    const { data, error } = await supabase
      .from("vehicles").update(patch).eq("id", vehicleId).eq("driver_id", user.id)
      .select().single();
    return { data, error: error?.message };
  },

  async setActiveVehicle(vehicleId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("vehicles").update({ is_active: false }).eq("driver_id", user.id);
    await supabase.from("vehicles").update({ is_active: true }).eq("id", vehicleId);
  },

  async hasActiveSubscription(): Promise<boolean> {
    const driver = await DriversAPI.getMe();
    if (!driver) return false;
    const now = Date.now();

    // An already-running referral waiver grants access regardless of billing.
    if (driver.waiver_until && new Date(driver.waiver_until).getTime() > now) {
      return true;
    }

    // RevenueCat entitlement is the source of truth once store billing is
    // live — it covers the store-side free trial AND the paid period.
    const entitled = await BillingAPI.isEntitled();
    if (entitled === true) return true;

    // App-managed access grants entry even when RevenueCat reports no
    // entitlement or isn't reachable. This is what makes the 30-day trial
    // the way in for the soft launch, before App Store billing is set up.
    // "trialing" is valid only while trial_ends_at is still in the future.
    if (driver.subscription_status === "trialing") {
      const end = driver.trial_ends_at ? new Date(driver.trial_ends_at).getTime() : 0;
      if (end > now) return true;
    }
    // "grace" is valid only until grace_ends_at.
    if (driver.subscription_status === "grace") {
      const end = driver.grace_ends_at ? new Date(driver.grace_ends_at).getTime() : 0;
      if (end > now) return true;
    }
    // "active" is valid until subscription_ends_at (or always if not set).
    if (driver.subscription_status === "active") {
      if (!driver.subscription_ends_at) return true;
      if (new Date(driver.subscription_ends_at).getTime() > now) return true;
    }

    // Lapsed and a referral free month is banked: start it now. Capped at
    // one month — referral_waiver_granted prevents the bank from ever being
    // topped past 1, so this fires at most once. The write goes through a
    // SECURITY DEFINER RPC because waiver_* columns are locked against direct
    // client writes (server-side access control).
    if ((driver.waiver_months ?? 0) > 0) {
      const { data, error } = await supabase.rpc("loadq_consume_waiver");
      if (!error && data === true) return true;
    }

    // No entitlement, no active trial/grace/DB period, no banked month.
    return false;
  },

  async uploadAvatar(localUri: string): Promise<{ url?: string; error?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const ext = (localUri.split(".").pop() || "jpg").toLowerCase().split("?")[0];
    const path = `${user.id}/avatar.${ext}`;
    const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;

    // In React Native, `fetch(localUri).blob()` often returns a 0-byte Blob,
    // which uploads "successfully" but produces an empty file. Read via
    // expo-file-system as base64, then convert to ArrayBuffer.
    // expo-file-system@19 moved the function API to /legacy. The new default
    // export is the File/Directory class API which has no readAsStringAsync.
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

    // Public bucket → use public URL; cache-bust so the new image is shown immediately.
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = `${pub.publicUrl}?v=${Date.now()}`;

    const { error: updErr } = await supabase
      .from("drivers").update({ avatar_url: url }).eq("id", user.id);
    if (updErr) return { error: updErr.message };

    return { url };
  },
};
