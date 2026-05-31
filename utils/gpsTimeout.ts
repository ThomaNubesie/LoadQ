import * as Location from "expo-location";

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
        return await Location.getCurrentPositionAsync({ accuracy });
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
    return await Promise.race([
      Location.getCurrentPositionAsync({ accuracy }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}
