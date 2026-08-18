// Theme selection (light / dark / azure). Persisted locally; applied to the mutable
// Colors palette. Switching reloads the JS so every StyleSheet re-creates with the
// new palette (StyleSheet.create captures colors at module-eval time).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { applyTheme } from "../constants/colors";

export type ThemeName = "light" | "dark" | "azure";
const KEY = "loadq-theme-v1";
let _theme: ThemeName = "light";

export function currentTheme(): ThemeName { return _theme; }

// Call once at startup, BEFORE the app renders, so screens pick up the palette.
export async function loadTheme(): Promise<void> {
  try {
    const t = (await AsyncStorage.getItem(KEY)) as ThemeName | null;
    if (t === "light" || t === "dark" || t === "azure") { _theme = t; applyTheme(t); }
  } catch { /* default light */ }
}

export async function setTheme(t: ThemeName): Promise<void> {
  _theme = t;
  applyTheme(t);
  try { await AsyncStorage.setItem(KEY, t); } catch { /* ignore */ }
  // Reload so all StyleSheets re-create with the new palette.
  try {
    const Updates = await import("expo-updates");
    if (typeof (Updates as any).reloadAsync === "function") { await (Updates as any).reloadAsync(); return; }
  } catch { /* fall through */ }
  try { const RN = await import("react-native"); (RN as any).DevSettings?.reload?.(); } catch { /* ignore */ }
}
