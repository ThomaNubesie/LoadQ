import { VehicleType } from "./types";

export const VEHICLE_TYPES: Record<VehicleType, {
  label: string;
  seats: number;
  icon: string;
  examples: string;
}> = {
  minibus:   { label: "Minibus",        seats: 14, icon: "bus",     examples: "Toyota HiAce, Nissan Urvan, Mercedes Sprinter" },
  van:       { label: "Van / Coaster",  seats: 10, icon: "truck",   examples: "Toyota Coaster, HiAce Long" },
  suv:       { label: "SUV / 4x4",      seats: 7,  icon: "car-suv", examples: "Land Cruiser, Prado, Fortuner" },
  bush_taxi: { label: "Bush taxi",      seats: 7,  icon: "car",     examples: "Peugeot 504/505, Renault 12" },
  sedan:     { label: "Sedan",          seats: 4,  icon: "car",     examples: "Toyota Corolla, Honda Accord" },
  tricycle:  { label: "Tricycle/Keke",  seats: 3,  icon: "car",     examples: "Bajaj, Piaggio" },
};

export function getSeatsForType(type: VehicleType): number {
  return VEHICLE_TYPES[type].seats;
}

export function getIconForType(type: VehicleType): string {
  return VEHICLE_TYPES[type].icon;
}
