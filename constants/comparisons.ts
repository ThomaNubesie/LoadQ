// Savings comparison: what a passenger would have paid on competing intercity
// options vs what they paid on LoadQ. Drives the "you've saved C$X" stats on
// the passenger History screen.
//
// ⚠️ The fares below are ESTIMATES seeded for the main routes. They are
// customer-facing once shown as savings — REPLACE WITH REAL ONE-WAY FARES
// before relying on them in marketing. Routes not in ROUTE_FARES fall back to
// a per-mode multiple of the LoadQ fare (MULT).

import { DestinationCity, regionOriginCity, getPricePerSeat } from "./pricing";
import { RegionCode } from "./zones";

export type CompareMode = "bus" | "train" | "amigo" | "pop";

// Display order + labels. Brand names (Amigo Express, Poparide) are proper
// nouns and stay untranslated.
export const COMPARE_MODES: { key: CompareMode; label: string }[] = [
  { key: "bus",   label: "Bus" },
  { key: "train", label: "Train" },
  { key: "amigo", label: "Amigo Express" },
  { key: "pop",   label: "Poparide" },
];

type Fares = Record<CompareMode, number>;

// Symmetric key for a city pair.
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

// One-way comparison fares (CAD) per route. EDIT THESE with real numbers.
const ROUTE_FARES: Record<string, Fares> = {
  [pairKey("montreal", "ottawa")]:  { bus: 45, train: 50,  amigo: 25, pop: 26 },
  [pairKey("montreal", "quebec")]:  { bus: 60, train: 60,  amigo: 30, pop: 30 },
  [pairKey("montreal", "toronto")]: { bus: 70, train: 110, amigo: 55, pop: 50 },
  [pairKey("ottawa",   "toronto")]: { bus: 65, train: 90,  amigo: 45, pop: 45 },
  [pairKey("kingston", "ottawa")]:  { bus: 40, train: 45,  amigo: 22, pop: 24 },
  [pairKey("kingston", "toronto")]: { bus: 45, train: 55,  amigo: 30, pop: 30 },
  [pairKey("kingston", "montreal")]:{ bus: 55, train: 65,  amigo: 32, pop: 33 },
  [pairKey("ottawa",   "quebec")]:  { bus: 95, train: 110, amigo: 55, pop: 55 },
};

// Fallback when a route isn't in ROUTE_FARES: estimate each mode as a multiple
// of the LoadQ fare for that route.
const MULT: Record<CompareMode, number> = { bus: 1.7, train: 2.8, amigo: 1.25, pop: 1.35 };

// Platform booking fees charged ON TOP of the base ride fare. The ROUTE_FARES
// amigo/pop values are base fares; these fees are added in getComparisonFares
// so the savings reflect a passenger's real out-the-door cost.
//   Amigo Express: flat fee per seat. Poparide: percentage service fee.
const AMIGO_SEAT_FEE = 7;     // C$ per seat
const POP_FEE_RATE   = 0.15;  // 15% service fee

// Comparison fares for a route, INCLUDING each platform's booking fee. Returns
// null when origin/destination can't be resolved or there's no LoadQ fare to
// anchor the multiplier fallback.
export function getComparisonFares(
  fromRegion: RegionCode | string | null | undefined,
  toCity: DestinationCity | string | null | undefined,
): Fares | null {
  const from = regionOriginCity(fromRegion);
  if (!from || !toCity) return null;

  let base = ROUTE_FARES[pairKey(from, toCity)];
  if (!base) {
    const loq = getPricePerSeat(fromRegion, toCity);
    if (loq == null) return null;
    base = {
      bus:   Math.round(loq * MULT.bus),
      train: Math.round(loq * MULT.train),
      amigo: Math.round(loq * MULT.amigo),
      pop:   Math.round(loq * MULT.pop),
    };
  }

  // Bus/Train fares are all-in; Amigo/Pop add a booking fee on top.
  return {
    bus:   base.bus,
    train: base.train,
    amigo: base.amigo + AMIGO_SEAT_FEE,
    pop:   Math.round(base.pop * (1 + POP_FEE_RATE)),
  };
}

// Per-mode savings for one trip vs each alternative, never negative.
export function tripSavings(
  fromRegion: RegionCode | string | null | undefined,
  toCity: DestinationCity | string | null | undefined,
  paid: number,
): Fares | null {
  const fares = getComparisonFares(fromRegion, toCity);
  if (!fares) return null;
  return {
    bus:   Math.max(0, fares.bus   - paid),
    train: Math.max(0, fares.train - paid),
    amigo: Math.max(0, fares.amigo - paid),
    pop:   Math.max(0, fares.pop   - paid),
  };
}

// Sum per-mode savings across a list of trips.
export function sumSavings(
  trips: { fromRegion: string | null | undefined; toCity: string | null | undefined; paid: number }[],
): Fares {
  const total: Fares = { bus: 0, train: 0, amigo: 0, pop: 0 };
  for (const t of trips) {
    const s = tripSavings(t.fromRegion, t.toCity, t.paid);
    if (!s) continue;
    total.bus   += s.bus;
    total.train += s.train;
    total.amigo += s.amigo;
    total.pop   += s.pop;
  }
  return total;
}
