import * as Location from "expo-location";

// Single-flight guard around one-shot position reads. Concurrent callers
// (focus re-detect, 60s background uploader, etc.) share ONE outstanding
// getCurrentPositionAsync request instead of each firing their own. On
// Android, overlapping native location requests pile up listeners and
// crash/ANR when a cold GPS fix takes longer than a caller's poll interval —
// this is the main source of the slow-load + crash reports. The slot clears
// the moment the underlying read settles, so genuine sequential reads still
// get fresh fixes.
let _inFlight: Promise<Location.LocationObject> | null = null;

function readPositionOnce(
  accuracy: Location.LocationAccuracy,
): Promise<Location.LocationObject> {
  if (!_inFlight) {
    _inFlight = Location.getCurrentPositionAsync({ accuracy })
      .finally(() => { _inFlight = null; });
  }
  return _inFlight;
}

// Test-only: clear the shared in-flight slot between cases so a never-
// resolving mock can't leak into the next test.
export function __resetGpsSingleFlight() {
  _inFlight = null;
}

// On Android the permission API itself (requestForegroundPermissionsAsync)
// can hang when the system is in a weird state — permission dialog queued
// behind notifications, OS background restrictions, locked permission
// state, etc. Racing only getCurrentPositionAsync isn't enough; we have
// to race the entire permission+location flow against a top-level timeout.
//
// Returns null on permission-denied, timeout, or any failure so callers
// fall back gracefully instead of awaiting forever.
export async function tryGetUserLocation(
  timeoutMs: number = 8000,
  accuracy: Location.LocationAccuracy = Location.Accuracy.Balanced,
): Promise<Location.LocationObject | null> {
  try {
    return await Promise.race<Location.LocationObject | null>([
      (async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return null;
        return await readPositionOnce(accuracy);
      })(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

// Kept for callers that need just the position read with a timeout (no
// permission request). Used by background poll loops where permission was
// already established at app start.
export async function getCurrentLocationWithTimeout(
  timeoutMs: number = 8000,
  accuracy: Location.LocationAccuracy = Location.Accuracy.Balanced,
): Promise<Location.LocationObject | null> {
  try {
    return await Promise.race<Location.LocationObject | null>([
      readPositionOnce(accuracy),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}
