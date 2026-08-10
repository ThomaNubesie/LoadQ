"use client";
import { createClient } from "@supabase/supabase-js";
import type { ZoneRow, DriverLite, QueueEntryRow } from "./data";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

export const e164 = (p: string) => {
  const d = p.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  const n = d.replace(/\D/g, "");
  return n.length === 11 && n[0] === "1" ? "+" + n : "+1" + n;
};

// Every admin write below goes through the SAME server-authorized surface the
// mobile app uses: zone RLS ("admins update/insert zones" gated on
// drivers.is_admin) and the loadq_admin_* / admin_* SECURITY DEFINER RPCs.
// The browser never holds any service secret.
export const api = {
  // Is the signed-in user a LoadQ admin? (drivers.is_admin)
  async isAdmin(): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase.from("drivers").select("is_admin").eq("id", user.id).maybeSingle();
    return !!(data as { is_admin?: boolean } | null)?.is_admin;
  },

  // ── Zones ──────────────────────────────────────────────────────────────
  async zones(): Promise<ZoneRow[]> {
    const { data, error } = await supabase.from("zones").select("*").order("region").order("name");
    if (error) throw error;
    return (data as ZoneRow[]) ?? [];
  },
  async addZone(z: Omit<ZoneRow, "is_active"> & { is_active?: boolean }): Promise<void> {
    const { error } = await supabase.from("zones").insert({ ...z, is_active: z.is_active ?? true });
    if (error) throw error;
  },
  async updateZone(id: string, patch: Partial<ZoneRow>): Promise<void> {
    // maybeSingle-safe: SELECT policy hides inactive zones, so don't ask for the
    // returning row (the UPDATE itself is what matters).
    const { error } = await supabase.from("zones").update(patch).eq("id", id);
    if (error) throw error;
  },
  async setZoneActive(id: string, active: boolean): Promise<void> {
    const { error } = await supabase.from("zones").update({ is_active: active }).eq("id", id);
    if (error) throw error;
  },

  // ── Queue ──────────────────────────────────────────────────────────────
  async zoneQueue(zoneId: string): Promise<QueueEntryRow[]> {
    const { data, error } = await supabase
      .from("queue_entries")
      .select("*, driver:drivers(full_name, phone), vehicle:vehicles(make, model, seats)")
      .eq("zone_id", zoneId)
      .order("position", { ascending: true });
    if (error) throw error;
    return (data as QueueEntryRow[]) ?? [];
  },
  // Verified-driver roster for the "add driver" picker, each with a vehicle.
  async verifiedDrivers(query: string): Promise<DriverLite[]> {
    let q = supabase.from("drivers").select("id, full_name, phone, verified").eq("verified", true).order("full_name").limit(100);
    const term = query.trim();
    if (term) q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);
    const { data } = await q;
    const drivers = (data as { id: string; full_name: string | null; phone: string | null; verified: boolean }[]) ?? [];
    if (drivers.length === 0) return [];
    const { data: vehicles } = await supabase
      .from("vehicles").select("driver_id, make, model, seats, is_active")
      .in("driver_id", drivers.map((d) => d.id));
    const byDriver = new Map<string, { make: string; model: string; seats: number }>();
    for (const v of (vehicles as { driver_id: string; make: string; model: string; seats: number; is_active: boolean }[] | null) ?? []) {
      if (!byDriver.get(v.driver_id) || v.is_active) byDriver.set(v.driver_id, { make: v.make, model: v.model, seats: v.seats });
    }
    return drivers.map((d) => ({ ...d, vehicle: byDriver.get(d.id) ?? null }));
  },
  async addToQueue(zoneId: string, dest: string | null, driverId: string, pos: number | null, minutes: number | null): Promise<void> {
    const { error } = await supabase.rpc("loadq_admin_add", { p_zone: zoneId, p_dest: dest, p_driver_id: driverId, p_pos: pos, p_minutes: minutes });
    if (error) throw error;
  },
  async move(entryId: string, newPos: number): Promise<void> {
    const { error } = await supabase.rpc("loadq_admin_move", { p_entry_id: entryId, p_new_pos: newPos });
    if (error) throw error;
  },
  async depart(entryId: string): Promise<void> {
    const { error } = await supabase.rpc("loadq_admin_depart", { p_entry_id: entryId, p_seats: 0 });
    if (error) throw error;
  },
  async removeFromQueue(entryId: string): Promise<void> {
    const { error } = await supabase.rpc("admin_remove_from_queue", { p_entry_id: entryId });
    if (error) throw error;
  },

  // ── Queue window (hours) ────────────────────────────────────────────────
  async queueWindow(): Promise<{ register_open_hour: number; load_open_hour: number; close_hour: number }> {
    const fallback = { register_open_hour: 0, load_open_hour: 5, close_hour: 23 };
    const { data } = await supabase.from("queue_window").select("register_open_hour, load_open_hour, close_hour").eq("id", 1).maybeSingle();
    return (data as typeof fallback) ?? fallback;
  },
  async setQueueWindow(reg: number, load: number, close: number): Promise<void> {
    const { error } = await supabase.rpc("loadq_set_queue_window", { p_register: reg, p_load: load, p_close: close });
    if (error) throw error;
  },

  // ── Driver documents (verification review) ──────────────────────────────
  async docsQueue(status: DocStatus = "pending"): Promise<DriverDocRow[]> {
    const { data, error } = await supabase.rpc("loadq_admin_docs_queue", { p_status: status });
    if (error) throw error;
    return (data as DriverDocRow[]) ?? [];
  },
  // Admin RLS (ddoc_sel_own → loadq_is_admin()) lets an admin read any driver's file.
  async docSignedUrl(path: string): Promise<string | null> {
    const { data, error } = await supabase.storage.from("driver-docs").createSignedUrl(path, 3600);
    if (error) throw error;
    return data?.signedUrl ?? null;
  },
  async reviewDoc(docId: string, decision: "approved" | "rejected", opts?: { notes?: string; expiresOn?: string | null }): Promise<DocReviewResult> {
    const { data, error } = await supabase.rpc("loadq_admin_doc_review", {
      p_doc_id: docId, p_decision: decision,
      p_notes: opts?.notes ?? null, p_expires_on: opts?.expiresOn ?? null,
    });
    if (error) throw error;
    return data as DocReviewResult;
  },

  // ── Rides (on-route pickup + on-demand dispatch) ────────────────────────
  async rides(status: string | null = null): Promise<RideRow[]> {
    const { data, error } = await supabase.rpc("loadq_ride_admin_list", { p_status: status });
    if (error) throw error;
    return (data as RideRow[]) ?? [];
  },
  async rideMarkPaid(requestId: string): Promise<void> {
    const { error } = await supabase.rpc("loadq_ride_mark_paid", { p_request_id: requestId, p_method: "interac" });
    if (error) throw error;
  },

  // ── Relocate (move people between locations) ────────────────────────────
  // Move a driver's active queue entry to another zone and/or destination.
  async relocateDriver(entryId: string, newZone: string, newDest: string | null, newPos: number | null, releasePassengers: boolean | null): Promise<void> {
    const { error } = await supabase.rpc("loadq_admin_relocate_driver", {
      p_entry_id: entryId, p_new_zone: newZone, p_new_dest: newDest,
      p_new_pos: newPos, p_release_passengers: releasePassengers,
    });
    if (error) throw error;
  },
  // Move a passenger's reservation onto a target driver's queue entry.
  async relocatePassenger(passengerId: string, targetEntryId: string, seats: number | null): Promise<void> {
    const { error } = await supabase.rpc("loadq_admin_relocate_passenger", {
      p_passenger_id: passengerId, p_target_entry_id: targetEntryId, p_seats: seats,
    });
    if (error) throw error;
  },
  // Passenger roster for the relocate picker.
  async searchPassengers(query: string): Promise<PassengerLite[]> {
    let q = supabase.from("passengers").select("id, full_name, phone").order("full_name").limit(100);
    const term = query.trim();
    if (term) q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);
    const { data, error } = await q;
    if (error) throw error;
    return (data as PassengerLite[]) ?? [];
  },
  // A passenger's current active reservation (driver + zone + destination), if any.
  async passengerReservation(passengerId: string): Promise<PassengerReservation | null> {
    const { data, error } = await supabase
      .from("seat_claims")
      .select("id, status, queue_entry:queue_entries(id, zone_id, destination_region, position, driver:drivers(full_name, phone))")
      .eq("passenger_id", passengerId)
      .in("status", ["pending", "confirmed"])
      .order("claimed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    // Embedded relations can come back as arrays under the untyped client — flatten.
    const one = (v: unknown): any => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
    const row = data as unknown as { status: string; queue_entry: unknown };
    const qe = one(row.queue_entry);
    if (qe) qe.driver = one(qe.driver);
    return { claimStatus: row.status, entry: qe as PassengerReservation["entry"] };
  },
};

export type PassengerLite = { id: string; full_name: string | null; phone: string | null };
export type PassengerReservation = {
  claimStatus: string;
  entry: { id: string; zone_id: string; destination_region: string | null; position: number; driver?: { full_name: string | null; phone: string | null } | null } | null;
};

export type RideRow = {
  id: string; kind: string; passenger_id: string; status: string;
  payment_status: string; payment_method: string;
  pickup_label: string | null; dest_region: string | null; fare_cents: number | null;
  driver_id: string | null; driver_name: string | null; live_offers: number; created_at: string;
};

export type DocStatus = "pending" | "approved" | "rejected" | "expired" | "all";
export type DriverDocRow = {
  doc_id: string; driver_id: string; full_name: string | null; phone: string | null; email: string | null;
  plate: string | null; doc_type: string; status: string; storage_path: string;
  expires_on: string | null; doc_number: string | null; review_notes: string | null;
  submitted_at: string; driver_verified: boolean;
};
export type DocReviewResult = { doc_id: string; driver_id: string; decision: string; driver_verified: boolean };

export function errMsg(e: unknown): string {
  if (!e) return "Something went wrong";
  if (typeof e === "string") return e;
  const m = (e as { message?: string }).message;
  return m || "Something went wrong";
}
