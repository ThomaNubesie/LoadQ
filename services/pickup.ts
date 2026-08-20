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
  pickup_lat: number | null;
  pickup_lng: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  loc_at: string | null;
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
  driver_lat: number | null;
  driver_lng: number | null;
  stops: FeederStop[];
}

export const PickupAPI = {
  // Rider: price a pickup + create a pending (unpaid) request. Returns the LQ ref.
  async quote(address: string, destinationRegion: string, name?: string | null, phone?: string | null, loadingZoneId?: string | null): Promise<PickupQuote | { error: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.functions.invoke("loadq-pickup", {
      body: { action: "quote", address, destination_region: destinationRegion, name: name ?? null, phone: phone ?? null, passenger_id: user?.id ?? null, loading_zone_id: loadingZoneId ?? null },
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

  // Rider: my current active (paid, non-terminal) pickup — for My Trips / board.
  async myActivePickup(): Promise<MyPickup | null> {
    const { data } = await supabase.rpc("loadq_my_active_pickup");
    return (data && (data as MyPickup).request_id) ? (data as MyPickup) : null;
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

  // Feeder driver: push live GPS to the active run (so riders can track).
  async pingRun(lat: number, lng: number): Promise<void> {
    try { await supabase.rpc("loadq_pickup_ping", { p_lat: lat, p_lng: lng }); } catch { /* best-effort */ }
  },

  // Feeder driver: complete the run at the loading zone (drops riders, frees driver).
  async completeRun(runId?: string): Promise<{ ok?: boolean; error?: string; dropped?: number }> {
    const { data, error } = await supabase.rpc("loadq_pickup_complete", { p_run: runId ?? null });
    if (error) return { error: error.message };
    return data as any;
  },
};

export interface PickupReceipt {
  request_id: string; code: string | null; service: string;
  pickup: string | null; destination: string | null;
  driver: string | null; car: string | null;
  fee_cents: number | null; tax_cents: number | null; total_cents: number | null;
  paid: boolean; paid_at: string | null; payment: string; hst_number: string;
  contact_phone: string | null; error?: string;
}

export const ReceiptAPI = {
  async get(requestId: string): Promise<PickupReceipt | null> {
    const { data } = await supabase.rpc("loadq_pickup_receipt", { p_request: requestId });
    return (data && !(data as any).error) ? (data as PickupReceipt) : null;
  },
  // Deliver by email (Resend) or SMS (Twilio) — server-side, only for a paid request.
  async send(requestId: string, channel: "email" | "sms", to: string): Promise<{ ok?: boolean; error?: string }> {
    const { data, error } = await supabase.functions.invoke("loadq-pickup-receipt", { body: { request_id: requestId, channel, to } });
    if (error) return { error: error.message };
    if (data?.error) return { error: data.error };
    return { ok: data?.ok === true };
  },
};

export const fmtMoney = (cents: number | null | undefined) => `$${(((cents ?? 0)) / 100).toFixed(2)}`;

// Google Places Autocomplete via the server-side proxy (key stays on the server).
export async function addressAutocomplete(input: string, lang?: string): Promise<{ description: string; place_id: string }[]> {
  const { data } = await supabase.functions.invoke("loadq-address-autocomplete", { body: { input, lang } });
  return (data?.predictions ?? []) as { description: string; place_id: string }[];
}
