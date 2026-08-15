import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import PassengerBottomNav from "../../components/PassengerBottomNav";
import LoadingTimesView from "../../components/LoadingTimesView";

export default function PassengerLoadingTimes() {
  const router = useRouter();
  const { zoneId, zoneName, dest } = useLocalSearchParams<{ zoneId: string; zoneName?: string; dest?: string }>();

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ChevronLeft size={24} color={Colors.t1} /></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {zoneId
          ? <LoadingTimesView zoneId={String(zoneId)} zoneName={zoneName ? String(zoneName) : null} destination={dest ? String(dest) : null} accent={Colors.accentP} />
          : <Text style={s.none}>No zone selected.</Text>}
      </ScrollView>
      <PassengerBottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 2 },
  none:   { color: Colors.t2, textAlign: "center", marginTop: 40 },
});
