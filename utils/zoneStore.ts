import AsyncStorage from "@react-native-async-storage/async-storage";

// Persists the passenger's currently active zone across app launches/
// crashes. Without this, every cold start re-runs GPS auto-detect — and
// if GPS hasn't returned yet (or the user denied permission, or the OS
// killed location services), activeZone defaults to zones[0] which is
// "McDonald's Saint-Raymond" (the first Gatineau zone by server sort).
// Users in other regions then have to manually re-pick their zone on
// every relaunch. 6h TTL keeps stale picks from following users when
// they actually travel.

const KEY = "active-zone-v1";
const TTL_MS = 6 * 60 * 60 * 1000;

export interface StoredZone {
  zoneId: string;
  manual: boolean;   // true when user picked via Zones tab; survives auto-detect
  savedAt: number;
}

export async function saveActiveZone(zoneId: string, manual: boolean): Promise<void> {
  try {
    const payload: StoredZone = { zoneId, manual, savedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
  } catch { /* ignore — non-fatal */ }
}

export async function loadActiveZone(): Promise<StoredZone | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredZone;
    if (!parsed?.zoneId || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearActiveZone(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch {}
}
