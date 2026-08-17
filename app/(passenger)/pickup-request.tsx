import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { ArrowLeft, Navigation } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import { DESTINATION_CITIES } from "../../constants/pricing";
import { PickupAPI } from "../../services/pickup";
import { PassengersAPI } from "../../services/passengers";
import { tryGetUserLocation } from "../../utils/gpsTimeout";
import AddressAutocomplete from "../../components/AddressAutocomplete";
import { ZonesAPI, ZoneRow } from "../../services/zones";

export default function PickupRequestScreen() {
  const router = useRouter();
  const { t, lang } = useStrings();
  const [address, setAddress] = useState("");
  const [dest, setDest] = useState<string | null>(null);
  const [me, setMe] = useState<{ full_name?: string; phone?: string | null } | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [zoneId, setZoneId] = useState<string | null>(null);

  useEffect(() => { PassengersAPI.getMe().then(p => setMe(p ? { full_name: p.full_name, phone: p.phone } : null)); }, []);
  useEffect(() => { ZonesAPI.list(false).then(setZones).catch(() => {}); }, []);

  async function useMyLocation() {
    setLocating(true);
    try {
      const loc = await tryGetUserLocation(6000);
      if (loc) {
        const [a] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        if (a) setAddress([a.name || a.street, a.city].filter(Boolean).join(", "));
      }
    } catch { /* ignore */ }
    setLocating(false);
  }

  async function getQuote() {
    if (!address.trim() || !dest) { Alert.alert(t("reqPickupTitle"), t("pickupNeedFields")); return; }
    setBusy(true);
    const res = await PickupAPI.quote(address.trim(), dest, me?.full_name, me?.phone, zoneId);
    setBusy(false);
    if ("error" in res) { Alert.alert(t("reqPickupTitle"), res.error); return; }
    router.push({
      pathname: "/(passenger)/pickup-pay" as any,
      params: {
        request_id: res.request_id, pay_ref: res.pay_ref, interac_to: res.interac_to,
        total_cents: String(res.total_cents), reserve_cents: String(res.reserve_cents),
        tax_cents: String(res.tax_cents), dest, address: address.trim(),
      },
    });
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{t("reqPickupTitle")}</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={s.lead}>{t("pickupLead")}</Text>

        <Text style={s.label}>{t("pickupAddrLabel")}</Text>
        <AddressAutocomplete value={address} onChangeText={setAddress} placeholder={t("pickupAddrPh")} accent={Colors.accentP} />
        <TouchableOpacity style={s.locBtn} onPress={useMyLocation} activeOpacity={0.8} disabled={locating}>
          <Navigation size={14} color={Colors.accentP} />
          <Text style={s.locBtnTxt}>{locating ? t("loading") : t("pickupUseLocation")}</Text>
        </TouchableOpacity>

        <Text style={s.label}>{t("pickupDestLabel")}</Text>
        <View style={s.pills}>
          {DESTINATION_CITIES.map(c => (
            <TouchableOpacity key={c.code} style={[s.pill, dest === c.code && s.pillOn]} onPress={() => setDest(c.code)} activeOpacity={0.8}>
              <Text style={[s.pillTxt, dest === c.code && s.pillTxtOn]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.label}>{lang === "fr" ? "Point de chargement (dépôt)" : "Loading zone (drop-off)"}</Text>
        <View style={{ gap: 8 }}>
          {zones.filter(z => !dest || z.region !== dest).map(z => {
            const on = zoneId === z.id;
            return (
              <TouchableOpacity key={z.id} onPress={() => setZoneId(z.id)} activeOpacity={0.85} style={[s.zoneRow, on && s.zoneRowOn]}>
                <View style={{ flex: 1 }}><Text style={s.zoneName}>{z.name}</Text>{!!z.address && <Text style={s.zoneSub} numberOfLines={1}>{z.address}</Text>}</View>
                <View style={[s.radio, on && s.radioOn]} />
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={s.note}><Text style={s.noteTxt}>{t("pickupFeeNote")}</Text></View>

        <TouchableOpacity style={[s.cta, busy && { opacity: 0.6 }]} onPress={getQuote} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color={Colors.accentPText} /> : <Text style={s.ctaTxt}>{t("pickupGetQuote")}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  title: { color: Colors.t1, fontSize: 18, fontWeight: "800" },
  lead: { color: Colors.t2, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  label: { color: Colors.t2, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 7 },
  field: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 13 },
  input: { flex: 1, color: Colors.t1, fontSize: 15, paddingVertical: 13 },
  locBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 9, paddingVertical: 4 },
  locBtnTxt: { color: Colors.accentP, fontWeight: "800", fontSize: 12.5 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 15, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: Colors.border },
  pillOn: { backgroundColor: Colors.accentP, borderColor: Colors.accentP },
  pillTxt: { color: Colors.t2, fontWeight: "700", fontSize: 13 },
  pillTxtOn: { color: Colors.accentPText },
  note: { backgroundColor: Colors.card, borderRadius: 12, padding: 12, marginTop: 18 },
  noteTxt: { color: Colors.t2, fontSize: 12, lineHeight: 18 },
  cta: { backgroundColor: Colors.accentP, borderRadius: 13, alignItems: "center", paddingVertical: 15, marginTop: 20 },
  ctaTxt: { color: Colors.accentPText, fontWeight: "900", fontSize: 16 },
  zoneRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12 },
  zoneRowOn: { borderColor: Colors.accentP, borderWidth: 2 },
  zoneName: { color: Colors.t1, fontWeight: "800", fontSize: 13.5 },
  zoneSub: { color: Colors.t3, fontSize: 11, marginTop: 2 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: Colors.border },
  radioOn: { borderColor: Colors.accentP, borderWidth: 6 },
});
