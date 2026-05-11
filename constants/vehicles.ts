import { VehicleType } from "./types";

export const VEHICLE_TYPES: Record<VehicleType, {
  label: string;
  seats: number;
  icon: string;
  examples: string;
}> = {
  minibus:   { label: "Minibus",        seats: 14, icon: "bus",     examples: "Toyota HiAce, Nissan Urvan, Mercedes Sprinter" },
  van:       { label: "Van / Coaster",  seats: 10, icon: "truck",   examples: "Toyota Coaster, HiAce Long" },
  suv:       { label: "SUV / 4x4",      seats: 5,  icon: "car-suv", examples: "RAV4, CR-V, Equinox (5-seat default)" },
  bush_taxi: { label: "Bush taxi",      seats: 7,  icon: "car",     examples: "Peugeot 504/505, Renault 12" },
  sedan:     { label: "Sedan",          seats: 4,  icon: "car",     examples: "Toyota Corolla, Honda Accord" },
  tricycle:  { label: "Tricycle/Keke",  seats: 3,  icon: "car",     examples: "Bajaj, Piaggio" },
};

// Model-specific seat overrides
// Format: "make|model" (lowercase) -> seat count
const MODEL_SEAT_MAP: Record<string, number> = {
  // 7-seat SUVs
  "audi|q7": 7, "audi|q8": 5,
  "bmw|x5": 7, "bmw|x7": 7,
  "mercedes-benz|gle": 5, "mercedes-benz|gls": 7, "mercedes-benz|glb": 7,
  "toyota|4runner": 7, "toyota|land cruiser": 8, "toyota|sequoia": 8,
  "toyota|highlander": 8, "toyota|sienna": 8,
  "ford|expedition": 8, "ford|explorer": 7, "ford|flex": 7,
  "ford|transit connect": 7,
  "chevrolet|suburban": 9, "chevrolet|tahoe": 9, "chevrolet|traverse": 8,
  "gmc|yukon": 9, "gmc|acadia": 7,
  "cadillac|escalade": 7, "cadillac|xt6": 7,
  "dodge|durango": 7,
  "jeep|grand cherokee l": 7, "jeep|wagoneer": 8,
  "lincoln|navigator": 8,
  "nissan|armada": 8, "nissan|pathfinder": 8,
  "honda|pilot": 8, "honda|odyssey": 8, "honda|passport": 5,
  "kia|telluride": 8, "kia|sorento": 7, "kia|carnival": 8,
  "hyundai|palisade": 8, "hyundai|santa fe": 7,
  "mazda|cx-9": 7,
  "subaru|ascent": 8,
  "volkswagen|atlas": 7,
  "chrysler|pacifica": 7,
  "tesla|model x": 7,
  "land rover|discovery": 7, "land rover|defender": 5,
  "range rover|range rover": 5,
  "volvo|xc90": 7,
  "infiniti|qx80": 8, "infiniti|qx60": 7,
  "lexus|lx": 8, "lexus|gx": 7, "lexus|rx l": 7,
  "acura|mdx": 7,
  "buick|enclave": 7,
  "mitsubishi|outlander": 7,
  // 5-seat SUVs
  "audi|q5": 5, "audi|q3": 5,
  "bmw|x3": 5, "bmw|x4": 5,
  "toyota|rav4": 5, "toyota|venza": 5,
  "honda|cr-v": 5, "honda|hr-v": 5,
  "ford|escape": 5, "ford|bronco": 5, "ford|bronco sport": 5, "ford|edge": 5,
  "chevrolet|equinox": 5, "chevrolet|blazer": 5, "chevrolet|trailblazer": 5,
  "gmc|terrain": 5,
  "jeep|cherokee": 5, "jeep|wrangler": 5, "jeep|compass": 5, "jeep|renegade": 5,
  "nissan|rogue": 5, "nissan|murano": 5, "nissan|kicks": 5,
  "hyundai|tucson": 5, "hyundai|kona": 5,
  "kia|sportage": 5, "kia|seltos": 5,
  "mazda|cx-5": 5, "mazda|cx-30": 5,
  "subaru|forester": 5, "subaru|outback": 5, "subaru|crosstrek": 5,
  "volkswagen|tiguan": 7, "volkswagen|taos": 5,
  "tesla|model y": 5,
  "volvo|xc60": 5, "volvo|xc40": 5,
  // Trucks
  "ford|f-150": 5, "ford|f-250": 5, "ford|f-350": 5,
  "chevrolet|silverado": 5, "gmc|sierra": 5,
  "ram|1500": 5, "ram|2500": 5,
  "toyota|tundra": 5, "toyota|tacoma": 5,
  "nissan|frontier": 5, "nissan|titan": 5,
  "honda|ridgeline": 5,
  // Minivans
  "toyota|sienna": 8,
  "honda|odyssey": 8,
  "chrysler|pacifica": 7,
  "kia|carnival": 8,
  // Sedans / compact
  "toyota|corolla": 5, "toyota|camry": 5, "toyota|avalon": 5,
  "honda|civic": 5, "honda|accord": 5,
  "ford|fusion": 5, "ford|mustang": 4,
  "chevrolet|malibu": 5, "chevrolet|impala": 5,
  "nissan|altima": 5, "nissan|sentra": 5, "nissan|maxima": 5,
  "hyundai|elantra": 5, "hyundai|sonata": 5,
  "kia|forte": 5, "kia|optima": 5, "kia|k5": 5,
  "mazda|mazda3": 5, "mazda|mazda6": 5,
  "subaru|impreza": 5, "subaru|legacy": 5,
  "volkswagen|jetta": 5, "volkswagen|passat": 5, "volkswagen|golf": 5,
  "bmw|3 series": 5, "bmw|5 series": 5, "bmw|7 series": 5,
  "mercedes-benz|c-class": 5, "mercedes-benz|e-class": 5, "mercedes-benz|s-class": 5,
  "audi|a3": 5, "audi|a4": 5, "audi|a6": 5,
  "tesla|model 3": 5, "tesla|model s": 5,
  "lexus|es": 5, "lexus|is": 5, "lexus|ls": 5,
  "acura|tlx": 5, "acura|ilx": 5,
  "infiniti|q50": 5, "infiniti|q60": 4,
  "cadillac|ct5": 5, "cadillac|ct4": 5,
  "buick|lacrosse": 5, "buick|envision": 5,
  "dodge|charger": 5, "dodge|challenger": 4,
  "chrysler|300": 5,
  "lincoln|mkz": 5, "lincoln|continental": 5,
  "volvo|s60": 5, "volvo|s90": 5,
  "jaguar|xe": 5, "jaguar|xf": 5, "jaguar|f-pace": 5,
  "land rover|range rover velar": 5, "land rover|range rover evoque": 5,
  "porsche|cayenne": 5, "porsche|macan": 5, "porsche|panamera": 4,
  "maserati|ghibli": 5, "maserati|levante": 5,
  "alfa romeo|giulia": 5, "alfa romeo|stelvio": 5,
};

export function getSeatsForType(type: VehicleType): number {
  return VEHICLE_TYPES[type].seats;
}

export function getSeatsForModel(make: string, model: string): number {
  const key = `${make.toLowerCase()}|${model.toLowerCase()}`;
  // Try exact match first
  if (MODEL_SEAT_MAP[key] !== undefined) return MODEL_SEAT_MAP[key];
  // Try partial model match
  for (const [k, v] of Object.entries(MODEL_SEAT_MAP)) {
    const [km, kmodel] = k.split("|");
    if (make.toLowerCase().includes(km) && model.toLowerCase().includes(kmodel)) return v;
  }
  return 0; // 0 means use type default
}

export function getIconForType(type: VehicleType): string {
  return VEHICLE_TYPES[type].icon;
}
