import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Alert, Linking, Platform, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Star, MessageCircle, Phone, Navigation, Copy } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { useNow } from "../../hooks/useNow";
import { PassengerBoardAPI, MyTrip, ratingLabel, vehicleLabel } from "../../services/passengerBoard";
import { PassengersAPI } from "../../services/passengers";
import { getRegionName } from "../../constants/pricing";
import PassengerBottomNav from "../../components/PassengerBottomNav";
import SeatSvg from "../../components/SeatSvg";

// Open turn-by-turn directions to the pickup zone (native maps → web fallback).
async function openDirections(dst: string) {
  const q = encodeURIComponent(dst);
  const web = `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  const native = Platform.select({ ios: `http://maps.apple.com/?daddr=${q}&dirflg=d`, android: `google.navigation:q=${q}`, default: web })!;
  try { const ok = await Linking.canOpenURL(native); await Linking.openURL(ok ? native : web); }
  catch { try { await Linking.openURL(web); } catch { /* ignore */ } }
}

function countdown(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function shortName(name?: string): string {
  if (!name) return "";
  const p = name.trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[1][0]}.` : p[0];
}
function initials(name?: string): string {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function MyTripScreen() {
  const router = useRouter();
  const { t } = useStrings();

  const [trip, setTrip]       = useState<MyTrip | null>(PassengerBoardAPI.cachedMyTrip());
  const [me, setMe]           = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(!PassengerBoardAPI.cachedMyTrip());
  const [refreshing, setRefreshing] = useState(false);
  const [seatBusy, setSeatBusy] = useState(false);

  const load = useCallback(async () => { setTrip(await PassengerBoardAPI.myTrip()); }, []);

  async function adjustSeats(delta: number) {
    if (!trip || seatBusy) return;
    const next = trip.seats + delta;
    if (next < 1) return;
    setSeatBusy(true);
    const { error } = await PassengerBoardAPI.updateSeats(trip.trip_id, next);
    setSeatBusy(false);
    if (error) { Alert.alert(t("myTripTitle"), error === "seats_full" ? t("errSeatsFull") : t("errReserve")); return; }
    await load();
  }

  async function copyInterac(v: string) {
    await Clipboard.setStringAsync(v);
    Alert.alert(t("copied"));
  }

  useEffect(() => {
    (async () => {
      const p = await PassengersAPI.getMe();
      if (p) setMe({ id: p.id, name: p.full_name });
      await load();
      setLoading(false);
    })();
  }, [load]);

  // Live updates on the caller's own trips (boarded / departed / expired).
  useEffect(() => {
    if (!me) return;
    const sub = PassengerBoardAPI.subscribeMyTrip(me.id, load);
    return () => { sub.unsubscribe(); };
  }, [me?.id, load]);

  const now = useNow(trip ? 1000 : 30000, !!trip);

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  function confirmCancel() {
    if (!trip) return;
    Alert.alert(t("cancelReservationQ"), undefined, [
      { text: t("navMyTrip"), style: "cancel" },
      { text: t("cancelBtn"), style: "destructive", onPress: async () => { await PassengerBoardAPI.cancel(trip.trip_id); await load(); } },
    ]);
  }

  if (loading) {
    return <SafeAreaView style={s.screen} edges={["top"]}><Text style={s.title}>{t("myTripTitle")}</Text><View style={s.center}><ActivityIndicator color={Colors.accent} /></View><PassengerBottomNav /></SafeAreaView>;
  }

  if (!trip) {
    return (
      <SafeAreaView style={s.screen} edges={["top"]}>
        <Text style={s.title}>{t("myTripTitle")}</Text>
        <View style={s.center}><Text style={s.empty}>{t("noActiveTrip")}</Text><Text style={s.sub}>{t("noActiveTripSub")}</Text>
          <TouchableOpacity style={s.goBoard} onPress={() => router.replace("/(passenger)/board" as any)}><Text style={s.goBoardTxt}>{t("navBoard")}</Text></TouchableOpacity>
        </View>
        <PassengerBottomNav />
      </SafeAreaView>
    );
  }

  const rating  = ratingLabel(trip.rating_avg, trip.rating_avg == null ? 0 : 1); // my_trip omits count
  const boarding = trip.car_status === "loading";
  const boarded  = trip.status === "boarded";
  const vehicle  = vehicleLabel(trip);

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <Text style={s.title}>{t("myTripTitle")}</Text>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>

        {trip.status === "held" && trip.hold_expires_at && (
          <View style={s.holdCard}>
            <Text style={s.holdLbl}>{t("seatsHeldLabel")}</Text>
            <Text style={s.holdTimer}>{countdown(trip.hold_expires_at, now)}</Text>
            <Text style={s.holdSub}>{t("untilBoard")}</Text>
          </View>
        )}

        {/* pickup zone + directions */}
        {(trip.zone_name || trip.zone_address) && (
          <View style={s.pickup}>
            <View style={{ flex: 1 }}>
              <Text style={s.pickupLbl}>{t("pickupZone")}</Text>
              <Text style={s.pickupName} numberOfLines={1}>{trip.zone_name ?? "—"}</Text>
              {!!trip.zone_address && <Text style={s.pickupAddr} numberOfLines={2}>{trip.zone_address}</Text>}
            </View>
            <TouchableOpacity style={s.dirBtn} onPress={() => openDirections(trip.zone_address || trip.zone_name || "")} activeOpacity={0.85}>
              <Navigation size={15} color={Colors.accentText} /><Text style={s.dirBtnTxt}>{t("directions")}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={[s.car, boarding && s.carHot]}>
          <View style={s.carTop}>
            {trip.avatar_url
              ? <Image source={{ uri: trip.avatar_url }} style={s.avatar} />
              : <View style={s.avatar}><Text style={s.avatarTxt}>{initials(trip.driver_name)}</Text></View>}
            <View style={{ flex: 1 }}>
              <View style={s.nameRow}>
                <Text style={s.name} numberOfLines={1}>{trip.driver_name}</Text>
                {!rating.isNew && <View style={s.ratingRow}><Star size={11} color={Colors.yellow} fill={Colors.yellow} /><Text style={s.rating}>{rating.stars}</Text></View>}
              </View>
              {!!vehicle && <Text style={s.vehicle} numberOfLines={1}>{vehicle}{trip.plate ? ` · ${trip.plate}` : ""}</Text>}
            </View>
          </View>

          <View style={s.statusRow}>
            <View style={[s.chip, boarding ? s.chipHot : s.chipWait]}>
              <Text style={[s.chipTxt, boarding ? s.chipTxtHot : s.chipTxtWait]}>
                {boarding ? `● ${t("boardingNow")}` : t("waitingToLoad")}
              </Text>
            </View>
          </View>

          <View style={s.rowSplit}>
            <View><Text style={s.metaLbl}>{t("yourSeats")}</Text><Text style={s.metaVal}>{t("heldN", { n: trip.seats })}</Text></View>
            <View style={{ alignItems: "flex-end" }}><Text style={s.metaLbl}>{getRegionName(trip.destination_region)}</Text><Text style={s.metaVal}>{boarded ? t("tripBoarded") : t("tripHeld")}</Text></View>
          </View>

          <View style={s.seatRow}>
            {Array.from({ length: Math.max(trip.vehicle_seats ?? trip.seats, trip.seats) }).map((_, i) => (
              <SeatSvg key={i} size="mini" filled={i < trip.seats} color={Colors.accent} disabled />
            ))}
          </View>

          {trip.status === "held" && (
            <View style={s.adjustRow}>
              <Text style={s.adjustLbl}>{t("adjustSeats")}</Text>
              <View style={s.stepperCtrl}>
                <TouchableOpacity style={s.stepBtn} disabled={seatBusy || trip.seats <= 1} onPress={() => adjustSeats(-1)} activeOpacity={0.8}><Text style={s.stepBtnTxt}>−</Text></TouchableOpacity>
                <Text style={s.stepVal}>{seatBusy ? "…" : trip.seats}</Text>
                <TouchableOpacity style={s.stepBtn} disabled={seatBusy} onPress={() => adjustSeats(1)} activeOpacity={0.8}><Text style={s.stepBtnTxt}>+</Text></TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* driver Interac — shown once the driver confirms (boarded) */}
        {boarded && (
          <View style={s.interac}>
            <Text style={s.interacLbl}>{t("payDriverInterac")}</Text>
            {(trip.driver_interac_email || trip.driver_interac_phone) ? (
              <>
                {!!trip.driver_interac_email && (
                  <TouchableOpacity style={s.interacRow} onPress={() => copyInterac(trip.driver_interac_email!)} activeOpacity={0.7}>
                    <Text style={s.interacVal}>{trip.driver_interac_email}</Text><Copy size={15} color={Colors.t3} />
                  </TouchableOpacity>
                )}
                {!!trip.driver_interac_phone && (
                  <TouchableOpacity style={s.interacRow} onPress={() => copyInterac(trip.driver_interac_phone!)} activeOpacity={0.7}>
                    <Text style={s.interacVal}>{trip.driver_interac_phone}</Text><Copy size={15} color={Colors.t3} />
                  </TouchableOpacity>
                )}
                {trip.price_paid != null && <Text style={s.interacSub}>{t("interacSub", { total: `$${(trip.price_paid * trip.seats).toFixed(2).replace(/\.00$/, "")}` })}</Text>}
              </>
            ) : (
              <Text style={s.interacMissing}>{t("interacMissing")}</Text>
            )}
          </View>
        )}

        {/* boarding pass — driver taps "Board" to confirm this passenger */}
        <View style={s.pass}>
          <Text style={s.passTxt}>{t("showToDriver")} — <Text style={s.passName}>{shortName(me?.name)}</Text></Text>
          <Text style={s.passSub}>{t("driverConfirms")}</Text>
        </View>

        <View style={s.actions}>
          {trip.status === "held" && (
            <TouchableOpacity style={[s.btn, s.btnCancel]} onPress={confirmCancel}><Text style={s.btnCancelTxt}>{t("cancelBtn")}</Text></TouchableOpacity>
          )}
          {!!trip.driver_phone && (
            <TouchableOpacity style={[s.btn, s.btnCall]} onPress={() => Linking.openURL(`tel:${trip.driver_phone}`)}>
              <Phone size={16} color={Colors.t1} /><Text style={s.btnCallTxt}>{t("callDriver")}</Text>
            </TouchableOpacity>
          )}
          {!!trip.driver_id && (
            <TouchableOpacity style={[s.btn, s.btnMsg]} onPress={() => router.push({ pathname: "/(passenger)/thread", params: { id: trip.driver_id, name: trip.driver_name, phone: trip.driver_phone ?? "" } } as any)}>
              <MessageCircle size={16} color={Colors.accentText} /><Text style={s.btnMsgTxt}>{t("messageDriver")}</Text>
            </TouchableOpacity>
          )}
        </View>

        {boarded && (
          <TouchableOpacity style={s.rateBtn}
            onPress={() => router.push({ pathname: "/(passenger)/rate", params: { tripId: trip.trip_id, driverName: trip.driver_name, dest: trip.destination_region } } as any)}>
            <Star size={15} color={Colors.accent} fill={Colors.accent} /><Text style={s.rateBtnTxt}>{t("rateRide")}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      <PassengerBottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: Colors.bg },
  title:    { color: Colors.t1, fontSize: 17, fontWeight: "800", padding: 16 },
  center:   { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  empty:    { color: Colors.t1, fontSize: 15, fontWeight: "700" },
  sub:      { color: Colors.t3, fontSize: 13, marginTop: 6, textAlign: "center" },
  goBoard:  { marginTop: 18, backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 26 },
  goBoardTxt: { color: Colors.accentText, fontWeight: "800", fontSize: 13.5 },

  holdCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.accent, borderRadius: 14, padding: 14, alignItems: "center", marginBottom: 12 },
  holdLbl:  { color: Colors.accent, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase" },
  holdTimer:{ color: Colors.t1, fontSize: 30, fontWeight: "800", marginTop: 3, fontVariant: ["tabular-nums"] },
  holdSub:  { color: Colors.t3, fontSize: 10.5, marginTop: 2 },

  car:      { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 15, padding: 13 },
  carHot:   { borderColor: Colors.accent },
  carTop:   { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar:   { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  avatarTxt:{ color: Colors.t1, fontWeight: "800", fontSize: 14 },
  nameRow:  { flexDirection: "row", alignItems: "center", gap: 6 },
  name:     { color: Colors.t1, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  vehicle:  { color: Colors.t3, fontSize: 11, marginTop: 2 },
  ratingRow:{ flexDirection: "row", alignItems: "center", gap: 2 },
  rating:   { color: Colors.yellow, fontSize: 11, fontWeight: "700" },
  statusRow:{ marginTop: 11 },
  chip:     { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  chipHot:  { backgroundColor: "rgba(255,107,0,0.16)" },
  chipWait: { backgroundColor: Colors.cardAlt },
  chipTxt:  { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.5 },
  chipTxtHot:  { color: Colors.accent },
  chipTxtWait: { color: Colors.t2 },
  rowSplit: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 12, paddingTop: 11 },
  metaLbl:  { color: Colors.t3, fontSize: 9.5, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  metaVal:  { color: Colors.t1, fontSize: 15, fontWeight: "800", marginTop: 2 },

  pass:     { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderStyle: "dashed", borderRadius: 12, padding: 12, alignItems: "center", marginTop: 12 },
  passTxt:  { color: Colors.t2, fontSize: 12.5 },
  passName: { color: Colors.t1, fontWeight: "800" },
  passSub:  { color: Colors.t3, fontSize: 10, marginTop: 3 },

  pickup:   { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 12, marginBottom: 12 },
  pickupLbl:{ color: Colors.t3, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  pickupName:{ color: Colors.t1, fontSize: 14.5, fontWeight: "800", marginTop: 2 },
  pickupAddr:{ color: Colors.t3, fontSize: 11, marginTop: 2 },
  dirBtn:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.accent, borderRadius: 11, paddingVertical: 9, paddingHorizontal: 12 },
  dirBtnTxt:{ color: Colors.accentText, fontWeight: "800", fontSize: 12.5 },

  seatRow:  { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12, flexWrap: "wrap" },
  adjustRow:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 11 },
  adjustLbl:{ color: Colors.t2, fontSize: 12.5, fontWeight: "700" },
  stepperCtrl: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepBtn:  { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  stepBtnTxt:{ color: Colors.t1, fontSize: 20, fontWeight: "800" },
  stepVal:  { color: Colors.t1, fontSize: 16, fontWeight: "800", minWidth: 20, textAlign: "center" },

  interac:  { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.green, borderRadius: 14, padding: 14, marginTop: 12 },
  interacLbl:{ color: Colors.green, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  interacRow:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, marginTop: 8 },
  interacVal:{ color: Colors.t1, fontSize: 14, fontWeight: "700" },
  interacSub:{ color: Colors.t2, fontSize: 11.5, marginTop: 8, lineHeight: 16 },
  interacMissing: { color: Colors.t3, fontSize: 12.5, marginTop: 8, lineHeight: 17 },

  actions:  { flexDirection: "row", gap: 9, marginTop: 12 },
  btn:      { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  btnCancel:{ borderWidth: 1.5, borderColor: Colors.red },
  btnCancelTxt: { color: Colors.red, fontWeight: "800", fontSize: 13 },
  btnCall:  { borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  btnCallTxt:{ color: Colors.t1, fontWeight: "800", fontSize: 13 },
  btnMsg:   { backgroundColor: Colors.accent },
  btnMsgTxt:{ color: Colors.accentText, fontWeight: "800", fontSize: 13 },

  rateBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 12, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingVertical: 12 },
  rateBtnTxt: { color: Colors.t1, fontWeight: "800", fontSize: 13.5 },
});
