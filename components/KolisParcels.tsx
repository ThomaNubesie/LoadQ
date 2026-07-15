// Kolis parcel offers shown inside the LoadQ driver queue screen, so drivers
// never have to open a separate app. Self-hides when there's nothing to show.
import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, Modal } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Location from "expo-location";
import { Colors } from "../constants/colors";
import { useStrings } from "../hooks/useStrings";
import { ks } from "../constants/kolisI18n";
import { KolisAPI, KolisParcel } from "../services/kolis";

const MAG = "#E11D6B";
const MAG_LT = "#ff6fa6";
const ETA_CHIPS = [10, 15, 20, 30, 45, 60];

export default function KolisParcels() {
  const { lang } = useStrings();
  const k = ks(lang);
  const router = useRouter();
  const [avail, setAvail] = useState<KolisParcel[]>([]);
  const [carry, setCarry] = useState<KolisParcel[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Accept opens the ETA sheet (auto-fill from GPS, courier can adjust); the
  // sender is told this pickup ETA. ALL hooks must run before the early return
  // below — declaring them after it changes the hook count between renders and
  // crashes with "Rendered more hooks than during the previous render".
  const [etaFor, setEtaFor] = useState<KolisParcel | null>(null);
  const [etaSel, setEtaSel] = useState<number | null>(null);
  const [etaAuto, setEtaAuto] = useState<number | null>(null);
  const [etaLoading, setEtaLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const load = useCallback(() => {
    KolisAPI.available().then(setAvail).catch(() => {});
    KolisAPI.carrying().then(setCarry).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (avail.length === 0 && carry.length === 0) return null;

  const sizeLabel = (s: string) => (s === "envelope" ? k.envelope : s === "large" ? k.large : k.small);
  const emoji = (s: string) => (s === "envelope" ? "✉️" : s === "large" ? "🧳" : "📦");

  const openAccept = async (p: KolisParcel) => {
    setEtaFor(p); setEtaSel(null); setEtaAuto(null); setEtaLoading(true);
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      const granted = perm.granted || (await Location.requestForegroundPermissionsAsync()).granted;
      if (granted) {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const auto = await KolisAPI.pickupEta(p.id, loc.coords.latitude, loc.coords.longitude);
        if (auto) { setEtaAuto(auto); setEtaSel(auto); }
      }
    } catch { /* manual fallback */ }
    setEtaLoading(false);
  };

  const confirmAccept = async () => {
    if (!etaFor || etaSel == null) return;
    const p = etaFor;
    setAccepting(true);
    const ok = await KolisAPI.accept(p.id, etaSel);
    setAccepting(false);
    setEtaFor(null);
    if (ok) Alert.alert("Kolis", k.accepted);
    load();
  };

  const decline = async (p: KolisParcel) => {
    setBusyId(p.id);
    await KolisAPI.decline(p.id);
    setBusyId(null);
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
        <View key={p.id} style={{ paddingVertical: 9, borderTopWidth: 1, borderTopColor: "rgba(225,29,107,0.2)" }}>
          {/* Info row — text gets the full width so it can't collapse to one char per line */}
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ fontSize: 17, marginRight: 9 }}>{emoji(p.size)}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: Colors.t1, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>{sizeLabel(p.size)} {k.forDest} {p.to_city}</Text>
              <Text style={{ color: Colors.t3, fontSize: 10.5 }} numberOfLines={1}>
                {p.is_request ? `📣 ${k.requestedForYou}` : `${k.pickHere} · 🔒 ${k.senderHidden}`}
              </Text>
            </View>
            <Text style={{ color: Colors.green, fontWeight: "800", fontSize: 14, marginLeft: 8 }}>+C${Math.round((p.driver_payout_cents ?? 0) / 100)}</Text>
          </View>
          {/* Action row — full-width buttons below, so they never squeeze the text */}
          <View style={{ flexDirection: "row", marginTop: 9, gap: 8 }}>
            {p.is_request && (
              <TouchableOpacity onPress={() => decline(p)} disabled={busyId === p.id} style={{ flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 9, paddingVertical: 9, alignItems: "center" }}>
                <Text style={{ color: Colors.t2, fontWeight: "800", fontSize: 12.5 }}>{k.decline}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => openAccept(p)} disabled={busyId === p.id} style={{ flex: p.is_request ? 1.5 : 1, backgroundColor: MAG, borderRadius: 9, paddingVertical: 9, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12.5 }}>{k.accept}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {avail.length === 0 && carry.length > 0 && (
        <Text style={{ color: Colors.t2, fontSize: 12, paddingTop: 6 }}>{k.none}</Text>
      )}

      {/* Pickup-ETA sheet */}
      <Modal visible={!!etaFor} transparent animationType="fade" onRequestClose={() => setEtaFor(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => !accepting && setEtaFor(null)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: "#1F1500", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, paddingBottom: 34, borderTopWidth: 1.5, borderColor: MAG }}>
            <Text style={{ fontSize: 18, fontWeight: "800", color: Colors.t1 }}>{k.pickupEtaTitle}</Text>
            <Text style={{ fontSize: 12.5, color: Colors.t3, marginTop: 3, marginBottom: 14 }}>{k.pickupEtaSub}</Text>
            {etaLoading ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <ActivityIndicator color={MAG} /><Text style={{ color: Colors.t2, fontSize: 12.5 }}>{k.etaLocating}</Text>
              </View>
            ) : etaAuto ? (
              <Text style={{ fontSize: 12.5, color: "#4ade9c", fontWeight: "700", marginBottom: 12 }}>📍 {k.etaAuto.replace("{min}", String(etaAuto))}</Text>
            ) : (
              <Text style={{ fontSize: 12.5, color: Colors.t3, marginBottom: 12 }}>{k.etaManual}</Text>
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9, marginBottom: 18 }}>
              {ETA_CHIPS.map((m) => {
                const on = etaSel === m;
                return (
                  <TouchableOpacity key={m} onPress={() => setEtaSel(m)} style={{ borderWidth: 1.5, borderColor: on ? MAG : "#3D2E00", backgroundColor: on ? MAG : "#150d02", borderRadius: 11, paddingHorizontal: 16, paddingVertical: 11 }}>
                    <Text style={{ color: on ? "#fff" : Colors.t1, fontWeight: "800", fontSize: 14 }}>{m} {k.minShort}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity onPress={confirmAccept} disabled={etaSel == null || accepting} style={{ backgroundColor: MAG, borderRadius: 13, padding: 15, alignItems: "center", opacity: (etaSel == null || accepting) ? 0.5 : 1 }}>
              {accepting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{k.confirmAcceptEta}</Text>}
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
