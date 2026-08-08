// Driver Deliveries tab — surfaces Kolis parcels (available offers + carrying)
// inside LoadQ. The KolisParcels component owns the available/accept/decline
// list and the carrying link; this screen gives it a first-class home + tab.
import { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import KolisParcels from "../../components/KolisParcels";
import BottomNav from "../../components/BottomNav";

export default function Deliveries() {
  const { t } = useStrings();
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Remount KolisParcels to re-fetch on focus / pull-to-refresh.
  useFocusEffect(useCallback(() => { setNonce((n) => n + 1); }, []));
  const onRefresh = useCallback(() => { setRefreshing(true); setNonce((n) => n + 1); setTimeout(() => setRefreshing(false), 600); }, []);

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <Text style={s.title}>{t.deliveries}</Text>
      <Text style={s.sub}>{t.deliveriesSub}</Text>
      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
      >
        <KolisParcels key={nonce} />
      </ScrollView>
      <BottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  title:  { color: Colors.t1, fontSize: 17, fontWeight: "800", paddingHorizontal: 16, paddingTop: 16 },
  sub:    { color: Colors.t3, fontSize: 12.5, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 4 },
});
