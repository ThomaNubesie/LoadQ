import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { getCurrentLang } from "../hooks/useStrings";
import { getStrings } from "../constants/i18n";

// Background location task — keeps the driver's position fresh in the DB even
// when the app is backgrounded or the screen is off. 1.2.5 only reported GPS in
// the foreground (queue/loading screens watchPositionAsync), so a driver with
// the app in their pocket went stale: the queue watchdog couldn't trust
// distance/time, and parcel senders/admin saw a frozen ETA. This adds true
// background reporting while a driver is loading or carrying a parcel.
//
// Reports through the same update_my_location RPC the foreground loop uses, so
// it writes drivers.current_lat/lng/location_at that the watchdog reads.
export const BG_LOCATION_TASK = "loadq-bg-location";

// Guard the registration: defineTask runs at module-load (import side-effect).
// On a device where expo-task-manager can't initialize (old Android / missing
// Play Services), this must no-op rather than crash the app on launch.
try {
  TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const locs = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
    const loc = locs?.[locs.length - 1];
    if (!loc) return;
    try {
      await supabase.rpc("update_my_location", {
        p_lat: loc.coords.latitude,
        p_lng: loc.coords.longitude,
      });
    } catch {
      /* best effort — the next fix retries */
    }
  });
} catch {
  /* TaskManager unavailable — background tracking will simply not run */
}

// Google Play REQUIRES a prominent in-app disclosure of background-location use,
// shown BEFORE the OS runtime permission prompt — explaining the feature and that
// collection continues when the app is closed/backgrounded. We only go on to
// request permission on affirmative consent. Resolved once per launch (cached
// promise, so concurrent callers share one dialog); a "Continue" is persisted so
// returning users never see it again.
const BG_DISCLOSURE_KEY = "loadq_bg_loc_disclosed_v1";
let bgDisclosure: Promise<boolean> | null = null;
function ensureBackgroundDisclosure(): Promise<boolean> {
  if (bgDisclosure) return bgDisclosure;
  bgDisclosure = (async () => {
    try {
      if ((await AsyncStorage.getItem(BG_DISCLOSURE_KEY)) === "1") return true;
    } catch { /* storage unavailable — show the disclosure anyway */ }
    const s = getStrings(getCurrentLang());
    const accepted = await new Promise<boolean>((resolve) => {
      Alert.alert(
        s.bgLocTitle,
        s.bgLocBody,
        [
          { text: s.bgLocNotNow, style: "cancel", onPress: () => resolve(false) },
          { text: s.bgLocContinue, onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });
    if (accepted) {
      try { await AsyncStorage.setItem(BG_DISCLOSURE_KEY, "1"); } catch { /* ignore */ }
    }
    return accepted;
  })();
  return bgDisclosure;
}

// Ask for Always/background permission and start streaming. Idempotent — safe to
// call on every loading/carrying transition. Returns true if tracking is running.
export async function startBackgroundTracking(): Promise<boolean> {
  // Background location for queued drivers: a driver waiting in line with the app
  // pocketed/backgrounded must keep reporting GPS so the queue watchdog can tell
  // when they leave the loading zone (and pull / re-insert / remove them). Needs
  // ACCESS_BACKGROUND_LOCATION + a location foreground service (Android) and
  // "Always" + UIBackgroundModes:location (iOS), declared in app.json — so this
  // takes effect only in a new native build, not an OTA.
  try {
    // Prominent disclosure before any location permission request (Play policy).
    if (!(await ensureBackgroundDisclosure())) return false;
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== "granted") return false;
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== "granted") return false;
    if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)) return true;
    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 120,        // meters moved before a fix — catches a departure before the 5-min tick
      timeInterval: 300_000,        // Android: ~1 fix / 5 min when stationary
      deferredUpdatesInterval: 300_000,  // iOS: batch/defer background fixes to ~5 min — easy on the battery
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        notificationTitle: "LoadQ is sharing your location",
        notificationBody: "Passengers and dispatch can see your position while you load or deliver.",
        notificationColor: "#FF6B00",
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundTracking(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
    }
  } catch {
    /* ignore */
  }
}

export async function isBackgroundTracking(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK);
  } catch {
    return false;
  }
}
