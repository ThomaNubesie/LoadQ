import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Linking, KeyboardAvoidingView, Platform, Modal, Pressable } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { RidesAPI, RIDE_TERMINAL, type MyRideRequest } from "../../services/rides";
import { DESTINATION_CITIES, getRegionName } from "../../constants/pricing";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { ArrowLeft, Navigation, Phone, MessageCircle, Route, Home, Info, X, Check, Clock, DollarSign } from "lucide-react-native";
import PickupPinMap from "../../components/PickupPinMap";
import AddressAutocomplete from "../../components/AddressAutocomplete";
import DriverTrackMap from "../../components/DriverTrackMap";

// Rough ETA (min) driver→pickup: straight-line distance at ~30 km/h city speed.
function etaMinutes(dLat: number, dLng: number, pLat: number, pLng: number): number {
  const R = 6371, rad = Math.PI / 180;
  const dLa = (pLat - dLat) * rad, dLo = (pLng - dLng) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(dLat * rad) * Math.cos(pLat * rad) * Math.sin(dLo / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(h));
  return Math.max(1, Math.round((km / 30) * 60));
}

const INTERAC_TO = "shaloderick@gmail.com"; // LoadQ Interac address (matches dispatch fallback).

export default function RequestRideScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<"loading" | "form" | "active">("loading");
  const [kind, setKind] = useState<"route_pickup" | "on_demand">("route_pickup");
  const [dest, setDest] = useState<string | null>(null);
  const [addr, setAddr] = useState("");                                   // typed/selected pickup address
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState<"route_pickup" | "on_demand" | null>(null);
  const [req, setReq] = useState<MyRideRequest | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const seeded = useRef(false);

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

  // Fill the pickup address + coords from the device GPS (right-side location button).
  const useMyLocation = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") { Alert.alert(t.reqRideTitle, t.reqNeedLocation); setLocating(false); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      try {
        const g = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        const a = g[0];
        const label = a ? [a.name || a.street, a.city].filter(Boolean).join(", ") : "";
        if (label) setAddr(label);
      } catch { /* keep coords, no label */ }
    } catch { Alert.alert(t.reqRideTitle, t.reqNeedLocation); }
    setLocating(false);
  };

  // Seed the map from GPS once when the form opens (silent — only if already granted).
  useEffect(() => {
    if (phase !== "form" || seeded.current) return;
    seeded.current = true;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        const g = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        const a = g[0];
        setAddr((prev) => prev || (a ? [a.name || a.street, a.city].filter(Boolean).join(", ") : prev));
      } catch { /* no seed */ }
    })();
  }, [phase]);   // eslint-disable-line react-hooks/exhaustive-deps

  // When a suggestion is picked, resolve its coords so the map re-centres.
  const onPickAddr = async (desc: string) => {
    try { const g = await Location.geocodeAsync(desc); if (g[0]) setCoords({ lat: g[0].latitude, lng: g[0].longitude }); } catch { /* resolved on submit */ }
  };

  // Dragging the pin sets the exact pickup point; refresh the address label to match.
  const onPinMove = async (la: number, ln: number) => {
    setCoords({ lat: la, lng: ln });
    try {
      const g = await Location.reverseGeocodeAsync({ latitude: la, longitude: ln });
      const a = g[0];
      const label = a ? [a.name || a.street, a.city].filter(Boolean).join(", ") : "";
      if (label) setAddr(label);
    } catch { /* keep coords */ }
  };

  const submit = async () => {
    if (!dest) { Alert.alert(t.reqRideTitle, t.reqNeedDest); return; }
    if (!addr.trim()) { Alert.alert(t.reqRideTitle, t.reqNeedLocation); return; }
    setBusy(true);
    // Resolve coordinates for the typed/selected address if we don't already have them.
    let c = coords;
    if (!c) {
      try { const g = await Location.geocodeAsync(addr.trim()); if (g[0]) c = { lat: g[0].latitude, lng: g[0].longitude }; } catch { /* */ }
    }
    if (!c) { setBusy(false); Alert.alert(t.reqRideTitle, t.reqBadAddress); return; }

    // Both ride types pay by Interac.
    const created = await RidesAPI.createRequest({
      kind, origin_address: addr.trim(), origin_lat: c.lat, origin_lng: c.lng,
      dest_region: dest, payment_method: "interac",
    });
    if (created.error || !created.id) { setBusy(false); Alert.alert(t.reqRideTitle, created.error || "Error"); return; }

    if (kind === "route_pickup") {
      const q = await RidesAPI.quote(created.id);
      // No live driver heading to the destination → don't charge; drop the request.
      if (!q.ok || q.error === "no_drivers") {
        setBusy(false);
        await RidesAPI.cancelRequest(created.id);
        Alert.alert(t.reqRideTitle, q.error === "no_drivers" ? t.reqNoDrivers : (q.error || t.reqNoDrivers));
        return;
      }
    } else {
      // Home pickup: depart from the nearest loading zone, then dispatch.
      const z = await RidesAPI.nearestZone(c.lat, c.lng);
      if (!z?.id) { setBusy(false); await RidesAPI.cancelRequest(created.id); Alert.alert(t.reqRideTitle, t.reqNoZone); return; }
      await RidesAPI.setDeparture(created.id, z.id);
      const d = await RidesAPI.dispatch(created.id);
      if (!d.ok) { setBusy(false); await RidesAPI.cancelRequest(created.id); Alert.alert(t.reqRideTitle, d.error || "Dispatch failed"); return; }
      // No eligible driver on duty → drop the request; nothing is charged.
      if (d.data?.status === "no_driver") {
        setBusy(false);
        await RidesAPI.cancelRequest(created.id);
        Alert.alert(t.reqRideTitle, t.reqNoDrivers);
        return;
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
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={insets.top + 8}>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Map hero — draggable pin for a pinpoint pickup */}
            {coords
              ? (
                <View>
                  <PickupPinMap lat={coords.lat} lng={coords.lng} onMove={onPinMove} height={190} />
                  <Text style={s.pinHint}>{t.reqDragPin}</Text>
                </View>
              )
              : <View style={s.mapPlaceholder}><Navigation size={22} color={Colors.t3} /><Text style={s.mapPlaceholderTxt}>{t.reqMapHint}</Text></View>}

            <View style={s.sheet}>
              {/* Ride type — segmented pill */}
              <View style={s.segC}>
                <TouchableOpacity style={[s.segCb, kind === "route_pickup" && s.segCbOn]} onPress={() => setKind("route_pickup")} activeOpacity={0.85}>
                  <Route size={17} color={kind === "route_pickup" ? Colors.accentPText : Colors.t2} />
                  <Text style={[s.segCbTxt, kind === "route_pickup" && s.segCbTxtOn]}>{t.reqRoutePickup}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.segCb, kind === "on_demand" && s.segCbOn]} onPress={() => setKind("on_demand")} activeOpacity={0.85}>
                  <Home size={17} color={kind === "on_demand" ? Colors.accentPText : Colors.t2} />
                  <Text style={[s.segCbTxt, kind === "on_demand" && s.segCbTxtOn]}>{t.reqHomePickup}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={s.infoHint} onPress={() => setInfoOpen(kind)} activeOpacity={0.7}>
                <Info size={13} color={Colors.accentP} />
                <Text style={s.infoHintTxt}>{kind === "route_pickup" ? t.reqWhatRoute : t.reqWhatHome}</Text>
              </TouchableOpacity>

              {/* Pickup — address on the left, location icon on the right */}
              <Text style={s.lbl}>{t.reqPickup}</Text>
              <AddressAutocomplete
                value={addr}
                onChangeText={(x) => { setAddr(x); setCoords(null); }}
                onPick={onPickAddr}
                placeholder={t.reqPickupAddrPh}
                accent={Colors.accentP}
                leftIcon={false}
                rightSlot={
                  <TouchableOpacity onPress={useMyLocation} hitSlop={8} style={s.locBtn} activeOpacity={0.8}>
                    {locating ? <ActivityIndicator size="small" color={Colors.accentP} /> : <Navigation size={18} color={Colors.accentP} />}
                  </TouchableOpacity>
                }
              />

              {/* Destination */}
              <Text style={s.lbl}>{t.reqDestination}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }} keyboardShouldPersistTaps="handled">
                {DESTINATION_CITIES.map((c) => (
                  <TouchableOpacity key={c.code} style={[s.chip, dest === c.code && s.chipOn]} onPress={() => setDest(c.code)}>
                    <Text style={[s.chipTxt, dest === c.code && s.chipTxtOn]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Payment — Interac only, centred */}
              <Text style={s.lbl}>{t.reqPayment}</Text>
              <View style={s.payWrap}>
                <View style={s.payPill}><Navigation size={14} color={Colors.accentP} /><Text style={s.payPillTxt}>{t.reqInterac}</Text></View>
              </View>

              <TouchableOpacity style={[s.cta, busy && s.ctaOff]} onPress={submit} disabled={busy}>
                <Text style={s.ctaTxt}>{busy ? "…" : t.reqGetPrice}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Ride-type "what is this?" popup */}
      <Modal visible={!!infoOpen} transparent animationType="slide" onRequestClose={() => setInfoOpen(null)}>
        <Pressable style={s.dim} onPress={() => setInfoOpen(null)}>
          <Pressable style={s.infoSheet} onPress={() => {}}>
            <View style={s.grab} />
            {infoOpen === "route_pickup" ? (
              <>
                <View style={s.infoTitle}><Route size={24} color={Colors.accentP} /><Text style={s.infoTitleTxt}>{t.reqRoutePickup}</Text></View>
                <Text style={s.infoBody}>{t.reqInfoRouteBody}</Text>
                <InfoFeat icon={<Navigation size={16} color={Colors.accentP} />} txt={t.reqInfoRouteF1} />
                <InfoFeat icon={<DollarSign size={16} color={Colors.accentP} />} txt={t.reqInfoRouteF2} />
                <InfoFeat icon={<Check size={16} color={Colors.accentP} />} txt={t.reqInfoNoCharge} />
              </>
            ) : (
              <>
                <View style={s.infoTitle}><Home size={24} color={Colors.accentP} /><Text style={s.infoTitleTxt}>{t.reqHomePickup}</Text></View>
                <Text style={s.infoBody}>{t.reqInfoHomeBody}</Text>
                <InfoFeat icon={<Clock size={16} color={Colors.accentP} />} txt={t.reqInfoHomeF1} />
                <InfoFeat icon={<DollarSign size={16} color={Colors.accentP} />} txt={t.reqInfoHomeF2} />
                <InfoFeat icon={<Check size={16} color={Colors.accentP} />} txt={t.reqInfoNoCharge} />
              </>
            )}
            <TouchableOpacity style={s.infoBtn} onPress={() => setInfoOpen(null)} activeOpacity={0.85}><Text style={s.infoBtnTxt}>{t.reqGotIt}</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {phase === "active" && req && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          {req.driver_id ? (
            // Driver matched
            <>
              {["assigned", "en_route"].includes(req.status) && req.driver_lat != null && req.driver_lng != null && req.pickup_lat != null && req.pickup_lng != null && (
                <>
                  <DriverTrackMap driver={{ lat: req.driver_lat, lng: req.driver_lng }} pickup={{ lat: req.pickup_lat, lng: req.pickup_lng }} height={220} />
                  <View style={s.etaWrap}>
                    <View style={s.etaPill}>
                      <Navigation size={14} color={Colors.accentP} />
                      <Text style={s.etaTxt}>{t("reqDriverAway", { name: req.driver_name || t.reqDriver, n: etaMinutes(req.driver_lat, req.driver_lng, req.pickup_lat, req.pickup_lng) })}</Text>
                    </View>
                  </View>
                </>
              )}
              <View style={s.pillWrap}><Text style={s.pillGreen}>
                {req.status === "picked_up" ? `● ${t.reqInRideTo} ${destName(req)}`
                  : (["assigned", "en_route"].includes(req.status) ? `● ${t.reqOnWayToYou}`
                    : `✓ ${t.reqDriverMatched}`)}
              </Text></View>
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

function InfoFeat({ icon, txt }: { icon: React.ReactNode; txt: string }) {
  return <View style={s.infoFeat}><View style={{ marginTop: 1 }}>{icon}</View><Text style={s.infoFeatTxt}>{txt}</Text></View>;
}

const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.bg },
  mapPlaceholder: { height: 190, backgroundColor: Colors.card, alignItems: "center", justifyContent: "center", gap: 8 },
  mapPlaceholderTxt: { color: Colors.t3, fontSize: 12 },
  pinHint:    { position: "absolute", bottom: 10, alignSelf: "center", backgroundColor: "rgba(12,13,16,0.85)", color: Colors.accentP, fontSize: 11, fontWeight: "700", paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, overflow: "hidden" },
  sheet:      { backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, marginTop: -20, paddingHorizontal: 16, paddingTop: 16 },
  segC:       { flexDirection: "row", backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 13, padding: 4, gap: 4 },
  segCb:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 10 },
  segCbOn:    { backgroundColor: Colors.accentP },
  segCbTxt:   { color: Colors.t2, fontWeight: "800", fontSize: 13 },
  segCbTxtOn: { color: Colors.accentPText },
  infoHint:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9 },
  infoHintTxt:{ color: Colors.accentP, fontWeight: "700", fontSize: 12 },
  locBtn:     { width: 40, height: 40, borderRadius: 9, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  payWrap:    { alignItems: "center" },
  payPill:    { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: Colors.accentP, backgroundColor: "rgba(234,106,30,0.08)", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18 },
  payPillTxt: { color: Colors.accentP, fontWeight: "800", fontSize: 13.5 },
  dim:        { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  infoSheet:  { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: Colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: Colors.border, padding: 18, paddingBottom: 26 },
  grab:       { width: 36, height: 4, borderRadius: 3, backgroundColor: "#333", alignSelf: "center", marginBottom: 14 },
  infoTitle:  { flexDirection: "row", alignItems: "center", gap: 10 },
  infoTitleTxt:{ fontSize: 18, fontWeight: "800", color: Colors.t1 },
  infoBody:   { color: Colors.t2, fontSize: 13, lineHeight: 20, marginTop: 12 },
  infoFeat:   { flexDirection: "row", gap: 10, marginTop: 12 },
  infoFeatTxt:{ flex: 1, color: Colors.t2, fontSize: 12.5, lineHeight: 18 },
  infoBtn:    { backgroundColor: Colors.accentP, borderRadius: 12, alignItems: "center", paddingVertical: 14, marginTop: 18 },
  infoBtnTxt: { color: Colors.accentPText, fontWeight: "900", fontSize: 15 },
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
  etaWrap:    { alignItems: "center", marginTop: -18, marginBottom: 4 },
  etaPill:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(12,13,16,0.92)", borderWidth: 1, borderColor: Colors.accentP, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 15 },
  etaTxt:     { color: Colors.accentP, fontWeight: "800", fontSize: 12.5 },
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
