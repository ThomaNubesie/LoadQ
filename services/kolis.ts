// Kolis parcel integration for LoadQ drivers. Reads/writes the shared kolis_*
// objects (same Supabase project). Additive — does not touch LoadQ's own data.
import { supabase } from "./supabase";

// Amount-walled: a LoadQ driver carrying a parcel sees their payout, never the
// sender's price. No price_cents field exists here by construction.
export type KolisParcel = {
  id: string;
  code: string;
  size: string;
  from_city?: string;
  to_city: string;
  pickup_zone?: string | null;
  pickup_hub_name?: string | null;
  pickup_addr?: string | null; // present only in carrying (post-accept)
  dropoff_addr?: string | null;    // carrying only, revealed after pickup
  recipient_name?: string | null;  // carrying only, revealed after pickup
  recipient_phone?: string | null; // carrying only, revealed after pickup
  driver_payout_cents: number | null;
  dropoff_type: string;
  status?: string;
  is_request?: boolean; // true = dispatch assigned this to me specifically (accept/decline)
  accepted_via?: string | null; // 'loadq' | 'kolis' — which app owns live tracking
};

export const KolisAPI = {
  // Available zone parcels matching the driver's current queue (PII-free RPC).
  async available(): Promise<KolisParcel[]> {
    const { data } = await supabase.rpc("kolis_available_parcels");
    return (data ?? []) as KolisParcel[];
  },

  // Accept an available parcel. etaMinutes = pickup ETA shown to the sender.
  async accept(id: string, etaMinutes?: number | null): Promise<boolean> {
    const { data } = await supabase.rpc("kolis_accept_parcel", { p_id: id, p_via: "loadq", p_eta_minutes: etaMinutes ?? null });
    return data === true;
  },

  // Auto pickup ETA (driving minutes) from the driver's coords to the pickup
  // address. Returns null when unavailable (no Maps key / stale GPS).
  async pickupEta(parcelId: string, lat: number, lng: number): Promise<number | null> {
    try {
      const { data } = await supabase.functions.invoke("kolis-pickup-eta", { body: { parcel_id: parcelId, lat, lng } });
      return data?.ok ? (data.eta_minutes as number) : null;
    } catch { return null; }
  },

  // Confirm possession with the SENDER's pickup code: matched -> picked_up.
  // Returns "ok" | "bad_code" | "fail".
  async markPickedUp(id: string, code: string): Promise<string> {
    const { data } = await supabase.rpc("kolis_courier_pickup", { p_id: id, p_code: code });
    return (data as string) ?? "fail";
  },

  // Decline a parcel that dispatch targeted to me — returns it to the pool.
  async decline(id: string): Promise<boolean> {
    const { data } = await supabase.rpc("kolis_decline_parcel", { p_id: id });
    return data === true;
  },

  // Parcels this driver is currently carrying (walled RPC — payout only, no price).
  async carrying(): Promise<KolisParcel[]> {
    const { data } = await supabase.rpc("kolis_carrying");
    return (data ?? []) as KolisParcel[];
  },

  // Driver's Kolis earnings, split paid vs pending (cents).
  async earnings(): Promise<{ paid: number; pending: number }> {
    const { data } = await supabase
      .from("kolis_parcels")
      .select("driver_payout_cents, driver_paid_at")
      .eq("status", "delivered");
    let paid = 0, pending = 0;
    (data ?? []).forEach((r: { driver_payout_cents: number | null; driver_paid_at: string | null }) => {
      const c = r.driver_payout_cents ?? 0;
      if (r.driver_paid_at) paid += c; else pending += c;
    });
    return { paid, pending };
  },

  async getInterac(): Promise<string | null> {
    const { data } = await supabase.from("kolis_driver_payout").select("interac_email").maybeSingle();
    return data?.interac_email ?? null;
  },

  async setInterac(email: string): Promise<{ error?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "not signed in" };
    const { error } = await supabase.from("kolis_driver_payout").upsert({ driver_id: user.id, interac_email: email });
    return { error: error?.message };
  },

  // Mark delivered with the recipient's 4-digit code -> captures the escrow.
  async deliver(id: string, code: string): Promise<{ ok: boolean; error?: string }> {
    const { data, error } = await supabase.functions.invoke("kolis-finalize-payment", { body: { parcel_id: id, action: "deliver", code } });
    if (error) return { ok: false, error: error.message };
    if (data?.error) return { ok: false, error: data.error };
    return { ok: true };
  },
};
