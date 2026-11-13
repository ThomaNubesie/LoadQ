import { Text, View, StyleProp, TextStyle, StyleSheet } from "react-native";
import { Colors } from "../constants/colors";

// The LoadQ wordmark. One definition — every screen renders this, nothing renders the
// letters itself.
//
// Current logo (2026-11): ALL-CAPS "LOADQ" with the Q always #FF8A1A, followed by a solid
// orange rounded-LEFT rectangle — rounded on the Q-facing (left) side, SQUARE on the far
// side — sitting a touch taller than the caps. "Load" takes only the colour the background
// allows: #15171C on a light background, white on a dark one. The Q and the rectangle are
// always the brand orange, never the theme accent.
export const BRAND_ORANGE = "#FF8A1A";
export const BRAND_INK = "#15171C";

// Perceived lightness of the background decides the "LOAD" colour, so a future palette is
// handled without editing this file. Defaults to the active theme; a screen that paints its
// own surface passes `on` so the mark reads against what's actually behind it.
export function brandInk(on?: string): string {
  const hex = (on || Colors.bg || "#FFFFFF").replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? BRAND_INK : "#FFFFFF";
}

export default function Wordmark({ style, on }: { style?: StyleProp<TextStyle>; on?: string }) {
  // Size the orange rectangle from the caller's font size so the mark scales as one unit.
  const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
  const size = typeof flat.fontSize === "number" ? flat.fontSize : 24;
  const rectH = size * 0.82;
  const rectW = size * 0.52;
  const rad = size * 0.11; // left corners only

  // `style` carries each screen's size/spacing; colour + tracking are applied AFTER it so a
  // caller cannot reintroduce the theme accent or lose the all-caps tracking.
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Text style={[{ fontWeight: "800" }, style, { color: brandInk(on), letterSpacing: 0.5 }]}>
        LOAD<Text style={{ color: BRAND_ORANGE }}>Q</Text>
      </Text>
      <View
        style={{
          width: rectW,
          height: rectH,
          marginLeft: size * 0.3,
          backgroundColor: BRAND_ORANGE,
          borderTopLeftRadius: rad,
          borderBottomLeftRadius: rad,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
        }}
      />
    </View>
  );
}
