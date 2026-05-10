export type VehicleType = "minibus" | "van" | "sedan" | "suv" | "bush_taxi" | "tricycle";

export interface Vehicle {
  id: string;
  driver_id: string;
  type: VehicleType;
  make: string;
  model: string;
  year: number;
  plate: string;
  seats: number;
  image_url?: string;
  is_active: boolean;
  created_at: string;
}

export interface Driver {
  id: string;
  full_name: string;
  phone: string;
  email?: string;
  avatar_url?: string;
  subscription_status: "trialing" | "active" | "grace" | "expired" | "cancelled";
  subscription_plan: "monthly" | "annual" | null;
  trial_ends_at?: string;
  subscription_ends_at?: string;
  grace_ends_at?: string;
  stripe_customer_id?: string;
  trust_score: number;
  created_at: string;
}

export interface Zone {
  id: string;
  name: string;
  admin_id: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  max_active_slots: number;
  load_time_limit_mins: number;
  return_window_mins: number;
  callback_count: number;
  is_active: boolean;
  created_at: string;
}

export type QueueStatus = "loading" | "called_back" | "waiting" | "penalised";
export type SeatStatus  = "empty" | "boarded" | "locked" | "disputed";

export interface QueueEntry {
  id: string;
  zone_id: string;
  driver_id: string;
  vehicle_id: string;
  position: number;
  status: QueueStatus;
  seats_boarded: number;
  seats_locked: number;
  return_deadline?: string;
  load_start_at?: string;
  load_deadline?: string;
  joined_at: string;
  driver?: Driver;
  vehicle?: Vehicle;
  seat_states?: SeatStatus[];
}

export interface SeatConfirmation {
  id: string;
  queue_entry_id: string;
  confirming_driver_id: string;
  seats_claimed: number;
  confirmed: boolean;
  disputed: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  driver_id: string;
  plan: "monthly" | "annual";
  status: "trialing" | "active" | "grace" | "expired" | "cancelled";
  stripe_subscription_id: string;
  current_period_start: string;
  current_period_end: string;
  trial_end?: string;
  grace_end?: string;
  amount_cad: number;
}
