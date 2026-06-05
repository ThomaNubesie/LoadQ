import * as Location from "expo-location";
import { getCurrentLocationWithTimeout } from "../utils/gpsTimeout";
import { supabase } from "./supabase";

let _interval: ReturnType<typeof setInterval> | null = null;

// Upload caller's current position via update_my_location RPC. Both drivers
// and passengers call the same function; the RPC updates whichever table
// they're in.
async function uploadOnce() {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return;
    // Shares the app-wide single-flight read (see utils/gpsTimeout) so this
    // 60s loop never stacks a native GPS request on top of a screen's read.
    const loc = await getCurrentLocationWithTimeout(8000);
    if (!loc) return;
    await supabase.rpc("update_my_location", {
      p_lat: loc.coords.latitude,
      p_lng: loc.coords.longitude,
    });
  } catch {
    /* silent — best effort */
  }
}

// Start a periodic foreground upload loop. Safe to call multiple times —
// previous interval gets cleared. Stops automatically when stop() is called
// (e.g. on sign-out).
export const LocationAPI = {
  start(intervalMs = 60_000) {
    this.stop();
    uploadOnce(); // first tick now
    _interval = setInterval(uploadOnce, intervalMs);
  },
  stop() {
    if (_interval) { clearInterval(_interval); _interval = null; }
  },
};
