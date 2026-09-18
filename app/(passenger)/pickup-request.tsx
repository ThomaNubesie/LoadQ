import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { ArrowLeft, Navigation } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import { DESTINATION_CITIES, getRegionName } from "../../constants/pricing";
import VanIcon from "../../components/VanIcon";
import { PickupAPI } from "../../services/pickup";
import { PassengersAPI } from "../../services/passengers";
import { tryGetUserLocation } from "../../utils/gpsTimeout";
import AddressAutocomplete from "../../components/AddressAutocomplete";
import { ZonesAPI, ZoneRow } from "../../services/zones";

export default function PickupRequestScreen() {
  const router = useRouter();
  const { t, lang } = useStrings();
  const [address, setAddress] = useState("");
  const [addrPostal, setAddrPostal] = useState<string | null>(null);
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
        if (a) {
          setAddress([a.name || a.street, a.city, a.region, a.postalCode].filter(Boolean).join(", "));
          setAddrPostal(a.postalCode ?? null);
        }
      }
    } catch { /* ignore */ }
    setLocating(false);
  }

  async function getQuote() {
    if (!address.trim() || !dest) { Alert.alert(t("reqPickupTitle"), t("pickupNeedFields")); return; }
    if (!addrPostal) { Alert.alert(t("reqPickupTitle"), lang === "fr" ? "Sélectionnez une adresse complète (avec code postal) dans les suggestions ou via « Ma position »." : "Pick a full address (with postal code) from the suggestions or via 'Use my location'."); return; }
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
    <SafeAreaView style={s.screen} edges={["left", "right", "bottom"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{t("reqPickupTitle")}</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={s.lead}>{t("pickupLead")}</Text>

        <Step n={1} h={t("reqWherePickup")} />
        <AddressAutocomplete value={address} onChangeText={(v) => { setAddress(v); setAddrPostal(null); }} onResolved={(d) => setAddrPostal(d.postal_code)} placeholder={t("pickupAddrPh")} accent={Colors.accentP} />
        {!!address.trim() && (addrPostal ? <Text style={s.postalOk}>✓ {lang === "fr" ? "Code postal" : "Postal code"} {addrPostal}</Text> : <Text style={s.postalWarn}>⚠ {lang === "fr" ? "Choisissez une adresse dans les suggestions" : "Pick an address from the suggestions"}</Text>)}
        <TouchableOpacity style={s.locBtn} onPress={useMyLocation} activeOpacity={0.8} disabled={locating}>
          <Navigation size={14} color={Colors.accentP} />
          <Text style={s.locBtnTxt}>{locating ? t("loading") : t("pickupUseLocation")}</Text>
        </TouchableOpacity>

        <Step n={2} h={t("reqWhichCity")} x={t("pickupWhyCity")} />
        <View style={s.pills}>
          {DESTINATION_CITIES.map(c => (
            <TouchableOpacity key={c.code} style={[s.pill, dest === c.code && s.pillOn]} onPress={() => setDest(c.code)} activeOpacity={0.8}>
              <Text style={[s.pillTxt, dest === c.code && s.pillTxtOn]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Step n={3} h={t("pickupWhereDrop")} />
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

        {/* What you are actually buying, drawn. The commonest misunderstanding on this screen is
            that the fee covers the whole journey; it covers the first leg only. */}
        {!!dest && !!zoneId && (
          <View style={s.route}>
            <Text style={s.routeEnd}>{t("pickupRouteYou")}</Text>
            <View style={s.routeDash} />
            <VanIcon size={30} color={Colors.accentWarm} heading="east" />
            <View style={s.routeDash} />
            <Text style={s.routeEnd} numberOfLines={1}>{zones.find(z => z.id === zoneId)?.name ?? ""}</Text>
            <View style={s.routeDash} />
            <Text style={s.routeEndDim} numberOfLines={1}>{getRegionName(dest)}</Text>
          </View>
        )}

        <View style={s.warn}><Text style={s.warnTxt}>{t("pickupFirstLegOnly")}</Text></View>

        <View style={s.note}><Text style={s.noteTxt}>{t("pickupFeeNote")}</Text></View>

        <TouchableOpacity style={[s.cta, busy && { opacity: 0.6 }]} onPress={getQuote} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color={Colors.accentPText} /> : <Text style={s.ctaTxt}>{t("pickupSeePrice")}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// A numbered step. The three fields on this screen are sequential — where you are, where you're
// going, where we drop you — and reading as a numbered list rather than three unrelated labels is
// the whole difference between "form" and "steps".
function Step({ n, h, x }: { n: number; h: string; x?: string }) {
  return (
    <View style={s.step}>
      <View style={s.stepNum}><Text style={s.stepNumTxt}>{n}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.stepH}>{h}</Text>
        {!!x && <Text style={s.stepX}>{x}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  step: { flexDirection: "row", gap: 9, marginTop: 18, marginBottom: 8 },
  stepNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.accentP, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepNumTxt: { color: Colors.accentPText, fontSize: 11, fontWeight: "800" },
  stepH: { color: Colors.t1, fontSize: 14.5, fontWeight: "800", lineHeight: 19 },
  stepX: { color: Colors.t2, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  route: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginTop: 16 },
  routeDash: { flex: 1, height: 1, borderTopWidth: 1.4, borderStyle: "dashed", borderColor: Colors.t3, opacity: 0.6 },
  routeEnd: { color: Colors.t1, fontSize: 10.5, fontWeight: "800", maxWidth: 78 },
  routeEndDim: { color: Colors.t2, fontSize: 10.5, fontWeight: "700", maxWidth: 70 },
  warn: { backgroundColor: "rgba(201,138,0,0.10)", borderLeftWidth: 3, borderLeftColor: Colors.yellow, borderRadius: 9, padding: 11, marginTop: 12 },
  warnTxt: { color: Colors.t1, fontSize: 12, lineHeight: 17, fontWeight: "600" },
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
  postalOk: { color: Colors.green, fontSize: 11, fontWeight: "800", marginTop: 5, marginLeft: 2 },
  postalWarn: { color: Colors.accentWarmText, fontSize: 11, fontWeight: "700", marginTop: 5, marginLeft: 2 },
  zoneRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12 },
  zoneRowOn: { borderColor: Colors.accentP, borderWidth: 2 },
  zoneName: { color: Colors.t1, fontWeight: "800", fontSize: 13.5 },
  zoneSub: { color: Colors.t3, fontSize: 11, marginTop: 2 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: Colors.border },
  radioOn: { borderColor: Colors.accentP, borderWidth: 6 },
});
