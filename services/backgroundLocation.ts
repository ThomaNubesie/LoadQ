import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Alert, Platform } from "react-native";
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

// Last reason tracking failed to start (it used to fail silently — on 2026-11-18
// none of 18 queued drivers had reported for over an hour).
let lastError: string | null = null;
export function getLastTrackingError(): string | null { return lastError; }

// Ask for location permission and start streaming. Idempotent — safe to call on
// every loading/carrying transition. Returns true if tracking is running.
//
// What's actually required (learned on Kolis, Nov 2026):
//   iOS: "While Using" is enough. With UIBackgroundModes:location, updates started
//        while the app is open keep running in the background (iOS shows the
//        location indicator). "Always" is offered but not required — requiring it
//        meant drivers who tapped "Allow While Using App" were never tracked.
//   Android: "Allow all the time" is requested (Play approved it), but tracking runs
//        as a visible foreground service, which Android allows with "While using
//        the app" — so a driver who declines the background upgrade is still tracked.
export async function startBackgroundTracking(): Promise<boolean> {
  // Background location for queued drivers: a driver waiting in line with the app
  // pocketed/backgrounded must keep reporting GPS so the queue watchdog can tell
  // when they leave the loading zone (and pull / re-insert / remove them). The
  // native setup (location foreground service on Android, UIBackgroundModes on
  // iOS) is in the 1.2.26 builds; this JS ships OTA.
  try {
    // Prominent disclosure before any location permission request (Play policy).
    if (!(await ensureBackgroundDisclosure())) { lastError = "disclosure_declined"; return false; }
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== "granted") { lastError = "permission_denied"; return false; }
    // Offer the background upgrade; never fail on it (see above).
    await Location.requestBackgroundPermissionsAsync().catch(() => null);
    // Always (re)register rather than returning early when a task exists: this
    // applies the current options to a task left over from an older version.
    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 120,        // meters moved before a fix — catches a departure before the 5-min tick
      timeInterval: 300_000,        // Android: ~1 fix / 5 min when stationary
      deferredUpdatesInterval: 300_000,  // iOS: batch/defer background fixes to ~5 min — easy on the battery
      pausesUpdatesAutomatically: false,
      // iOS: show the location indicator while tracking in the background — keeps
      // "While Using" tracking alive and is honest with the driver.
      showsBackgroundLocationIndicator: Platform.OS === "ios",
      foregroundService: {
        notificationTitle: "LoadQ is sharing your location",
        notificationBody: "Passengers and dispatch can see your position while you load or deliver.",
        notificationColor: "#FF6B00",
      },
    });
    lastError = null;
    return true;
  } catch (e) {
    lastError = String((e as Error)?.message ?? e);
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
