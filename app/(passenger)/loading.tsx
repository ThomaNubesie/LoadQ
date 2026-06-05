import { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, RefreshControl, Alert, Modal, Linking, Platform, Share, ActivityIndicator } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusAndForeground } from "../../hooks/useFocusAndForeground";
import { QueueAPI } from "../../services/queue";
import { ClaimsAPI } from "../../services/claims";
import { MessagesAPI } from "../../services/messages";
import { MessageEvents } from "../../services/messageEvents";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { QueueEntry } from "../../constants/types";
import { useZones } from "../../hooks/useZones";
import { getDistanceKm } from "../../constants/zones";
import { getPricePerSeat, getDestinationsFrom, getRegionName } from "../../constants/pricing";
import { useDestinations } from "../../hooks/useDestinations";
import { loadingState, formatRemaining } from "../../utils/loadingTimer";
import { useNow } from "../../hooks/useNow";
import { tryGetUserLocation } from "../../utils/gpsTimeout";
import { getVehicleImageUrl } from "../../utils/vehicleImage";
import SeatSvg from "../../components/SeatSvg";
import VerifiedBadge from "../../components/VerifiedBadge";
import UserActionMenu from "../../components/UserActionMenu";
import PassengerBottomNav from "../../components/PassengerBottomNav";

export default function PassengerLoadingScreen() {
  const router = useRouter();
  const { t }  = useStrings();
  const { zones } = useZones();
  const { activeCodes: activeDestCodes } = useDestinations();
  // Navigation context from Board tab: zoneId pins the loading view to the
  // zone the user was looking at, dest pre-applies the destination filter.
  const { dest: destParam, zoneId: zoneIdParam } = useLocalSearchParams<{ dest?: string; zoneId?: string }>();

  const [entries,    setEntries]    = useState<QueueEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeZone, setActiveZone] = useState(zones[0] || null);
  const [destFilter, setDestFilter] = useState<string | null>(destParam ?? null);
  const [userCoords, setUserCoords] = useState<{lat:number,lon:number}|null>(null);
  const [openClaims, setOpenClaims] = useState<Record<string, string>>({}); // entryId -> claimId
  // entryIds where the passenger's claim is CONFIRMED (not just pending).
  // Drives the Call / Message buttons in the driver row — both sides can
  // contact each other only after the driver has accepted the reservation.
  const [confirmedEntries, setConfirmedEntries] = useState<Set<string>>(new Set());
  const [claiming,   setClaiming]   = useState<string | null>(null);
  const [showDestPicker, setShowDestPicker] = useState(false);
  // Per-driver unread message count. Drives the badge on each card's 💬 button.
  const [unreadByDriver, setUnreadByDriver] = useState<Map<string, number>>(new Map());

  // True once the first load() completes — lets focus/foreground re-detects
  // refresh silently instead of flashing the full-screen spinner.
  const loadedOnceRef = useRef(false);

  // `silent` re-detects in the background without blanking the list — used by
  // the focus/foreground re-detect so reopening the app doesn't flash the
  // spinner over content. The first load always shows the spinner.
  const load = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) setRefreshing(true);
    else if (!silent || !loadedOnceRef.current) setLoading(true);
    let zone = activeZone;
    // If the Board tab handed us a zoneId, pin to it instead of GPS-detecting.
    // Keeps the loading view consistent with what the passenger saw on Board.
    if (zoneIdParam) {
      const pinned = zones.find(z => z.id === zoneIdParam);
      if (pinned) { zone = pinned; setActiveZone(pinned); }
    }
    // GPS read races against an 8s top-level timeout that covers BOTH the
    // permission request AND the position read — Android can hang on
    // either when the system is in a weird state, and we never want this
    // screen to freeze on "chargement".
    const loc = await tryGetUserLocation(8000);
    if (loc) {
      const { latitude, longitude } = loc.coords;
      setUserCoords({ lat: latitude, lon: longitude });
      // Only auto-localize when no zone was pinned via param — otherwise
      // honour the caller's choice.
      if (!zoneIdParam && zones.length > 0) {
        const nearest = zones
          .map(z => ({ z, d: getDistanceKm(latitude, longitude, z.latitude, z.longitude) }))
          .sort((a, b) => a.d - b.d)[0]?.z;
        if (nearest) { zone = nearest; setActiveZone(nearest); }
      }
    }
    if (zone) {
      const q = await QueueAPI.getZoneQueue(zone.id);
      const loadingEntries = q.filter(e => e.status === "loading");
      setEntries(loadingEntries);
      // Check each entry to see if we already have a claim on it. Track
      // confirmed claims separately so we know whether to show contact
      // buttons (call / message) on that driver's card.
      const openMap: Record<string, string> = {};
      const confirmedSet = new Set<string>();
      await Promise.all(loadingEntries.map(async e => {
        const c = await ClaimsAPI.findOpenClaim(e.id);
        if (c) {
          openMap[e.id] = c.id;
          if (c.status === "confirmed") confirmedSet.add(e.id);
        }
      }));
      setOpenClaims(openMap);
      setConfirmedEntries(confirmedSet);
    }
    // Unread DMs per driver — drives the badge on each card's chat icon.
    setUnreadByDriver(await MessagesAPI.unreadBySender());
    loadedOnceRef.current = true;
    setLoading(false); setRefreshing(false);
  }, [activeZone?.id, zones, zoneIdParam]);

  const inGeo = !!(activeZone && userCoords &&
    getDistanceKm(userCoords.lat, userCoords.lon, activeZone.latitude, activeZone.longitude) * 1000 <= activeZone.radius_meters);

  // Driver details (name, vehicle, plate) are now always visible — the
  // earlier 300m privacy gate was lifted per UX feedback. Only the Call /
  // Message buttons need a proximity check, gated at 500m. Confirmed
  // reservations also unlock contact regardless of distance (passenger
  // may be walking around mid-board).
  const distanceM = (activeZone && userCoords)
    ? Math.round(getDistanceKm(userCoords.lat, userCoords.lon, activeZone.latitude, activeZone.longitude) * 1000)
    : null;
  const within500m = distanceM !== null && distanceM <= 500;

  const handleClaim = async (entry: QueueEntry) => {
    if (!inGeo) {
      Alert.alert(t.outOfRangeTitle, t.outOfRange);
      return;
    }
    setClaiming(entry.id);
    const { data, error } = await ClaimsAPI.claim(entry.id);
    setClaiming(null);
    if (error) { Alert.alert(t.error, error); return; }
    if (data) setOpenClaims(prev => ({ ...prev, [entry.id]: data.id }));
  };

  // Re-run GPS + nearest-zone detection on every focus AND every time the
  // app returns from background, so the passenger lands on their current
  // zone whenever they reopen the app, even if they last viewed another.
  // Debounced (8s) + silent so the focus+foreground double-fire doesn't
  // re-run GPS several times or blank the list on every reopen.
  const refocusDetect = useCallback(() => { load(false, true); }, [load]);
  useFocusAndForeground(refocusDetect, 8000);

  // Live unread badge: bump the per-driver counter whenever a new message
  // arrives from one of the loading drivers, without waiting for a poll.
  useEffect(() => {
    const off = MessageEvents.on(msg => {
      setUnreadByDriver(prev => {
        const next = new Map(prev);
        next.set(msg.sender_id, (next.get(msg.sender_id) ?? 0) + 1);
        return next;
      });
    });
    return off;
  }, []);

  useEffect(() => {
    if (!activeZone) return;
    const sub = QueueAPI.subscribeToZone(activeZone.id, () => {
      QueueAPI.getZoneQueue(activeZone.id).then(q =>
        setEntries(q.filter(e => e.status === "loading"))
      );
    });
    return () => { sub.unsubscribe(); };
  }, [activeZone?.id]);

  const filtered = destFilter
    ? entries.filter(e => e.destination_region === destFilter)
    : entries;

  const now = useNow(filtered.length > 0 ? 1000 : 30_000, true);
  const reachable  = activeZone ? new Set(getDestinationsFrom(activeZone.region, activeDestCodes) as string[]) : new Set<string>();
  const allRegions = activeZone ? getDestinationsFrom(activeZone.region, activeDestCodes) : [];

  const handleAddressTap = () => {
    if (!activeZone) return;
    const addr = activeZone.address || activeZone.name;
    Alert.alert(activeZone.name, addr, [
      { text: t.getDirections, onPress: () => {
        const q = encodeURIComponent(addr);
        const url = Platform.OS === "ios"
          ? `http://maps.apple.com/?daddr=${q}`
          : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
        Linking.openURL(url);
      }},
      { text: t.copyAddress, onPress: async () => {
        try { await Clipboard.setStringAsync(addr); } catch {}
      }},
      { text: t.shareAddress, onPress: async () => {
        try { await Share.share({ message: `${activeZone.name}\n${addr}` }); } catch {}
      }},
      { text: t.cancel, style: "cancel" },
    ]);
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>🚌 {t.loadingNowTitle}</Text>
        <View style={{ flex: 1 }} />
        <Text style={s.subtitle}>{activeZone?.name}</Text>
      </View>

      {activeZone && (
        <TouchableOpacity style={s.addressBar} onPress={handleAddressTap} activeOpacity={0.7}>
          <Text style={s.addressIcon}>📍</Text>
          <Text style={s.addressText} numberOfLines={2}>{activeZone.address || activeZone.name}</Text>
          <Text style={s.addressArrow}>›</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={s.destDropdown} onPress={() => setShowDestPicker(true)} activeOpacity={0.85}>
        <Text style={s.destDropdownLabel}>
          {destFilter === null ? t.allDestinations : `→ ${getRegionName(destFilter)}`}
        </Text>
        <Text style={s.destDropdownArrow}>▾</Text>
      </TouchableOpacity>

      <ScrollView
        style={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.accent} />}
      >
        {loading ? (
          <View style={s.loadingBlock}>
            <ActivityIndicator color={Colors.accent} size="large" />
            <Text style={s.loadingText}>{t.loading}</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>⏸</Text>
            <Text style={s.emptyText}>{t.noLoadingNow}</Text>
          </View>
        ) : (
          filtered.map(entry => {
            const vehicle = entry.vehicle;
            const totalSeats = vehicle?.seats || 4;
            const seats = Math.max(totalSeats - 1, 1);
            const boarded = entry.seats_boarded || 0;
            const lstate = loadingState(entry.load_start_at, seats, now);
            const required = lstate?.effectiveRequired ?? seats;
            const remaining = required - boarded;
            const price = getPricePerSeat(activeZone?.region, entry.destination_region);
            const timerColor = lstate?.phase === "warning" || lstate?.phase === "expired"
              ? Colors.red
              : lstate?.phase === "reduced3" ? Colors.yellow : Colors.accent;

            // Driver details are ALWAYS visible now. The earlier 300m privacy
            // gate has been lifted — passengers need to see who's loading
            // before deciding to claim. Only Call / Message remain gated, at
            // 500m proximity OR an existing confirmed reservation.
            const isMyReservation = confirmedEntries.has(entry.id);
            const canContact      = within500m || isMyReservation;
            const unreadFromThis  = entry.driver_id ? (unreadByDriver.get(entry.driver_id) ?? 0) : 0;

            return (
              <View key={entry.id} style={s.card}>
                {vehicle && (
                  <Image
                    source={{ uri: getVehicleImageUrl(vehicle.make, vehicle.model, vehicle.year, "side", vehicle.color || undefined) }}
                    style={s.vehicleImg}
                    resizeMode="contain"
                  />
                )}
                {isMyReservation && !within500m && (
                  <View style={s.yourTripBanner}>
                    <Text style={s.yourTripText}>
                      {t("yourReservation", { distance: distanceM !== null ? t("metersFromZone", { m: String(distanceM) }) : t.outsideZone })}
                    </Text>
                  </View>
                )}
                <View style={s.driverRow}>
                  {entry.driver?.avatar_url ? (
                    <Image source={{ uri: entry.driver.avatar_url }} style={s.avatar} />
                  ) : (
                    <View style={s.avatarFallback}><Text style={{ fontSize: 22 }}>👤</Text></View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={s.driverNameRow}>
                      <Text style={s.driverName}>{entry.driver?.full_name || t.driverLabel}</Text>
                      {entry.driver?.verified && <VerifiedBadge size={15} />}
                      {entry.driver_id && (
                        <UserActionMenu
                          userId={entry.driver_id}
                          userName={entry.driver?.full_name || t.driverLabel}
                        />
                      )}
                    </View>
                    <Text style={s.routeText}>
                      {getRegionName(activeZone?.region)} → {getRegionName(entry.destination_region)}
                    </Text>
                    {vehicle && (
                      <Text style={s.vehicleInfoText}>
                        {vehicle.year} {vehicle.make} {vehicle.model}
                        {vehicle.color ? `  ·  ${vehicle.color}` : ""}
                        {vehicle.plate ? `  ·  ${vehicle.plate}` : ""}
                      </Text>
                    )}
                  </View>
                  {price !== null && (
                    <View style={s.priceBox}>
                      <Text style={s.priceText}>C${price}</Text>
                      <Text style={s.priceSub}>/ seat</Text>
                    </View>
                  )}
                </View>

                {entry.driver && (
                  <View style={s.passengerContactRow}>
                    {entry.driver.phone && (
                      <TouchableOpacity
                        style={[s.passengerContactBtn, !canContact && s.passengerContactBtnLocked]}
                        onPress={() => {
                          if (!canContact) {
                            Alert.alert(
                              t.moveCloserToCall,
                              t("moveCloserBody", { zone: activeZone?.name || "" }),
                            );
                            return;
                          }
                          Linking.openURL(`tel:${entry.driver!.phone}`);
                        }}
                        activeOpacity={0.85}
                      >
                        <Text style={s.passengerContactEmoji}>{canContact ? "📞" : "🔒"}</Text>
                        <Text style={s.passengerContactLabel}>{t.callDriver}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[s.passengerContactBtn, s.passengerContactBtnPrimary, !canContact && s.passengerContactBtnLocked]}
                      onPress={() => {
                        if (!canContact) {
                          Alert.alert(
                            t.moveCloserToMessage,
                            t("moveCloserBody", { zone: activeZone?.name || "" }),
                          );
                          return;
                        }
                        // Opening the thread will mark messages read; clear
                        // locally so the badge disappears instantly.
                        if (entry.driver_id) {
                          setUnreadByDriver(prev => {
                            if (!prev.has(entry.driver_id!)) return prev;
                            const next = new Map(prev);
                            next.delete(entry.driver_id!);
                            return next;
                          });
                        }
                        router.push({
                          pathname: "/(app)/thread" as any,
                          params: {
                            id:    entry.driver_id,
                            name:  entry.driver?.full_name || t.driverLabel,
                            phone: entry.driver?.phone || "",
                          },
                        });
                      }}
                      activeOpacity={0.85}
                    >
                      <Text style={s.passengerContactEmoji}>{canContact ? "💬" : "🔒"}</Text>
                      <Text style={[s.passengerContactLabel, { color: Colors.accentText }]}>{t.messageLabel}</Text>
                      {unreadFromThis > 0 && (
                        <View style={s.passengerContactBadge}>
                          <Text style={s.passengerContactBadgeText}>
                            {unreadFromThis > 9 ? "9+" : unreadFromThis}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                <View style={s.seatGrid}>
                  {Array.from({ length: seats }).map((_, i) => {
                    const isFilled  = i < boarded;
                    const isExpired = i >= required; // shrunk by timer
                    return (
                      <View key={i} style={{ position: "relative" }}>
                        <SeatSvg size="full" filled={isFilled} locked={i < (entry.seats_locked || 0)} color={Colors.accent} disabled />
                        {isExpired && !isFilled && (
                          <View pointerEvents="none" style={s.passengerExpiredX}>
                            <Text style={s.passengerExpiredText}>✕</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>

                <View style={s.statsRow}>
                  <View style={s.statBox}>
                    <Text style={s.statVal}>{remaining}</Text>
                    <Text style={s.statKey}>{t.seatsLeft}</Text>
                  </View>
                  <View style={s.statBox}>
                    <Text style={[s.statVal, { color: timerColor }]}>
                      {lstate ? formatRemaining(lstate.remainingMs) : "—"}
                    </Text>
                    <Text style={s.statKey}>{t.timeLeftCol}</Text>
                  </View>
                  <View style={s.statBox}>
                    <Text style={s.statVal}>{vehicle ? `${vehicle.year}` : "—"}</Text>
                    <Text style={s.statKey}>{vehicle ? `${vehicle.make}` : t.vehicleCol}</Text>
                  </View>
                </View>

                {lstate?.showWarning && (
                  <View style={s.warnBanner}>
                    <Text style={s.warnText}>⚠ {t.windowClosingSoon}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[
                    s.claimBtn,
                    openClaims[entry.id]   && s.claimBtnClaimed,
                    !openClaims[entry.id] && !inGeo && s.claimBtnDisabled,
                    claiming === entry.id && s.claimBtnDisabled,
                  ]}
                  onPress={() => handleClaim(entry)}
                  disabled={!!openClaims[entry.id] || !inGeo || claiming === entry.id}
                  activeOpacity={0.85}
                >
                  <Text style={s.claimBtnText}>
                    {openClaims[entry.id]
                      ? t.claimedLabel
                      : claiming === entry.id
                        ? t.loading
                        : !inGeo
                          ? t.outOfRange
                          : t.claimSeat}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      <PassengerBottomNav />

      <Modal visible={showDestPicker} transparent animationType="slide" onRequestClose={() => setShowDestPicker(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowDestPicker(false)}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Choose destination</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              <TouchableOpacity
                style={[s.destPickRow, destFilter === null && s.destPickRowActive]}
                onPress={() => { setDestFilter(null); setShowDestPicker(false); }}
              >
                <Text style={[s.destPickName, destFilter === null && { color: Colors.accent }]}>{t.allDestinations}</Text>
              </TouchableOpacity>
              {allRegions.map(dest => {
                const price = getPricePerSeat(activeZone?.region, dest);
                const isReachable = reachable.has(dest);
                return (
                  <TouchableOpacity
                    key={dest}
                    style={[s.destPickRow, destFilter === dest && s.destPickRowActive, !isReachable && { opacity: 0.45 }]}
                    onPress={() => { setDestFilter(dest); setShowDestPicker(false); }}
                    disabled={!isReachable}
                  >
                    <Text style={[s.destPickName, destFilter === dest && { color: Colors.accent }]}>→ {getRegionName(dest)}</Text>
                    {price !== null
                      ? <Text style={s.destPickPrice}>C${price} / seat</Text>
                      : <Text style={s.destPickPriceMuted}>No service</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex:1, backgroundColor:Colors.bg },
  header:      { flexDirection:"row", alignItems:"center", paddingHorizontal:16, paddingTop:16, paddingBottom:10 },
  title:       { fontSize:18, fontWeight:"800", color:Colors.t1 },
  subtitle:    { fontSize:12, color:Colors.t3, fontWeight:"600" },
  addressBar:  { flexDirection:"row", alignItems:"center", marginHorizontal:16, marginBottom:10, padding:12, backgroundColor:Colors.card, borderRadius:10, borderWidth:0.5, borderColor:Colors.border, gap:8 },
  addressIcon: { fontSize:16 },
  addressText: { flex:1, color:Colors.t2, fontSize:13, fontWeight:"500" },
  addressArrow:{ color:Colors.t3, fontSize:20, fontWeight:"300" },
  destDropdown:      { flexDirection:"row", alignItems:"center", justifyContent:"space-between", backgroundColor:Colors.card, marginHorizontal:16, marginVertical:8, paddingVertical:12, paddingHorizontal:14, borderRadius:12, borderWidth:1, borderColor:Colors.border },
  destDropdownLabel: { fontSize:14, fontWeight:"700", color:Colors.t1 },
  destDropdownArrow: { fontSize:14, color:Colors.accent, fontWeight:"700" },
  modalOverlay:      { flex:1, backgroundColor:"rgba(0,0,0,0.6)", justifyContent:"flex-end" },
  modalSheet:        { backgroundColor:Colors.card, borderTopLeftRadius:20, borderTopRightRadius:20, paddingTop:12, paddingBottom:24 },
  modalHandle:       { width:36, height:4, borderRadius:2, backgroundColor:Colors.border, alignSelf:"center", marginBottom:16 },
  modalTitle:        { fontSize:16, fontWeight:"700", color:Colors.t1, paddingHorizontal:16, marginBottom:8 },
  destPickRow:       { flexDirection:"row", justifyContent:"space-between", alignItems:"center", paddingVertical:14, paddingHorizontal:16, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  destPickRowActive: { backgroundColor:Colors.accent+"10" },
  destPickName:      { fontSize:14, fontWeight:"600", color:Colors.t1 },
  destPickPrice:     { fontSize:12, color:Colors.accent, fontWeight:"700" },
  destPickPriceMuted:{ fontSize:11, color:Colors.t3, fontStyle:"italic" },
  scroll:      { flex:1, paddingHorizontal:16, paddingTop:12 },
  card:        { backgroundColor:Colors.card, borderRadius:16, borderWidth:0.5, borderColor:Colors.border, marginBottom:12, overflow:"hidden" },
  vehicleImg:  { width:"100%", height:130, backgroundColor:Colors.cardAlt },
  yourTripBanner: { paddingVertical:8, paddingHorizontal:12, backgroundColor:Colors.accent+"22", borderTopWidth:1.5, borderTopColor:Colors.accent, alignItems:"center" },
  yourTripText:   { color:Colors.accent, fontSize:11, fontWeight:"800", letterSpacing:1 },
  driverRow:   { flexDirection:"row", alignItems:"center", gap:10, padding:12, borderBottomWidth:0.3, borderBottomColor:Colors.border },
  avatar:      { width:44, height:44, borderRadius:22, backgroundColor:Colors.cardAlt },
  avatarFallback: { width:44, height:44, borderRadius:22, backgroundColor:Colors.bg, alignItems:"center", justifyContent:"center", borderWidth:0.5, borderColor:Colors.border },
  driverNameRow:{ flexDirection:"row", alignItems:"center", gap:6 },
  driverName:  { fontSize:14, fontWeight:"700", color:Colors.t1 },
  routeText:   { fontSize:12, color:Colors.t2, marginTop:2 },
  vehicleInfoText: { fontSize:11, color:Colors.t3, marginTop:3, fontWeight:"500" },
  priceBox:    { alignItems:"flex-end" },
  priceText:   { fontSize:18, fontWeight:"800", color:Colors.accent },
  priceSub:    { fontSize:10, color:Colors.t3 },
  seatGrid:    { flexDirection:"row", flexWrap:"wrap", justifyContent:"center", gap:8, padding:14, borderBottomWidth:0.3, borderBottomColor:Colors.border },
  passengerExpiredX:    { position:"absolute", top:0, left:0, right:0, bottom:0, alignItems:"center", justifyContent:"center" },
  passengerExpiredText: { color:Colors.red, fontSize:30, fontWeight:"900", opacity:0.85 },
  passengerContactRow:        { flexDirection:"row", gap:8, paddingHorizontal:12, paddingVertical:10, borderBottomWidth:0.3, borderBottomColor:Colors.border },
  passengerContactBtn:        { flex:1, flexDirection:"row", alignItems:"center", justifyContent:"center", gap:6, paddingVertical:10, borderRadius:10, backgroundColor:Colors.cardAlt, borderWidth:0.5, borderColor:Colors.border },
  passengerContactBtnPrimary: { backgroundColor:Colors.accent, borderColor:Colors.accent },
  passengerContactBtnLocked:  { opacity:0.5 },
  passengerContactEmoji:      { fontSize:14 },
  passengerContactLabel:      { color:Colors.t1, fontSize:13, fontWeight:"700" },
  passengerContactBadge:      { position:"absolute", top:-4, right:-4, minWidth:18, height:18, borderRadius:9, backgroundColor:Colors.red, paddingHorizontal:4, alignItems:"center", justifyContent:"center" },
  passengerContactBadgeText:  { color:"#fff", fontSize:10, fontWeight:"800" },
  statsRow:    { flexDirection:"row", padding:12 },
  statBox:     { flex:1, alignItems:"center" },
  statVal:     { fontSize:16, fontWeight:"800", color:Colors.t1 },
  statKey:     { fontSize:10, color:Colors.t3, marginTop:2 },
  warnBanner:  { backgroundColor:Colors.red+"15", borderTopWidth:0.5, borderTopColor:Colors.red+"40", padding:8 },
  warnText:    { color:Colors.red, fontSize:11, textAlign:"center", fontWeight:"600" },
  claimBtn:    { backgroundColor:"#22C55E", padding:14, alignItems:"center" },
  claimBtnText:{ color:"#fff", fontSize:14, fontWeight:"800" },
  claimBtnClaimed:  { backgroundColor:Colors.accent },
  claimBtnDisabled: { backgroundColor:Colors.card, opacity:0.7 },
  loadingBlock: { alignItems:"center", marginTop:60, gap:12 },
  loadingText: { color:Colors.t2, textAlign:"center" },
  empty:       { alignItems:"center", marginTop:80, paddingHorizontal:24 },
  emptyEmoji:  { fontSize:48, marginBottom:12 },
  emptyText:   { fontSize:15, color:Colors.t2, textAlign:"center", lineHeight:22 },
});
