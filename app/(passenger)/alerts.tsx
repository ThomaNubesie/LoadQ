// STUB — passenger Alerts screen. Placeholder so the tab bar routes without
// crashing; real alerts feed is a later step.
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import PassengerBottomNav from "../../components/PassengerBottomNav";

export default function AlertsScreen() {
  const { t } = useStrings();
  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <Text style={s.title}>{t("navAlerts")}</Text>
      <View style={s.center}>
        <Text style={s.empty}>{t("noAlertsYet")}</Text>
      </View>
      <PassengerBottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  title:  { color: Colors.t1, fontSize: 17, fontWeight: "800", padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  empty:  { color: Colors.t3, fontSize: 14 },
});
