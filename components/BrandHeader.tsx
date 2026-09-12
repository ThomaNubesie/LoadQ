import { View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../constants/colors";
import Wordmark from "./Wordmark";

// The LoadQ wordmark strip, on every driver and passenger screen.
//
// Before this, the mark appeared on the 8 auth screens and then vanished: of the 52 screens
// past sign-in only zone-select, pickup-receipt and admin-print-user carried it. A driver
// could work all day without seeing whose app it was.
//
// Rendered ONCE by each group's _layout above the <Stack>, not pasted into 40 screens —
// every screen already draws its own header row (zone picker, message button), so this is a
// slim strip above that, never a replacement for it.
//
// The letters come from <Wordmark/>, which is the single definition of the mark; this file
// only decides where the strip sits and that it owns the top inset.
export default function BrandHeader() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.wrap, { paddingTop: insets.top, backgroundColor: Colors.bg }]}>
      <View style={s.row}>
        <Wordmark style={{ fontSize: 19 }} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { height: 34, justifyContent: "center", paddingHorizontal: 16 },
  wrap: {},
});
