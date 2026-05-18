import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { ZonesAPI, ZoneRow } from "../services/zones";
import { INITIAL_ZONES } from "../constants/zones";

// Module-level cache so non-React code (services, utils) can read the current
// zones synchronously. Updated by the listener pattern below.
let _zones: ZoneRow[] = INITIAL_ZONES;
const _listeners = new Set<() => void>();

const STORAGE_KEY = "zones-cache-v1";
let _hydrated = false;
let _refreshing = false;

function notify() { _listeners.forEach(fn => fn()); }

async function hydrateFromStorage(): Promise<void> {
  if (_hydrated) return;
  _hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ZoneRow[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        _zones = parsed;
        notify();
      }
    }
  } catch { /* ignore, fall back to INITIAL_ZONES */ }
}

async function refreshFromServer(): Promise<{ error?: string }> {
  if (_refreshing) return {};
  _refreshing = true;
  try {
    const fresh = await ZonesAPI.list(false);
    if (fresh.length > 0) {
      _zones = fresh;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      notify();
    }
    return {};
  } catch (e: any) {
    return { error: e?.message ?? "Could not refresh zones" };
  } finally {
    _refreshing = false;
  }
}

// Sync accessors for non-React callers (services, utils).
export function getCurrentZones(): ZoneRow[] { return _zones; }

export function getZoneById(zoneId: string | null | undefined): ZoneRow | undefined {
  if (!zoneId) return undefined;
  return _zones.find(z => z.id === zoneId);
}

export function getZoneTimezone(zoneId: string | null | undefined): string {
  return getZoneById(zoneId)?.timezone ?? "America/Toronto";
}

export function useZones(): {
  zones:   ZoneRow[];
  loading: boolean;
  refresh: () => Promise<{ error?: string }>;
} {
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(!_hydrated);

  useEffect(() => {
    const update = () => setTick(t => t + 1);
    _listeners.add(update);
    (async () => {
      await hydrateFromStorage();
      setLoading(false);
      refreshFromServer();
    })();
    return () => { _listeners.delete(update); };
  }, []);

  return {
    zones:   _zones,
    loading,
    refresh: refreshFromServer,
  };
}
