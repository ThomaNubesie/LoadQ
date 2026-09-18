// Full destination list for door-to-door scheduled trips — mirrors Kolis's network
// (constants/cities.ts in the Kolis repo) plus Hamilton. `code` matches
// zones.region / destination_region; `label` is shown to riders. Door-to-door
// pricing is distance-based, so every city here works without a per-city fare.
export type NetworkCity = { code: string; label: string };

export const NETWORK_CITIES: NetworkCity[] = [
  // Primary hubs
  { code: "ottawa", label: "Ottawa" },
  { code: "montreal", label: "Montréal" },
  { code: "gatineau", label: "Gatineau" },
  { code: "toronto", label: "Toronto" },
  { code: "kingston", label: "Kingston" },
  { code: "sudbury", label: "Sudbury" },
  { code: "quebec", label: "Québec" },
  { code: "trois-rivieres", label: "Trois-Rivières" },
  { code: "sherbrooke", label: "Sherbrooke" },
  { code: "chicoutimi", label: "Chicoutimi" },
  { code: "moncton", label: "Moncton" },
  { code: "halifax", label: "Halifax" },
  // Ontario network
  { code: "acton", label: "Acton" },
  { code: "ajax", label: "Ajax" },
  { code: "angus", label: "Angus" },
  { code: "arnprior", label: "Arnprior" },
  { code: "aurora", label: "Aurora" },
  { code: "bancroft", label: "Bancroft" },
  { code: "barrie", label: "Barrie" },
  { code: "belleville", label: "Belleville" },
  { code: "bracebridge", label: "Bracebridge" },
  { code: "bradford", label: "Bradford" },
  { code: "brampton", label: "Brampton" },
  { code: "brantford", label: "Brantford" },
  { code: "burlington", label: "Burlington" },
  { code: "cambridge", label: "Cambridge" },
  { code: "carleton", label: "Carleton Place" },
  { code: "deep", label: "Deep River" },
  { code: "elmvale", label: "Elmvale" },
  { code: "gravenhurst", label: "Gravenhurst" },
  { code: "guelph", label: "Guelph" },
  { code: "hamilton", label: "Hamilton" },
  { code: "kitchener", label: "Kitchener" },
  { code: "london", label: "London" },
  { code: "markham", label: "Markham" },
  { code: "mississauga", label: "Mississauga" },
  { code: "newmarket", label: "Newmarket" },
  { code: "niagara", label: "Niagara Falls" },
  { code: "north", label: "North Bay" },
  { code: "orillia", label: "Orillia" },
  { code: "oshawa", label: "Oshawa" },
  { code: "pembroke", label: "Pembroke" },
  { code: "peterborough", label: "Peterborough" },
  { code: "pickering", label: "Pickering" },
  { code: "quinte", label: "Quinte West" },
  { code: "renfrew", label: "Renfrew" },
  { code: "richmond", label: "Richmond Hill" },
  { code: "sarnia", label: "Sarnia" },
  { code: "stouffville", label: "Stouffville" },
  { code: "vaughan", label: "Vaughan" },
  { code: "waterloo", label: "Waterloo" },
  { code: "whitby", label: "Whitby" },
  { code: "woodstock", label: "Woodstock" },
  // Québec network
  { code: "alma", label: "Alma" },
  { code: "baie-comeau", label: "Baie-Comeau" },
  { code: "baie-saint-paul", label: "Baie-Saint-Paul" },
  { code: "drummondville", label: "Drummondville" },
  { code: "forestville", label: "Forestville" },
  { code: "laurier-station", label: "Laurier-Station" },
  { code: "levis", label: "Lévis" },
  { code: "longueuil", label: "Longueuil" },
  { code: "riviere-du-loup", label: "Rivière-du-Loup" },
  { code: "saint-constant", label: "Saint-Constant" },
  { code: "tadoussac", label: "Tadoussac" },
];

export function networkCityLabel(code: string | null | undefined): string {
  if (!code) return "";
  return NETWORK_CITIES.find((c) => c.code === code)?.label ?? code;
}

// Derive the destination city from a Google formatted_address, so a rider who has already typed
// their drop-off address is not then asked which city it is in.
//
// Matching is per comma-separated COMPONENT and exact, never a substring of the whole string:
// "1234 Montreal Rd, Ottawa, ON K1J 1A1, Canada" contains "Montreal", but its city component is
// "Ottawa". A substring match would silently book that rider to the wrong city.
//
// Returns null when nothing matches — the caller must keep a manual picker for that case rather
// than guessing.
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s-]/g, "").trim();

export function cityFromAddress(formatted: string | null | undefined): string | null {
  if (!formatted) return null;
  const parts = formatted.split(",").map(norm).filter(Boolean);
  for (const part of parts) {
    const hit = NETWORK_CITIES.find((c) => norm(c.label) === part || c.code === part);
    if (hit) return hit.code;
  }
  return null;
}
