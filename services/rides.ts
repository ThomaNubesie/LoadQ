import { supabase } from "./supabase";

// A7 · On-route pickup + on-demand dispatch — driver offer side.
export interface RideOffer {
  offer_id: string;
  request_id: string;
  kind: string;                 // 'route_pickup' | 'on_demand'
  pickup_label: string | null;
  dest_region: string | null;
  dest_address: string | null;
  fare_cents: number | null;
  expires_at: string;           // ISO — drive the live countdown from this
}

export const RidesAPI = {
  // Active offers currently pending for THIS driver (soonest-expiring first).
  async driverOffers(): Promise<RideOffer[]> {
    const { data, error } = await supabase.rpc("loadq_ride_driver_offers");
    if (error) return [];
    const rows = (data as RideOffer[]) ?? [];
    return rows.sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime());
  },

  // Accept or decline. Returns { accepted, request_id }. Accepting binds the ride
  // and withdraws sibling offers server-side.
  async respond(offerId: string, accept: boolean): Promise<{ accepted: boolean; request_id?: string; error?: string }> {
    const { data, error } = await supabase.rpc("loadq_ride_offer_respond", { p_offer_id: offerId, p_accept: accept });
    if (error) return { accepted: false, error: error.message };
    const d = (data as { accepted?: boolean; request_id?: string } | null) || {};
    return { accepted: !!d.accepted, request_id: d.request_id };
  },
};
