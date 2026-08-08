import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// Single-active-session enforcement (driver AND passenger).
// Each sign-in mints a fresh device session id, stored locally and written to
// active_sessions(user_id -> session_id). A newer sign-in on any other device
// overwrites that row; the previous device sees the mismatch (via Realtime or a
// foreground re-check) and is force-signed-out. Simultaneous sessions are thus
// impossible: only the most-recent device stays valid.

// MASTER SWITCH — lives in the DB (app_flags.single_session_enforce), NOT in the
// app bundle, so it can be toggled ON/OFF with zero rebuild. While off, the app
// still *records* which device is active (so the data is ready) but NEVER
// force-logs-out or blocks any device. Flip the DB flag → enforcement goes live
// for every device in realtime; nobody is kicked until you do.
//   Turn ON:  update public.app_flags set enabled=true  where key='single_session_enforce';
//   Turn OFF: update public.app_flags set enabled=false where key='single_session_enforce';
const FLAG_KEY = "single_session_enforce";
let _enforce = false; // last-known value; fail-safe OFF until first fetch.

const KEY = "loadq.device_session_id";

// RFC4122-ish v4 without crypto deps — uniqueness, not cryptographic strength.
function newId() {
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${s.slice(16, 20)}-${s.slice(20)}-${Date.now().toString(16)}`;
}

export const SessionAPI = {
  // Call right after a successful OTP verification. Claims this device as THE
  // active session for the user, evicting any other device.
  async claim(userId: string): Promise<void> {
    try {
      const id = newId();
      await AsyncStorage.setItem(KEY, id);
      await supabase.from("active_sessions").upsert(
        { user_id: userId, session_id: id, platform: Platform.OS, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    } catch { /* never block sign-in on session bookkeeping */ }
  },

  async localId(): Promise<string | null> {
    try { return await AsyncStorage.getItem(KEY); } catch { return null; }
  },

  async clearLocal(): Promise<void> {
    try { await AsyncStorage.removeItem(KEY); } catch { /* noop */ }
  },

  // True if this device still owns the active session. Fail-OPEN on any error or
  // missing data so a transient network blip never logs a legitimate user out.
  async isCurrent(userId: string): Promise<boolean> {
    try {
      const local = await AsyncStorage.getItem(KEY);
      if (!local) return true; // pre-migration install / never claimed
      const { data, error } = await supabase
        .from("active_sessions").select("session_id").eq("user_id", userId).maybeSingle();
      if (error || !data) return true;
      return data.session_id === local;
    } catch { return true; }
  },

  // Realtime watch: fires onKicked() the instant another device claims the seat.
  // Returns an unsubscribe fn.
  subscribe(userId: string, onKicked: () => void): () => void {
    let cancelled = false;
    const ch = supabase
      .channel(`sess:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "active_sessions", filter: `user_id=eq.${userId}` },
        async (payload: any) => {
          if (cancelled) return;
          const serverId = payload?.new?.session_id;
          if (!serverId) return;
          const local = await AsyncStorage.getItem(KEY).catch(() => null);
          if (local && serverId !== local) onKicked();
        },
      )
      .subscribe();
    return () => { cancelled = true; try { supabase.removeChannel(ch); } catch { /* noop */ } };
  },

  // --- Remote master switch (app_flags.single_session_enforce) ---------------

  // Synchronous last-known value. Fail-safe OFF until the first fetch resolves.
  isEnforcing(): boolean { return _enforce; },

  // Pull the current flag value from the DB. Keeps the last-known value on error
  // so a network blip never spuriously turns enforcement on or off.
  async refreshEnforcement(): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from("app_flags").select("enabled").eq("key", FLAG_KEY).maybeSingle();
      if (!error && data) _enforce = !!data.enabled;
    } catch { /* keep last-known */ }
    return _enforce;
  },

  // Realtime watch on the flag itself, so flipping it in the DB activates (or
  // deactivates) enforcement on every running device with no relaunch.
  subscribeFlag(onChange: (enabled: boolean) => void): () => void {
    const ch = supabase
      .channel(`appflag:${FLAG_KEY}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_flags", filter: `key=eq.${FLAG_KEY}` },
        (payload: any) => {
          const enabled = !!payload?.new?.enabled;
          _enforce = enabled;
          onChange(enabled);
        },
      )
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch { /* noop */ } };
  },
};
