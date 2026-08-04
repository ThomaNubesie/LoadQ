import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, Modal, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MapPin, Star, Navigation } from "lucide-react-native";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { useZones } from "../../hooks/useZones";
import { ZoneLocation } from "../../constants/zones";
import { getDestinationsFrom, getRegionName } from "../../constants/pricing";
import { tryGetUserLocation } from "../../utils/gpsTimeout";
import { useNow } from "../../hooks/useNow";
import { PassengerBoardAPI, BoardCar, formatFare, ratingLabel } from "../../services/passengerBoard";
import PassengerBottomNav from "../../components/PassengerBottomNav";

const DEFAULT_ZONE_ID = "ottawa-universal-grocery";

// mm:ss until an ISO deadline (clamped at 0:00).
function countdown(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function BoardScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const { zones } = useZones();
  const { zoneId: paramZoneId } = useLocalSearchParams<{ zoneId?: string }>();

  const [zone, setZone]           = useState<ZoneLocation | null>(null);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [inRange, setInRange]     = useState<boolean>(true);
  const [dest, setDest]           = useState<string | null>(null);
  const [cars, setCars]           = useState<BoardCar[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // reserve sheet
  const [reserveCar, setReserveCar] = useState<BoardCar | null>(null);
  const [reserveSeats, setReserveSeats] = useState(1);
  const [reserving, setReserving] = useState(false);
  const [reserveErr, setReserveErr] = useState<string | null>(null);

  const didResolve = useRef(false);

  // Destinations served from this zone's origin region.
  const destinations = useMemo(
    () => (zone ? getDestinationsFrom(zone.region) : []),
    [zone],
  );

  // Resolve nearest pickup zone: GPS → loadq_nearest_zone (authoritative
  // distance/within_radius) → local zone row for its region. Falls back to the
  // Universal Grocery board if GPS/zone lookup is unavailable.
  const resolveZone = useCallback(async () => {
    const fallback = () => zones.find(z => z.id === DEFAULT_ZONE_ID) ?? zones[0] ?? null;
    const loc = await tryGetUserLocation(8000);
    if (!loc) { setZone(prev => prev ?? fallback()); return; }
    const near = await PassengerBoardAPI.nearestZone(loc.coords.latitude, loc.coords.longitude);
    if (!near) { setZone(prev => prev ?? fallback()); return; }
    const local = zones.find(z => z.id === near.id) ?? fallback();
    setZone(local);
    setDistanceM(near.distance_m);
    setInRange(near.within_radius);
  }, [zones]);

  useEffect(() => {
    if (didResolve.current || zones.length === 0) return;
    didResolve.current = true;
    // Explicit pick from the Zones screen wins over GPS detection.
    if (paramZoneId) {
      const picked = zones.find(z => z.id === paramZoneId);
      if (picked) { setZone(picked); setInRange(true); setLoading(false); return; }
    }
    resolveZone().finally(() => setLoading(false));
  }, [zones, resolveZone, paramZoneId]);

  // Default destination once the zone resolves — prefer Montréal, else first.
  useEffect(() => {
    if (!dest && destinations.length) {
      setDest(destinations.includes("montreal") ? "montreal" : destinations[0]);
    }
  }, [destinations, dest]);

  const loadBoard = useCallback(async () => {
    if (!zone || !dest) { setCars([]); return; }
    const rows = await PassengerBoardAPI.board(zone.id, dest);
    setCars(rows);
  }, [zone, dest]);

  // Fetch + subscribe to live queue changes for this zone.
  useEffect(() => {
    if (!zone || !dest) return;
    loadBoard();
    const sub = PassengerBoardAPI.subscribeBoard(zone.id, loadBoard);
    return () => { sub.unsubscribe(); };
  }, [zone?.id, dest, loadBoard]);

  const now = useNow(cars.length ? 1000 : 30000, true);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await resolveZone();
    await loadBoard();
    setRefreshing(false);
  }, [resolveZone, loadBoard]);

  function openReserve(car: BoardCar) {
    setReserveCar(car);
    setReserveSeats(1);
    setReserveErr(null);
  }

  async function confirmReserve() {
    if (!reserveCar) return;
    setReserving(true); setReserveErr(null);
    const { data, error } = await PassengerBoardAPI.reserve(reserveCar.queue_entry_id, reserveSeats);
    setReserving(false);
    if (error) {
      const map: Record<string, string> = {
        not_loading_car: t("errNotLoadingCar"),
        seats_full:      t("errSeatsFull"),
        already_reserved:t("errAlreadyReserved"),
      };
      setReserveErr(map[error] ?? t("errReserve"));
      return;
    }
    setReserveCar(null);
    if (data) router.push("/(passenger)/my-trip" as any);
  }

  /* ---------------------------------------------------------------- render */

  const CarCard = ({ car }: { car: BoardCar }) => {
    const isLoading = car.status === "loading";
    const rating = ratingLabel(car.rating_avg, car.rating_count);
    const vehicle = [car.make, car.model].filter(Boolean).join(" ") || t("newDriver");
    return (
      <View style={[s.car, isLoading && s.carLoading]}>
        <View style={s.carTop}>
          <View style={s.avatar}><Text style={s.avatarTxt}>{initials(car.driver_name)}</Text></View>
          <View style={{ flex: 1 }}>
            <View style={s.nameRow}>
              <Text style={s.name} numberOfLines={1}>{car.driver_name}</Text>
              {rating.isNew
                ? <View style={s.newBadge}><Text style={s.newBadgeTxt}>{t("badgeNew")}</Text></View>
                : <View style={s.ratingRow}><Star size={11} color={Colors.yellow} fill={Colors.yellow} /><Text style={s.rating}>{rating.stars}</Text></View>}
            </View>
            <Text style={s.vehicle} numberOfLines={1}>{vehicle}</Text>
          </View>
          <Text style={s.fare}>{formatFare(car.fare_cents)}</Text>
        </View>

        {isLoading && (
          <View style={s.seats}>
            {Array.from({ length: car.seats }).map((_, i) => (
              <View key={i} style={[s.seatDot, i < car.seats_taken && s.seatDotFull]} />
            ))}
            <Text style={s.seatTxt}>{t("seatsOf", { taken: car.seats_taken, total: car.seats })} · {t("seatsLeftN", { n: car.seats_left })}</Text>
          </View>
        )}

        <View style={s.statusRow}>
          {isLoading
            ? <View style={s.chipLoad}><Text style={s.chipLoadTxt}>● {t("statusLoading")}</Text></View>
            : <View style={s.chipQueue}><Text style={s.chipQueueTxt}>{car.position <= 1 ? t("queuedNext") : t("queuedNum", { n: car.position })}</Text></View>}
          {isLoading
            ? <Text style={s.timer}>{t("departsIn", { t: countdown(car.load_deadline, now) })}</Text>
            : <Text style={s.timer}>{t("seatsOpenN", { n: car.seats_left })}</Text>}
        </View>

        {isLoading && (
          <TouchableOpacity
            style={[s.reserveBtn, car.seats_left <= 0 && s.reserveBtnDisabled]}
            disabled={car.seats_left <= 0}
            onPress={() => openReserve(car)}
            activeOpacity={0.85}
          >
            <Text style={s.reserveBtnTxt}>{car.seats_left <= 0 ? t("seatsFull") : t("reserveSeat")}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      {/* header */}
      <View style={s.header}>
        <View style={s.brand}><View style={s.lqTile}><Text style={s.lqTileTxt}>LQ</Text></View><Text style={s.brandTxt}>LoadQ</Text></View>
        <TouchableOpacity style={s.locBtn} onPress={resolveZone} activeOpacity={0.7}><Navigation size={18} color={Colors.t2} /></TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
      >
        {/* zone */}
        <View style={s.zone}>
          <View style={s.pin}><MapPin size={16} color={Colors.t2} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.zoneLbl}>{t("pickupZone")}</Text>
            <Text style={s.zoneName} numberOfLines={1}>{zone?.name ?? t("findingZone")}</Text>
          </View>
          {zone && (
            <View style={[s.rangeChip, !inRange && s.rangeChipOut]}>
              <Text style={[s.rangeChipTxt, !inRange && s.rangeChipTxtOut]}>
                {inRange ? t("inRange") : t("zoneOutOfRange")}{distanceM != null ? ` · ${distanceM} m` : ""}
              </Text>
            </View>
          )}
        </View>

        {/* destinations */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pills} contentContainerStyle={{ gap: 8 }}>
          {destinations.map(code => (
            <TouchableOpacity key={code} style={[s.pill, dest === code && s.pillOn]} onPress={() => setDest(code)} activeOpacity={0.8}>
              <Text style={[s.pillTxt, dest === code && s.pillTxtOn]}>{getRegionName(code)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* live queue */}
        <Text style={s.sectionLbl}>
          {t("liveQueue")} · {cars.length === 1 ? t("carOne") : t("carsCount", { n: cars.length })}
        </Text>

        {loading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 40 }} />
        ) : !dest ? (
          <Text style={s.empty}>{t("pickDestination")}</Text>
        ) : cars.length === 0 ? (
          <Text style={s.empty}>{t("noCarsRoute")}</Text>
        ) : (
          cars.map(car => <CarCard key={car.queue_entry_id} car={car} />)
        )}
      </ScrollView>

      {/* reserve sheet */}
      <Modal visible={!!reserveCar} transparent animationType="slide" onRequestClose={() => setReserveCar(null)}>
        <Pressable style={s.sheetDim} onPress={() => !reserving && setReserveCar(null)} />
        <View style={s.sheet}>
          <View style={s.grip} />
          <Text style={s.sheetTitle}>{t("reserveSeatsTitle")}</Text>
          {reserveCar && (
            <>
              <View style={s.sheetDriver}>
                <View style={[s.avatar, { width: 30, height: 30 }]}><Text style={s.avatarTxt}>{initials(reserveCar.driver_name)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{reserveCar.driver_name}</Text>
                  <Text style={s.vehicle}>{[reserveCar.make, reserveCar.model].filter(Boolean).join(" ")} · {getRegionName(dest)}</Text>
                </View>
              </View>

              <View style={s.stepper}>
                <Text style={s.stepperLbl}>{t("seatsLabel")}</Text>
                <View style={s.stepperCtrl}>
                  <TouchableOpacity style={s.stepBtn} disabled={reserveSeats <= 1} onPress={() => setReserveSeats(n => Math.max(1, n - 1))}><Text style={s.stepBtnTxt}>−</Text></TouchableOpacity>
                  <Text style={s.stepVal}>{reserveSeats}</Text>
                  <TouchableOpacity style={s.stepBtn} disabled={reserveSeats >= reserveCar.seats_left} onPress={() => setReserveSeats(n => Math.min(reserveCar.seats_left, n + 1))}><Text style={s.stepBtnTxt}>+</Text></TouchableOpacity>
                </View>
              </View>

              <View style={s.priceRow}>
                <Text style={s.priceLeft}>{reserveSeats} × {formatFare(reserveCar.fare_cents)}</Text>
                <Text style={s.priceRight}>{formatFare((reserveCar.fare_cents ?? 0) * reserveSeats)}</Text>
              </View>
              <Text style={s.holdNote}>🔒 {t("holdNote")}</Text>
              {reserveErr && <Text style={s.reserveErr}>{reserveErr}</Text>}

              <TouchableOpacity style={[s.reserveBtn, { marginTop: 14 }, reserving && { opacity: 0.6 }]} disabled={reserving} onPress={confirmReserve} activeOpacity={0.85}>
                <Text style={s.reserveBtnTxt}>
                  {reserving ? t("reserving") : (reserveSeats === 1 ? t("holdSeatBtn", { n: 1, fare: formatFare(reserveCar.fare_cents) }) : t("holdSeatsBtn", { n: reserveSeats, fare: formatFare((reserveCar.fare_cents ?? 0) * reserveSeats) }))}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </Modal>

      <PassengerBottomNav />
    </SafeAreaView>
  );
}

function initials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const s = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: Colors.bg },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  brand:       { flexDirection: "row", alignItems: "center", gap: 8 },
  lqTile:      { width: 26, height: 26, borderRadius: 7, backgroundColor: Colors.accent, alignItems: "center", justifyContent: "center" },
  lqTileTxt:   { color: Colors.accentText, fontWeight: "900", fontSize: 12 },
  brandTxt:    { color: Colors.t1, fontWeight: "800", fontSize: 16 },
  locBtn:      { width: 38, height: 38, borderRadius: 11, backgroundColor: Colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.border },

  zone:        { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 12, marginBottom: 12 },
  pin:         { width: 32, height: 32, borderRadius: 9, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  zoneLbl:     { color: Colors.t3, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase" },
  zoneName:    { color: Colors.t1, fontWeight: "800", fontSize: 14, marginTop: 2 },
  rangeChip:   { backgroundColor: "rgba(34,192,131,0.15)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  rangeChipOut:{ backgroundColor: "rgba(124,134,151,0.18)" },
  rangeChipTxt:{ color: Colors.green, fontSize: 9.5, fontWeight: "800" },
  rangeChipTxtOut: { color: Colors.t2 },

  pills:       { marginBottom: 14 },
  pill:        { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: Colors.border },
  pillOn:      { backgroundColor: Colors.accent, borderColor: Colors.accent },
  pillTxt:     { color: Colors.t2, fontWeight: "700", fontSize: 13 },
  pillTxtOn:   { color: Colors.accentText },

  sectionLbl:  { color: Colors.t3, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase", marginBottom: 10 },
  empty:       { color: Colors.t3, fontSize: 13, textAlign: "center", marginTop: 34, paddingHorizontal: 20, lineHeight: 19 },

  car:         { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 15, padding: 12, marginBottom: 10 },
  carLoading:  { borderColor: Colors.accent },
  carTop:      { flexDirection: "row", alignItems: "center", gap: 9 },
  avatar:      { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  avatarTxt:   { color: Colors.t1, fontWeight: "800", fontSize: 13 },
  nameRow:     { flexDirection: "row", alignItems: "center", gap: 6 },
  name:        { color: Colors.t1, fontSize: 13.5, fontWeight: "700", flexShrink: 1 },
  vehicle:     { color: Colors.t3, fontSize: 10.5, marginTop: 1 },
  ratingRow:   { flexDirection: "row", alignItems: "center", gap: 2 },
  rating:      { color: Colors.yellow, fontSize: 11, fontWeight: "700" },
  newBadge:    { backgroundColor: Colors.cardAlt, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  newBadgeTxt: { color: Colors.t2, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  fare:        { color: Colors.t1, fontWeight: "800", fontSize: 16 },

  seats:       { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 11, marginBottom: 2, flexWrap: "wrap" },
  seatDot:     { width: 15, height: 15, borderRadius: 4, borderWidth: 1.5, borderColor: Colors.border },
  seatDotFull: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  seatTxt:     { color: Colors.t2, fontSize: 10.5, marginLeft: 6 },

  statusRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 9 },
  chipLoad:    { backgroundColor: "rgba(255,107,0,0.16)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  chipLoadTxt: { color: Colors.accent, fontSize: 9.5, fontWeight: "800", letterSpacing: 0.5 },
  chipQueue:   { backgroundColor: Colors.cardAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  chipQueueTxt:{ color: Colors.t2, fontSize: 9.5, fontWeight: "800", letterSpacing: 0.5 },
  timer:       { color: Colors.t2, fontSize: 10.5 },

  reserveBtn:  { backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 12, alignItems: "center", marginTop: 11 },
  reserveBtnDisabled: { backgroundColor: Colors.cardAlt },
  reserveBtnTxt: { color: Colors.accentText, fontWeight: "800", fontSize: 13.5 },

  sheetDim:    { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet:       { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: Colors.border, padding: 16, paddingBottom: 26 },
  grip:        { width: 36, height: 4, borderRadius: 3, backgroundColor: Colors.border, alignSelf: "center", marginBottom: 12 },
  sheetTitle:  { color: Colors.t1, fontSize: 17, fontWeight: "800", marginBottom: 12 },
  sheetDriver: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 6 },
  stepper:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12, marginTop: 10 },
  stepperLbl:  { color: Colors.t2, fontSize: 13, fontWeight: "600" },
  stepperCtrl: { flexDirection: "row", alignItems: "center", gap: 16 },
  stepBtn:     { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  stepBtnTxt:  { color: Colors.t1, fontSize: 20, fontWeight: "800" },
  stepVal:     { color: Colors.t1, fontSize: 16, fontWeight: "800", minWidth: 18, textAlign: "center" },
  priceRow:    { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 2, marginTop: 8 },
  priceLeft:   { color: Colors.t2, fontSize: 13 },
  priceRight:  { color: Colors.t1, fontSize: 13, fontWeight: "800" },
  holdNote:    { color: Colors.t3, fontSize: 10.5, marginTop: 8, lineHeight: 15 },
  reserveErr:  { color: Colors.red, fontSize: 12, marginTop: 8, fontWeight: "600" },
});
