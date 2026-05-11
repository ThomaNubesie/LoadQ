import { useCallback, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { QueueAPI } from "../../services/queue";
import { DriversAPI } from "../../services/drivers";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { QueueEntry, Vehicle } from "../../constants/types";
import { VEHICLE_TYPES } from "../../constants/vehicles";
import SeatSvg from "../../components/SeatSvg";
import { getVehicleImageUrl } from "../../utils/vehicleImage";
import { Image } from "react-native";

const DEMO_ZONE_ID = "00000000-0000-0000-0000-000000000001";

export default function QueueScreen() {
  const router = useRouter();
  const { zoneName } = useLocalSearchParams<{ zoneName?: string }>();
  const { t }  = useStrings();
  const [entries,    setEntries]    = useState<QueueEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myId,       setMyId]       = useState<string|null>(null);
  const [myVehicle,  setMyVehicle]  = useState<Vehicle|null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const [q, driver] = await Promise.all([
      QueueAPI.getZoneQueue(DEMO_ZONE_ID),
      DriversAPI.getMe(),
    ]);
    setEntries(q);
    setMyId(driver?.id || null);
    const vehicles = await DriversAPI.getVehicles();
    setMyVehicle(vehicles.find(v => v.is_active) || vehicles[0] || null);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
    const sub = QueueAPI.subscribeToZone(DEMO_ZONE_ID, () => load());
    return () => { sub.unsubscribe(); };
  }, []);

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

  const renderEntry = (entry: QueueEntry, idx: number) => {
    const vehicle   = entry.vehicle;
    const vType     = vehicle ? VEHICLE_TYPES[vehicle.type] : null;
    const seats     = vehicle?.seats || 4;
    const boarded   = entry.seats_boarded || 0;
    const isMe      = entry.driver_id === myId;
    const states    = (entry.seat_states as string[]) || [];

    return (
      <TouchableOpacity
        key={entry.id}
        style={[s.row, isMe && s.rowMe, entry.status === "loading" && s.rowLoading]}
        onPress={() => isMe && router.push("/(app)/my-loading")}
        activeOpacity={isMe ? 0.8 : 1}
      >
        <View style={[s.pos, { backgroundColor: idx === 0 ? Colors.yellow : idx === 1 ? "#6B7280" : idx === 2 ? "#92400E" : Colors.card }]}>
          <Text style={[s.posText, { color: idx < 3 ? "#000" : Colors.t2 }]}>{entry.position}</Text>
        </View>

        <View style={[s.carIcon, { backgroundColor: (statusColor(entry.status))+"20", borderColor: (statusColor(entry.status))+"40" }]}>
          <Text style={{ fontSize:16 }}>{entry.status === "loading" ? "🚌" : entry.status === "called_back" ? "🔄" : "🚗"}</Text>
        </View>

        <View style={s.info}>
          <Text style={s.name}>{entry.driver?.full_name || "Driver"} {isMe ? "(you)" : ""}</Text>
          <Text style={s.vehicleName}>{vehicle ? `${vehicle.make} ${vehicle.model}` : "Vehicle"}</Text>
          <View style={s.miniSeats}>
            {Array.from({ length: seats }).map((_, i) => (
              <SeatSvg
                key={i}
                size="mini"
                filled={i < boarded}
                color={statusColor(entry.status)}
                disabled
              />
            ))}
          </View>
          <Text style={[s.statusText, { color: statusColor(entry.status) }]}>
            {boarded}/{seats} · {statusLabel(entry.status)}
            {entry.status === "loading" && entry.seats_locked ? ` · ${entry.seats_locked} 🔒` : ""}
          </Text>
        </View>

        {entry.status === "called_back" && entry.return_deadline && (
          <View style={s.timer}>
            <Text style={s.timerText}>⏱</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>{zoneName || "Queue"}</Text>
          <View style={s.liveRow}>
            <View style={s.liveDot} />
            <Text style={s.liveText}>{t.zoneActive} · {entries.length} drivers</Text>
          </View>
        </View>
        <TouchableOpacity style={s.profileBtn} onPress={() => router.push("/(app)/profile")}>
          <Text style={{ fontSize:18 }}>👤</Text>
        </TouchableOpacity>
      </View>

      {myVehicle && (
        <View style={s.vehicleBanner}>
          <Image source={{ uri: getVehicleImageUrl(myVehicle.make, myVehicle.model, myVehicle.year) }} style={s.vehicleBannerImg} resizeMode="contain" />
          <View style={s.vehicleBannerInfo}>
            <Text style={s.vehicleBannerName}>{myVehicle.year} {myVehicle.make} {myVehicle.model}</Text>
            <Text style={s.vehicleBannerSub}>{myVehicle.plate} · {myVehicle.seats} seats</Text>
          </View>
          <TouchableOpacity style={s.changeZoneBtn} onPress={() => router.push("/(app)/zone-select")}>
            <Text style={s.changeZoneText}>Change zone</Text>
          </TouchableOpacity>
        </View>
      )}
      <ScrollView
        style={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.accent} />}
      >
        {loading ? (
          <Text style={s.loadingText}>{t.loading}</Text>
        ) : (
          <>
            {groups.loading.length > 0 && (
              <>
                <Text style={s.groupLabel}>{t.loadingNow}</Text>
                {groups.loading.map((e,i) => renderEntry(e,i))}
              </>
            )}
            {groups.called_back.length > 0 && (
              <>
                <Text style={s.groupLabel}>{t.calledBack}</Text>
                {groups.called_back.map((e,i) => renderEntry(e, groups.loading.length + i))}
              </>
            )}
            {groups.waiting.length > 0 && (
              <>
                <Text style={s.groupLabel}>{t.waiting}</Text>
                {groups.waiting.map((e,i) => renderEntry(e, groups.loading.length + groups.called_back.length + i))}
              </>
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

      <View style={s.bottomNav}>
        {[
          { icon:"📋", label:t.queue,       route:"/(app)/queue"      },
          { icon:"🚗", label:t.myLoading,   route:"/(app)/my-loading" },
          { icon:"🔔", label:t.notifications,route:"/(app)/alerts"    },
          { icon:"👤", label:t.profile,     route:"/(app)/profile"    },
        ].map(item => (
          <TouchableOpacity key={item.route} style={s.navItem} onPress={() => router.push(item.route as any)}>
            <Text style={{ fontSize:18 }}>{item.icon}</Text>
            <Text style={s.navLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:    { flex:1, backgroundColor:Colors.bg },
  header:       { flexDirection:"row", alignItems:"center", justifyContent:"space-between", paddingHorizontal:16, paddingTop:8, paddingBottom:12 },
  headerTitle:  { fontSize:17, fontWeight:"700", color:Colors.t1 },
  liveRow:      { flexDirection:"row", alignItems:"center", gap:5, marginTop:3 },
  liveDot:      { width:7, height:7, borderRadius:4, backgroundColor:Colors.accent },
  liveText:     { fontSize:11, color:Colors.t2 },
  profileBtn:   { width:36, height:36, borderRadius:10, backgroundColor:Colors.card, alignItems:"center", justifyContent:"center" },
  scroll:       { flex:1, paddingHorizontal:16 },
  groupLabel:   { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.7, textTransform:"uppercase", marginBottom:8, marginTop:12 },
  row:          { flexDirection:"row", alignItems:"center", gap:10, backgroundColor:Colors.card, borderRadius:12, padding:10, marginBottom:6, borderWidth:0.5, borderColor:Colors.border },
  rowMe:        { borderColor:Colors.accent+"60", backgroundColor:Colors.accent+"08" },
  rowLoading:   { borderColor:Colors.accent+"40", backgroundColor:Colors.accent+"06" },
  pos:          { width:26, height:26, borderRadius:13, alignItems:"center", justifyContent:"center", flexShrink:0 },
  posText:      { fontSize:11, fontWeight:"700" },
  carIcon:      { width:34, height:34, borderRadius:8, alignItems:"center", justifyContent:"center", borderWidth:0.5, flexShrink:0 },
  info:         { flex:1, minWidth:0 },
  name:         { fontSize:12, fontWeight:"600", color:Colors.t1 },
  vehicleName:  { fontSize:10, color:Colors.t3, marginTop:1 },
  miniSeats:    { flexDirection:"row", flexWrap:"wrap", gap:2, marginTop:4 },
  statusText:   { fontSize:10, marginTop:3 },
  timer:        { flexShrink:0 },
  timerText:    { fontSize:16 },
  loadingText:  { color:Colors.t2, textAlign:"center", marginTop:40 },
  empty:        { alignItems:"center", marginTop:80 },
  emptyEmoji:   { fontSize:48, marginBottom:12 },
  emptyText:    { fontSize:18, fontWeight:"700", color:Colors.t1 },
  emptySub:     { fontSize:13, color:Colors.t3, marginTop:4 },
  bottomNav:    { flexDirection:"row", backgroundColor:Colors.card, borderTopWidth:0.5, borderTopColor:Colors.border, paddingVertical:8 },
  navItem:      { flex:1, alignItems:"center", gap:3 },
  navLabel:     { fontSize:10, color:Colors.t3 },
});
