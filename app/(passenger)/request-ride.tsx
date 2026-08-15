import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { useStripe, initStripe } from "@stripe/stripe-react-native";
import { RidesAPI, RIDE_TERMINAL, type MyRideRequest } from "../../services/rides";
import { DESTINATION_CITIES, getRegionName } from "../../constants/pricing";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { ArrowLeft, MapPin, Navigation, Phone, MessageCircle } from "lucide-react-native";

const INTERAC_TO = "shaloderick@gmail.com"; // LoadQ Interac address (matches dispatch fallback).

type Coords = { label: string; lat: number; lng: number };

export default function RequestRideScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [phase, setPhase] = useState<"loading" | "form" | "active">("loading");
  const [kind, setKind] = useState<"route_pickup" | "on_demand">("route_pickup");
  const [pay, setPay] = useState<"interac" | "cash" | "card">("interac");
  const [dest, setDest] = useState<string | null>(null);
  const [pickup, setPickup] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [req, setReq] = useState<MyRideRequest | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  // On focus: if there's already an active request, jump straight to its status.
  const refresh = useCallback(async () => {
    const active = await RidesAPI.activeRequest();
    if (active) { setReq(active); setPhase("active"); }
    else { setReq(null); setPhase((p) => (p === "loading" ? "form" : p === "active" ? "form" : p)); }
  }, []);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // Poll status while a request is active.
  useEffect(() => {
    if (phase !== "active") { if (poll.current) clearInterval(poll.current); return; }
    poll.current = setInterval(async () => {
      const active = await RidesAPI.activeRequest();
      if (active) setReq(active); else { setPhase("form"); setReq(null); }
    }, 5000);
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [phase]);

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") { Alert.alert(t.reqRideTitle, t.reqNeedLocation); setLocating(false); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      let label = t.reqUseLocation;
      try {
        const g = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        const a = g[0];
        if (a) label = [a.name || a.street, a.city].filter(Boolean).join(", ") || label;
      } catch { /* keep default label */ }
      setPickup({ label, lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch { Alert.alert(t.reqRideTitle, t.reqNeedLocation); }
    setLocating(false);
  };

  const submit = async () => {
    if (!dest) { Alert.alert(t.reqRideTitle, t.reqNeedDest); return; }
    if (!pickup) { Alert.alert(t.reqRideTitle, t.reqNeedLocation); return; }
    const method = kind === "route_pickup" ? "interac" : pay;
    setBusy(true);
    const c = await RidesAPI.createRequest({
      kind, origin_address: pickup.label, origin_lat: pickup.lat, origin_lng: pickup.lng,
      dest_region: dest, payment_method: method,
    });
    if (c.error || !c.id) { setBusy(false); Alert.alert(t.reqRideTitle, c.error || "Error"); return; }
    if (kind === "route_pickup") {
      const q = await RidesAPI.quote(c.id);
      if (!q.ok) { setBusy(false); Alert.alert(t.reqRideTitle, q.error || "Quote failed"); return; }
    } else {
      // On-demand: depart from the nearest loading zone, then dispatch (which
      // prices the ride and, for card/Interac, returns awaiting_payment first).
      const z = await RidesAPI.nearestZone(pickup.lat, pickup.lng);
      if (!z?.id) { setBusy(false); Alert.alert(t.reqRideTitle, t.reqNoZone); return; }
      await RidesAPI.setDeparture(c.id, z.id);
      const d = await RidesAPI.dispatch(c.id);
      if (!d.ok) { setBusy(false); Alert.alert(t.reqRideTitle, d.error || "Dispatch failed"); return; }

      if (method === "card") {
        // Pre-authorize the fare (manual capture = held, not taken) via PaymentSheet.
        const a = await RidesAPI.authorizeCard(c.id);
        if (a.error || !a.client_secret) { setBusy(false); Alert.alert(t.reqRideTitle, a.error || "Card setup failed"); return; }
        // Initialize Stripe with the publishable key returned by the backend
        // (from the STRIPE_PUBLISHABLE_KEY secret) — no key baked into the build.
        if (a.publishable_key) { try { await initStripe({ publishableKey: a.publishable_key }); } catch { /* provider already set */ } }
        const init = await initPaymentSheet({
          merchantDisplayName: "LoadQ",
          paymentIntentClientSecret: a.client_secret,
          customerId: a.customer, customerEphemeralKeySecret: a.ephemeral_key,
          allowsDelayedPaymentMethods: false,
        });
        if (init.error) { setBusy(false); Alert.alert(t.reqRideTitle, init.error.message); return; }
        const present = await presentPaymentSheet();
        if (present.error) { setBusy(false); return; } // user cancelled / declined — nothing held
        await RidesAPI.confirmCard(c.id);   // verify hold server-side → paid
        await RidesAPI.dispatch(c.id);      // now offer a driver
      }
    }
    setBusy(false);
    await refresh();
  };

  const cancel = async () => {
    if (!req) return;
    Alert.alert(t.reqRideTitle, t.reqCancelConfirm, [
      { text: t.rideBack, style: "cancel" },
      { text: t.reqCancelRide, style: "destructive", onPress: async () => { await RidesAPI.cancelRequest(req.id); setPhase("form"); setReq(null); } },
    ]);
  };

  const fare = (r: MyRideRequest) => `$${((r.fare_cents ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}`;
  const destName = (r: MyRideRequest) => r.dest_region ? getRegionName(r.dest_region) : (r.dest_address || "—");

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={20} color={Colors.t2} strokeWidth={2} /></TouchableOpacity>
        <Text style={s.title}>{t.reqRideTitle}</Text>
        <View style={{ width: 20 }} />
      </View>

      {phase === "loading" && <View style={s.center}><ActivityIndicator color={Colors.accentP} /></View>}

      {phase === "form" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          <Text style={s.lbl}>{t.reqRideType}</Text>
          <View style={s.seg}>
            <TouchableOpacity style={[s.segBtn, kind === "route_pickup" && s.segOn]} onPress={() => setKind("route_pickup")}>
              <Text style={[s.segTxt, kind === "route_pickup" && s.segTxtOn]}>🛣️ {t.reqRoutePickup}</Text>
              <Text style={[s.segSub, kind === "route_pickup" && s.segSubOn]}>{t.reqRoutePickupSub}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.segBtn, kind === "on_demand" && s.segOn]} onPress={() => setKind("on_demand")}>
              <Text style={[s.segTxt, kind === "on_demand" && s.segTxtOn]}>⚡ {t.reqOnDemand}</Text>
              <Text style={[s.segSub, kind === "on_demand" && s.segSubOn]}>{t.reqOnDemandSub}</Text>
            </TouchableOpacity>
          </View>

          <Text style={s.lbl}>{t.reqPickup}</Text>
          <TouchableOpacity style={s.field} onPress={useMyLocation} activeOpacity={0.85}>
            <MapPin size={17} color={Colors.accentP} strokeWidth={2} />
            <Text style={[s.fieldTxt, !pickup && s.fieldPh]} numberOfLines={1}>{pickup ? pickup.label : t.reqUseLocation}</Text>
            {locating ? <ActivityIndicator color={Colors.accentP} /> : <Text style={s.fieldAction}>{pickup ? t.reqUseLocation : "→"}</Text>}
          </TouchableOpacity>

          <Text style={s.lbl}>{t.reqDestination}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
            {DESTINATION_CITIES.map((c) => (
              <TouchableOpacity key={c.code} style={[s.chip, dest === c.code && s.chipOn]} onPress={() => setDest(c.code)}>
                <Text style={[s.chipTxt, dest === c.code && s.chipTxtOn]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={s.lbl}>{t.reqPayment}</Text>
          <View style={s.chip2Row}>
            <TouchableOpacity style={[s.chip2, pay === "interac" && s.chip2On]} onPress={() => setPay("interac")}>
              <Text style={pay === "interac" ? s.chip2TxtOn : s.chip2Txt}>{t.reqInterac}</Text>
            </TouchableOpacity>
            {kind === "on_demand" && (
              <TouchableOpacity style={[s.chip2, pay === "card" && s.chip2On]} onPress={() => setPay("card")}>
                <Text style={pay === "card" ? s.chip2TxtOn : s.chip2Txt}>{t.reqCard}</Text>
              </TouchableOpacity>
            )}
            {kind === "on_demand" && (
              <TouchableOpacity style={[s.chip2, pay === "cash" && s.chip2On]} onPress={() => setPay("cash")}>
                <Text style={pay === "cash" ? s.chip2TxtOn : s.chip2Txt}>{t.reqCash}</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity style={[s.cta, busy && s.ctaOff]} onPress={submit} disabled={busy}>
            <Text style={s.ctaTxt}>{busy ? "…" : t.reqGetPrice}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {phase === "active" && req && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          {req.driver_id ? (
            // Driver matched
            <>
              <View style={s.pillWrap}><Text style={s.pillGreen}>✓ {t.reqDriverMatched}</Text></View>
              <View style={s.drv}>
                <Text style={s.drvName}>{req.driver_name || t.reqDriverMatched}</Text>
                <Text style={s.drvCar}>{[req.vehicle_make, req.vehicle_model, req.vehicle_color].filter(Boolean).join(" · ")}{req.vehicle_seats ? ` · ${req.vehicle_seats}` : ""}</Text>
                {!!req.vehicle_plate && <Text style={s.plate}>{req.vehicle_plate}</Text>}
                <View style={s.drvBtns}>
                  {!!req.driver_phone && <TouchableOpacity style={[s.db, s.dbCall]} onPress={() => Linking.openURL(`tel:${req.driver_phone}`)}><Phone size={15} color={Colors.accentPText} /><Text style={s.dbCallTxt}>{t.reqCall}</Text></TouchableOpacity>}
                  <TouchableOpacity style={[s.db, s.dbMsg]} onPress={() => router.push({ pathname: "/(passenger)/thread", params: { id: req.driver_id, name: req.driver_name || "", phone: req.driver_phone || "" } } as any)}><MessageCircle size={15} color={Colors.t1} /><Text style={s.dbMsgTxt}>{t.reqMessage}</Text></TouchableOpacity>
                </View>
              </View>
            </>
          ) : req.payment_method === "interac" && req.payment_status !== "paid" ? (
            // Awaiting payment — show fare + Interac reference
            <>
              <Text style={s.priceBig}>{fare(req)}</Text>
              <Text style={s.priceSub}>{t.reqAwaitingPay}</Text>
              <View style={s.interac}>
                <Text style={s.interacTxt}>{t.reqPayInstruc}</Text>
                <View style={s.refBox}><Text style={s.refTxt}>{req.pay_ref || "LQ-…"}</Text></View>
                <Text style={s.interacTo}>{t.reqTo} <Text style={{ color: Colors.accentP, fontWeight: "800" }}>{INTERAC_TO}</Text></Text>
              </View>
            </>
          ) : (
            // Paid, searching for a driver
            <View style={s.center}>
              <ActivityIndicator size="large" color={Colors.accentP} />
              <Text style={s.finding}>{t.reqFinding}</Text>
            </View>
          )}

          <View style={s.legs}>
            <View style={s.legRow}><View style={s.legDot} /><View><Text style={s.legK}>{t.reqPickingUp}</Text><Text style={s.legV}>{req.pickup_label || req.origin_address || "—"}</Text></View></View>
            <View style={s.legRow}><View style={[s.legDot, s.legDot2]} /><View><Text style={s.legK}>{t.reqHeadingTo}</Text><Text style={s.legV}>{destName(req)}</Text></View></View>
          </View>

          <TouchableOpacity style={s.cancel} onPress={cancel}><Text style={s.cancelTxt}>{t.reqCancelRide}</Text></TouchableOpacity>
          {req.pay_ref && <Text style={s.payLine}>{fare(req)} · {req.pay_ref}</Text>}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.bg },
  header:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  title:      { fontSize: 17, fontWeight: "700", color: Colors.t1 },
  center:     { alignItems: "center", justifyContent: "center", padding: 30, gap: 12 },
  lbl:        { fontSize: 11, color: Colors.t3, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  seg:        { flexDirection: "row", gap: 8 },
  segBtn:     { flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 6, alignItems: "center" },
  segOn:      { backgroundColor: Colors.accentP, borderColor: Colors.accentP },
  segDisabled:{ opacity: 0.45 },
  segTxt:     { fontWeight: "800", fontSize: 12.5, color: Colors.t2 },
  segTxtOn:   { color: Colors.accentPText },
  segSub:     { fontSize: 9.5, color: Colors.t3, marginTop: 2 },
  segSubOn:   { color: Colors.accentPText, opacity: 0.8 },
  field:      { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 13 },
  fieldTxt:   { color: Colors.t1, fontSize: 14, flex: 1 },
  fieldPh:    { color: Colors.t3 },
  fieldAction:{ color: Colors.accentP, fontWeight: "800", fontSize: 12 },
  chip:       { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  chipOn:     { borderColor: Colors.accentP, backgroundColor: "rgba(255,107,0,0.12)" },
  chipTxt:    { color: Colors.t2, fontWeight: "700", fontSize: 13 },
  chipTxtOn:  { color: Colors.accentP },
  chip2Row:   { flexDirection: "row", gap: 8 },
  chip2:      { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  chip2On:    { borderColor: Colors.accentP },
  chip2Txt:   { color: Colors.t2, fontWeight: "700", fontSize: 13 },
  chip2TxtOn: { color: Colors.accentP, fontWeight: "700", fontSize: 13 },
  cta:        { marginTop: 24, backgroundColor: Colors.accentP, borderRadius: 14, padding: 16, alignItems: "center" },
  ctaOff:     { opacity: 0.5 },
  ctaTxt:     { color: Colors.accentPText, fontWeight: "800", fontSize: 16 },
  priceBig:   { fontSize: 48, fontWeight: "900", color: Colors.t1, textAlign: "center", marginTop: 8, letterSpacing: -1 },
  priceSub:   { color: Colors.t3, fontSize: 12.5, textAlign: "center", marginTop: 2 },
  interac:    { backgroundColor: "rgba(255,107,0,0.10)", borderWidth: 1, borderColor: "rgba(255,107,0,0.4)", borderRadius: 14, padding: 14, marginTop: 16 },
  interacTxt: { color: Colors.t2, fontSize: 12.5, lineHeight: 18 },
  refBox:     { alignItems: "center", backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.accentP, borderStyle: "dashed", borderRadius: 10, paddingVertical: 12, marginVertical: 10 },
  refTxt:     { fontSize: 22, fontWeight: "900", letterSpacing: 2, color: Colors.accentP },
  interacTo:  { textAlign: "center", color: Colors.t1, fontSize: 12.5 },
  finding:    { color: Colors.t1, fontSize: 15, fontWeight: "700" },
  pillWrap:   { alignItems: "center", marginVertical: 6 },
  pillGreen:  { backgroundColor: "rgba(47,190,110,0.15)", color: "#2FBE6E", fontWeight: "800", fontSize: 11.5, paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999, overflow: "hidden" },
  drv:        { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, marginTop: 8 },
  drvName:    { fontSize: 17, fontWeight: "800", color: Colors.t1 },
  drvCar:     { color: Colors.t2, fontSize: 13, marginTop: 2 },
  plate:      { alignSelf: "flex-start", marginTop: 8, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, borderRadius: 7, paddingVertical: 5, paddingHorizontal: 12, fontWeight: "800", letterSpacing: 1, color: Colors.t1, overflow: "hidden" },
  drvBtns:    { flexDirection: "row", gap: 9, marginTop: 14 },
  db:         { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 12, paddingVertical: 12 },
  dbCall:     { backgroundColor: Colors.accentP },
  dbCallTxt:  { color: Colors.accentPText, fontWeight: "800", fontSize: 13 },
  dbMsg:      { backgroundColor: Colors.cardAlt },
  dbMsgTxt:   { color: Colors.t1, fontWeight: "800", fontSize: 13 },
  legs:       { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginTop: 16 },
  legRow:     { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 3 },
  legDot:     { width: 9, height: 9, borderRadius: 5, backgroundColor: Colors.accentP, marginTop: 5 },
  legDot2:    { backgroundColor: "#2FBE6E" },
  legK:       { fontSize: 10, color: Colors.t3, textTransform: "uppercase", letterSpacing: 0.5 },
  legV:       { fontSize: 14, fontWeight: "700", color: Colors.t1, marginTop: 1 },
  cancel:     { marginTop: 18, alignItems: "center", paddingVertical: 12 },
  cancelTxt:  { color: "#F5566B", fontWeight: "700", fontSize: 14 },
  payLine:    { textAlign: "center", color: Colors.t3, fontSize: 11, marginTop: 2 },
});
