import { Text, StyleProp, TextStyle } from "react-native";
import { Colors } from "../constants/colors";

// The LoadQ wordmark. One definition — every screen renders this, nothing renders the
// letters itself.
//
// Before this the 8 auth screens each wrote `<Text style={s.logo}>LOADQ</Text>` with
// `color: Colors.accent`, so the mark was ALL CAPS and took the theme's action colour:
// blue #2F6FE0 on the default light theme, orange #FF6B00 on dark, #4C82F0 on azure.
// Four different marks, none of them the one on the letterhead.
//
// Brand rule (set 2026-09-11): the Q is ALWAYS #FF8A1A and never the theme accent.
// "Load" takes only the colour the background allows — #15171C on a light background,
// white on a dark one. No plate, no box.
export const BRAND_ORANGE = "#FF8A1A";
export const BRAND_INK = "#15171C";

// Perceived lightness of the active background decides the "Load" colour, so a future
// palette is handled without editing this file.
export function brandInk(): string {
  const hex = (Colors.bg || "#FFFFFF").replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? BRAND_INK : "#FFFFFF";
}

export default function Wordmark({ style }: { style?: StyleProp<TextStyle> }) {
  // `style` carries each screen's own size and spacing; colour and letter-spacing are
  // applied AFTER it so a caller cannot reintroduce the accent colour or the wide
  // all-caps tracking.
  return (
    <Text style={[{ fontWeight: "900" }, style, { color: brandInk(), letterSpacing: -0.5 }]}>
      Load<Text style={{ color: BRAND_ORANGE }}>Q</Text>
    </Text>
  );
}
