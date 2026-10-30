import { supabase } from "./supabase";

// LoadQ morning raffle — fair lottery that replaces the handwritten sign-up sheet.
// Backend lives in the shared DB (migrations loadq_morning_raffle / loadq_raffle_launch):
// RPCs loadq_raffle_status / _enter / _result. One zone configured for now; add
// zones in loadq_raffle_config to expand.
export const RAFFLE_ZONE = "ottawa-universal-grocery";

export type RaffleStatus = {
  zone: string;
  round_id: string | null;
  status: "none" | "open" | "locked" | "drawn" | "cancelled";
  test_mode?: boolean;
  is_admin?: boolean;
  window_open: boolean;
  draw_at: string | null;
  seed_commit: string | null;
  entrant_count: number;
  eligible: boolean;
  already_raffled: boolean;
  my_number: number | null;
  can_raffle: boolean;       // drives the Raffle button / banner visibility
  error?: string;
};

export type RaffleEnterResult =
  | { ok: true; registered?: boolean; test?: boolean; entry_id?: string; provisional_position: number; entrant_count?: number; note: string }
  | { ok?: false; error: string; distance_m?: number };

export type RaffleOrderRow = { pos: number; driver_id: string; name: string; seats: number };
export type RaffleResult = {
  round_id: string;
  status: string;
  drawn_at: string | null;
  final: boolean;
  seed_commit: string;
  seed_reveal: string | null;
  order: RaffleOrderRow[];
  error?: string;
};

export const RaffleAPI = {
  async status(zone: string = RAFFLE_ZONE): Promise<RaffleStatus> {
    const { data, error } = await supabase.rpc("loadq_raffle_status", { p_zone: zone });
    if (error) return { zone, round_id: null, status: "none", window_open: false, draw_at: null,
      seed_commit: null, entrant_count: 0, eligible: false, already_raffled: false,
      my_number: null, can_raffle: false, error: error.message };
    return data as RaffleStatus;
  },

  async enter(args: { zone?: string; lat: number; lng: number; accuracy: number | null;
                      code: string; deviceId: string }): Promise<RaffleEnterResult> {
    const { data, error } = await supabase.rpc("loadq_raffle_enter", {
      p_zone: args.zone ?? RAFFLE_ZONE, p_lat: args.lat, p_lng: args.lng,
      p_accuracy: args.accuracy, p_code: args.code, p_device: args.deviceId });
    if (error) return { error: error.message };
    return data as RaffleEnterResult;
  },

  async result(roundId: string): Promise<RaffleResult> {
    const { data, error } = await supabase.rpc("loadq_raffle_result", { p_round: roundId });
    if (error) return { round_id: roundId, status: "error", drawn_at: null, final: false,
      seed_commit: "", seed_reveal: null, order: [], error: error.message };
    return data as RaffleResult;
  },
};
