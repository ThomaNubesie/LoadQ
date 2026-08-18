// LoadQ themes. Three palettes with identical token keys; the active one is copied
// into the mutable `Colors` object at startup (see services/theme.ts). Because
// StyleSheet.create() captures color values at module-eval time, switching theme
// at runtime persists the choice and reloads the JS so styles re-create.
//
//  • light — cream background, azure actions, orange accents (default, live)
//  • dark  — original charcoal + orange
//  • azure — charcoal background, azure actions, orange logo
const LIGHT = {
  bg: "#FAF6EF", surface: "#F3EEE4", card: "#FFFFFF", cardAlt: "#F0EADF", border: "#E7E0D3",
  accent: "#2F6FE0", accentText: "#FFFFFF", accentP: "#2F6FE0", accentPText: "#FFFFFF",
  accentWarm: "#FF8A1A", accentWarmText: "#C56A08",
  blue: "#2F6FE0", yellow: "#C98A00", red: "#E24C4C", purple: "#7C5CEF", green: "#12A150",
  t1: "#1B2130", t2: "#5A6273", t3: "#98A0AE",
};
const DARK = {
  bg: "#15171C", surface: "#1B1E25", card: "#232733", cardAlt: "#2C313F", border: "#3E4453",
  accent: "#FF6B00", accentText: "#20140A", accentP: "#EA6A1E", accentPText: "#20140A",
  accentWarm: "#FF6B00", accentWarmText: "#FF8A3A",
  blue: "#3B82F6", yellow: "#F5C842", red: "#EF4444", purple: "#8B5CF6", green: "#22C083",
  t1: "#FFFFFF", t2: "#AEB6C4", t3: "#7C8697",
};
const AZURE = {
  ...DARK,
  accent: "#4C82F0", accentText: "#FFFFFF", accentP: "#4C82F0", accentPText: "#FFFFFF",
  accentWarm: "#FF8A1A", accentWarmText: "#FF8A3A",
};

export type Palette = typeof LIGHT;
export const THEMES: Record<string, Palette> = { light: LIGHT, dark: DARK, azure: AZURE };

// Mutable active palette — every screen imports this. Defaults to light.
export const Colors: Palette = { ...LIGHT };

export function applyTheme(name: string): void {
  Object.assign(Colors, THEMES[name] ?? LIGHT);
}
