import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, Modal, Pressable, Image, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Star, MessageSquare, ChevronDown, X, Phone, Clock, Bell, Car, MapPin } from "lucide-react-native";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { useZones } from "../../hooks/useZones";
import { ZoneLocation, REGIONS } from "../../constants/zones";
import { getDestinationsFrom, getRegionName } from "../../constants/pricing";
import { tryGetUserLocation } from "../../utils/gpsTimeout";
import { useNow } from "../../hooks/useNow";
import { PassengerBoardAPI, BoardCar, CityZone, formatFare, ratingLabel, vehicleLabel } from "../../services/passengerBoard";
import PassengerBottomNav from "../../components/PassengerBottomNav";
import SeatSvg from "../../components/SeatSvg";
import ZoneMap from "../../components/ZoneMap";
import { getVehicleImageUrl } from "../../utils/vehicleImage";
import { PushAPI } from "../../services/push";
import { PassengersAPI } from "../../services/passengers";
import { Mail } from "lucide-react-native";

const DEFAULT_ZONE_ID = "ottawa-universal-grocery";

const regionName = (code?: string | null) => REGIONS.find(r => r.code === code)?.name ?? (code ?? "");

// Human loading-window countdown: "2h 11m" for long windows, "M:SS" near the end.
function countdown(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - nowMs;
  if (Number.isNaN(ms) || ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function BoardScreen() {
  const router = useRouter();
  const { t, lang } = useStrings();
  const { zones } = useZones();
  const { zoneId: paramZoneId } = useLocalSearchParams<{ zoneId?: string }>();

  // City = region. homeCity is where the rider may reserve; other cities are view-only.
  const [homeCity, setHomeCity]         = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [zoneId, setZoneId]             = useState<string | null>(null);
  const [cityZones, setCityZones]       = useState<CityZone[]>([]);
  const [dest, setDest]                 = useState<string | null>(null);
  const [cars, setCars]                 = useState<BoardCar[]>([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [pickerOpen, setPickerOpen]     = useState(false);
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [profileCar, setProfileCar]     = useState<BoardCar | null>(null);

  // reserve sheet
  const [reserveCar, setReserveCar]   = useState<BoardCar | null>(null);
  const [heldCar, setHeldCar]         = useState<BoardCar | null>(null);   // held-seat info sheet
  const [notifyCar, setNotifyCar]     = useState<BoardCar | null>(null);   // notify-when-open channel picker
  const [meProfile, setMeProfile]     = useState<{ phone?: string | null; email?: string | null } | null>(null);
  const [notifyChannel, setNotifyChannel] = useState<"sms" | "email">("sms");
  const [notifyContact, setNotifyContact] = useState("");
  const [notifySave, setNotifySave]   = useState(true);
  const [notifyBusy, setNotifyBusy]   = useState(false);
  const [otherCarsOpen, setOtherCarsOpen] = useState(false);               // see-other-cars (next 3) sheet
  const [reserveSeats, setReserveSeats] = useState(1);
  const [reserving, setReserving]     = useState(false);
  const [reserveErr, setReserveErr]   = useState<string | null>(null);

  const didResolve = useRef(false);

  const reservable = selectedCity != null && selectedCity === homeCity;

  // Cities that actually have active zones (for the city switcher).
  const cities = useMemo(() => {
    const seen = new Set<string>();
    const out: { code: string; name: string }[] = [];
    for (const z of zones) if (!seen.has(z.region)) { seen.add(z.region); out.push({ code: z.region, name: regionName(z.region) }); }
    return out;
  }, [zones]);

  const zoneMeta = useMemo(
    () => cityZones.find(z => z.id === zoneId) ?? (() => {
      const z = zones.find(zz => zz.id === zoneId);
      return z ? { id: z.id, name: z.name, region: z.region, latitude: z.latitude, longitude: z.longitude, address: z.address ?? null, car_count: cars.length, has_loading: cars.some(c => c.status === "loading") } as CityZone : null;
    })(),
    [cityZones, zones, zoneId, cars],
  );

  const destinations = useMemo(
    () => (zoneMeta ? getDestinationsFrom(zoneMeta.region) : []),
    [zoneMeta],
  );

  // Resolve the rider's home city via GPS → nearest zone; default to the busiest
  // zone in that city. Falls back to Ottawa / Universal Grocery.
  const resolveHome = useCallback(async () => {
    const fallbackZone = zones.find(z => z.id === DEFAULT_ZONE_ID) ?? zones[0] ?? null;
    const loc = await tryGetUserLocation(8000);
    let region = fallbackZone?.region ?? "ottawa";
    if (loc) {
      const near = await PassengerBoardAPI.nearestZone(loc.coords.latitude, loc.coords.longitude);
      if (near) { const nz = zones.find(z => z.id === near.id); if (nz) region = nz.region; }
    }
    setHomeCity(region);
    setSelectedCity(prev => prev ?? region);
  }, [zones]);

  useEffect(() => {
    if (didResolve.current || zones.length === 0) return;
    didResolve.current = true;
    if (paramZoneId) {
      const picked = zones.find(z => z.id === paramZoneId);
      if (picked) { setHomeCity(picked.region); setSelectedCity(picked.region); setZoneId(picked.id); }
    }
    resolveHome().finally(() => setLoading(false));
  }, [zones, resolveHome, paramZoneId]);

  // When the viewed city changes, load its zones (busiest first) + default zone.
  useEffect(() => {
    if (!selectedCity) return;
    const cached = PassengerBoardAPI.cachedCityZones(selectedCity);
    if (cached) setCityZones(cached);
    PassengerBoardAPI.cityZones(selectedCity).then(rows => {
      setCityZones(rows);
      setZoneId(prev => (prev && rows.some(r => r.id === prev)) ? prev : (rows[0]?.id ?? prev));
    });
  }, [selectedCity]);

  // Default destination once a zone resolves — prefer Montréal, else first.
  useEffect(() => {
    if (destinations.length && (!dest || !destinations.includes(dest as any))) {
      setDest(destinations.includes("montreal") ? "montreal" : destinations[0]);
    }
  }, [destinations, dest]);

  const loadBoard = useCallback(async () => {
    if (!zoneId || !dest) { setCars([]); return; }
    setCars(await PassengerBoardAPI.board(zoneId, dest));
  }, [zoneId, dest]);

  // Cache-first paint, then live subscribe.
  useEffect(() => {
    if (!zoneId || !dest) return;
    const cached = PassengerBoardAPI.cachedBoard(zoneId, dest);
    if (cached) setCars(cached);
    loadBoard();
    const sub = PassengerBoardAPI.subscribeBoard(zoneId, loadBoard);
    return () => { sub.unsubscribe(); };
  }, [zoneId, dest, loadBoard]);

  const now = useNow(cars.length ? 1000 : 30000, true);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (selectedCity) setCityZones(await PassengerBoardAPI.cityZones(selectedCity));
    await loadBoard();
    setRefreshing(false);
  }, [selectedCity, loadBoard]);

  function openReserve(car: BoardCar) { setReserveCar(car); setReserveSeats(1); setReserveErr(null); }

  // Passenger contact (for the notify-when-open prefill).
  useEffect(() => { PassengersAPI.getMe().then(p => setMeProfile(p ? { phone: p.phone, email: p.email } : null)); }, []);

  // When the notify sheet opens, default to whichever contact is on file.
  useEffect(() => {
    if (!notifyCar) return;
    const ph = meProfile?.phone?.trim(); const em = meProfile?.email?.trim();
    if (ph)      { setNotifyChannel("sms");   setNotifyContact(ph); setNotifySave(false); }
    else if (em) { setNotifyChannel("email"); setNotifyContact(em); setNotifySave(false); }
    else         { setNotifyChannel("sms");   setNotifyContact(""); setNotifySave(true); }
  }, [notifyCar]);   // eslint-disable-line react-hooks/exhaustive-deps

  function pickNotifyChannel(ch: "sms" | "email") {
    setNotifyChannel(ch);
    const val = (ch === "sms" ? meProfile?.phone : meProfile?.email)?.trim() ?? "";
    setNotifyContact(val); setNotifySave(!val);
  }

  async function submitNotify() {
    if (!notifyCar) return;
    if (!notifyContact.trim()) { Alert.alert(t("notifyWhenOpen"), t("notifyNeedContact")); return; }
    setNotifyBusy(true);
    const { error } = await PassengerBoardAPI.notifySeatOpen(notifyCar.queue_entry_id, notifyChannel, notifyContact, notifySave);
    setNotifyBusy(false);
    if (error) { Alert.alert(t("notifyWhenOpen"), t("errReserve")); return; }
    if (notifySave) setMeProfile(m => ({ ...(m ?? {}), [notifyChannel === "sms" ? "phone" : "email"]: notifyContact.trim() }));
    setNotifyCar(null);
    Alert.alert(t("notifyArmedTitle"), notifyChannel === "sms" ? t("notifyArmedSms") : t("notifyArmedEmail"));
  }

  async function confirmReserve() {
    if (!reserveCar) return;
    setReserving(true); setReserveErr(null);
    const { data, error } = await PassengerBoardAPI.reserve(reserveCar.queue_entry_id, reserveSeats);
    setReserving(false);
    if (error) {
      const map: Record<string, string> = {
        not_loading_car: t("errNotLoadingCar"), seats_full: t("errSeatsFull"), already_reserved: t("errAlreadyReserved"),
      };
      setReserveErr(map[error] ?? t("errReserve"));
      return;
    }
    setReserveCar(null);
    if (data) {
      // Local reminders at the 7-min and 3-min marks of the 15-min hold.
      if (data.hold_expires_at) {
        const exp = new Date(data.hold_expires_at).getTime();
        PushAPI.scheduleLocal(new Date(exp - 7 * 60000), t("holdWarnTitle"), t("holdWarn7"));
        PushAPI.scheduleLocal(new Date(exp - 3 * 60000), t("holdWarnTitle"), t("holdWarn3"));
      }
      router.push("/(passenger)/my-trip" as any);
    }
  }

  function pickZone(id: string, city: string) {
    setSelectedCity(city);
    setZoneId(id);
    setExpandedId(null);
    setPickerOpen(false);
  }

  const queueCount = zoneMeta?.car_count ?? cars.length;
  const dateLabel = new Date().toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { weekday: "long", month: "long", day: "numeric" });

  /* ---------------------------------------------------------------- render */

  const CarCard = ({ car }: { car: BoardCar }) => {
    const isLoading = car.status === "loading";
    const rating = ratingLabel(car.rating_avg, car.rating_count);
    const vehicle = vehicleLabel(car) || t("newDriver");
    const isExpanded = expandedId === car.queue_entry_id;
    return (
      <View style={[s.car, isLoading && s.carLoading]}>
        <TouchableOpacity style={s.carTop} activeOpacity={0.85} onPress={() => setExpandedId(isExpanded ? null : car.queue_entry_id)}>
          <TouchableOpacity onPress={() => setProfileCar(car)} activeOpacity={0.7}>
            {car.avatar_url
              ? <Image source={{ uri: car.avatar_url }} style={s.avatar} />
              : <View style={s.avatar}><Text style={s.avatarTxt}>{initials(car.driver_name)}</Text></View>}
          </TouchableOpacity>
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
          <Text style={s.chevron}>{isExpanded ? "▾" : "▸"}</Text>
        </TouchableOpacity>

        {isLoading && (
          <View style={s.seats}>
            {Array.from({ length: car.seats }).map((_, i) => {
              const boarded = i < car.seats_boarded;
              const held    = !boarded && i < car.seats_taken;   // reserved, not yet boarded
              return (
                <SeatSvg
                  key={i}
                  size="mini"
                  filled={boarded}
                  locked={held}
                  color={Colors.accentP}
                  disabled={!held}
                  onPress={held ? () => setHeldCar(car) : undefined}
                />
              );
            })}
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

        {isExpanded && (
          <View style={s.expand}>
            {car.make && <Image source={{ uri: getVehicleImageUrl(car.make || "", car.model || "", undefined, "side", car.color || undefined) }} style={s.expandVehicle} resizeMode="contain" />}
            <View style={s.expandRow}><Text style={s.expandKey}>{t("destinationLabel")}</Text><Text style={s.expandVal}>{getRegionName(dest)}</Text></View>
            <View style={s.expandRow}><Text style={s.expandKey}>{t("seatsLabel")}</Text><Text style={s.expandVal}>{car.seats_taken} / {car.seats} · {t("seatsLeftN", { n: car.seats_left })}</Text></View>
            <View style={s.expandRow}><Text style={s.expandKey}>{t("fareLabel")}</Text><Text style={[s.expandVal, { color: Colors.accentP, fontWeight: "800" }]}>{formatFare(car.fare_cents)} {t("perSeat")}</Text></View>
          </View>
        )}

        {reservable && (
          <TouchableOpacity
            style={[s.reserveBtn, car.seats_left <= 0 && s.reserveBtnDisabled, !isLoading && s.reserveBtnAlt]}
            disabled={car.seats_left <= 0}
            onPress={() => openReserve(car)}
            activeOpacity={0.85}
          >
            <Text style={[s.reserveBtnTxt, !isLoading && s.reserveBtnAltTxt]}>{car.seats_left <= 0 ? t("seatsFull") : (isLoading ? t("reserveSeat") : t("prebookSeat"))}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      {/* header — driver-style zone selector */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <TouchableOpacity style={s.zonePicker} onPress={() => setPickerOpen(true)} activeOpacity={0.8}>
            <Text style={s.zoneName} numberOfLines={1}>{zoneMeta?.name ?? t("findingZone")}</Text>
            <Text style={s.zoneCity}>{regionName(zoneMeta?.region)} <ChevronDown size={13} color={Colors.accentP} /></Text>
          </TouchableOpacity>
          {zoneMeta && (
            <View style={s.liveRow}>
              <View style={s.liveDot} />
              <Text style={s.liveTxt}>{t("liveInQueue", { n: queueCount })}</Text>
              {!reservable && <Text style={s.watchTag}> · {t("viewOnlyTag")}</Text>}
            </View>
          )}
          {zoneMeta && <Text style={s.dateTxt}>{dateLabel}</Text>}
        </View>
        <TouchableOpacity onPress={() => router.push("/(passenger)/messages" as any)} style={s.msgBtn} activeOpacity={0.7} hitSlop={8}>
          <MessageSquare size={20} color={Colors.t1} strokeWidth={2} />
          <Text style={s.msgAdminTag}>{t("adminTag")}</Text>
        </TouchableOpacity>
      </View>

      {/* zone map */}
      {zoneMeta && <ZoneMap latitude={zoneMeta.latitude} longitude={zoneMeta.longitude} label={zoneMeta.name} height={130} />}

      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accentP} />}
      >
        {/* A7: request an on-route pickup (A2: restrained outline, lucide icon) */}
        <TouchableOpacity style={s.reqRideBtn} onPress={() => router.push("/(passenger)/request-ride" as any)} activeOpacity={0.85}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Car size={17} color={Colors.accentP} />
            <Text style={s.reqRideBtnTxt}>{t("reqRideTitle")}</Text>
          </View>
          <Text style={s.reqRideBtnArrow}>→</Text>
        </TouchableOpacity>

        {zoneId && zoneMeta && (
          <TouchableOpacity
            style={s.loadingTimesLink}
            activeOpacity={0.8}
            onPress={() => router.push({ pathname: "/(passenger)/loading-times" as any, params: { zoneId, zoneName: zoneMeta.name, dest: dest ? getRegionName(dest) : "" } })}
          >
            <Clock size={14} color={Colors.accentP} />
            <Text style={s.loadingTimesLinkTxt}>{t("loadingTimesLink")}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={s.pickupLink} activeOpacity={0.8} onPress={() => router.push("/(passenger)/pickup-request" as any)}>
          <MapPin size={14} color={Colors.t2} />
          <Text style={s.pickupLinkTxt}>{t("pickupBoardLink")}</Text>
        </TouchableOpacity>

        {!reservable && (
          <View style={s.viewOnlyBanner}><Text style={s.viewOnlyTxt}>{t("viewOnlyBanner", { city: regionName(homeCity) })}</Text></View>
        )}

        {/* destinations */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pills} contentContainerStyle={{ gap: 8 }}>
          {destinations.map(code => (
            <TouchableOpacity key={code} style={[s.pill, dest === code && s.pillOn]} onPress={() => setDest(code)} activeOpacity={0.8}>
              <Text style={[s.pillTxt, dest === code && s.pillTxtOn]}>{getRegionName(code)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={s.sectionLbl}>{t("liveQueue")} · {cars.length === 1 ? t("carOne") : t("carsCount", { n: cars.length })}</Text>

        {loading ? (
          <ActivityIndicator color={Colors.accentP} style={{ marginTop: 40 }} />
        ) : !dest ? (
          <Text style={s.empty}>{t("pickDestination")}</Text>
        ) : cars.length === 0 ? (
          <Text style={s.empty}>{t("noCarsRoute")}</Text>
        ) : (
          cars.map(car => <CarCard key={car.queue_entry_id} car={car} />)
        )}
      </ScrollView>

      {/* city / zone picker */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={s.sheetDim} onPress={() => setPickerOpen(false)} />
        <View style={[s.sheet, { maxHeight: "80%" }]}>
          <View style={s.grip} />
          <Text style={s.sheetTitle}>{t("choosePickup")}</Text>
          {/* city chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8 }}>
            {cities.map(c => (
              <TouchableOpacity key={c.code} style={[s.cityChip, selectedCity === c.code && s.cityChipOn]} onPress={() => setSelectedCity(c.code)} activeOpacity={0.8}>
                <Text style={[s.cityChipTxt, selectedCity === c.code && s.cityChipTxtOn]}>{c.name}{c.code === homeCity ? " ★" : ""}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {selectedCity !== homeCity && (
            <Text style={s.pickerNote}>{t("viewOnlyBanner", { city: regionName(homeCity) })}</Text>
          )}
          <ScrollView style={{ maxHeight: 360 }}>
            {cityZones.map((z, i) => (
              <TouchableOpacity key={z.id} style={[s.zoneRow, z.id === zoneId && s.zoneRowOn]} onPress={() => pickZone(z.id, z.region)} activeOpacity={0.8}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={s.zoneRowName} numberOfLines={1}>{z.name}</Text>
                    {i === 0 && z.car_count > 0 && <View style={s.busyTag}><Text style={s.busyTagTxt}>{t("busiestTag")}</Text></View>}
                  </View>
                  <Text style={s.zoneRowAddr} numberOfLines={1}>{z.address ?? regionName(z.region)}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[s.zoneRowCount, z.car_count > 0 && { color: Colors.accentP }]}>{t("carsCount", { n: z.car_count })}</Text>
                  {z.has_loading && <Text style={s.zoneRowLoading}>● {t("statusLoading")}</Text>}
                </View>
              </TouchableOpacity>
            ))}
            {cityZones.length === 0 && <Text style={s.empty}>{t("noCarsRoute")}</Text>}
          </ScrollView>
        </View>
      </Modal>

      {/* driver profile */}
      <Modal visible={!!profileCar} transparent animationType="fade" onRequestClose={() => setProfileCar(null)}>
        <Pressable style={s.centerDim} onPress={() => setProfileCar(null)}>
          <Pressable style={s.profileCard} onPress={() => {}}>
            <TouchableOpacity style={s.profileClose} onPress={() => setProfileCar(null)} hitSlop={10}><X size={20} color={Colors.t2} /></TouchableOpacity>
            {profileCar && (() => {
              const r = ratingLabel(profileCar.rating_avg, profileCar.rating_count);
              return (
                <>
                  {profileCar.avatar_url
                    ? <Image source={{ uri: profileCar.avatar_url }} style={s.profileAvatar} />
                    : <View style={s.profileAvatar}><Text style={s.profileAvatarTxt}>{initials(profileCar.driver_name)}</Text></View>}
                  <Text style={s.profileName}>{profileCar.driver_name}</Text>
                  {r.isNew
                    ? <View style={s.newBadge}><Text style={s.newBadgeTxt}>{t("badgeNew")}</Text></View>
                    : <View style={s.ratingRow}><Star size={13} color={Colors.yellow} fill={Colors.yellow} /><Text style={[s.rating, { fontSize: 14 }]}>{r.stars} · {t("ratingsCount", { n: profileCar.rating_count })}</Text></View>}
                  {profileCar.make && <Image source={{ uri: getVehicleImageUrl(profileCar.make || "", profileCar.model || "", undefined, "side", profileCar.color || undefined) }} style={s.profileVehicle} resizeMode="contain" />}
                  <Text style={s.profileVehTxt}>{vehicleLabel(profileCar)} · {t("seatsN", { n: profileCar.seats })}</Text>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

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
                  <Text style={s.vehicle}>{vehicleLabel(reserveCar)} · {getRegionName(dest)}</Text>
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
              <Text style={s.holdNote}>{reserveCar.status === "loading" ? t("holdNote") : t("prebookNote")}</Text>
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

      {/* Held-seat info sheet — reserved by another passenger, opens in ~15 min if no-show */}
      <Modal visible={!!heldCar} transparent animationType="slide" onRequestClose={() => setHeldCar(null)}>
        <Pressable style={s.sheetDim} onPress={() => setHeldCar(null)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.grip} />
            {heldCar && (
              <>
                <View style={s.heldHead}>
                  <Clock size={18} color={Colors.yellow} />
                  <Text style={s.heldTitle}>{t("heldSeatTitle")}</Text>
                </View>
                <Text style={s.heldBody}>{t("heldSeatBody")}</Text>
                {heldCar.next_hold_expires_at && (
                  <Text style={s.heldCountdown}>{countdown(heldCar.next_hold_expires_at, now)}</Text>
                )}
                <TouchableOpacity style={s.notifyBtn} activeOpacity={0.85} onPress={() => { const c = heldCar; setHeldCar(null); setNotifyCar(c); }}>
                  <Bell size={16} color={Colors.yellow} />
                  <Text style={s.notifyBtnTxt}>{t("notifyWhenOpen")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.otherCarsBtn} activeOpacity={0.85} onPress={() => { setHeldCar(null); setOtherCarsOpen(true); }}>
                  <Car size={16} color={Colors.t2} />
                  <Text style={s.otherCarsBtnTxt}>{t("seeOtherCars")}</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Notify me when a seat opens — pick SMS or Email, capture + save if missing */}
      <Modal visible={!!notifyCar} transparent animationType="slide" onRequestClose={() => setNotifyCar(null)}>
        <Pressable style={s.sheetDim} onPress={() => setNotifyCar(null)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.grip} />
            <Text style={s.sheetTitle}>{t("notifyWhenOpen")}</Text>
            <Text style={s.otherCarsSub}>{t("notifySub")}</Text>

            <TouchableOpacity style={[s.chOpt, notifyChannel === "sms" && s.chOptOn]} activeOpacity={0.85} onPress={() => pickNotifyChannel("sms")}>
              <View style={s.chIco}><MessageSquare size={17} color={Colors.t1} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.chTitle}>{t("notifySms")}</Text>
                {!!meProfile?.phone && <Text style={s.chSub}>{maskContact(meProfile.phone)}</Text>}
              </View>
              <View style={[s.radio, notifyChannel === "sms" && s.radioOn]} />
            </TouchableOpacity>

            <TouchableOpacity style={[s.chOpt, notifyChannel === "email" && s.chOptOn]} activeOpacity={0.85} onPress={() => pickNotifyChannel("email")}>
              <View style={s.chIco}><Mail size={17} color={Colors.t1} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.chTitle}>{t("notifyEmail")}</Text>
                {!!meProfile?.email && <Text style={s.chSub}>{maskContact(meProfile.email)}</Text>}
              </View>
              <View style={[s.radio, notifyChannel === "email" && s.radioOn]} />
            </TouchableOpacity>

            <TextInput
              style={s.notifyInput}
              value={notifyContact}
              onChangeText={setNotifyContact}
              placeholder={notifyChannel === "sms" ? t("notifyPhonePh") : t("notifyEmailPh")}
              placeholderTextColor={Colors.t3}
              keyboardType={notifyChannel === "sms" ? "phone-pad" : "email-address"}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TouchableOpacity style={s.saveRow} activeOpacity={0.8} onPress={() => setNotifySave(v => !v)}>
              <View style={[s.checkbox, notifySave && s.checkboxOn]}>{notifySave && <Text style={s.checkboxTick}>✓</Text>}</View>
              <Text style={s.saveTxt}>{t("notifySaveProfile")}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[s.reserveBtn, { marginTop: 14 }, notifyBusy && { opacity: 0.6 }]} disabled={notifyBusy} onPress={submitNotify} activeOpacity={0.85}>
              <Text style={s.reserveBtnTxt}>{notifyBusy ? t("reserving") : t("notifyConfirm")}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* See other cars — the next queued cars after the one loading */}
      <Modal visible={otherCarsOpen} transparent animationType="slide" onRequestClose={() => setOtherCarsOpen(false)}>
        <Pressable style={s.sheetDim} onPress={() => setOtherCarsOpen(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.grip} />
            <Text style={s.sheetTitle}>{t("otherCarsTitle")}</Text>
            <Text style={s.otherCarsSub}>{t("otherCarsSub", { dest: getRegionName(dest) })}</Text>
            {cars.filter(c => c.status !== "loading").slice(0, 3).map((c, idx) => (
              <View key={c.queue_entry_id} style={s.ocRow}>
                <Text style={s.ocPos}>#{idx + 2}</Text>
                {c.avatar_url
                  ? <Image source={{ uri: c.avatar_url }} style={s.ocAvatar} />
                  : <View style={s.ocAvatar}><Text style={s.avatarTxt}>{initials(c.driver_name)}</Text></View>}
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{c.driver_name}</Text>
                  <Text style={s.vehicle} numberOfLines={1}>{vehicleLabel(c) || t("newDriver")} · {t("seatsOpenN", { n: c.seats_left })}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <Text style={s.ocFare}>{formatFare(c.fare_cents)}</Text>
                  {reservable && (
                    <TouchableOpacity
                      style={[s.ocReserve, c.seats_left <= 0 && { opacity: 0.4 }]}
                      disabled={c.seats_left <= 0}
                      onPress={() => { setOtherCarsOpen(false); openReserve(c); }}
                      activeOpacity={0.85}
                    >
                      <Text style={s.ocReserveTxt}>{c.seats_left <= 0 ? t("seatsFull") : t("prebookSeat")}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
            {cars.filter(c => c.status !== "loading").length === 0 && (
              <Text style={s.otherCarsSub}>{t("otherCarsNone")}</Text>
            )}
            <Text style={s.ocNote}>{t("prebookNote")}</Text>
          </Pressable>
        </Pressable>
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

// Mask a phone/email for display: keep the ends, dot out the middle.
function maskContact(v?: string | null): string {
  const s = (v ?? "").trim();
  if (!s) return "";
  if (s.includes("@")) {
    const [u, d] = s.split("@");
    return `${u.slice(0, 2)}•••@${d}`;
  }
  return s.length <= 4 ? s : `${s.slice(0, 3)} ••• ${s.slice(-4)}`;
}

const s = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: Colors.bg },
  header:      { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, gap: 10 },
  zonePicker:  { flexDirection: "column" },
  zoneName:    { fontSize: 22, fontWeight: "800", color: Colors.t1 },
  zoneCity:    { fontSize: 13.5, color: Colors.accentP, fontWeight: "700", marginTop: 1 },
  liveRow:     { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  liveDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.accentP },
  liveTxt:     { fontSize: 12, color: Colors.t2, fontWeight: "600" },
  watchTag:    { fontSize: 12, color: Colors.yellow, fontWeight: "700" },
  dateTxt:     { color: Colors.t2, fontSize: 11.5, fontWeight: "700", marginTop: 3 },
  msgBtn:      { width: 40, alignItems: "center", justifyContent: "center", gap: 1 },
  msgAdminTag: { fontSize: 8.5, fontWeight: "700", color: Colors.t3, letterSpacing: 0.3, opacity: 0.6 },

  reqRideBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(234,106,30,0.06)", borderWidth: 1.5, borderColor: Colors.accentP, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 16, marginBottom: 12 },
  reqRideBtnTxt: { color: Colors.accentP, fontWeight: "800", fontSize: 15 },
  reqRideBtnArrow: { color: Colors.accentP, fontWeight: "800", fontSize: 18 },
  loadingTimesLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, marginBottom: 8 },
  loadingTimesLinkTxt: { color: Colors.accentP, fontWeight: "800", fontSize: 12.5 },
  pickupLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, marginBottom: 6 },
  pickupLinkTxt: { color: Colors.t2, fontWeight: "700", fontSize: 12 },
  viewOnlyBanner: { backgroundColor: "rgba(245,200,66,0.12)", borderWidth: 1, borderColor: "rgba(245,200,66,0.4)", borderRadius: 12, padding: 11, marginBottom: 12 },
  viewOnlyTxt:    { color: Colors.yellow, fontSize: 12, fontWeight: "600", lineHeight: 17 },

  pills:       { marginBottom: 14 },
  pill:        { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: Colors.border },
  pillOn:      { backgroundColor: Colors.accentP, borderColor: Colors.accentP },
  pillTxt:     { color: Colors.t2, fontWeight: "700", fontSize: 13 },
  pillTxtOn:   { color: Colors.accentPText },

  sectionLbl:  { color: Colors.t3, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase", marginBottom: 10 },
  empty:       { color: Colors.t3, fontSize: 13, textAlign: "center", marginTop: 34, paddingHorizontal: 20, lineHeight: 19 },

  car:         { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 15, padding: 12, marginBottom: 10 },
  carLoading:  { borderColor: Colors.accentP },
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
  chevron:     { color: Colors.t3, fontSize: 14, marginLeft: 2, width: 14, textAlign: "center" },

  seats:       { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 11, marginBottom: 2, flexWrap: "wrap" },
  seatTxt:     { color: Colors.t2, fontSize: 10.5, marginLeft: 6 },

  statusRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 9 },
  chipLoad:    { backgroundColor: "rgba(76,130,240,0.16)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  chipLoadTxt: { color: Colors.accentP, fontSize: 9.5, fontWeight: "800", letterSpacing: 0.5 },
  chipQueue:   { backgroundColor: Colors.cardAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  chipQueueTxt:{ color: Colors.t2, fontSize: 9.5, fontWeight: "800", letterSpacing: 0.5 },
  timer:       { color: Colors.t2, fontSize: 10.5 },

  expand:      { marginTop: 11, paddingTop: 11, borderTopWidth: 1, borderTopColor: Colors.border },
  expandVehicle: { width: "100%", height: 90, marginBottom: 8 },
  expandRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  expandKey:   { color: Colors.t3, fontSize: 11.5, fontWeight: "600" },
  expandVal:   { color: Colors.t1, fontSize: 12.5, fontWeight: "600" },

  reserveBtn:  { backgroundColor: Colors.accentP, borderRadius: 12, paddingVertical: 12, alignItems: "center", marginTop: 11 },
  reserveBtnDisabled: { backgroundColor: Colors.cardAlt },
  reserveBtnTxt: { color: Colors.accentPText, fontWeight: "800", fontSize: 13.5 },

  // picker / sheets
  sheetDim:    { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet:       { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: Colors.border, padding: 16, paddingBottom: 26 },
  grip:        { width: 36, height: 4, borderRadius: 3, backgroundColor: Colors.border, alignSelf: "center", marginBottom: 12 },
  sheetTitle:  { color: Colors.t1, fontSize: 17, fontWeight: "800", marginBottom: 12 },
  sheetDriver: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 6 },
  heldHead:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  heldTitle:   { color: Colors.yellow, fontWeight: "800", fontSize: 16 },
  heldBody:    { color: Colors.t2, fontSize: 13, lineHeight: 19 },
  heldCountdown:{ color: Colors.yellow, fontSize: 26, fontWeight: "800", fontVariant: ["tabular-nums"], marginTop: 10, letterSpacing: 1 },
  notifyBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderColor: Colors.yellow, borderRadius: 12, paddingVertical: 12, marginTop: 16 },
  notifyBtnTxt:{ color: Colors.yellow, fontWeight: "800", fontSize: 14 },
  otherCarsBtn:{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12, paddingVertical: 12, marginTop: 10 },
  otherCarsBtnTxt:{ color: Colors.t2, fontWeight: "700", fontSize: 14 },
  otherCarsSub:{ color: Colors.t2, fontSize: 12.5, marginTop: -6, marginBottom: 12 },
  ocRow:       { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 11, marginBottom: 9 },
  ocPos:       { color: Colors.accentP, fontWeight: "800", fontSize: 13, width: 24 },
  ocAvatar:    { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  ocFare:      { color: Colors.accentP, fontWeight: "800", fontSize: 13.5 },
  ocReserve:   { borderWidth: 1.5, borderColor: Colors.accentP, borderRadius: 9, paddingVertical: 6, paddingHorizontal: 12 },
  ocReserveTxt:{ color: Colors.accentP, fontWeight: "800", fontSize: 12 },
  reserveBtnAlt:  { backgroundColor: "transparent", borderWidth: 1.5, borderColor: Colors.accentP },
  reserveBtnAltTxt: { color: Colors.accentP },
  ocNote:      { color: Colors.t3, fontSize: 11, marginTop: 4, textAlign: "center", lineHeight: 16 },
  chOpt:       { flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12, marginBottom: 9 },
  chOptOn:     { borderColor: Colors.accentP, backgroundColor: "rgba(234,106,30,0.08)" },
  chIco:       { width: 34, height: 34, borderRadius: 9, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  chTitle:     { color: Colors.t1, fontWeight: "700", fontSize: 14 },
  chSub:       { color: Colors.t2, fontSize: 11.5, marginTop: 1 },
  radio:       { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.border },
  radioOn:     { borderColor: Colors.accentP, borderWidth: 6 },
  notifyInput: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, color: Colors.t1, fontSize: 15, fontWeight: "600", marginTop: 3 },
  saveRow:     { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 13 },
  checkbox:    { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: Colors.accentP, alignItems: "center", justifyContent: "center" },
  checkboxOn:  { backgroundColor: Colors.accentP },
  checkboxTick:{ color: Colors.accentPText, fontWeight: "900", fontSize: 13 },
  saveTxt:     { color: Colors.t2, fontSize: 12.5 },
  pickerNote:  { color: Colors.yellow, fontSize: 11.5, marginBottom: 10, lineHeight: 16 },

  cityChip:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: Colors.border },
  cityChipOn:  { backgroundColor: Colors.accentP, borderColor: Colors.accentP },
  cityChipTxt: { color: Colors.t2, fontWeight: "700", fontSize: 13 },
  cityChipTxtOn: { color: Colors.accentPText },

  zoneRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, marginBottom: 8 },
  zoneRowOn:   { borderColor: Colors.accentP, backgroundColor: "rgba(76,130,240,0.08)" },
  zoneRowName: { color: Colors.t1, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  zoneRowAddr: { color: Colors.t3, fontSize: 11, marginTop: 2 },
  zoneRowCount:{ color: Colors.t2, fontSize: 12, fontWeight: "800" },
  zoneRowLoading: { color: Colors.accentP, fontSize: 9.5, fontWeight: "800", marginTop: 2 },
  busyTag:     { backgroundColor: Colors.accentP, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5 },
  busyTagTxt:  { color: Colors.accentPText, fontSize: 8.5, fontWeight: "900", letterSpacing: 0.4 },

  // driver profile
  centerDim:   { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 30 },
  profileCard: { backgroundColor: Colors.card, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 22, width: "100%", alignItems: "center" },
  profileClose:{ position: "absolute", top: 12, right: 12, zIndex: 2 },
  profileAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  profileAvatarTxt: { color: Colors.t1, fontWeight: "800", fontSize: 26 },
  profileName: { color: Colors.t1, fontSize: 18, fontWeight: "800", marginBottom: 6 },
  profileVehicle: { width: "100%", height: 110, marginTop: 14 },
  profileVehTxt: { color: Colors.t2, fontSize: 13, fontWeight: "600", marginTop: 6 },

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
