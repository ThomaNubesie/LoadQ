import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { DestinationsAPI, DestinationRow } from "../services/destinations";
import { DESTINATION_CITIES } from "../constants/pricing";

// Seed = the static city list, all active, until the DB cache loads.
const SEED: DestinationRow[] = DESTINATION_CITIES.map((c, i) => ({
  code: c.code, name: c.name, is_active: true, sort_order: i + 1,
}));

let _dests: DestinationRow[] = SEED;
const _listeners = new Set<() => void>();
const STORAGE_KEY = "destinations-cache-v1";
let _hydrated = false;
let _refreshing = false;

function notify() { _listeners.forEach(fn => fn()); }

async function hydrate() {
  if (_hydrated) return;
  _hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DestinationRow[];
      if (Array.isArray(parsed) && parsed.length > 0) { _dests = parsed; notify(); }
    }
  } catch { /* keep SEED */ }
}

async function refresh(): Promise<{ error?: string }> {
  if (_refreshing) return {};
  _refreshing = true;
  try {
    const fresh = await DestinationsAPI.list(false); // active only
    if (fresh.length > 0) {
      _dests = fresh;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      notify();
    }
    return {};
  } catch (e: any) {
    return { error: e?.message ?? "Could not refresh destinations" };
  } finally {
    _refreshing = false;
  }
}

// Sync accessor for non-React code.
export function getActiveDestinationCodes(): Set<string> {
  return new Set(_dests.filter(d => d.is_active).map(d => d.code));
}

export function useDestinations(): {
  destinations: DestinationRow[];
  activeCodes:  Set<string>;
  refresh:      () => Promise<{ error?: string }>;
} {
  const [, tick] = useState(0);
  useEffect(() => {
    const update = () => tick(t => t + 1);
    _listeners.add(update);
    (async () => { await hydrate(); refresh(); })();
    return () => { _listeners.delete(update); };
  }, []);
  return {
    destinations: _dests,
    activeCodes:  new Set(_dests.filter(d => d.is_active).map(d => d.code)),
    refresh,
  };
}
