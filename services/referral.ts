import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { supabase } from "./supabase";

const PENDING_REF_KEY = "loadq.pendingRef";

export interface DriverCard {
  id:            string;
  full_name:     string;
  verified:      boolean;
  trust_score:   number;
  vehicle_make?:  string | null;
  vehicle_model?: string | null;
  vehicle_plate?: string | null;
  vehicle_type?:  string | null;
  vehicle_seats?: number | null;
}

export interface ReferralProgress {
  referred_total: number;
  qualified:      number; // referred passengers with >= 3 trips
  waiver_until:   string | null;
  waiver_months:  number; // banked, not yet started
}

export const ReferralAPI = {
  // The web URL encoded in the driver's QR. Hosts a landing page on loadq.ca
  // that auto-opens the LoadQ app if installed, or falls back to App Store /
  // Play Store install links. Works with any phone's native camera, even if
  // LoadQ isn't installed yet.
  link(driverId: string): string {
    return `https://loadq.ca/ref/${driverId}`;
  },

  async setPendingRef(driverId: string) {
    try { await AsyncStorage.setItem(PENDING_REF_KEY, driverId); } catch { /* best effort */ }
  },

  // Read + clear the pending referral. Called once at passenger signup.
  async consumePendingRef(): Promise<string | null> {
    try {
      const v = await AsyncStorage.getItem(PENDING_REF_KEY);
      if (v) await AsyncStorage.removeItem(PENDING_REF_KEY);
      return v;
    } catch {
      return null;
    }
  },

  async getDriverCard(driverId: string): Promise<DriverCard | null> {
    const { data, error } = await supabase.rpc("driver_card", { p_id: driverId });
    if (error || !data || data.length === 0) return null;
    return data[0] as DriverCard;
  },

  async myProgress(): Promise<ReferralProgress | null> {
    const { data, error } = await supabase.rpc("my_referral_progress");
    if (error || !data || data.length === 0) return null;
    return data[0] as ReferralProgress;
  },
};
