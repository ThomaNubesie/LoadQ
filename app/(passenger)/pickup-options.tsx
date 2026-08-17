import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Route as RouteIcon, Home, MapPinned, ChevronRight } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";

export default function PickupOptionsScreen() {
  const router = useRouter();
  const { lang } = useStrings();
  const fr = lang === "fr";

  const OPTIONS = [
    {
      key: "on_route", icon: RouteIcon, warm: false,
      title: fr ? "Ramassage sur le trajet" : "On-route pickup",
      desc: fr ? "Un chauffeur en route vous prend en chemin, puis dépose au point de chargement." : "A driver already heading out grabs you along their route, then drops at a loading zone.",
      price: fr ? "dès 12,99 $" : "from $12.99",
      go: () => router.push("/(passenger)/request-ride" as any),
    },
    {
      key: "home_zone", icon: Home, warm: true,
      title: fr ? "Domicile → point de chargement" : "Home → loading zone",
      desc: fr ? "Un chauffeur-navette vous prend à domicile et vous dépose au point de chargement de votre choix." : "A feeder driver collects you at home and drops you at a loading zone you pick.",
      price: fr ? "12,99 $ + distance" : "$12.99 + distance",
      go: () => router.push("/(passenger)/pickup-request" as any),
    },
    {
      key: "door", icon: MapPinned, warm: true,
      title: fr ? "Domicile → porte-à-porte" : "Home → door-to-door",
      desc: fr ? "Réservez à l'avance. Un seul chauffeur vous conduit du domicile jusqu'à votre adresse en ville." : "Book ahead. One driver takes you home → city → your drop-off address.",
      price: fr ? "12,99 $ + trajet + distance" : "$12.99 + fare + distance",
      go: () => router.push("/(passenger)/pickup-scheduled" as any),
    },
  ];

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{fr ? "Comment être pris en charge" : "How to get picked up"}</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
        {OPTIONS.map(o => (
          <TouchableOpacity key={o.key} style={s.card} onPress={o.go} activeOpacity={0.85}>
            <View style={[s.icon, o.warm && s.iconWarm]}><o.icon size={20} color={o.warm ? Colors.accentWarmText : Colors.accent} strokeWidth={2.2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{o.title}</Text>
              <Text style={s.cardDesc}>{o.desc}</Text>
              <Text style={[s.price, o.warm ? { color: Colors.accentWarmText } : { color: Colors.accent }]}>{o.price}</Text>
            </View>
            <ChevronRight size={18} color={Colors.t3} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  title: { color: Colors.t1, fontSize: 18, fontWeight: "800" },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 15, padding: 14 },
  icon: { width: 38, height: 38, borderRadius: 11, backgroundColor: "rgba(47,111,224,0.12)", alignItems: "center", justifyContent: "center" },
  iconWarm: { backgroundColor: "rgba(255,138,26,0.15)" },
  cardTitle: { color: Colors.t1, fontSize: 15, fontWeight: "800" },
  cardDesc: { color: Colors.t2, fontSize: 12, lineHeight: 17, marginTop: 3 },
  price: { fontSize: 11.5, fontWeight: "800", marginTop: 6 },
});
