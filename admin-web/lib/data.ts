// Static reference data ported from the LoadQ app's constants so the web
// console speaks the same language as the mobile admin (regions, destination
// cities, timezone list). The runtime source of truth for zones/queues is the
// shared Supabase project (kzjptcpjpwlxfofzhyku).

export type RegionCode = "ottawa" | "gatineau" | "montreal" | "quebec" | "laval" | "toronto";

export const REGIONS: { code: RegionCode; name: string; latitude: number; longitude: number; timezone: string }[] = [
  { code: "ottawa",   name: "Ottawa",   latitude: 45.4215, longitude: -75.6972, timezone: "America/Toronto" },
  { code: "gatineau", name: "Gatineau", latitude: 45.4765, longitude: -75.7013, timezone: "America/Toronto" },
  { code: "montreal", name: "Montréal", latitude: 45.5017, longitude: -73.5673, timezone: "America/Toronto" },
  { code: "quebec",   name: "Québec",   latitude: 46.8139, longitude: -71.2080, timezone: "America/Toronto" },
  { code: "laval",    name: "Laval",    latitude: 45.6066, longitude: -73.7124, timezone: "America/Toronto" },
  { code: "toronto",  name: "Toronto",  latitude: 43.6532, longitude: -79.3832, timezone: "America/Toronto" },
];

export const COMMON_TZS = [
  "America/Toronto",
  "America/Halifax",
  "America/St_Johns",
  "America/Winnipeg",
  "America/Regina",
  "America/Edmonton",
  "America/Vancouver",
];

// Inter-city destinations — every zone offers a queue to every city except its
// own origin city (Gatineau prices/pairs as Ottawa; Laval as Montréal).
export type DestinationCity =
  | "chicoutimi" | "moncton" | "quebec" | "montreal" | "ottawa" | "kingston" | "toronto"
  | "trois-rivieres" | "sherbrooke";

export const DESTINATION_CITIES: { code: DestinationCity; name: string }[] = [
  { code: "chicoutimi",     name: "Chicoutimi"     },
  { code: "moncton",        name: "Moncton"        },
  { code: "quebec",         name: "Québec City"    },
  { code: "trois-rivieres", name: "Trois-Rivières" },
  { code: "montreal",       name: "Montréal"       },
  { code: "sherbrooke",     name: "Sherbrooke"     },
  { code: "ottawa",         name: "Ottawa"         },
  { code: "kingston",       name: "Kingston"       },
  { code: "toronto",        name: "Toronto"        },
];

const REGION_TO_CITY: Record<string, DestinationCity> = {
  ottawa: "ottawa", gatineau: "ottawa", montreal: "montreal",
  laval: "montreal", quebec: "quebec", toronto: "toronto",
};

export function getDestinationsFrom(fromRegion: string | null | undefined): DestinationCity[] {
  const from = fromRegion ? REGION_TO_CITY[fromRegion] ?? null : null;
  return DESTINATION_CITIES.map((c) => c.code).filter((code) => code !== from);
}

export function getRegionName(code: string | null | undefined): string {
  if (!code) return "";
  return DESTINATION_CITIES.find((c) => c.code === code)?.name ?? code;
}

export function slugify(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// ── DB row shapes (only the fields the console reads) ────────────────────────
export interface ZoneRow {
  id: string;
  name: string;
  region: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radius_meters: number;
  timezone: string;
  is_active: boolean;
}

export interface DriverLite {
  id: string;
  full_name: string | null;
  phone: string | null;
  verified: boolean;
  vehicle: { make: string; model: string; seats: number } | null;
}

export interface QueueEntryRow {
  id: string;
  zone_id: string;
  driver_id: string;
  position: number;
  status: string;
  seats_boarded: number | null;
  seats_locked: number | null;
  destination_region: string | null;
  joined_at: string;
  driver?: { full_name: string | null; phone: string | null } | null;
  vehicle?: { make: string | null; model: string | null; seats: number | null } | null;
}
