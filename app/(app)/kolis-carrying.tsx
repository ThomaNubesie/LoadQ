// Driver's carried Kolis parcels + deliver (4-digit code -> captures escrow).
import { useCallback, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import { ks } from "../../constants/kolisI18n";
import { KolisAPI, KolisParcel } from "../../services/kolis";

const MAG = "#E11D6B";

export default function KolisCarrying() {
  const { lang } = useStrings();
  const k = ks(lang);
  const router = useRouter();
  const [list, setList] = useState<KolisParcel[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => { KolisAPI.carrying().then(setList).catch(() => {}); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const deliver = async (p: KolisParcel) => {
    const code = (codes[p.id] || "").trim();
    if (code.length < 4) return;
    setBusyId(p.id);
    const { ok, error } = await KolisAPI.deliver(p.id, code);
    setBusyId(null);
    if (!ok) { Alert.alert("Kolis", error === "bad_code" ? k.badCode : (error || k.badCode)); return; }
    Alert.alert("Kolis", k.delivered);
    load();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <TouchableOpacity onPress={() => router.back()}><Text style={{ color: Colors.t2, marginBottom: 8, fontSize: 15 }}>←</Text></TouchableOpacity>
        <Text style={{ fontSize: 22, fontWeight: "800", color: Colors.t1, marginBottom: 14 }}>{k.carrying}</Text>
        {list.length === 0 && <Text style={{ color: Colors.t2, textAlign: "center", marginTop: 30 }}>{k.noneCarrying}</Text>}
        {list.map((p) => (
          <View key={p.id} style={{ borderWidth: 1, borderColor: "#3D2E00", backgroundColor: "#1F1500", borderRadius: 15, padding: 14, marginBottom: 12 }}>
            <Text style={{ color: Colors.t1, fontWeight: "800", fontSize: 15 }}>#{p.code} {k.forDest} {p.to_city}</Text>
            <Text style={{ color: Colors.t3, fontSize: 12, marginTop: 2, marginBottom: 12 }}>🔒 {k.recipientMasked}</Text>
            <Text style={{ fontSize: 10, color: Colors.t3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>{k.enterCode}</Text>
            <TextInput value={codes[p.id] || ""} onChangeText={(v) => setCodes((c) => ({ ...c, [p.id]: v }))} keyboardType="number-pad" maxLength={4} placeholder="••••" placeholderTextColor={Colors.t3}
              style={{ borderWidth: 1.5, borderColor: MAG, borderRadius: 11, padding: 12, fontSize: 20, fontWeight: "800", letterSpacing: 8, textAlign: "center", color: Colors.t1, backgroundColor: "#150d02", marginBottom: 10 }} />
            <TouchableOpacity onPress={() => deliver(p)} disabled={busyId === p.id} style={{ backgroundColor: MAG, borderRadius: 12, padding: 14, alignItems: "center" }}>
              {busyId === p.id ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>{k.markDelivered}</Text>}
            </TouchableOpacity>
            <Text style={{ color: "#4ade9c", fontSize: 11, textAlign: "center", marginTop: 8 }}>C${Math.round(p.price_cents / 100)} {k.released}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
