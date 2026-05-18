// Inter-city loading destinations + per-seat fare matrix.
//
// Destinations are a fixed list of 7 cities. Every loading zone offers a
// queue to every city (except its own origin city). Fares are symmetric:
// Ottawa→Montreal == Montreal→Ottawa.
//
// 4 fares were given by the operator; the other 17 were deduced at
// ~C$0.145/km of road distance, rounded to the nearest $5.

import { RegionCode } from "./zones";

export type DestinationCity =
  | "chicoutimi" | "moncton" | "quebec" | "montreal" | "ottawa" | "kingston" | "toronto"
  | "trois-rivieres" | "sherbrooke";

export const DESTINATION_CITIES: { code: DestinationCity; name: string }[] = [
  { code: "chicoutimi",     name: "Chicoutimi"      },
  { code: "moncton",        name: "Moncton"         },
  { code: "quebec",         name: "Québec City"     },
  { code: "trois-rivieres", name: "Trois-Rivières"  },
  { code: "montreal",       name: "Montréal"        },
  { code: "sherbrooke",     name: "Sherbrooke"      },
  { code: "ottawa",         name: "Ottawa"          },
  { code: "kingston",       name: "Kingston"        },
  { code: "toronto",        name: "Toronto"         },
];

// A loading zone's region maps to its origin city for fare lookup.
// Gatineau rides price as Ottawa; Laval prices as Montreal (adjacent metros).
const REGION_TO_CITY: Record<string, DestinationCity> = {
  ottawa:   "ottawa",
  gatineau: "ottawa",
  montreal: "montreal",
  laval:    "montreal",
  quebec:   "quebec",
  toronto:  "toronto",
};

interface RoutePrice { a: DestinationCity; b: DestinationCity; price: number; }

const ROUTES: RoutePrice[] = [
  // operator-provided
  { a: "ottawa",   b: "montreal", price: 30 },
  { a: "montreal", b: "quebec",   price: 35 },
  { a: "montreal", b: "toronto",  price: 80 },
  { a: "ottawa",   b: "toronto",  price: 60 },
  // distance-deduced (~$0.145/km, nearest $5)
  { a: "ottawa",     b: "kingston", price: 30  },
  { a: "chicoutimi", b: "quebec",   price: 30  },
  { a: "kingston",   b: "toronto",  price: 40  },
  { a: "montreal",   b: "kingston", price: 40  },
  { a: "quebec",     b: "ottawa",   price: 65  },
  { a: "chicoutimi", b: "montreal", price: 65  },
  { a: "quebec",     b: "kingston", price: 90  },
  { a: "chicoutimi", b: "ottawa",   price: 95  },
  { a: "moncton",    b: "quebec",   price: 100 },
  { a: "quebec",     b: "toronto",  price: 115 },
  { a: "chicoutimi", b: "kingston", price: 120 },
  { a: "chicoutimi", b: "moncton",  price: 130 },
  { a: "moncton",    b: "montreal", price: 140 },
  { a: "chicoutimi", b: "toronto",  price: 145 },
  { a: "moncton",    b: "ottawa",   price: 165 },
  { a: "moncton",    b: "kingston", price: 195 },
  { a: "moncton",    b: "toronto",  price: 225 },
  // Trois-Rivières routes
  { a: "trois-rivieres", b: "montreal",   price: 20  },
  { a: "trois-rivieres", b: "quebec",     price: 20  },
  { a: "trois-rivieres", b: "sherbrooke", price: 25  },
  { a: "trois-rivieres", b: "ottawa",     price: 50  },
  { a: "trois-rivieres", b: "chicoutimi", price: 50  },
  { a: "trois-rivieres", b: "kingston",   price: 70  },
  { a: "trois-rivieres", b: "toronto",    price: 100 },
  { a: "trois-rivieres", b: "moncton",    price: 120 },
  // Sherbrooke routes
  { a: "sherbrooke", b: "montreal",   price: 20  },
  { a: "sherbrooke", b: "quebec",     price: 35  },
  { a: "sherbrooke", b: "ottawa",     price: 50  },
  { a: "sherbrooke", b: "chicoutimi", price: 65  },
  { a: "sherbrooke", b: "kingston",   price: 70  },
  { a: "sherbrooke", b: "toronto",    price: 100 },
  { a: "sherbrooke", b: "moncton",    price: 110 },
];

// Symmetric lookup: PRICE[a][b] === PRICE[b][a]
const PRICE: Partial<Record<DestinationCity, Partial<Record<DestinationCity, number>>>> = {};
for (const r of ROUTES) {
  (PRICE[r.a] ??= {})[r.b] = r.price;
  (PRICE[r.b] ??= {})[r.a] = r.price;
}

function originCity(region: RegionCode | string | null | undefined): DestinationCity | null {
  if (!region) return null;
  return REGION_TO_CITY[region] ?? null;
}

// Price per seat between a zone's region and a destination city. null = "set on board".
export function getPricePerSeat(
  fromRegion: RegionCode | string | null | undefined,
  toCity: DestinationCity | string | null | undefined,
): number | null {
  const from = originCity(fromRegion);
  if (!from || !toCity) return null;
  return PRICE[from]?.[toCity as DestinationCity] ?? null;
}

// Every city is selectable from every zone, except the zone's own origin city.
// Pass `activeCodes` (from useDestinations) to hide admin-disabled destinations.
export function getDestinationsFrom(
  fromRegion: RegionCode | string | null | undefined,
  activeCodes?: Set<string>,
): DestinationCity[] {
  const from = originCity(fromRegion);
  return DESTINATION_CITIES
    .map(c => c.code)
    .filter(code => code !== from)
    .filter(code => !activeCodes || activeCodes.has(code));
}

export function getRegionName(code: string | null | undefined): string {
  if (!code) return "";
  return DESTINATION_CITIES.find(c => c.code === code)?.name ?? code;
}
