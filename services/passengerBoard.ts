// LoadQ Passenger Board — app-side wrappers for the live board RPCs on Supabase
// (project kzjptcpjpwlxfofzhyku). Every RPC returns RAW values (status enums,
// integers, cents); screens localize via t() and format via the helpers here.
// Backend contract: see kolis-passenger-integration-handoff.md.
import { supabase } from "./supabase";

/* ------------------------------------------------------------- module cache
 * Last-known results survive tab switches so screens paint instantly from
 * cache, then refresh in the background — no from-scratch reload each focus. */
const _boardCache = new Map<string, BoardCar[]>();
const _cityZonesCache = new Map<string, CityZone[]>();
let _myTripCache: MyTrip | null = null;
const boardKey = (zoneId: string, dest: string) => `${zoneId}|${dest}`;

/* ------------------------------------------------------------------ types */

export type CarStatus = "waiting" | "loading";                 // queue_entries.status
export type TripStatus = "held" | "boarded" | "departed" | "cancelled" | "expired";

export interface NearestZone {
  id:            string;
  name:          string;
  distance_m:    number;
  within_radius: boolean;
  latitude:      number;
  longitude:     number;
}

export interface BoardCar {
  queue_entry_id: string;
  position:       number;
  status:         CarStatus;      // front car = "loading" (reservable); others "waiting"
  load_deadline:  string | null;  // ISO — countdown source for the loading car
  driver_id:      string;
  driver_name:    string;
  avatar_url:     string | null;
  rating_avg:     number | null;  // show "New" when rating_count === 0
  rating_count:   number;
  make:           string | null;
  model:          string | null;
  type:           string | null;
  color:          string | null;
  year:           number | null;
  seats:          number;
  seats_taken:    number;
  seats_left:     number;
  fare_cents:     number | null;
}

export interface MyTrip {
  trip_id:            string;
  status:             TripStatus;         // held | boarded (only these are returned)
  seats:              number;
  pay_mode:           string;
  hold_expires_at:    string | null;      // ISO — hold countdown
  destination_region: string;
  zone_id:            string;
  queue_entry_id:     string;
  position:           number;
  car_status:         CarStatus;          // loading = boarding now
  load_deadline:      string | null;
  driver_id:          string;
  driver_name:        string;
  driver_phone:         string | null;
  driver_interac_email: string | null;
  driver_interac_phone: string | null;
  rating_avg:         number | null;
  avatar_url:         string | null;
  make:               string | null;
  model:              string | null;
  plate:              string | null;
  type:               string | null;
  color:              string | null;
  year:               number | null;
  vehicle_seats:      number | null;
  price_paid:         number | null;
  zone_name:          string | null;
  zone_address:       string | null;
  zone_lat:           number | null;
  zone_lng:           number | null;
}

// A pickup zone within a city (region), with live car counts. Busiest first.
export interface CityZone {
  id:          string;
  name:        string;
  region:      string;
  latitude:    number;
  longitude:   number;
  address:     string | null;
  car_count:   number;
  has_loading: boolean;
}

export interface Reservation {
  trip_id:         string;
  hold_expires_at: string;
  seats:           number;
  seats_left:      number;
}

// A reservation on the driver's loading car (driver-side board list).
export interface CarPassenger {
  trip_id:         string;
  seats:           number;
  status:          "held" | "boarded";
  hold_expires_at: string | null;
  created_at:      string;
  passenger_id:    string;
  passenger_name:  string;
  avatar_url:      string | null;
  rating_avg:      number | null;
  rating_count:    number;
}

// reserve_seat raises these Postgres exceptions — surface the code so the UI localizes.
export type ReserveError =
  | "unauthenticated" | "car_not_found" | "not_loading_car" | "seats_full" | "already_reserved" | "unknown";

/* -------------------------------------------------------------- formatting */

// "2017 Honda Odyssey · Light Grey" — year/make/model with colour appended.
export function vehicleLabel(v: { year?: number | null; color?: string | null; make?: string | null; model?: string | null }): string {
  const base = [v.year || null, v.make, v.model].filter(Boolean).join(" ");
  return v.color ? (base ? `${base} · ${v.color}` : v.color) : base;
}

export function formatFare(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

// Rating for display: null/"New" when the driver has no ratings yet.
export function ratingLabel(avg: number | null | undefined, count: number): { isNew: boolean; stars: string | null } {
  if (!count || count === 0) return { isNew: true, stars: null };
  return { isNew: false, stars: (avg ?? 0).toFixed(1) };
}

function normalizeReserveError(msg?: string): ReserveError {
  const m = (msg || "").toLowerCase();
  if (m.includes("not_loading_car")) return "not_loading_car";
  if (m.includes("seats_full"))      return "seats_full";
  if (m.includes("already_reserved"))return "already_reserved";
  if (m.includes("car_not_found"))   return "car_not_found";
  if (m.includes("unauthenticated")) return "unauthenticated";
  return "unknown";
}

/* --------------------------------------------------------------------- API */

export const PassengerBoardAPI = {
  /** Nearest active pickup zone to a coordinate (or null if none). */
  async nearestZone(lat: number, lng: number): Promise<NearestZone | null> {
    const { data, error } = await supabase.rpc("loadq_nearest_zone", { p_lat: lat, p_lng: lng });
    if (error) { console.warn("[board] nearestZone", error.message); return null; }
    return (data as NearestZone) ?? null;
  },

  /** Live queue for a zone + destination — cars in order, front car "loading". */
  async board(zoneId: string, destination: string): Promise<BoardCar[]> {
    const { data, error } = await supabase.rpc("loadq_passenger_board", {
      p_zone_id: zoneId, p_destination: destination,
    });
    if (error) { console.warn("[board] board", error.message); return _boardCache.get(boardKey(zoneId, destination)) ?? []; }
    const rows = (data as BoardCar[]) ?? [];
    _boardCache.set(boardKey(zoneId, destination), rows);
    return rows;
  },

  /** Last-known board for a zone+dest (instant paint before the refresh lands). */
  cachedBoard(zoneId: string, destination: string): BoardCar[] | null {
    return _boardCache.get(boardKey(zoneId, destination)) ?? null;
  },

  /** Active pickup zones in a city (region), busiest first, with live counts. */
  async cityZones(region: string): Promise<CityZone[]> {
    const { data, error } = await supabase.rpc("loadq_city_zones", { p_region: region });
    if (error) { console.warn("[board] cityZones", error.message); return _cityZonesCache.get(region) ?? []; }
    const rows = (data as CityZone[]) ?? [];
    _cityZonesCache.set(region, rows);
    return rows;
  },

  cachedCityZones(region: string): CityZone[] | null {
    return _cityZonesCache.get(region) ?? null;
  },

  cachedMyTrip(): MyTrip | null { return _myTripCache; },

  /** Adjust seats on the caller's held reservation (add or decrease). */
  async updateSeats(tripId: string, seats: number): Promise<{ data?: Reservation; error?: ReserveError }> {
    const { data, error } = await supabase.rpc("loadq_update_reservation_seats", { p_trip_id: tripId, p_seats: seats });
    if (error) return { error: normalizeReserveError(error.message) };
    return { data: data as Reservation };
  },

  /** Reserve seats on the front (loading) car; holds them 15 min. */
  async reserve(queueEntryId: string, seats: number): Promise<{ data?: Reservation; error?: ReserveError }> {
    const { data, error } = await supabase.rpc("loadq_reserve_seat", {
      p_queue_entry_id: queueEntryId, p_seats: seats,
    });
    if (error) return { error: normalizeReserveError(error.message) };
    return { data: data as Reservation };
  },

  /** Release the caller's hold. */
  async cancel(tripId: string): Promise<{ error?: string }> {
    const { error } = await supabase.rpc("loadq_cancel_reservation", { p_trip_id: tripId });
    return { error: error?.message };
  },

  /** The caller's active held/boarded trip with live car status (or null). */
  async myTrip(): Promise<MyTrip | null> {
    const { data, error } = await supabase.rpc("loadq_my_trip");
    if (error) { console.warn("[board] myTrip", error.message); return _myTripCache; }
    _myTripCache = (data as MyTrip) ?? null;
    return _myTripCache;
  },

  /** Rider rates the driver. tags = short raw keys; note optional. */
  async rateDriver(tripId: string, stars: number, tags: string[] = [], note?: string): Promise<{ error?: string }> {
    const { error } = await supabase.rpc("loadq_rate_driver", {
      p_trip_id: tripId, p_stars: stars, p_tags: tags.length ? tags : null, p_note: note || null,
    });
    return { error: error?.message };
  },

  /* ---- driver side ---- */

  /** Held/boarded reservations on the driver's own loading car. */
  async carPassengers(queueEntryId: string): Promise<CarPassenger[]> {
    const { data, error } = await supabase.rpc("loadq_car_passengers", { p_queue_entry_id: queueEntryId });
    if (error) { console.warn("[board] carPassengers", error.message); return []; }
    return (data as CarPassenger[]) ?? [];
  },

  /** Driver marks a held reservation boarded. */
  async boardPassenger(tripId: string): Promise<{ error?: string }> {
    const { error } = await supabase.rpc("loadq_board_passenger", { p_trip_id: tripId });
    return { error: error?.message };
  },

  /** Driver rates the passenger. */
  async ratePassenger(tripId: string, stars: number, tags: string[] = [], note?: string): Promise<{ error?: string }> {
    const { error } = await supabase.rpc("loadq_rate_passenger", {
      p_trip_id: tripId, p_stars: stars, p_tags: tags.length ? tags : null, p_note: note || null,
    });
    return { error: error?.message };
  },

  /* ---- realtime ---- */

  /**
   * Live board: fire `onChange` whenever this zone's queue moves (car promoted,
   * seats locked, driver departs). The caller re-fetches board() on each tick.
   * Filtering by destination is done client-side in board().
   */
  subscribeBoard(zoneId: string, onChange: () => void) {
    const name = `board-${zoneId}`;
    const existing = supabase.getChannels().find((ch) => ch.topic === `realtime:${name}`);
    if (existing) supabase.removeChannel(existing);
    const channel = supabase
      .channel(name)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "queue_entries", filter: `zone_id=eq.${zoneId}` },
        onChange)
      .subscribe();
    return { unsubscribe: () => supabase.removeChannel(channel) };
  },

  /**
   * Live "my trip": fire `onChange` when the caller's own trips change (boarded,
   * departed, expired, cancelled) so the screen re-fetches myTrip().
   */
  subscribeMyTrip(passengerId: string, onChange: () => void) {
    const name = `mytrip-${passengerId}`;
    const existing = supabase.getChannels().find((ch) => ch.topic === `realtime:${name}`);
    if (existing) supabase.removeChannel(existing);
    const channel = supabase
      .channel(name)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "trips", filter: `passenger_id=eq.${passengerId}` },
        onChange)
      .subscribe();
    return { unsubscribe: () => supabase.removeChannel(channel) };
  },
};
