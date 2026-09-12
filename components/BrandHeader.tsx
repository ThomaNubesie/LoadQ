import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../constants/colors";

// The LoadQ wordmark, on every driver and passenger screen.
//
// Before this, the mark appeared on the 8 auth screens and then vanished: of the 52
// screens past sign-in only zone-select, pickup-receipt and admin-print-user carried it.
// A driver could use the app all day without seeing whose app it was.
//
// Rendered ONCE by each group's _layout above the <Stack>, not pasted into 40 screens —
// every screen already draws its own header row (zone picker, message button), so this is
// a slim strip above that, never a replacement for it.
//
// Brand rule (set 2026-09-11): the Q is ALWAYS #FF8A1A — the letterhead orange — and never
// the theme's accent, which differs per palette (#FF6B00 on dark). "Load" takes only the
// colour the background allows: near-black on the cream theme, white on the charcoal ones.
// No plate, no box.
const BRAND_ORANGE = "#FF8A1A";
const BRAND_INK = "#15171C";

// Perceived lightness of the active background decides the wordmark colour, so a future
// palette gets the right treatment without another edit here.
function onLightBackground(): boolean {
  const hex = (Colors.bg || "#FFFFFF").replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 140;
}

export default function BrandHeader() {
  const insets = useSafeAreaInsets();
  const ink = onLightBackground() ? BRAND_INK : "#FFFFFF";
  return (
    <View style={[s.wrap, { paddingTop: insets.top, backgroundColor: Colors.bg }]}>
      <View style={s.row}>
        <Text style={[s.logo, { color: ink }]}>
          Load<Text style={{ color: BRAND_ORANGE }}>Q</Text>
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: Colors.bg },
  row: { height: 34, justifyContent: "center", paddingHorizontal: 16 },
  logo: { fontSize: 19, fontWeight: "900", letterSpacing: -0.5 },
});
