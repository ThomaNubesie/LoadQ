import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import Svg, { Circle } from "react-native-svg";
import { RidesAPI, type RideOffer } from "../../services/rides";
import { getRegionName } from "../../constants/pricing";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { MapPin, Navigation, X } from "lucide-react-native";

const WINDOW = 60; // offer window (s) — the ring is drawn relative to this.
const R = 52, C = 2 * Math.PI * R;

export default function RideOfferScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const { offer_id } = useLocalSearchParams<{ offer_id?: string }>();

  const [phase, setPhase] = useState<"loading" | "offer" | "accepted" | "empty">("loading");
  const [offer, setOffer] = useState<RideOffer | null>(null);
  const [secs, setSecs] = useState(WINDOW);
  const [busy, setBusy] = useState(false);
  const [acceptedPickup, setAcceptedPickup] = useState<string | null>(null);
  const [acceptedReqId, setAcceptedReqId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const pickCurrent = (list: RideOffer[]): RideOffer | null => {
    const live = list.filter((o) => new Date(o.expires_at).getTime() > Date.now());
    if (!live.length) return null;
    return (offer_id && live.find((o) => o.offer_id === offer_id)) || live[0];
  };

  const load = useCallback(async () => {
    const cur = pickCurrent(await RidesAPI.driverOffers());
    if (!cur) { setOffer(null); setPhase((p) => (p === "accepted" ? p : "empty")); return; }
    setOffer(cur); setPhase("offer");
  }, [offer_id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Live countdown from expires_at; when it hits 0, roll to the next offer.
  useEffect(() => {
    if (phase !== "offer" || !offer) return;
    const compute = () => {
      const left = Math.max(0, Math.round((new Date(offer.expires_at).getTime() - Date.now()) / 1000));
      setSecs(left);
      if (left <= 0) load();
    };
    compute();
    tick.current = setInterval(compute, 1000);
    return () => { if (tick.current) clearInterval(tick.current); };
  }, [phase, offer, load]);

  const respond = async (accept: boolean) => {
    if (!offer || busy) return;
    setBusy(true);
    const r = await RidesAPI.respond(offer.offer_id, accept);
    setBusy(false);
    if (!accept) { load(); return; }
    if (r.accepted) { setAcceptedPickup(offer.pickup_label); setAcceptedReqId(r.request_id ?? offer.request_id); setPhase("accepted"); }
    else { load(); } // taken/expired in the meantime → show the next one
  };

  const navigate = () => {
    const q = encodeURIComponent(acceptedPickup || offer?.pickup_label || "");
    if (!q) return;
    const url = Platform.select({ ios: `http://maps.apple.com/?daddr=${q}`, default: `https://www.google.com/maps/dir/?api=1&destination=${q}` });
    Linking.openURL(url!).catch(() => {});
  };

  const complete = async () => {
    if (!acceptedReqId || completing) return;
    setCompleting(true);
    const { error } = await RidesAPI.completeRide(acceptedReqId);
    setCompleting(false);
    if (error) { close(); return; }
    close();
  };

  function close() { try { router.back(); } catch { router.replace("/(app)/queue" as never); } }

  const dest = (o: RideOffer) => o.dest_region ? getRegionName(o.dest_region) : (o.dest_address || "—");
  const fare = (o: RideOffer) => `$${((o.fare_cents ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}`;
  const isRoute = (o: RideOffer) => o.kind === "route_pickup";

  return (
    <SafeAreaView style={s.container}>
      <TouchableOpacity style={s.close} onPress={close} hitSlop={12}><X size={22} color={Colors.t2} strokeWidth={2} /></TouchableOpacity>

      {phase === "loading" && <View style={s.center}><ActivityIndicator color={Colors.accent} /></View>}

      {phase === "empty" && (
        <View style={s.center}>
          <Text style={s.emptyTitle}>{t.rideNoOffers}</Text>
          <TouchableOpacity style={s.ghostBtn} onPress={close}><Text style={s.ghostBtnTxt}>{t.rideBack}</Text></TouchableOpacity>
        </View>
      )}

      {phase === "offer" && offer && (
        <View style={s.body}>
          <View style={s.topLabel}><View style={s.pulse} /><Text style={s.topLabelTxt}>{t.rideOfferTitle}</Text></View>

          <View style={s.ring}>
            <Svg width={118} height={118} style={{ transform: [{ rotate: "-90deg" }] }}>
              <Circle cx={59} cy={59} r={R} stroke={Colors.border} strokeWidth={8} fill="none" />
              <Circle cx={59} cy={59} r={R} stroke={Colors.accent} strokeWidth={8} fill="none" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(secs, WINDOW) / WINDOW)} />
            </Svg>
            <View style={s.ringNum}><Text style={s.ringBig}>{secs}</Text><Text style={s.ringUnit}>{t.rideSeconds}</Text></View>
          </View>

          <View style={[s.kind, !isRoute(offer) && s.kindOd]}>
            <Text style={[s.kindTxt, !isRoute(offer) && s.kindTxtOd]}>{isRoute(offer) ? `🛣️ ${t.rideKindRoute}` : `⚡ ${t.rideKindOnDemand}`}</Text>
          </View>

          <View style={s.leg}>
            <View style={s.dotCol}><View style={s.dot} /><View style={s.dotLine} /></View>
            <View style={{ flex: 1 }}><Text style={s.legK}>{t.ridePickup}</Text><Text style={s.legV}>{offer.pickup_label || "—"}</Text></View>
            <MapPin size={16} color={Colors.t3} strokeWidth={2} />
          </View>
          <View style={s.leg}>
            <View style={s.dotCol}><View style={[s.dot, s.dot2]} /></View>
            <View style={{ flex: 1 }}><Text style={s.legK}>{t.rideDropAt}</Text><Text style={s.legV}>{dest(offer)}</Text>{!!offer.dest_address && offer.dest_region && <Text style={s.legS}>{offer.dest_address}</Text>}</View>
          </View>

          <View style={s.fareBox}>
            <View><Text style={s.fareL}>{t.rideFare}</Text><Text style={s.fareNote}>{isRoute(offer) ? t.rideFareRouteNote : t.rideFareOnDemandNote}</Text></View>
            <Text style={s.fareV}>{fare(offer)}</Text>
          </View>

          <View style={s.btns}>
            <TouchableOpacity style={[s.btn, s.btnDec]} disabled={busy} onPress={() => respond(false)}><Text style={s.btnDecTxt}>{t.rideDecline}</Text></TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnAcc]} disabled={busy} onPress={() => respond(true)}><Text style={s.btnAccTxt}>{busy ? "…" : t.rideAccept}</Text></TouchableOpacity>
          </View>
          <Text style={s.disc}>{isRoute(offer) ? t.ridePaidNote : t.rideKeepPos}</Text>
        </View>
      )}

      {phase === "accepted" && (
        <View style={s.center}>
          <View style={s.check}><Text style={{ fontSize: 38 }}>✅</Text></View>
          <Text style={s.acceptedTitle}>{t.rideAcceptedTitle}</Text>
          <Text style={s.acceptedSub}>{t("rideAcceptedSub", { addr: acceptedPickup || "" })}</Text>
          <TouchableOpacity style={s.navBtn} onPress={navigate}>
            <Navigation size={16} color={Colors.accentText} strokeWidth={2.4} /><Text style={s.navBtnTxt}>{t.rideNavigate}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.completeBtn} onPress={complete} disabled={completing}>
            <Text style={s.completeBtnTxt}>{completing ? "…" : t.rideComplete}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostBtn} onPress={close}><Text style={s.ghostBtnTxt}>{t.rideDone}</Text></TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg },
  close:       { position: "absolute", top: 52, right: 20, zIndex: 5, padding: 4 },
  center:      { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 8 },
  body:        { flex: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20 },
  topLabel:    { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", marginTop: 6 },
  pulse:       { width: 9, height: 9, borderRadius: 5, backgroundColor: Colors.accent },
  topLabelTxt: { color: Colors.accent, fontWeight: "800", fontSize: 13, letterSpacing: 0.4, textTransform: "uppercase" },
  ring:        { alignSelf: "center", width: 118, height: 118, marginTop: 16, marginBottom: 6, alignItems: "center", justifyContent: "center" },
  ringNum:     { position: "absolute", alignItems: "center" },
  ringBig:     { fontSize: 32, fontWeight: "800", color: Colors.t1, lineHeight: 34 },
  ringUnit:    { fontSize: 10, color: Colors.t3, textTransform: "uppercase", letterSpacing: 1, marginTop: 2 },
  kind:        { alignSelf: "center", backgroundColor: "rgba(255,107,0,0.14)", borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, marginBottom: 14 },
  kindOd:      { backgroundColor: "rgba(47,190,110,0.14)" },
  kindTxt:     { color: Colors.accent, fontWeight: "800", fontSize: 11.5 },
  kindTxtOd:   { color: "#2FBE6E" },
  leg:         { flexDirection: "row", alignItems: "flex-start", gap: 11, paddingVertical: 2, paddingHorizontal: 2 },
  dotCol:      { alignItems: "center", paddingTop: 4 },
  dot:         { width: 11, height: 11, borderRadius: 6, backgroundColor: Colors.accent },
  dot2:        { backgroundColor: "#2FBE6E" },
  dotLine:     { width: 2, height: 22, backgroundColor: Colors.border, marginVertical: 3 },
  legK:        { fontSize: 10.5, color: Colors.t3, textTransform: "uppercase", letterSpacing: 0.5 },
  legV:        { fontSize: 14.5, fontWeight: "700", color: Colors.t1, marginTop: 1 },
  legS:        { fontSize: 12, color: Colors.t2, marginTop: 1 },
  fareBox:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginTop: 14 },
  fareL:       { color: Colors.t2, fontSize: 12.5 },
  fareNote:    { color: Colors.t3, fontSize: 10.5, marginTop: 2 },
  fareV:       { fontSize: 26, fontWeight: "900", color: Colors.t1 },
  btns:        { flexDirection: "row", gap: 11, marginTop: "auto", paddingTop: 14 },
  btn:         { flex: 1, alignItems: "center", borderRadius: 14, paddingVertical: 15 },
  btnDec:      { backgroundColor: "transparent", borderWidth: 1.5, borderColor: Colors.border },
  btnDecTxt:   { color: Colors.t2, fontWeight: "800", fontSize: 16 },
  btnAcc:      { backgroundColor: Colors.accent },
  btnAccTxt:   { color: Colors.accentText, fontWeight: "800", fontSize: 16 },
  disc:        { color: Colors.t3, fontSize: 10.5, textAlign: "center", marginTop: 9 },
  emptyTitle:  { color: Colors.t1, fontSize: 16, fontWeight: "700" },
  check:       { width: 78, height: 78, borderRadius: 39, backgroundColor: "rgba(47,190,110,0.15)", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  acceptedTitle:{ fontSize: 22, fontWeight: "800", color: Colors.t1 },
  acceptedSub: { color: Colors.t2, fontSize: 13.5, textAlign: "center", maxWidth: 240, lineHeight: 19 },
  navBtn:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 24, marginTop: 14 },
  navBtnTxt:   { color: Colors.accentText, fontWeight: "800", fontSize: 15 },
  completeBtn: { marginTop: 12, borderWidth: 1.5, borderColor: "#2FBE6E", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  completeBtnTxt: { color: "#2FBE6E", fontWeight: "800", fontSize: 15 },
  ghostBtn:    { marginTop: 12, paddingVertical: 10, paddingHorizontal: 20 },
  ghostBtnTxt: { color: Colors.t2, fontWeight: "700", fontSize: 14 },
});
