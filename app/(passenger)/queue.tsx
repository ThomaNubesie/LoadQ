import { useCallback, useEffect, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Location from "expo-location";
import { QueueAPI } from "../../services/queue";
import { Colors } from "../../constants/colors";
import { QueueEntry } from "../../constants/types";
import { detectUserRegion, getDistanceKm, REGIONS } from "../../constants/zones";
import { useZones } from "../../hooks/useZones";
import { getRegionName } from "../../constants/pricing";
import { loadingState } from "../../utils/loadingTimer";
import { useNow } from "../../hooks/useNow";
import PassengerBottomNav from "../../components/PassengerBottomNav";

export default function PassengerBoardScreen() {
  const router = useRouter();
  const { zones } = useZones();
  const { zoneId: paramZoneId } = useLocalSearchParams<{ zoneId?: string }>();

  const [entries, setEntries]       = useState<QueueEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeZone, setActiveZone] = useState(zones[0] || null);

  // Resolve active zone: param → GPS-nearest → first available.
  useEffect(() => {
    (async () => {
      if (zones.length === 0) return;
      if (paramZoneId) {
        const z = zones.find(z => z.id === paramZoneId);
        if (z) { setActiveZone(z); return; }
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const { latitude, longitude } = loc.coords;
          const region = detectUserRegion(latitude, longitude);
          const inRegion = region ? zones.filter(z => z.region === region) : zones;
          const nearest = (inRegion.length ? inRegion : zones)
            .map(z => ({ z, d: getDistanceKm(latitude, longitude, z.latitude, z.longitude) }))
            .sort((a, b) => a.d - b.d)[0]?.z;
          if (nearest) setActiveZone(nearest);
        } catch {
          /* fall through */
        }
      }
      if (!activeZone) setActiveZone(zones[0]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, paramZoneId]);

  const load = useCallback(async (isRefresh = false) => {
    if (!activeZone) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const list = await QueueAPI.getZoneQueue(activeZone.id);
    setEntries(list.filter(e => e.status !== "ended"));
    setLoading(false);
    setRefreshing(false);
  }, [activeZone?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    if (!activeZone) return;
    const sub = QueueAPI.subscribeToZone(activeZone.id, () => load());
    return () => { sub.unsubscribe(); };
  }, [activeZone?.id, load]);

  const now = useNow(entries.length > 0 ? 1000 : 30000, true);

  // Aggregate entries by destination region → one card per route.
  const routes = useMemo(() => {
    const byDest: Record<string, { dest: string; count: number; loaders: QueueEntry[]; nextEntry: QueueEntry | null }> = {};
    for (const e of entries) {
      const key = e.destination_region || "—";
      (byDest[key] ??= { dest: key, count: 0, loaders: [], nextEntry: null });
      byDest[key].count += 1;
      if (e.status === "loading") byDest[key].loaders.push(e);
      if (!byDest[key].nextEntry) byDest[key].nextEntry = e;
    }
    return Object.values(byDest).sort((a, b) => b.count - a.count);
  }, [entries]);

  const activeCount = entries.length;

  const statusFor = (route: { loaders: QueueEntry[]; nextEntry: QueueEntry | null }): "LOADING" | "FILLING" | "SOON" => {
    const ld = route.loaders[0];
    if (!ld?.load_start_at) return "SOON";
    const seats = (ld.vehicle?.seats || 4) - 1;
    const ls = loadingState(ld.load_start_at, Math.max(seats, 1), now);
    const required = ls?.effectiveRequired ?? seats;
    const boarded = ld.seats_boarded ?? 0;
    if (boarded >= required - 1) return "LOADING"; // almost full
    if (boarded >= 1) return "FILLING";
    return "SOON";
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.brand}>LoadQ</Text>
        <View style={s.liveTag}>
          <View style={s.liveDot} />
          <Text style={s.liveText}>LIVE</Text>
        </View>
      </View>

      <View style={s.zoneRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.zoneName} numberOfLines={1}>
            {activeZone ? `${REGIONS.find(r => r.code === activeZone.region)?.name ?? activeZone.region} · ${activeZone.name}` : "Detecting zone…"}
          </Text>
          <Text style={s.activeCount}>{activeCount} active</Text>
        </View>
        <TouchableOpacity onPress={() => router.push("/(passenger)/zones" as any)}>
          <Text style={s.changeZone}>Change ›</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.accent} />}
      >
        {loading ? (
          <Text style={s.empty}>Loading…</Text>
        ) : routes.length === 0 ? (
          <View style={s.emptyBlock}>
            <Text style={s.emptyHeading}>No cars in this zone</Text>
            <Text style={s.empty}>Pull down to refresh, or check another zone.</Text>
          </View>
        ) : (
          routes.map(r => {
            const status = statusFor(r);
            const ld = r.loaders[0];
            const seats = (ld?.vehicle?.seats || 4) - 1;
            const boarded = ld?.seats_boarded || 0;
            const time = ld?.load_start_at
              ? new Date(ld.load_start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "—";
            return (
              <TouchableOpacity
                key={r.dest}
                style={s.routeCard}
                onPress={() => router.push({ pathname: "/(passenger)/loading", params: { dest: r.dest } })}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.routeName}>
                    {activeZone ? REGIONS.find(rr => rr.code === activeZone.region)?.name : ""} → {getRegionName(r.dest)}
                  </Text>
                  <Text style={s.routeMeta}>
                    {time} · {status} · {boarded}/{seats}
                  </Text>
                </View>
                <Text style={[s.routeCount, status === "LOADING" && s.routeCountHot]}>{String(r.count).padStart(2, "0")}</Text>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <PassengerBottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:     { flex: 1, backgroundColor: Colors.bg },
  header:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  brand:         { fontSize: 20, fontWeight: "900", color: Colors.accent, letterSpacing: -0.5 },
  liveTag:       { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border },
  liveDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  liveText:      { fontSize: 10, color: Colors.t1, fontWeight: "800", letterSpacing: 1 },
  zoneRow:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 14 },
  zoneName:      { fontSize: 14, fontWeight: "700", color: Colors.t1 },
  activeCount:   { fontSize: 12, color: Colors.t3, marginTop: 3, fontWeight: "600" },
  changeZone:    { fontSize: 12, color: Colors.accent, fontWeight: "700" },
  scroll:        { padding: 16, paddingBottom: 24 },
  routeCard:     { flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border, borderRadius: 12, marginBottom: 10 },
  routeName:     { fontSize: 14, fontWeight: "700", color: Colors.t1 },
  routeMeta:     { fontSize: 11, color: Colors.t3, marginTop: 4, letterSpacing: 0.5, fontWeight: "600" },
  routeCount:    { fontSize: 28, fontWeight: "900", color: Colors.t2, letterSpacing: -0.5, minWidth: 56, textAlign: "right" },
  routeCountHot: { color: Colors.accent },
  empty:         { color: Colors.t3, textAlign: "center", marginTop: 40 },
  emptyBlock:    { alignItems: "center", marginTop: 40 },
  emptyHeading:  { color: Colors.t1, fontSize: 16, fontWeight: "700", marginBottom: 8 },
});
