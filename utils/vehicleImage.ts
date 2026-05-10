import { VehicleType } from "../constants/types";

const CUSTOMER_KEY = process.env.EXPO_PUBLIC_IMAGIN_KEY || "img";

const MODEL_FAMILY_MAP: Record<string, string> = {
  "hiace":          "hiace",
  "urvan":          "urvan",
  "sprinter":       "sprinter",
  "coaster":        "coaster",
  "land cruiser":   "land-cruiser",
  "prado":          "land-cruiser-prado",
  "fortuner":       "fortuner",
  "corolla":        "corolla",
  "accord":         "accord",
  "logan":          "logan",
};

export type ImageAngle = "side" | "front" | "rear" | "interior";

const ANGLE_MAP: Record<ImageAngle, string> = {
  side:     "01",
  front:    "13",
  rear:     "07",
  interior: "27",
};

export function getVehicleImageUrl(
  make: string,
  model: string,
  year?: number,
  angle: ImageAngle = "side",
  color?: string,
): string {
  const url = new URL("https://cdn.imagin.studio/getImage");
  const modelKey    = model.toLowerCase().trim();
  const modelFamily = MODEL_FAMILY_MAP[modelKey] || modelKey.split(" ")[0];

  url.searchParams.append("customer",    CUSTOMER_KEY);
  url.searchParams.append("make",        make.toLowerCase().trim());
  url.searchParams.append("modelFamily", modelFamily);
  url.searchParams.append("zoomType",    "fullscreen");
  url.searchParams.append("angle",       ANGLE_MAP[angle]);

  if (year)  url.searchParams.append("modelYear", String(year));
  if (color) url.searchParams.append("paintId",   color.toLowerCase().replace(/\s+/g, "-"));

  return url.toString();
}

export function getFallbackColor(type: VehicleType): string {
  const map: Record<VehicleType, string> = {
    minibus:   "#2563EB",
    van:       "#F59E0B",
    suv:       "#7C3AED",
    bush_taxi: "#DC2626",
    sedan:     "#94A3B8",
    tricycle:  "#14B8A6",
  };
  return map[type];
}
