import { View, Text, TouchableOpacity, StyleSheet, Image } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useStrings } from "../hooks/useStrings";
import { useMyAvatar } from "../hooks/useMyAvatar";
import { Colors } from "../constants/colors";

export interface NavItem {
  icon:  string;
  label: string;
  route: string;
  match: string;        // path fragment used to decide if this item is the active one
  isProfile?: boolean;  // render the user's avatar instead of the emoji icon
}

interface Props {
  items?: NavItem[]; // overrides the default driver nav
}

export default function BottomNav({ items }: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const { t }    = useStrings();
  const avatar   = useMyAvatar();

  const defaultItems: NavItem[] = [
    { icon: "📋", label: t.queue,         route: "/(app)/queue",      match: "/queue"      },
    { icon: "🚗", label: t.myLoading,     route: "/(app)/my-loading", match: "/my-loading" },
    { icon: "🔔", label: t.notifications, route: "/(app)/alerts",     match: "/alerts"     },
    { icon: "👤", label: t.profile,       route: "/(app)/profile",    match: "/profile", isProfile: true },
  ];

  const list = items ?? defaultItems;

  return (
    <View style={s.bar}>
      {list.map(item => {
        const active = pathname.startsWith(item.match);
        const showAvatar = item.isProfile && !!avatar;
        return (
          <TouchableOpacity
            key={item.route}
            style={[s.item, active && s.itemActive]}
            onPress={() => { if (!active) router.replace(item.route as any); }}
            activeOpacity={0.7}
          >
            {showAvatar ? (
              <Image
                source={{ uri: avatar! }}
                style={[s.avatar, active && s.avatarActive]}
              />
            ) : (
              <Text style={[s.icon, active && s.iconActive]}>{item.icon}</Text>
            )}
            <Text style={[s.label, active && s.labelActive]} numberOfLines={1}>{item.label}</Text>
            {active && <View style={s.indicator} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar:          { flexDirection:"row", backgroundColor:Colors.card, borderTopWidth:0.5, borderTopColor:Colors.border, paddingTop:8, paddingBottom:8 },
  item:         { flex:1, alignItems:"center", gap:3, paddingVertical:2 },
  itemActive:   { },
  icon:         { fontSize:18, opacity:0.55 },
  iconActive:   { opacity:1 },
  avatar:       { width:22, height:22, borderRadius:11, opacity:0.6, backgroundColor:Colors.cardAlt },
  avatarActive: { opacity:1, borderWidth:1.5, borderColor:Colors.accent },
  label:        { fontSize:10, color:Colors.t3, fontWeight:"500" },
  labelActive:  { color:Colors.accent, fontWeight:"700" },
  indicator:    { position:"absolute", top:0, width:24, height:2, borderRadius:1, backgroundColor:Colors.accent },
});
