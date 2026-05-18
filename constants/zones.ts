// Region metadata + initial seed of zone rows.
// The runtime source of truth for zones is `public.zones` in the DB, surfaced
// via hooks/useZones.ts. INITIAL_ZONES below is only the offline-fallback
// seed used on first launch before the cache is populated.

import type { ZoneRow } from "../services/zones";

export type RegionCode = "ottawa" | "gatineau" | "montreal" | "quebec" | "laval" | "toronto";

export interface Region {
  code: RegionCode;
  name: string;
  latitude: number;
  longitude: number;
  radius_km: number;          // radius to detect if user is "in" this region
  timezone: string;           // IANA TZ used for the 4 AM–11:59 PM loading window
}

export const REGIONS: Region[] = [
  { code: "ottawa",   name: "Ottawa",    latitude: 45.4215, longitude: -75.6972, radius_km: 30, timezone: "America/Toronto" },
  { code: "gatineau", name: "Gatineau",  latitude: 45.4765, longitude: -75.7013, radius_km: 20, timezone: "America/Toronto" },
  { code: "montreal", name: "Montréal",  latitude: 45.5017, longitude: -73.5673, radius_km: 40, timezone: "America/Toronto" },
  { code: "quebec",   name: "Québec",    latitude: 46.8139, longitude: -71.2080, radius_km: 30, timezone: "America/Toronto" },
  { code: "laval",    name: "Laval",     latitude: 45.6066, longitude: -73.7124, radius_km: 20, timezone: "America/Toronto" },
  { code: "toronto",  name: "Toronto",   latitude: 43.6532, longitude: -79.3832, radius_km: 40, timezone: "America/Toronto" },
];

export const INITIAL_ZONES: ZoneRow[] = [
  { id: "ottawa-george",        name: "140 George Street",            region: "ottawa",   address: "140 George St, Ottawa, ON",            latitude: 45.4268, longitude: -75.6910, radius_meters: 100, timezone: "America/Toronto", is_active: true },
  { id: "gatineau-mcdo",        name: "McDonald's Saint-Raymond",     region: "gatineau", address: "Boul. Saint-Raymond, Gatineau, QC",    latitude: 45.4785, longitude: -75.7456, radius_meters:  80, timezone: "America/Toronto", is_active: true },
  { id: "montreal-jean-talon",  name: "5300 Jean-Talon Ouest",        region: "montreal", address: "5300 Rue Jean-Talon O, Montréal, QC",  latitude: 45.5025, longitude: -73.6631, radius_meters: 100, timezone: "America/Toronto", is_active: true },
  { id: "montreal-berri",       name: "Berri-UQAM — Sainte-Catherine",region: "montreal", address: "Rue Sainte-Catherine E, Montréal, QC", latitude: 45.5167, longitude: -73.5673, radius_meters: 100, timezone: "America/Toronto", is_active: true },
  { id: "quebec-shell",         name: "Shell Laurier",                region: "quebec",   address: "Boul. Laurier, Québec, QC",            latitude: 46.7792, longitude: -71.2839, radius_meters:  80, timezone: "America/Toronto", is_active: true },
  { id: "quebec-mcdo",          name: "McDonald's Laurier",           region: "quebec",   address: "Boul. Laurier, Québec, QC",            latitude: 46.7798, longitude: -71.2850, radius_meters:  80, timezone: "America/Toronto", is_active: true },
  { id: "laval-desjardins",     name: "Pavillon Desjardins",          region: "laval",    address: "Laval, QC",                            latitude: 45.5724, longitude: -73.6920, radius_meters: 100, timezone: "America/Toronto", is_active: true },
  { id: "toronto-yorkdale",     name: "Yorkdale Mall",                region: "toronto",  address: "3401 Dufferin St, Toronto, ON",        latitude: 43.7255, longitude: -79.4502, radius_meters: 150, timezone: "America/Toronto", is_active: true },
  { id: "toronto-scarborough",  name: "Scarborough Town Centre",      region: "toronto",  address: "300 Borough Dr, Scarborough, ON",      latitude: 43.7757, longitude: -79.2576, radius_meters: 150, timezone: "America/Toronto", is_active: true },
  { id: "toronto-union",        name: "Union Station",                region: "toronto",  address: "65 Front St W, Toronto, ON",           latitude: 43.6452, longitude: -79.3806, radius_meters: 120, timezone: "America/Toronto", is_active: true },
];

// Backwards-compat alias for existing imports — same shape as ZoneRow now.
export type ZoneLocation = ZoneRow;

// Calculate distance between two coordinates in km
export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function detectUserRegion(lat: number, lon: number): RegionCode | null {
  for (const region of REGIONS) {
    const dist = getDistanceKm(lat, lon, region.latitude, region.longitude);
    if (dist <= region.radius_km) return region.code;
  }
  return null;
}

// Pure helper — pass the current zones list from useZones().
export function getZonesByRegion(zones: ZoneRow[], region: RegionCode): ZoneRow[] {
  return zones.filter(z => z.region === region);
}
