import { useCallback, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Image, Modal } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { QueueAPI } from "../../services/queue";
import * as Location from "expo-location";
import { DriversAPI } from "../../services/drivers";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { QueueEntry, Vehicle } from "../../constants/types";
import SeatSvg from "../../components/SeatSvg";
import {
  ZONE_LOCATIONS, REGIONS, detectUserRegion, getDistanceKm,
  ZoneLocation, RegionCode, getZonesByRegion
} from "../../constants/zones";
import { getVehicleImageUrl } from "../../utils/vehicleImage";

export default function QueueScreen() {
  const router = useRouter();
  const { zoneId: paramZoneId, zoneName: paramZoneName } = useLocalSearchParams<{ zoneId?: string; zoneName?: string }>();
  const { t } = useStrings();

  const [entries,      setEntries]      = useState<QueueEntry[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [myId,         setMyId]         = useState<string|null>(null);
  const [myVehicle,    setMyVehicle]    = useState<Vehicle|null>(null);
  const [userRegion,   setUserRegion]   = useState<RegionCode|null>(null);
  const [activeZone,   setActiveZone]   = useState<ZoneLocation|null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropRegion,   setDropRegion]   = useState<RegionCode>("ottawa");
  const [userCoords,   setUserCoords]   = useState<{lat:number,lon:number}|null>(null);
  const [joining,      setJoining]      = useState(false);
  const [joinError,    setJoinError]    = useState("");
  const [myEntry,      setMyEntry]      = useState<QueueEntry|null>(null);

  // Resolve active zone from params or GPS
  const resolveZone = (lat: number, lon: number) => {
    if (paramZoneId) {
      const z = ZONE_LOCATIONS.find(z => z.id === paramZoneId);
      if (z) return z;
    }
    // Find nearest zone
    const sorted = ZONE_LOCATIONS
      .map(z => ({ ...z, dist: getDistanceKm(lat, lon, z.latitude, z.longitude) }))
      .sort((a: any, b: any) => a.dist - b.dist);
    return sorted[0] || ZONE_LOCATIONS[0];
  };

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const lat = loc.coords.latitude;
        const lon = loc.coords.longitude;
        setUserCoords({ lat, lon });
        const region = detectUserRegion(lat, lon);
        setUserRegion(region);
        if (region) setDropRegion(region);
        const zone = resolveZone(lat, lon);
        setActiveZone(zone);
      } else {
        // No GPS — use param or first zone
        const z = paramZoneId ? ZONE_LOCATIONS.find(z => z.id === paramZoneId) : ZONE_LOCATIONS[0];
        setActiveZone(z || ZONE_LOCATIONS[0]);
      }
    } catch {
      setActiveZone(ZONE_LOCATIONS[0]);
    }

    const [driver, vehicles] = await Promise.all([
      DriversAPI.getMe(),
      DriversAPI.getVehicles(),
    ]);
    setMyId(driver?.id || null);
    setMyVehicle(vehicles.find(v => v.is_active) || vehicles[0] || null);
    setLoading(false);
    setRefreshing(false);
  }, [paramZoneId]);

  useEffect(() => { load(); }, []);

  const handleJoinQueue = async () => {
    if (!activeZone || !myVehicle) return;
    setJoinError("");

    // Check if already in queue
    if (myEntry) { setJoinError("You are already in this queue"); return; }

    // Check geo-fence
    if (userCoords) {
      const dist = getDistanceKm(userCoords.lat, userCoords.lon, activeZone.latitude, activeZone.longitude);
      const allowedRadius = activeZone.radius_meters / 1000;
      if (dist > allowedRadius) {
        setJoinError("You must be within " + activeZone.radius_meters + "m of this zone to join. Drive to " + activeZone.name + " first.");
        return;
      }
    } else {
      setJoinError("Location required to join. Please enable GPS.");
      return;
    }

    setJoining(true);
    const { error } = await QueueAPI.joinQueue(activeZone.id, myVehicle.id);
    setJoining(false);
    if (error) { setJoinError(error); return; }
    QueueAPI.getZoneQueue(activeZone.id).then(q => {
      setEntries(q);
      const me = q.find(e => e.driver_id === myId);
      setMyEntry(me || null);
    });
  };

  // Load queue when activeZone changes
  useEffect(() => {
    if (!activeZone) return;
    QueueAPI.getZoneQueue(activeZone.id).then(q => {
      setEntries(q);
    });
    const sub = QueueAPI.subscribeToZone(activeZone.id, () => {
      QueueAPI.getZoneQueue(activeZone.id).then(q => {
        setEntries(q);
      });
    });
    return () => { sub.unsubscribe(); };
  }, [activeZone?.id]);

  // Track my entry
  useEffect(() => {
    if (myId && entries.length > 0) {
      setMyEntry(entries.find(e => e.driver_id === myId) || null);
    }
  }, [entries, myId]);

  const statusColor = (status: string) => {
    if (status === "loading")     return Colors.accent;
    if (status === "called_back") return Colors.yellow;
    if (status === "penalised")   return Colors.red;
    return Colors.t3;
  };

  const statusLabel = (status: string) => {
    if (status === "loading")     return t.loadingNow;
    if (status === "called_back") return t.returning;
    if (status === "penalised")   return t.penalised;
    return t.standby;
  };

  const groups = {
    loading:     entries.filter(e => e.status === "loading"),
    called_back: entries.filter(e => e.status === "called_back"),
    waiting:     entries.filter(e => e.status === "waiting" || e.status === "penalised"),
  };

  const isMyRegion = !activeZone || activeZone.region === userRegion || userRegion === null;

  const renderEntry = (entry: QueueEntry, idx: number) => {
    const vehicle  = entry.vehicle;
    const totalSeats = vehicle?.seats || 4;
    const seats      = Math.max(totalSeats - 1, 1); // exclude driver
    const boarded  = entry.seats_boarded || 0;
    const isMe     = entry.driver_id === myId;
    const states   = (entry.seat_states as string[]) || [];
    const sc       = statusColor(entry.status);

    return (
      <TouchableOpacity
        key={entry.id}
        style={[s.row, isMe && s.rowMe, entry.status === "loading" && s.rowLoading]}
        onPress={() => isMe ? router.replace("/(app)/my-loading") : null}
        activeOpacity={isMe ? 0.8 : 1}
      >
        <View style={[s.pos, {
          backgroundColor: idx === 0 ? Colors.yellow : idx === 1 ? "#6B7280" : idx === 2 ? "#92400E" : Colors.card
        }]}>
          <Text style={[s.posText, { color: idx < 3 ? "#000" : Colors.t2 }]}>{entry.position}</Text>
        </View>
        <View style={[s.carIcon, { backgroundColor: sc+"20", borderColor: sc+"40" }]}>
          <Text style={{ fontSize:14 }}>{entry.status === "loading" ? "🚌" : entry.status === "called_back" ? "🔄" : "🚗"}</Text>
        </View>
        <View style={s.info}>
          <Text style={s.name}>{entry.driver?.full_name || "Driver"}{isMe ? " (you)" : ""}</Text>
          <Text style={s.vehicleName}>{vehicle ? `${vehicle.make} ${vehicle.model}` : "Vehicle"}</Text>
          <View style={s.miniSeats}>
            {Array.from({ length: seats }).map((_, i) => (
              <SeatSvg key={i} size="mini" filled={i < boarded} color={sc} disabled />
            ))}
          </View>
          <Text style={[s.statusText, { color: sc }]}>
            {boarded}/{seats} · {statusLabel(entry.status)}
            {entry.seats_locked ? ` · ${entry.seats_locked} 🔒` : ""}
          </Text>
        </View>
        {entry.status === "called_back" && <Text style={{ fontSize:16 }}>⏱</Text>}
      </TouchableOpacity>
    );
  };

  const dropZones = getZonesByRegion(dropRegion);

  return (
    <SafeAreaView style={s.container}>

      {/* ── Header ── */}
      <View style={s.header}>
        <View style={{ flex:1 }}>
          {/* Zone picker */}
          <TouchableOpacity style={s.zonePicker} onPress={() => setShowDropdown(true)} activeOpacity={0.8}>
            <Text style={s.zonePickerName}>{activeZone?.name || "Select zone"}</Text>
            <Text style={s.zonePickerRegion}>{activeZone ? REGIONS.find(r => r.code === activeZone.region)?.name : ""} ▾</Text>
          </TouchableOpacity>
          {activeZone && (
            <View style={s.liveRow}>
              <View style={s.liveDot} />
              <Text style={s.liveText}>Live · {entries.length} in queue</Text>
              {!isMyRegion && <Text style={s.watchTag}> · Watching only</Text>}
            </View>
          )}
        </View>
        <TouchableOpacity style={s.profileBtn} onPress={() => router.replace("/(app)/profile")}>
          <Text style={{ fontSize:18 }}>👤</Text>
        </TouchableOpacity>
      </View>

      {/* ── My vehicle card ── */}
      {myVehicle && (
        <View style={s.vehicleBanner}>
          <Image
            source={{ uri: getVehicleImageUrl(myVehicle.make, myVehicle.model, myVehicle.year) }}
            style={s.vehicleBannerImg}
            resizeMode="contain"
          />
          <View style={s.vehicleBannerInfo}>
            <Text style={s.vehicleBannerName}>{myVehicle.year} {myVehicle.make} {myVehicle.model}</Text>
            <Text style={s.vehicleBannerSub}>{myVehicle.plate} · {myVehicle.seats} seats</Text>
          </View>
          {isMyRegion && (
            myEntry ? (
              <TouchableOpacity style={s.joinBtn} onPress={() => router.replace("/(app)/my-loading")} activeOpacity={0.85}>
                <Text style={s.joinBtnText}>#{myEntry.position} · Loading →</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[s.joinBtn, s.joinBtnPrimary]} onPress={handleJoinQueue} disabled={joining} activeOpacity={0.85}>
                <Text style={[s.joinBtnText, { color: Colors.accentText }]}>{joining ? "Joining..." : "Join queue"}</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      )}

      {/* Join error */}
      {!!joinError && (
        <View style={s.geoError}>
          <Text style={s.geoErrorText}>📍 {joinError}</Text>
          <TouchableOpacity onPress={() => setJoinError("")}>
            <Text style={{ color:Colors.t3, fontSize:16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Queue list ── */}
      <ScrollView
        style={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.accent} />}
      >
        {loading ? (
          <Text style={s.loadingText}>{t.loading}</Text>
        ) : (
          <>
            {groups.loading.length > 0 && (
              <><Text style={s.groupLabel}>{t.loadingNow}</Text>{groups.loading.map((e,i) => renderEntry(e,i))}</>
            )}
            {groups.called_back.length > 0 && (
              <><Text style={s.groupLabel}>{t.calledBack}</Text>{groups.called_back.map((e,i) => renderEntry(e, groups.loading.length+i))}</>
            )}
            {groups.waiting.length > 0 && (
              <><Text style={s.groupLabel}>{t.waiting}</Text>{groups.waiting.map((e,i) => renderEntry(e, groups.loading.length+groups.called_back.length+i))}</>
            )}
            {entries.length === 0 && (
              <View style={s.empty}>
                <Text style={s.emptyEmoji}>🚗</Text>
                <Text style={s.emptyText}>Queue is empty</Text>
                <Text style={s.emptySub}>Be the first to join</Text>
              </View>
            )}
          </>
        )}
        <View style={{ height:100 }} />
      </ScrollView>

      {/* ── Bottom nav ── */}
      <View style={s.bottomNav}>
        {[
          { icon:"📋", label:t.queue,          route:"/(app)/queue"        },
          { icon:"🚗", label:t.myLoading,      route:"/(app)/my-loading"   },
          { icon:"🔔", label:t.notifications,  route:"/(app)/alerts"       },
          { icon:"👤", label:t.profile,        route:"/(app)/profile"      },
        ].map(item => (
          <TouchableOpacity key={item.route} style={s.navItem} onPress={() => router.replace(item.route as any)}>
            <Text style={{ fontSize:18 }}>{item.icon}</Text>
            <Text style={s.navLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Zone selector dropdown modal ── */}
      <Modal visible={showDropdown} transparent animationType="slide" onRequestClose={() => setShowDropdown(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowDropdown(false)}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Select loading zone</Text>

            {/* City tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:12 }} contentContainerStyle={{ gap:8, paddingHorizontal:16 }}>
              {REGIONS.map(r => (
                <TouchableOpacity
                  key={r.code}
                  style={[s.cityTab, dropRegion === r.code && s.cityTabActive]}
                  onPress={() => setDropRegion(r.code)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.cityTabText, dropRegion === r.code && { color:Colors.accent }]}>{r.name}</Text>
                  {r.code === userRegion && <View style={s.cityTabDot} />}
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Zone list for selected city */}
            <ScrollView contentContainerStyle={{ paddingHorizontal:16, paddingBottom:40 }}>
              {dropZones.map(zone => {
                const isActive = activeZone?.id === zone.id;
                const dist = userCoords
                  ? getDistanceKm(userCoords.lat, userCoords.lon, zone.latitude, zone.longitude)
                  : null;
                const canJoin = zone.region === userRegion || userRegion === null;
                return (
                  <TouchableOpacity
                    key={zone.id}
                    style={[s.zoneRow, isActive && s.zoneRowActive]}
                    onPress={() => { setActiveZone(zone); setShowDropdown(false); }}
                    activeOpacity={0.8}
                  >
                    <View style={{ flex:1 }}>
                      <Text style={s.zoneRowName}>{zone.name}</Text>
                      <Text style={s.zoneRowAddr}>{zone.address}</Text>
                      {dist !== null && (
                        <Text style={s.zoneRowDist}>
                          {dist < 1 ? `${Math.round(dist*1000)}m away` : `${dist.toFixed(1)}km away`}
                        </Text>
                      )}
                    </View>
                    <View style={{ alignItems:"flex-end", gap:4 }}>
                      {isActive && <Text style={s.activeTag}>✓ Active</Text>}
                      {!canJoin && <Text style={s.watchOnlyTag}>Watch only</Text>}
                      <View style={s.liveDot} />
                    </View>
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
  container:          { flex:1, backgroundColor:Colors.bg },
  header:             { flexDirection:"row", alignItems:"center", paddingHorizontal:16, paddingTop:8, paddingBottom:10, gap:10 },
  zonePicker:         { flexDirection:"row", alignItems:"center", gap:8 },
  zonePickerName:     { fontSize:16, fontWeight:"700", color:Colors.t1 },
  zonePickerRegion:   { fontSize:13, color:Colors.accent, fontWeight:"600" },
  liveRow:            { flexDirection:"row", alignItems:"center", gap:5, marginTop:3 },
  liveDot:            { width:7, height:7, borderRadius:4, backgroundColor:Colors.accent },
  liveText:           { fontSize:11, color:Colors.t2 },
  watchTag:           { fontSize:11, color:Colors.yellow },
  profileBtn:         { width:36, height:36, borderRadius:10, backgroundColor:Colors.card, alignItems:"center", justifyContent:"center" },
  vehicleBanner:      { flexDirection:"row", alignItems:"center", backgroundColor:Colors.card, borderBottomWidth:0.5, borderBottomColor:Colors.border, paddingHorizontal:14, paddingVertical:10, gap:10 },
  vehicleBannerImg:   { width:80, height:50, borderRadius:8 },
  vehicleBannerInfo:  { flex:1 },
  vehicleBannerName:  { fontSize:12, fontWeight:"600", color:Colors.t1 },
  vehicleBannerSub:   { fontSize:11, color:Colors.t3, marginTop:2 },
  joinBtn:            { backgroundColor:Colors.accent+"20", borderRadius:8, paddingHorizontal:10, paddingVertical:6, borderWidth:0.5, borderColor:Colors.accent+"50" },
  joinBtnText:        { color:Colors.accent, fontSize:11, fontWeight:"700" },
  scroll:             { flex:1, paddingHorizontal:16 },
  groupLabel:         { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.7, textTransform:"uppercase", marginBottom:8, marginTop:12 },
  row:                { flexDirection:"row", alignItems:"center", gap:10, backgroundColor:Colors.card, borderRadius:12, padding:10, marginBottom:6, borderWidth:0.5, borderColor:Colors.border },
  rowMe:              { borderColor:Colors.accent+"60", backgroundColor:Colors.accent+"08" },
  rowLoading:         { borderColor:Colors.accent+"40" },
  pos:                { width:26, height:26, borderRadius:13, alignItems:"center", justifyContent:"center", flexShrink:0 },
  posText:            { fontSize:11, fontWeight:"700" },
  carIcon:            { width:34, height:34, borderRadius:8, alignItems:"center", justifyContent:"center", borderWidth:0.5, flexShrink:0 },
  info:               { flex:1, minWidth:0 },
  name:               { fontSize:12, fontWeight:"600", color:Colors.t1 },
  vehicleName:        { fontSize:10, color:Colors.t3, marginTop:1 },
  miniSeats:          { flexDirection:"row", flexWrap:"wrap", gap:2, marginTop:4 },
  statusText:         { fontSize:10, marginTop:3 },
  loadingText:        { color:Colors.t2, textAlign:"center", marginTop:40 },
  empty:              { alignItems:"center", marginTop:80 },
  emptyEmoji:         { fontSize:48, marginBottom:12 },
  emptyText:          { fontSize:18, fontWeight:"700", color:Colors.t1 },
  emptySub:           { fontSize:13, color:Colors.t3, marginTop:4 },
  bottomNav:          { flexDirection:"row", backgroundColor:Colors.card, borderTopWidth:0.5, borderTopColor:Colors.border, paddingVertical:8 },
  navItem:            { flex:1, alignItems:"center", gap:3 },
  navLabel:           { fontSize:10, color:Colors.t3 },
  // Modal
  modalOverlay:       { flex:1, backgroundColor:"rgba(0,0,0,0.6)", justifyContent:"flex-end" },
  modalSheet:         { backgroundColor:Colors.card, borderTopLeftRadius:20, borderTopRightRadius:20, paddingTop:12, maxHeight:"75%" },
  modalHandle:        { width:36, height:4, borderRadius:2, backgroundColor:Colors.border, alignSelf:"center", marginBottom:16 },
  modalTitle:         { fontSize:16, fontWeight:"700", color:Colors.t1, paddingHorizontal:16, marginBottom:14 },
  cityTab:            { paddingHorizontal:14, paddingVertical:8, borderRadius:20, borderWidth:1, borderColor:Colors.border, backgroundColor:Colors.cardAlt, position:"relative" },
  cityTabActive:      { borderColor:Colors.accent, backgroundColor:Colors.accent+"15" },
  cityTabText:        { color:Colors.t2, fontSize:13, fontWeight:"500" },
  cityTabDot:         { position:"absolute", top:3, right:3, width:6, height:6, borderRadius:3, backgroundColor:Colors.accent },
  zoneRow:            { flexDirection:"row", alignItems:"center", padding:14, borderRadius:12, marginBottom:8, backgroundColor:Colors.bg, borderWidth:0.5, borderColor:Colors.border },
  zoneRowActive:      { borderColor:Colors.accent, backgroundColor:Colors.accent+"08" },
  zoneRowName:        { fontSize:14, fontWeight:"600", color:Colors.t1, marginBottom:2 },
  zoneRowAddr:        { fontSize:11, color:Colors.t3 },
  zoneRowDist:        { fontSize:11, color:Colors.accent, marginTop:3 },
  activeTag:          { fontSize:10, color:Colors.accent, fontWeight:"700" },
  watchOnlyTag:       { fontSize:10, color:Colors.yellow },
  joinBtnPrimary:     { backgroundColor:Colors.accent, borderColor:Colors.accent },
  geoError:           { flexDirection:"row", alignItems:"center", justifyContent:"space-between", backgroundColor:Colors.red+"15", borderLeftWidth:3, borderLeftColor:Colors.red, marginHorizontal:16, marginBottom:8, padding:12, borderRadius:8 },
  geoErrorText:       { flex:1, color:Colors.red, fontSize:12, lineHeight:18 },
});
