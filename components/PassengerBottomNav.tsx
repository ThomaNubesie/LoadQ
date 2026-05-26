import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { Colors } from "../constants/colors";
import ActiveTripBanner from "./ActiveTripBanner";

interface Tab {
  label: string;
  route: string;
  match: string;
}

const TABS: Tab[] = [
  { label: "BOARD",  route: "/(passenger)/queue",   match: "/queue"   },
  { label: "ZONES",  route: "/(passenger)/zones",   match: "/zones"   },
  { label: "ALERTS", route: "/(passenger)/analytics", match: "/analytics" },
  { label: "ME",     route: "/(passenger)/profile", match: "/profile" },
];

export default function PassengerBottomNav() {
  const router   = useRouter();
  const pathname = usePathname();

  return (
    <View>
      <ActiveTripBanner />
      <View style={s.bar}>
      {TABS.map(tab => {
        const active = pathname.startsWith(tab.match);
        return (
          <TouchableOpacity
            key={tab.route}
            style={s.item}
            onPress={() => { if (!active) router.replace(tab.route as any); }}
            activeOpacity={0.7}
          >
            <Text style={[s.label, active && s.labelActive]} numberOfLines={1}>{tab.label}</Text>
            {active && <View style={s.underline} />}
          </TouchableOpacity>
        );
      })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar:         { flexDirection:"row", backgroundColor:Colors.card, borderTopWidth:0.5, borderTopColor:Colors.border, paddingTop:12, paddingBottom:14 },
  item:        { flex:1, alignItems:"center", paddingVertical:4 },
  label:       { fontSize:12, color:Colors.t3, fontWeight:"700", letterSpacing:1.5 },
  labelActive: { color:Colors.accent },
  underline:   { position:"absolute", bottom:-2, width:36, height:2, backgroundColor:Colors.accent, borderRadius:1 },
});
