import { supabase } from "./supabase";
import { Driver, Vehicle, VehicleType } from "../constants/types";
import { getSeatsForType } from "../constants/vehicles";

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
    const { data, error } = await supabase
      .from("drivers").upsert({ id: user.id, ...fields }).select().single();
    return { data, error: error?.message };
  },

  async getVehicles(): Promise<Vehicle[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase.from("vehicles").select("*")
      .eq("driver_id", user.id).order("created_at", { ascending: false });
    return data || [];
  },

  async addVehicle(vehicle: { type: VehicleType; make: string; model: string; year: number; plate: string }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    const seats = getSeatsForType(vehicle.type);
    const { data, error } = await supabase
      .from("vehicles").insert({ ...vehicle, driver_id: user.id, seats }).select().single();
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
    return ["trialing", "active", "grace"].includes(driver.subscription_status);
  },
};
