// Kolis parcel offers shown inside the LoadQ driver queue screen, so drivers
// never have to open a separate app. Self-hides when there's nothing to show.
import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Colors } from "../constants/colors";
import { useStrings } from "../hooks/useStrings";
import { ks } from "../constants/kolisI18n";
import { KolisAPI, KolisParcel } from "../services/kolis";

const MAG = "#E11D6B";
const MAG_LT = "#ff6fa6";

export default function KolisParcels() {
  const { lang } = useStrings();
  const k = ks(lang);
  const router = useRouter();
  const [avail, setAvail] = useState<KolisParcel[]>([]);
  const [carry, setCarry] = useState<KolisParcel[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    KolisAPI.available().then(setAvail).catch(() => {});
    KolisAPI.carrying().then(setCarry).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (avail.length === 0 && carry.length === 0) return null;

  const sizeLabel = (s: string) => (s === "envelope" ? k.envelope : s === "large" ? k.large : k.small);
  const emoji = (s: string) => (s === "envelope" ? "✉️" : s === "large" ? "🧳" : "📦");

  const accept = async (p: KolisParcel) => {
    setBusyId(p.id);
    const ok = await KolisAPI.accept(p.id);
    setBusyId(null);
    if (ok) Alert.alert("Kolis", k.accepted);
    load();
  };

  return (
    <View style={{ marginHorizontal: 16, marginTop: 14, borderWidth: 1.5, borderColor: MAG, borderRadius: 15, padding: 13, backgroundColor: "rgba(225,29,107,0.06)" }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
        <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: MAG, alignItems: "center", justifyContent: "center", marginRight: 8 }}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 10 }}>Ko</Text>
        </View>
        <Text style={{ color: "#ffd9e8", fontWeight: "800", fontSize: 14 }}>{k.parcels}</Text>
        {carry.length > 0 && (
          <TouchableOpacity onPress={() => router.push("/(app)/kolis-carrying" as any)} style={{ marginLeft: "auto" }}>
            <Text style={{ color: MAG_LT, fontWeight: "700", fontSize: 12 }}>{k.carrying} ({carry.length}) →</Text>
          </TouchableOpacity>
        )}
      </View>

      {avail.map((p) => (
        <View key={p.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 9, borderTopWidth: 1, borderTopColor: "rgba(225,29,107,0.2)" }}>
          <Text style={{ fontSize: 17, marginRight: 9 }}>{emoji(p.size)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: Colors.t1, fontWeight: "700", fontSize: 13 }}>{sizeLabel(p.size)} {k.forDest} {p.to_city}</Text>
            <Text style={{ color: Colors.t3, fontSize: 10.5 }}>{k.pickHere} · 🔒 {k.senderHidden}</Text>
          </View>
          <Text style={{ color: Colors.green, fontWeight: "800", fontSize: 13, marginRight: 8 }}>+C${Math.round((p.driver_payout_cents ?? 0) / 100)}</Text>
          <TouchableOpacity onPress={() => accept(p)} disabled={busyId === p.id} style={{ backgroundColor: MAG, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 13 }}>
            {busyId === p.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>{k.accept}</Text>}
          </TouchableOpacity>
        </View>
      ))}

      {avail.length === 0 && carry.length > 0 && (
        <Text style={{ color: Colors.t2, fontSize: 12, paddingTop: 6 }}>{k.none}</Text>
      )}
    </View>
  );
}
