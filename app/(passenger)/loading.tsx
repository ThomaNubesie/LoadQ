import { useCallback, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, RefreshControl, Alert, Modal } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { QueueAPI } from "../../services/queue";
import { ClaimsAPI } from "../../services/claims";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { QueueEntry } from "../../constants/types";
import { useZones } from "../../hooks/useZones";
import { getDistanceKm } from "../../constants/zones";
import { getPricePerSeat, getDestinationsFrom, getRegionName } from "../../constants/pricing";
import { useDestinations } from "../../hooks/useDestinations";
import { loadingState, formatRemaining } from "../../utils/loadingTimer";
import { useNow } from "../../hooks/useNow";
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

  const [entries,    setEntries]    = useState<QueueEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeZone, setActiveZone] = useState(zones[0] || null);
  const [destFilter, setDestFilter] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<{lat:number,lon:number}|null>(null);
  const [openClaims, setOpenClaims] = useState<Record<string, string>>({}); // entryId -> claimId
  const [claiming,   setClaiming]   = useState<string | null>(null);
  const [showDestPicker, setShowDestPicker] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    let zone = activeZone;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude, longitude } = loc.coords;
        setUserCoords({ lat: latitude, lon: longitude });
        // Auto-localize to nearest zone (the passenger loading view always
        // follows GPS — there's no manual zone picker on this screen).
        if (zones.length > 0) {
          const nearest = zones
            .map(z => ({ z, d: getDistanceKm(latitude, longitude, z.latitude, z.longitude) }))
            .sort((a, b) => a.d - b.d)[0]?.z;
          if (nearest) { zone = nearest; setActiveZone(nearest); }
        }
      }
    } catch {}
    if (zone) {
      const q = await QueueAPI.getZoneQueue(zone.id);
      const loadingEntries = q.filter(e => e.status === "loading");
      setEntries(loadingEntries);
      // Check each entry to see if we already have a claim on it.
      const openMap: Record<string, string> = {};
      await Promise.all(loadingEntries.map(async e => {
        const c = await ClaimsAPI.findOpenClaim(e.id);
        if (c) openMap[e.id] = c.id;
      }));
      setOpenClaims(openMap);
    }
    setLoading(false); setRefreshing(false);
  }, [activeZone?.id, zones]);

  const inGeo = !!(activeZone && userCoords &&
    getDistanceKm(userCoords.lat, userCoords.lon, activeZone.latitude, activeZone.longitude) * 1000 <= activeZone.radius_meters);

  const handleClaim = async (entry: QueueEntry) => {
    if (!inGeo) {
      Alert.alert("Out of range", t.outOfRange);
      return;
    }
    setClaiming(entry.id);
    const { data, error } = await ClaimsAPI.claim(entry.id);
    setClaiming(null);
    if (error) { Alert.alert(t.error, error); return; }
    if (data) setOpenClaims(prev => ({ ...prev, [entry.id]: data.id }));
  };

  useEffect(() => { load(); }, [load]);

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

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>🚌 {t.loadingNowTitle}</Text>
        <View style={{ flex: 1 }} />
        <Text style={s.subtitle}>{activeZone?.name}</Text>
      </View>

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
          <Text style={s.loadingText}>{t.loading}</Text>
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

            return (
              <View key={entry.id} style={s.card}>
                {vehicle && (
                  <Image
                    source={{ uri: getVehicleImageUrl(vehicle.make, vehicle.model, vehicle.year, "side", vehicle.color || undefined) }}
                    style={s.vehicleImg}
                    resizeMode="contain"
                  />
                )}
                <View style={s.driverRow}>
                  {entry.driver?.avatar_url ? (
                    <Image source={{ uri: entry.driver.avatar_url }} style={s.avatar} />
                  ) : (
                    <View style={s.avatarFallback}><Text style={{ fontSize: 22 }}>👤</Text></View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={s.driverNameRow}>
                      <Text style={s.driverName}>{entry.driver?.full_name || "Driver"}</Text>
                      {entry.driver?.verified && <VerifiedBadge size={15} />}
                      {entry.driver_id && (
                        <UserActionMenu
                          userId={entry.driver_id}
                          userName={entry.driver?.full_name || "Driver"}
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

                <View style={s.seatGrid}>
                  {Array.from({ length: seats }).map((_, i) => (
                    <SeatSvg key={i} size="full" filled={i < boarded} locked={i < (entry.seats_locked || 0)} color={Colors.accent} disabled />
                  ))}
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
  loadingText: { color:Colors.t2, textAlign:"center", marginTop:40 },
  empty:       { alignItems:"center", marginTop:80, paddingHorizontal:24 },
  emptyEmoji:  { fontSize:48, marginBottom:12 },
  emptyText:   { fontSize:15, color:Colors.t2, textAlign:"center", lineHeight:22 },
});
