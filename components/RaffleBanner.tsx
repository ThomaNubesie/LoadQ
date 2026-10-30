import { useEffect, useState } from "react";
import { TouchableOpacity, View, Text } from "react-native";
import { useRouter } from "expo-router";
import { Dices, ChevronRight } from "lucide-react-native";
import { Colors } from "../constants/colors";
import { RaffleAPI, RaffleStatus } from "../services/raffle";
import { useStrings } from "../hooks/useStrings";

// Entry point to the Morning Raffle. Renders NOTHING for a regular driver unless
// they can raffle (eligible + window open) or have already raffled today — EXCEPT
// raffle admins, for whom it ALWAYS shows so they can reach the test tap any time.
// Self-contained: drop <RaffleBanner/> anywhere and it decides visibility. Label is
// derived at render (not cached) so it follows a live language switch.
export default function RaffleBanner() {
  const router = useRouter();
  const { t } = useStrings();
  const [status, setStatus] = useState<RaffleStatus | null>(null);

  useEffect(() => {
    let alive = true;
    RaffleAPI.status().then((s) => { if (alive) setStatus(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!status) return null;
  const show = status.can_raffle || status.already_raffled || !!status.is_admin;
  if (!show) return null;

  const label =
    status.already_raffled ? t("raffleYourNumberShort", { n: status.my_number ?? "—" })
    : status.window_open   ? t.raffleOpenTap
    :                        t.raffleTest;

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => router.push("/(app)/raffle" as any)}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.card,
        borderWidth: 1.5, borderColor: Colors.accentWarm, borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.accentWarm,
        alignItems: "center", justifyContent: "center" }}>
        <Dices size={20} color="#fff" strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "800", color: Colors.t1 }}>{t.raffleTitle}</Text>
        <Text style={{ fontSize: 12, color: Colors.t2 }}>{label}</Text>
      </View>
      <ChevronRight size={20} color={Colors.t3} />
    </TouchableOpacity>
  );
}
