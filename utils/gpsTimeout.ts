import * as Location from "expo-location";

// On iOS with weak GPS, getCurrentPositionAsync can hang for 30s+ without
// throwing. Without a timeout, callers that await it block their UI in a
// "Loading…" state indefinitely. This helper races the GPS read against a
// timeout and returns null on timeout/failure so the caller can fall back
// gracefully (last-known zone, default zone, etc.) instead of freezing.
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
