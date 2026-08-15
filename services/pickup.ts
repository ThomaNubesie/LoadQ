// A8 pooled/feeder pickup + A9 payment. A rider who can't reach a loading point
// requests a pickup; a feeder driver collects several (Google-optimized) and drops
// them at the loading point. Backend: loadq-pickup edge fn + loadq_pickup_* RPCs.
import { supabase } from "./supabase";

export interface PickupQuote {
  ok: boolean;
  request_id: string;
  pay_ref: string;          // LQ-XXXXX — goes in the Interac message
  interac_to: string;       // deposit address
  within_5km: boolean;
  pickup_distance_km: number;
  pickup_eta_min: number;
  reserve_cents: number;
  tax_cents: number;
  total_cents: number;
  error?: string;
}

export interface MyPickup {
  request_id: string;
  status: string;           // quoted | pending | batched | picked_up | dropped | ...
  seq: number | null;
  eta_min: number | null;
  total_stops: number;
  picked_up_before: number;
  total_cents: number | null;
  paid: boolean;
  driver: { name: string | null; car: string | null; plate: string | null } | null;
}

export interface FeederStop {
  request_id: string;
  seq: number;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  status: string;
  eta_min: number | null;
  picked_up: boolean;
}
export interface FeederRun {
  run_id: string;
  destination: string;
  dropoff_zone: string;
  seats_total: number;
  seats_filled: number;
  status: string;
  run_min: number | null;
  stops: FeederStop[];
}

export const PickupAPI = {
  // Rider: price a pickup + create a pending (unpaid) request. Returns the LQ ref.
  async quote(address: string, destinationRegion: string, name?: string | null, phone?: string | null): Promise<PickupQuote | { error: string }> {
    const { data, error } = await supabase.functions.invoke("loadq-pickup", {
      body: { action: "quote", address, destination_region: destinationRegion, name: name ?? null, phone: phone ?? null },
    });
    if (error) return { error: error.message };
    if (data?.error) return { error: data.detail || data.error };
    return data as PickupQuote;
  },

  // Rider: live status of my pickup (poll while waiting / in the run).
  async myPickup(requestId: string): Promise<MyPickup | null> {
    const { data } = await supabase.rpc("loadq_my_pickup", { p_request: requestId });
    return (data as MyPickup) ?? null;
  },

  // Feeder driver: go on / off duty with current vehicle + GPS.
  async goOnDuty(vehicleId: string, lat: number, lng: number, on: boolean): Promise<{ ok?: boolean; error?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "not signed in" };
    const { data, error } = await supabase.rpc("loadq_pickup_go_on_duty", {
      p_driver: user.id, p_vehicle: vehicleId, p_lat: lat, p_lng: lng, p_on: on,
    });
    if (error) return { error: error.message };
    return { ok: (data as any)?.ok === true };
  },

  // Feeder driver: my active run (ordered stops + drop-off zone). Null if none.
  async myRun(): Promise<FeederRun | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.rpc("loadq_pickup_run", { p_driver: user.id });
    return (data && (data as any).run_id) ? (data as FeederRun) : null;
  },

  // Feeder driver: mark a stop picked up.
  async markStop(requestId: string): Promise<{ ok?: boolean; error?: string }> {
    const { data, error } = await supabase.rpc("loadq_pickup_mark", { p_request: requestId });
    if (error) return { error: error.message };
    return { ok: true, ...(data as any) };
  },
};

export const fmtMoney = (cents: number | null | undefined) => `$${(((cents ?? 0)) / 100).toFixed(2)}`;

// Google Places Autocomplete via the server-side proxy (key stays on the server).
export async function addressAutocomplete(input: string, lang?: string): Promise<{ description: string; place_id: string }[]> {
  const { data } = await supabase.functions.invoke("loadq-address-autocomplete", { body: { input, lang } });
  return (data?.predictions ?? []) as { description: string; place_id: string }[];
}
