import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LayoutGrid, Ticket, Bell, User } from "lucide-react-native";
import { Colors } from "../constants/colors";
import { useStrings } from "../hooks/useStrings";
import ActiveTripBanner from "./ActiveTripBanner";

// Passenger tab bar (v1.2): Board · My trip · Alerts · Profile.
// Replaces the old Board · Zones · History · Me nav; "Board" is now the live
// reservation board (app/(passenger)/board.tsx), not the drivers-available page.
const TABS = [
  { labelKey: "navBoard",   route: "/(passenger)/board",   match: "/board",   Icon: LayoutGrid },
  { labelKey: "navMyTrip",  route: "/(passenger)/my-trip", match: "/my-trip", Icon: Ticket },
  { labelKey: "navAlerts",  route: "/(passenger)/alerts",  match: "/alerts",  Icon: Bell },
  { labelKey: "navProfile", route: "/(passenger)/profile", match: "/profile", Icon: User },
] as const;

export default function PassengerBottomNav() {
  const router   = useRouter();
  const pathname = usePathname();
  const { t }    = useStrings();
  const insets   = useSafeAreaInsets();

  return (
    <View>
      <ActiveTripBanner />
      {/* pad for the Android gesture/nav bar (and iOS home indicator) so the
          system bar never overlaps the tab row */}
      <View style={[s.bar, { paddingBottom: 10 + insets.bottom }]}>
        {TABS.map(({ labelKey, route, match, Icon }) => {
          const active = pathname.startsWith(match);
          return (
            <TouchableOpacity key={route} style={s.item} activeOpacity={0.7}
              onPress={() => { if (!active) router.replace(route as any); }}>
              <Icon size={19} color={active ? Colors.accent : Colors.t3} strokeWidth={active ? 2.4 : 2} />
              <Text style={[s.label, active && s.labelActive]} numberOfLines={1}>{t(labelKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar:         { flexDirection: "row", backgroundColor: "#101217", borderTopWidth: 0.5, borderTopColor: Colors.border, paddingTop: 8, paddingBottom: 12 },
  item:        { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 4 },
  label:       { fontSize: 9.5, color: Colors.t3, fontWeight: "700" },
  labelActive: { color: Colors.accent },
});
