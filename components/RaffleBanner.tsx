import { useEffect, useState } from "react";
import { TouchableOpacity, View, Text } from "react-native";
import { useRouter } from "expo-router";
import { Dices, ChevronRight } from "lucide-react-native";
import { Colors } from "../constants/colors";
import { RaffleAPI } from "../services/raffle";

// Entry point to the Morning Raffle. Renders NOTHING unless the driver can raffle
// (eligible + window open, or a feature-admin who can test) or has already raffled
// today. Self-contained: drop <RaffleBanner/> anywhere and it decides visibility.
export default function RaffleBanner() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [label, setLabel] = useState("Morning Raffle");

  useEffect(() => {
    let alive = true;
    RaffleAPI.status().then((s) => {
      if (!alive) return;
      setShow(s.can_raffle || s.already_raffled);
      setLabel(
        s.already_raffled ? `Your raffle number: ${s.my_number ?? "—"}`
        : s.window_open ? "Raffle open — tap to get your number"
        : "Test the morning raffle"
      );
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!show) return null;
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => router.push("/(app)/raffle")}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.card,
        borderWidth: 1.5, borderColor: Colors.accentWarm, borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.accentWarm,
        alignItems: "center", justifyContent: "center" }}>
        <Dices size={20} color="#fff" strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "800", color: Colors.t1 }}>Morning Raffle</Text>
        <Text style={{ fontSize: 12, color: Colors.t2 }}>{label}</Text>
      </View>
      <ChevronRight size={20} color={Colors.t3} />
    </TouchableOpacity>
  );
}
