// Driver's carried Kolis parcels + deliver (4-digit code -> captures escrow).
import { useCallback, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, ScanLine, Building2, DoorOpen, Navigation, Lock, MessageSquare, Package, CircleCheckBig, MapPin, Phone } from "lucide-react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import { ks } from "../../constants/kolisI18n";
import { KolisAPI, KolisParcel } from "../../services/kolis";

const MAG = "#E11D6B";
const MAG_LT = "#ff6fa6";

export default function KolisCarrying() {
  const { lang } = useStrings();
  const k = ks(lang);
  const router = useRouter();
  const [list, setList] = useState<KolisParcel[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [pcodes, setPcodes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [labelBusy, setLabelBusy] = useState<string | null>(null);
  const [earn, setEarn] = useState({ paid: 0, pending: 0 });
  const [interac, setInterac] = useState("");
  const [savingI, setSavingI] = useState(false);

  const load = useCallback(() => {
    KolisAPI.carrying().then(setList).catch(() => {});
    KolisAPI.earnings().then(setEarn).catch(() => {});
    KolisAPI.getInterac().then((v) => setInterac(v ?? "")).catch(() => {});
  }, []);

  const saveInterac = async () => {
    setSavingI(true);
    await KolisAPI.setInterac(interac.trim());
    setSavingI(false);
  };
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Open the platform maps app with turn-by-turn directions to an address.
  const openDirections = async (addr: string) => {
    const dst = encodeURIComponent(addr);
    const web = `https://www.google.com/maps/dir/?api=1&destination=${dst}`;
    const native = Platform.select({ ios: `http://maps.apple.com/?daddr=${dst}&dirflg=d`, android: `google.navigation:q=${dst}`, default: web })!;
    try { const ok = await Linking.canOpenURL(native); await Linking.openURL(ok ? native : web); }
    catch { try { await Linking.openURL(web); } catch { Alert.alert("Kolis", addr); } }
  };

  const pickup = async (p: KolisParcel) => {
    const code = (pcodes[p.id] || "").trim();
    if (code.length < 4) return;
    setBusyId(p.id);
    const res = await KolisAPI.markPickedUp(p.id, code);
    setBusyId(null);
    if (res !== "ok") { Alert.alert("Kolis", res === "bad_code" ? k.badPickupCode : k.badCode); return; }
    setPcodes((c) => ({ ...c, [p.id]: "" }));
    load();
  };

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
        <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 8 }}><ArrowLeft size={18} color={Colors.t2} strokeWidth={2} /></TouchableOpacity>
        <Text style={{ fontSize: 22, fontWeight: "800", color: Colors.t1, marginBottom: 6 }}>{k.carrying}</Text>
        <TouchableOpacity onPress={() => router.push("/(app)/kolis-scan" as any)}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: MAG, borderRadius: 12, paddingVertical: 13, marginBottom: 12 }}>
          <ScanLine size={16} color="#fff" strokeWidth={2} />
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{lang === "fr" ? "Scanner le QR du colis" : "Scan parcel QR"}</Text>
        </TouchableOpacity>
        <View style={{ borderRadius: 12, backgroundColor: "rgba(16,185,129,0.12)", borderWidth: 1, borderColor: "rgba(16,185,129,0.3)", padding: 12, marginBottom: 10, flexDirection: "row", justifyContent: "space-between" }}>
          <View><Text style={{ color: Colors.t3, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 }}>{k.pending}</Text><Text style={{ color: "#4ade9c", fontWeight: "800", fontSize: 20 }}>C${Math.round(earn.pending / 100)}</Text></View>
          <View style={{ alignItems: "flex-end" }}><Text style={{ color: Colors.t3, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 }}>{k.paid}</Text><Text style={{ color: Colors.t2, fontWeight: "800", fontSize: 20 }}>C${Math.round(earn.paid / 100)}</Text></View>
        </View>
        <Text style={{ fontSize: 10, color: Colors.t3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5 }}>{k.interacEmail}</Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
          <TextInput value={interac} onChangeText={setInterac} placeholder="you@email.com" keyboardType="email-address" autoCapitalize="none" placeholderTextColor={Colors.t3}
            style={{ flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 11, color: Colors.t1, backgroundColor: Colors.card, fontSize: 14 }} />
          <TouchableOpacity onPress={saveInterac} disabled={savingI} style={{ backgroundColor: MAG, borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" }}>
            {savingI ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800" }}>{k.savePayout}</Text>}
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 10.5, color: Colors.t3, marginBottom: 14 }}>{k.payoutHint}</Text>
        {list.length === 0 && <Text style={{ color: Colors.t2, textAlign: "center", marginTop: 30 }}>{k.noneCarrying}</Text>}
        {list.map((p) => {
          const gotIt = p.status !== "matched"; // picked_up / in_transit → possession confirmed
          const isHub = p.dropoff_type === "hub";
          const pickupWhere = isHub ? (p.pickup_hub_name || "") : (p.pickup_addr || "");
          return (
          <View key={p.id} style={{ borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card, borderRadius: 15, padding: 14, marginBottom: 12 }}>
            <Text style={{ color: Colors.t1, fontWeight: "800", fontSize: 15, marginBottom: 8 }}>#{p.code} {k.forDest} {p.to_city}</Text>
            <TouchableOpacity
              onPress={async () => { setLabelBusy(p.id); const r = await KolisAPI.emailLabel(p.code); setLabelBusy(null); Alert.alert("Kolis", r.ok ? (lang === "fr" ? `Étiquette envoyée à ${r.to}` : `Label emailed to ${r.to}`) : (r.error || (lang === "fr" ? "Erreur" : "Error"))); }}
              disabled={labelBusy === p.id}
              style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderColor: MAG, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 10, opacity: labelBusy === p.id ? 0.6 : 1 }}>
              {labelBusy === p.id ? <ActivityIndicator color={MAG} /> : <Text style={{ color: MAG, fontWeight: "800", fontSize: 12 }}>{lang === "fr" ? "Étiquette par courriel" : "Email label to me"}</Text>}
            </TouchableOpacity>

            {/* STAGE 1 — before pickup: pickup address + navigate + pickup code */}
            {!gotIt && (<>
              {pickupWhere ? (
                <TouchableOpacity onPress={() => openDirections(pickupWhere)} style={{ backgroundColor: Colors.surface, borderRadius: 11, padding: 11, marginBottom: 10 }}>
                  <Text style={{ fontSize: 10, color: Colors.t3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>{isHub ? k.pickupHub : k.pickupDoor}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {isHub ? <Building2 size={13.5} color={Colors.t1} strokeWidth={2} /> : <DoorOpen size={13.5} color={Colors.t1} strokeWidth={2} />}
                    <Text style={{ fontSize: 13.5, color: Colors.t1, fontWeight: "700" }}>{pickupWhere}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <Navigation size={11.5} color={MAG_LT} strokeWidth={2} />
                    <Text style={{ fontSize: 11.5, color: MAG_LT, fontWeight: "800" }}>{k.directions}</Text>
                  </View>
                </TouchableOpacity>
              ) : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <Lock size={12} color={Colors.t3} strokeWidth={2} />
                <Text style={{ color: Colors.t3, fontSize: 12 }}>{k.recipientMasked}</Text>
              </View>
              <Text style={{ fontSize: 10, color: Colors.t3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>{k.enterPickupCode}</Text>
              <TextInput value={pcodes[p.id] || ""} onChangeText={(v) => setPcodes((c) => ({ ...c, [p.id]: v.replace(/[^0-9]/g, "") }))} keyboardType="number-pad" maxLength={4} placeholder="••••" placeholderTextColor={Colors.t3}
                style={{ borderWidth: 1.5, borderColor: MAG, borderRadius: 11, padding: 12, fontSize: 20, fontWeight: "800", letterSpacing: 8, textAlign: "center", color: Colors.t1, backgroundColor: Colors.surface, marginBottom: 6 }} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <MessageSquare size={11} color={Colors.t3} strokeWidth={2} />
                <Text style={{ fontSize: 11, color: Colors.t3 }}>{k.askPickupCode}</Text>
              </View>
              <TouchableOpacity onPress={() => pickup(p)} disabled={busyId === p.id || (pcodes[p.id] || "").trim().length < 4} style={{ backgroundColor: MAG, borderRadius: 12, padding: 14, alignItems: "center", opacity: (busyId === p.id || (pcodes[p.id] || "").trim().length < 4) ? 0.55 : 1 }}>
                {busyId === p.id ? <ActivityIndicator color="#fff" /> : <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Package size={14} color="#fff" strokeWidth={2} /><Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>{k.confirmPickup}</Text></View>}
              </TouchableOpacity>
            </>)}

            {/* STAGE 2 — after pickup: delivery address + navigate + recipient + deliver code */}
            {gotIt && (<>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <CircleCheckBig size={11} color="#4ade9c" strokeWidth={2} />
                <Text style={{ fontSize: 11, color: "#4ade9c", fontWeight: "700" }}>{k.pickedUpNote}</Text>
              </View>
              {p.dropoff_addr ? (
                <TouchableOpacity onPress={() => openDirections(p.dropoff_addr!)} style={{ backgroundColor: Colors.surface, borderRadius: 11, padding: 11, marginBottom: 10 }}>
                  <Text style={{ fontSize: 10, color: Colors.t3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>{k.deliveryAddress}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <MapPin size={13.5} color={Colors.t1} strokeWidth={2} />
                    <Text style={{ fontSize: 13.5, color: Colors.t1, fontWeight: "700" }}>{p.dropoff_addr}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <Navigation size={11.5} color={MAG_LT} strokeWidth={2} />
                    <Text style={{ fontSize: 11.5, color: MAG_LT, fontWeight: "800" }}>{k.directions}</Text>
                  </View>
                </TouchableOpacity>
              ) : null}
              {(p.recipient_name || p.recipient_phone) ? (
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 10, color: Colors.t3, textTransform: "uppercase", letterSpacing: 0.6 }}>{k.recipient}</Text>
                    <Text style={{ fontSize: 13, color: Colors.t1, fontWeight: "700" }}>{p.recipient_name || "—"}</Text>
                  </View>
                  {p.recipient_phone ? (
                    <TouchableOpacity onPress={() => Linking.openURL(`tel:${p.recipient_phone}`)} style={{ borderWidth: 1.5, borderColor: MAG, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Phone size={12.5} color={MAG_LT} strokeWidth={2} />
                      <Text style={{ color: MAG_LT, fontWeight: "800", fontSize: 12.5 }}>{k.callRecipient}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
              <Text style={{ fontSize: 10, color: Colors.t3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>{k.enterCode}</Text>
              <TextInput value={codes[p.id] || ""} onChangeText={(v) => setCodes((c) => ({ ...c, [p.id]: v.replace(/[^0-9]/g, "") }))} keyboardType="number-pad" maxLength={4} placeholder="••••" placeholderTextColor={Colors.t3}
                style={{ borderWidth: 1.5, borderColor: MAG, borderRadius: 11, padding: 12, fontSize: 20, fontWeight: "800", letterSpacing: 8, textAlign: "center", color: Colors.t1, backgroundColor: Colors.surface, marginBottom: 10 }} />
              <TouchableOpacity onPress={() => deliver(p)} disabled={busyId === p.id || (codes[p.id] || "").trim().length < 4} style={{ backgroundColor: MAG, borderRadius: 12, padding: 14, alignItems: "center", opacity: (busyId === p.id || (codes[p.id] || "").trim().length < 4) ? 0.55 : 1 }}>
                {busyId === p.id ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>{k.markDelivered}</Text>}
              </TouchableOpacity>
              <Text style={{ color: "#4ade9c", fontSize: 11, textAlign: "center", marginTop: 8 }}>+C${Math.round((p.driver_payout_cents ?? 0) / 100)} {k.released}</Text>
            </>)}
          </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
