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

// Passenger's own ride request (with matched driver + vehicle once assigned).
export interface MyRideRequest {
  id: string; kind: string; status: string; payment_status: string; payment_method: string;
  pickup_label: string | null; origin_address: string | null; dest_region: string | null; dest_address: string | null;
  fare_cents: number | null; pay_ref: string | null; driver_id: string | null;
  driver_name: string | null; driver_phone: string | null;
  vehicle_make: string | null; vehicle_model: string | null; vehicle_color: string | null;
  vehicle_plate: string | null; vehicle_seats: number | null; created_at: string;
}

// Ride request is resolved (terminal) — nothing more to poll/act on.
export const RIDE_TERMINAL = ["completed", "cancelled", "expired"];

export const RidesAPI = {
  // ── Passenger side ────────────────────────────────────────────────────────
  async createRequest(p: {
    kind: "route_pickup" | "on_demand"; origin_address: string; origin_lat: number; origin_lng: number;
    dest_region?: string | null; dest_address?: string | null; dest_lat?: number | null; dest_lng?: number | null;
    payment_method?: string;
  }): Promise<{ id?: string; error?: string }> {
    const { data, error } = await supabase.rpc("loadq_ride_request_create", {
      p_kind: p.kind, p_origin_address: p.origin_address, p_origin_lat: p.origin_lat, p_origin_lng: p.origin_lng,
      p_dest_region: p.dest_region ?? null, p_dest_address: p.dest_address ?? null,
      p_dest_lat: p.dest_lat ?? null, p_dest_lng: p.dest_lng ?? null, p_payment_method: p.payment_method ?? "interac",
    });
    if (error) return { error: error.message };
    return { id: data as string };
  },
  // Compute + persist the quote (fare + pay_ref) for a route-pickup request.
  async quote(requestId: string): Promise<{ ok: boolean; error?: string; data?: any }> {
    const { data, error } = await supabase.functions.invoke("loadq-ride-quote", { body: { request_id: requestId } });
    if (error) return { ok: false, error: error.message };
    if ((data as any)?.error) return { ok: false, error: (data as any).error };
    return { ok: true, data };
  },
  async myRequests(): Promise<MyRideRequest[]> {
    const { data, error } = await supabase.rpc("loadq_my_ride_requests");
    if (error) return [];
    return (data as MyRideRequest[]) ?? [];
  },
  async activeRequest(): Promise<MyRideRequest | null> {
    const rows = await this.myRequests();
    return rows.find((r) => !RIDE_TERMINAL.includes(r.status)) ?? null;
  },
  async cancelRequest(id: string): Promise<{ error?: string }> {
    const { error } = await supabase.rpc("loadq_ride_request_cancel", { p_request_id: id });
    return { error: error?.message };
  },
  // On-demand: nearest loading zone to the pickup, to depart from.
  async nearestZone(lat: number, lng: number): Promise<{ id: string; name?: string } | null> {
    const { data } = await supabase.rpc("loadq_nearest_zone", { p_lat: lat, p_lng: lng });
    return (data as { id: string; name?: string } | null) ?? null;
  },
  async setDeparture(requestId: string, zoneId: string): Promise<{ error?: string }> {
    const { error } = await supabase.rpc("loadq_ride_set_departure", { p_request_id: requestId, p_zone_id: zoneId });
    return { error: error?.message };
  },
  // On-demand dispatch (offers a queue driver, or returns awaiting_payment for Interac/card).
  async dispatch(requestId: string): Promise<{ ok: boolean; error?: string; data?: any }> {
    const { data, error } = await supabase.functions.invoke("loadq-ride-dispatch", { body: { request_id: requestId } });
    if (error) return { ok: false, error: error.message };
    if ((data as any)?.error) return { ok: false, error: (data as any).error };
    return { ok: true, data };
  },
  // Card pre-auth: create a manual-capture PaymentIntent (funds held only) for the fare.
  async authorizeCard(requestId: string): Promise<{ client_secret?: string; customer?: string; ephemeral_key?: string; publishable_key?: string | null; error?: string }> {
    const { data, error } = await supabase.functions.invoke("loadq-ride-card", { body: { action: "authorize", request_id: requestId } });
    if (error) return { error: error.message };
    if ((data as any)?.error) return { error: (data as any).error };
    return data as any;
  },
  // Verify the hold server-side (PI is requires_capture) and mark the ride paid.
  async confirmCard(requestId: string): Promise<{ ok: boolean; status?: string; error?: string }> {
    const { data, error } = await supabase.functions.invoke("loadq-ride-card", { body: { action: "confirm", request_id: requestId } });
    if (error) return { ok: false, error: error.message };
    return data as any;
  },

  // ── Driver side ───────────────────────────────────────────────────────────
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
