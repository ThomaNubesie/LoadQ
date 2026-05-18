import { useCallback, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Image, Modal } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { QueueAPI } from "../../services/queue";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { QueueEntry } from "../../constants/types";
import {
  REGIONS, detectUserRegion, RegionCode, getZonesByRegion, getDistanceKm
} from "../../constants/zones";
import { useZones } from "../../hooks/useZones";
import { getPricePerSeat, getDestinationsFrom, getRegionName } from "../../constants/pricing";
import { useDestinations } from "../../hooks/useDestinations";
import { loadingState, formatRemaining } from "../../utils/loadingTimer";
import { useNow } from "../../hooks/useNow";
import ZoneMap from "../../components/ZoneMap";
import PassengerBottomNav from "../../components/PassengerBottomNav";
import SeatSvg from "../../components/SeatSvg";

export default function PassengerQueueScreen() {
  const router = useRouter();
  const { t }  = useStrings();
  const { zones } = useZones();
  const { activeCodes: activeDestCodes } = useDestinations();

  const [entries,      setEntries]      = useState<QueueEntry[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [userRegion,   setUserRegion]   = useState<RegionCode|null>(null);
  const [activeZone,   setActiveZone]   = useState(zones[0] || null);
  const [destFilter,   setDestFilter]   = useState<string | null>(null);
  const [showZonePicker, setShowZonePicker] = useState(false);
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [manualZone,   setManualZone]   = useState(false); // true once user picks a zone by hand

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    let zone = activeZone;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude, longitude } = loc.coords;
        setUserRegion(detectUserRegion(latitude, longitude));
        // Auto-localize to the nearest zone unless the user picked one manually.
        if (!manualZone && zones.length > 0) {
          const nearest = zones
            .map(z => ({ z, d: getDistanceKm(latitude, longitude, z.latitude, z.longitude) }))
            .sort((a, b) => a.d - b.d)[0]?.z;
          if (nearest) { zone = nearest; setActiveZone(nearest); }
        }
      }
    } catch {}
    if (zone) {
      const q = await QueueAPI.getZoneQueue(zone.id);
      setEntries(q);
    }
    setLoading(false); setRefreshing(false);
  }, [activeZone?.id, manualZone, zones]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!activeZone) return;
    const sub = QueueAPI.subscribeToZone(activeZone.id, () => {
      QueueAPI.getZoneQueue(activeZone.id).then(setEntries);
    });
    return () => { sub.unsubscribe(); };
  }, [activeZone?.id]);

  const STATUS_RANK: Record<string, number> = { loading: 0, called_back: 1, waiting: 2, penalised: 3 };
  const filtered = destFilter
    ? entries.filter(e => e.destination_region === destFilter)
    : entries;
  const byDest = filtered.reduce<Record<string, QueueEntry[]>>((acc, e) => {
    const key = e.destination_region || "_unknown";
    (acc[key] ??= []).push(e);
    return acc;
  }, {});
  Object.values(byDest).forEach(list => list.sort((a, b) => {
    const sa = STATUS_RANK[a.status] ?? 9;
    const sb = STATUS_RANK[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return a.position - b.position;
  }));
  const sortedDestKeys = Object.keys(byDest).sort((a, b) =>
    getRegionName(a).localeCompare(getRegionName(b))
  );

  const loadingCount = entries.filter(e => e.status === "loading").length;
  const now = useNow(loadingCount > 0 ? 1000 : 30_000, true);

  // Active, admin-enabled destinations reachable from this zone.
  const reachable  = activeZone ? new Set(getDestinationsFrom(activeZone.region, activeDestCodes) as string[]) : new Set<string>();
  const allRegions = activeZone ? getDestinationsFrom(activeZone.region, activeDestCodes) : [];

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <View style={{ flex:1 }}>
          <TouchableOpacity onPress={() => setShowZonePicker(true)} activeOpacity={0.8}>
            <Text style={s.zoneName}>{activeZone?.name || "Select zone"}</Text>
            <Text style={s.zoneRegion}>{activeZone ? REGIONS.find(r => r.code === activeZone.region)?.name : ""} ▾</Text>
          </TouchableOpacity>
        </View>
      </View>

      {activeZone && (
        <ZoneMap latitude={activeZone.latitude} longitude={activeZone.longitude} label={activeZone.name} height={140} />
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
          <Text style={s.loadingText}>{t.loading}</Text>
        ) : entries.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>🚗</Text>
            <Text style={s.emptyText}>{t.queueEmpty}</Text>
            <Text style={s.emptySub}>{t.pickRouteFirst}</Text>
          </View>
        ) : sortedDestKeys.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>🛑</Text>
            <Text style={s.emptyText}>{t.noDriversRoute}</Text>
          </View>
        ) : (
          sortedDestKeys.map(destKey => {
            const list  = byDest[destKey];
            const price = getPricePerSeat(activeZone?.region, destKey);
            return (
              <View key={destKey} style={{ marginTop:14, paddingHorizontal:16 }}>
                <View style={s.destHeader}>
                  <Text style={s.destName}>→ {getRegionName(destKey)}</Text>
                  <View style={{ flexDirection:"row", gap:8, alignItems:"center" }}>
                    <Text style={s.destCount}>{list.length}</Text>
                    {price !== null && (
                      <View style={s.priceBadge}>
                        <Text style={s.priceBadgeText}>C${price} / seat</Text>
                      </View>
                    )}
                  </View>
                </View>
                {list.map((entry, idx) => {
                  const vehicle  = entry.vehicle;
                  const totalSeats = vehicle?.seats || 4;
                  const seats      = Math.max(totalSeats - 1, 1);
                  const boarded  = entry.seats_boarded || 0;
                  const lstate = entry.status === "loading"
                    ? loadingState(entry.load_start_at, seats, now)
                    : null;
                  const required = lstate ? lstate.effectiveRequired : seats;
                  return (
                    <View key={entry.id} style={[s.row, entry.status === "loading" && s.rowLoading]}>
                      <View style={s.pos}>
                        <Text style={s.posText}>{entry.position}</Text>
                      </View>
                      {entry.driver?.avatar_url ? (
                        <Image source={{ uri: entry.driver.avatar_url }} style={s.avatar} />
                      ) : (
                        <View style={s.avatarFallback}>
                          <Text style={{ fontSize:18 }}>👤</Text>
                        </View>
                      )}
                      <View style={s.info}>
                        <Text style={s.driverName}>{entry.driver?.full_name || "Driver"}</Text>
                        <Text style={s.vehicleName}>{vehicle ? `${vehicle.make} ${vehicle.model}` : "Vehicle"}</Text>
                        <View style={s.miniSeats}>
                          {Array.from({ length: seats }).map((_, i) => (
                            <SeatSvg key={i} size="mini" filled={i < boarded} color={entry.status === "loading" ? Colors.accent : Colors.t3} disabled />
                          ))}
                        </View>
                        <Text style={[s.statusText, { color: entry.status === "loading" ? Colors.accent : Colors.t2 }]}>
                          {boarded}/{required} · {entry.status === "loading" ? t.loadingNowTitle : t.waiting}
                          {lstate ? `  ⏱ ${formatRemaining(lstate.remainingMs)}` : ""}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })
        )}
        <View style={{ height:100 }} />
      </ScrollView>

      <PassengerBottomNav />

      {/* Destination picker */}
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

      <Modal visible={showZonePicker} transparent animationType="slide" onRequestClose={() => setShowZonePicker(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowZonePicker(false)}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>{t.pickOriginZone}</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {zones.map(z => (
                <TouchableOpacity
                  key={z.id}
                  style={s.zoneRow}
                  onPress={() => { setActiveZone(z); setManualZone(true); setShowZonePicker(false); }}
                >
                  <View style={{ flex:1 }}>
                    <Text style={s.zoneRowName}>{z.name}</Text>
                    <Text style={s.zoneRowSub}>{REGIONS.find(r => r.code === z.region)?.name} · {z.address}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex:1, backgroundColor:Colors.bg },
  header:      { flexDirection:"row", alignItems:"center", paddingHorizontal:16, paddingTop:8, paddingBottom:10, gap:10 },
  zoneName:    { fontSize:16, fontWeight:"700", color:Colors.t1 },
  zoneRegion:  { fontSize:13, color:Colors.accent, fontWeight:"600", marginTop:2 },
  destDropdown:      { flexDirection:"row", alignItems:"center", justifyContent:"space-between", backgroundColor:Colors.card, marginHorizontal:16, marginVertical:10, paddingVertical:12, paddingHorizontal:14, borderRadius:12, borderWidth:1, borderColor:Colors.border },
  destDropdownLabel: { fontSize:14, fontWeight:"700", color:Colors.t1 },
  destDropdownArrow: { fontSize:14, color:Colors.accent, fontWeight:"700" },
  destPickRow:       { flexDirection:"row", justifyContent:"space-between", alignItems:"center", paddingVertical:14, paddingHorizontal:16, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  destPickRowActive: { backgroundColor:Colors.accent+"10" },
  destPickName:      { fontSize:14, fontWeight:"600", color:Colors.t1 },
  destPickPrice:     { fontSize:12, color:Colors.accent, fontWeight:"700" },
  destPickPriceMuted:{ fontSize:11, color:Colors.t3, fontStyle:"italic" },
  scroll:      { flex:1 },
  destHeader:  { flexDirection:"row", justifyContent:"space-between", alignItems:"center", marginBottom:8 },
  destName:    { fontSize:13, fontWeight:"700", color:Colors.t1 },
  destCount:   { fontSize:11, color:Colors.t3 },
  priceBadge:  { backgroundColor:Colors.accent+"22", borderRadius:6, paddingHorizontal:7, paddingVertical:2, borderWidth:0.5, borderColor:Colors.accent+"44" },
  priceBadgeText:{ color:Colors.accent, fontSize:10, fontWeight:"700" },
  row:         { flexDirection:"row", alignItems:"center", gap:10, backgroundColor:Colors.card, borderRadius:12, padding:10, marginBottom:6, borderWidth:0.5, borderColor:Colors.border },
  rowLoading:  { borderColor:Colors.accent+"40" },
  pos:         { width:26, height:26, borderRadius:13, alignItems:"center", justifyContent:"center", flexShrink:0, backgroundColor:Colors.card, borderWidth:1, borderColor:Colors.border },
  posText:     { fontSize:11, fontWeight:"700", color:Colors.t2 },
  avatar:      { width:38, height:38, borderRadius:19, backgroundColor:Colors.cardAlt },
  avatarFallback: { width:38, height:38, borderRadius:19, backgroundColor:Colors.card, alignItems:"center", justifyContent:"center", borderWidth:0.5, borderColor:Colors.border },
  info:        { flex:1, minWidth:0 },
  driverName:  { fontSize:13, fontWeight:"600", color:Colors.t1 },
  vehicleName: { fontSize:10, color:Colors.t3, marginTop:1 },
  miniSeats:   { flexDirection:"row", flexWrap:"wrap", gap:2, marginTop:4 },
  statusText:  { fontSize:10, marginTop:3, fontWeight:"600" },
  loadingText: { color:Colors.t2, textAlign:"center", marginTop:40 },
  empty:       { alignItems:"center", marginTop:80, paddingHorizontal:24 },
  emptyEmoji:  { fontSize:48, marginBottom:12 },
  emptyText:   { fontSize:18, fontWeight:"700", color:Colors.t1, textAlign:"center" },
  emptySub:    { fontSize:13, color:Colors.t3, marginTop:4, textAlign:"center" },
  modalOverlay:{ flex:1, backgroundColor:"rgba(0,0,0,0.6)", justifyContent:"flex-end" },
  modalSheet:  { backgroundColor:Colors.card, borderTopLeftRadius:20, borderTopRightRadius:20, paddingTop:12, paddingBottom:24 },
  modalHandle: { width:36, height:4, borderRadius:2, backgroundColor:Colors.border, alignSelf:"center", marginBottom:16 },
  modalTitle:  { fontSize:16, fontWeight:"700", color:Colors.t1, paddingHorizontal:16, marginBottom:14 },
  zoneRow:     { paddingVertical:12, paddingHorizontal:16, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  zoneRowName: { fontSize:14, fontWeight:"600", color:Colors.t1 },
  zoneRowSub:  { fontSize:11, color:Colors.t3, marginTop:3 },
});
