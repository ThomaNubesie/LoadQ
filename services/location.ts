import * as Location from "expo-location";
import { supabase } from "./supabase";

let _interval: ReturnType<typeof setInterval> | null = null;

// Upload caller's current position via update_my_location RPC. Both drivers
// and passengers call the same function; the RPC updates whichever table
// they're in.
async function uploadOnce() {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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
