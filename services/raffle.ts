import { supabase } from "./supabase";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";

// LoadQ morning raffle — fair lottery that replaces the handwritten sign-up sheet.
// Backend lives in the shared DB (migrations loadq_morning_raffle / loadq_raffle_launch):
// RPCs loadq_raffle_status / _enter / _result. One zone configured for now; add
// zones in loadq_raffle_config to expand.
export const RAFFLE_ZONE = "ottawa-universal-grocery";   // fallback when nothing else says which lot

// Every active lot runs its own raffle (loadq_raffle_config rows). The app shows the
// raffle of the lot the driver is at: the phone's last known fix (no prompt) within
// 3 km of a lot, else the lot whose line they're in, else the lot they last opened.
export type RaffleLot = { zone_id: string; name: string; destination: string | null; lat: number; lng: number; test_mode: boolean };
const LOT_KEY = "raffleLot";
const DEST: Record<string, string> = { montreal: "Montréal", ottawa: "Ottawa", quebec: "Québec", toronto: "Toronto", gatineau: "Gatineau" };
export const lotShort = (l: RaffleLot) => l.name.split(" - ")[0].trim();
export const lotRoute = (l: RaffleLot) => `${lotShort(l)} → ${DEST[l.destination ?? ""] ?? l.destination ?? ""}`;

function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000, r = Math.PI / 180, dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function raffleLots(): Promise<RaffleLot[]> {
  const { data, error } = await supabase.rpc("loadq_raffle_lots");
  return !error && Array.isArray(data) ? (data as RaffleLot[]) : [];
}

export async function pickRaffleLot(lots?: RaffleLot[]): Promise<string> {
  const all = lots ?? await raffleLots();
  if (all.length === 0) return RAFFLE_ZONE;
  if (all.length === 1) return all[0].zone_id;
  const has = (z?: string | null) => !!z && all.some((l) => l.zone_id === z);
  try {
    const p = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 });
    if (p) {
      const near = all.map((l) => ({ l, d: metres(p.coords.latitude, p.coords.longitude, l.lat, l.lng) }))
                      .sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 3000) return near.l.zone_id;
    }
  } catch { /* no permission / no fix — fall through */ }
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from("queue_entries").select("zone_id")
        .eq("driver_id", user.id).neq("status", "ended").order("joined_at", { ascending: false }).limit(1);
      if (has(data?.[0]?.zone_id)) return data![0].zone_id;
    }
  } catch { /* ignore */ }
  try { const saved = await AsyncStorage.getItem(LOT_KEY); if (has(saved)) return saved!; } catch { /* ignore */ }
  return has(RAFFLE_ZONE) ? RAFFLE_ZONE : all[0].zone_id;
}

export async function rememberRaffleLot(zone: string) {
  try { await AsyncStorage.setItem(LOT_KEY, zone); } catch { /* ignore */ }
}

export type RaffleStatus = {
  zone: string;
  round_id: string | null;
  status: "none" | "open" | "locked" | "drawn" | "cancelled";
  // Two steps: check in at the lot (05:00–06:01, no code) → hat sealed at 1…N →
  // draw with the code (06:02–07:00), each number goes straight onto the line.
  phase?: "none" | "before" | "checkin" | "sealing" | "draw" | "closed";
  test_mode?: boolean;
  is_admin?: boolean;
  window_open: boolean;
  checkin_opens_at?: string | null;
  checkin_closes_at?: string | null;
  draw_opens_at?: string | null;
  draw_at: string | null;
  hat_size?: number | null;
  drawn_count?: number;
  checked_in?: boolean;
  excluded?: boolean;
  seed_commit: string | null;
  entrant_count: number;
  eligible: boolean;
  already_raffled: boolean;
  my_number: number | null;
  can_raffle: boolean;       // drives the Raffle button / banner visibility
  error?: string;
};

export type RaffleEnterResult =
  | { ok: true; registered?: boolean; test?: boolean; checked_in?: boolean; entry_id?: string; provisional_position: number | null;
      assigned_number?: number; entrant_count?: number; note: string }
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

// ── Admin surface (tiered: lead = full control, other admins = partial) ──
export type RaffleMonitorRow = {
  driver_id: string; checked_in_at: string; provisional: number; geo_ok: boolean; code_ok: boolean;
};
export type RaffleAdminCtx = {
  is_admin: boolean;
  is_lead: boolean;
  enabled: boolean;
  test_mode: boolean;
  code_len: number;
  checkin_opens_local: string | null;
  draw_at_local: string | null;
  has_round: boolean;
  status: "none" | "open" | "locked" | "drawn" | "cancelled";
  service_date: string | null;
  code: string | null;
  draw_at: string | null;
  entrant_count: number;
  error?: string;
};
export type RaffleActionResult = { ok?: boolean; error?: string; expected_len?: number; [k: string]: any };

export const RaffleAPI = {
  async status(zone: string = RAFFLE_ZONE): Promise<RaffleStatus> {
    const { data, error } = await supabase.rpc("loadq_raffle_status", { p_zone: zone });
    if (error) return { zone, round_id: null, status: "none", window_open: false, draw_at: null,
      seed_commit: null, entrant_count: 0, eligible: false, already_raffled: false,
      my_number: null, can_raffle: false, error: error.message };
    return data as RaffleStatus;
  },

  async enter(args: { zone?: string; lat: number | null; lng: number | null; accuracy: number | null;
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

  // ── Admin actions (server-gated: see loadq_raffle_admin_controls migration) ──
  async isLead(zone: string = RAFFLE_ZONE): Promise<boolean> {
    const { data, error } = await supabase.rpc("loadq_raffle_is_lead", { p_zone: zone });
    return !error && data === true;
  },

  async adminCtx(zone: string = RAFFLE_ZONE): Promise<RaffleAdminCtx> {
    const { data, error } = await supabase.rpc("loadq_raffle_admin_ctx", { p_zone: zone });
    if (error) return { is_admin: false, is_lead: false, enabled: false, test_mode: false, code_len: 4,
      checkin_opens_local: null, draw_at_local: null, has_round: false, status: "none",
      service_date: null, code: null, draw_at: null, entrant_count: 0, error: error.message };
    return data as RaffleAdminCtx;
  },

  async monitor(zone: string = RAFFLE_ZONE): Promise<RaffleMonitorRow[]> {
    const { data, error } = await supabase.rpc("loadq_raffle_monitor", { p_zone: zone });
    if (error || !Array.isArray(data)) return [];
    return data as RaffleMonitorRow[];
  },

  // Any raffle admin (lead or sub) — set / rotate today's lot code.
  async setCode(code: string, zone: string = RAFFLE_ZONE): Promise<RaffleActionResult> {
    const { data, error } = await supabase.rpc("loadq_raffle_set_code", { p_zone: zone, p_code: code });
    if (error) return { error: error.message };
    return data as RaffleActionResult;
  },

  // Lead admin only — enforced server-side; the UI also hides these for sub-admins.
  async setTestMode(enabled: boolean, zone: string = RAFFLE_ZONE): Promise<RaffleActionResult> {
    const { data, error } = await supabase.rpc("loadq_raffle_set_test_mode", { p_zone: zone, p_enabled: enabled });
    if (error) return { error: error.message };
    return data as RaffleActionResult;
  },
  async setEnabled(enabled: boolean, zone: string = RAFFLE_ZONE): Promise<RaffleActionResult> {
    const { data, error } = await supabase.rpc("loadq_raffle_set_enabled_lead", { p_zone: zone, p_enabled: enabled });
    if (error) return { error: error.message };
    return data as RaffleActionResult;
  },
  async forceDraw(zone: string = RAFFLE_ZONE): Promise<RaffleActionResult> {
    const { data, error } = await supabase.rpc("loadq_raffle_finalize_lead", { p_zone: zone });
    if (error) return { error: error.message };
    return data as RaffleActionResult;
  },
};
