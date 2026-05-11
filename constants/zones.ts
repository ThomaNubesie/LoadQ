export type RegionCode = "ottawa" | "gatineau" | "montreal" | "quebec" | "laval" | "toronto";

export interface ZoneLocation {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  region: RegionCode;
  radius_meters: number;
}

export interface Region {
  code: RegionCode;
  name: string;
  latitude: number;
  longitude: number;
  radius_km: number; // radius to detect if user is "in" this region
}

export const REGIONS: Region[] = [
  { code: "ottawa",   name: "Ottawa",    latitude: 45.4215, longitude: -75.6972, radius_km: 30 },
  { code: "gatineau", name: "Gatineau",  latitude: 45.4765, longitude: -75.7013, radius_km: 20 },
  { code: "montreal", name: "Montréal",  latitude: 45.5017, longitude: -73.5673, radius_km: 40 },
  { code: "quebec",   name: "Québec",    latitude: 46.8139, longitude: -71.2080, radius_km: 30 },
  { code: "laval",    name: "Laval",     latitude: 45.6066, longitude: -73.7124, radius_km: 20 },
  { code: "toronto",  name: "Toronto",   latitude: 43.6532, longitude: -79.3832, radius_km: 40 },
];

export const ZONE_LOCATIONS: ZoneLocation[] = [
  // Ottawa
  {
    id: "ottawa-george",
    name: "140 George Street",
    address: "140 George St, Ottawa, ON",
    latitude: 45.4268,
    longitude: -75.6910,
    region: "ottawa",
    radius_meters: 100,
  },
  // Gatineau
  {
    id: "gatineau-mcdo",
    name: "McDonald\'s Saint-Raymond",
    address: "Boul. Saint-Raymond, Gatineau, QC",
    latitude: 45.4785,
    longitude: -75.7456,
    region: "gatineau",
    radius_meters: 80,
  },
  // Montreal
  {
    id: "montreal-jean-talon",
    name: "5300 Jean-Talon Ouest",
    address: "5300 Rue Jean-Talon O, Montréal, QC",
    latitude: 45.5025,
    longitude: -73.6631,
    region: "montreal",
    radius_meters: 100,
  },
  {
    id: "montreal-berri",
    name: "Berri-UQAM — Sainte-Catherine",
    address: "Rue Sainte-Catherine E, Montréal, QC",
    latitude: 45.5167,
    longitude: -73.5673,
    region: "montreal",
    radius_meters: 100,
  },
  // Quebec City
  {
    id: "quebec-shell",
    name: "Shell Laurier",
    address: "Boul. Laurier, Québec, QC",
    latitude: 46.7792,
    longitude: -71.2839,
    region: "quebec",
    radius_meters: 80,
  },
  {
    id: "quebec-mcdo",
    name: "McDonald\'s Laurier",
    address: "Boul. Laurier, Québec, QC",
    latitude: 46.7798,
    longitude: -71.2850,
    region: "quebec",
    radius_meters: 80,
  },
  // Laval
  {
    id: "laval-desjardins",
    name: "Pavillon Desjardins",
    address: "Laval, QC",
    latitude: 45.5724,
    longitude: -73.6920,
    region: "laval",
    radius_meters: 100,
  },
  // Toronto
  {
    id: "toronto-yorkdale",
    name: "Yorkdale Mall",
    address: "3401 Dufferin St, Toronto, ON",
    latitude: 43.7255,
    longitude: -79.4502,
    region: "toronto",
    radius_meters: 150,
  },
  {
    id: "toronto-scarborough",
    name: "Scarborough Town Centre",
    address: "300 Borough Dr, Scarborough, ON",
    latitude: 43.7757,
    longitude: -79.2576,
    region: "toronto",
    radius_meters: 150,
  },
  {
    id: "toronto-union",
    name: "Union Station",
    address: "65 Front St W, Toronto, ON",
    latitude: 43.6452,
    longitude: -79.3806,
    region: "toronto",
    radius_meters: 120,
  },
];

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

export function getZonesByRegion(region: RegionCode): ZoneLocation[] {
  return ZONE_LOCATIONS.filter(z => z.region === region);
}
