// Kolis parcel integration for LoadQ drivers. Reads/writes the shared kolis_*
// objects (same Supabase project). Additive — does not touch LoadQ's own data.
import { supabase } from "./supabase";

export type KolisParcel = {
  id: string;
  code: string;
  size: string;
  to_city: string;
  pickup_zone: string;
  price_cents: number;
  driver_payout_cents: number | null;
  dropoff_type: string;
  status?: string;
};

export const KolisAPI = {
  // Available zone parcels matching the driver's current queue (PII-free RPC).
  async available(): Promise<KolisParcel[]> {
    const { data } = await supabase.rpc("kolis_available_parcels");
    return (data ?? []) as KolisParcel[];
  },

  // Accept an available parcel that matches the driver's queue.
  async accept(id: string): Promise<boolean> {
    const { data } = await supabase.rpc("kolis_accept_parcel", { p_id: id });
    return data === true;
  },

  // Parcels this driver is currently carrying.
  async carrying(): Promise<KolisParcel[]> {
    const { data } = await supabase
      .from("kolis_parcels")
      .select("id, code, size, to_city, pickup_zone, price_cents, driver_payout_cents, dropoff_type, status")
      .in("status", ["matched", "picked_up", "in_transit"])
      .order("created_at", { ascending: true });
    return (data ?? []) as KolisParcel[];
  },

  // Total the driver has earned from delivered Kolis parcels (in cents).
  async earnedCents(): Promise<number> {
    const { data } = await supabase
      .from("kolis_parcels")
      .select("driver_payout_cents")
      .eq("status", "delivered");
    return (data ?? []).reduce((sum: number, r: { driver_payout_cents: number | null }) => sum + (r.driver_payout_cents ?? 0), 0);
  },

  // Mark delivered with the recipient's 4-digit code -> captures the escrow.
  async deliver(id: string, code: string): Promise<{ ok: boolean; error?: string }> {
    const { data, error } = await supabase.functions.invoke("kolis-finalize-payment", { body: { parcel_id: id, action: "deliver", code } });
    if (error) return { ok: false, error: error.message };
    if (data?.error) return { ok: false, error: data.error };
    return { ok: true };
  },
};
