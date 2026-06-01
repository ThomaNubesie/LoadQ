import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, AppState, ActivityIndicator } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { QueueAPI } from "../../services/queue";
import { Colors } from "../../constants/colors";
import { QueueEntry } from "../../constants/types";
import { getDistanceKm, REGIONS, ZoneLocation } from "../../constants/zones";
import { useZones } from "../../hooks/useZones";
import { getRegionName } from "../../constants/pricing";
import { loadingState } from "../../utils/loadingTimer";
import { useNow } from "../../hooks/useNow";
import { tryGetUserLocation } from "../../utils/gpsTimeout";
import { saveActiveZone, loadActiveZone } from "../../utils/zoneStore";
import PassengerBottomNav from "../../components/PassengerBottomNav";

export default function PassengerBoardScreen() {
  const router = useRouter();
  const { zones } = useZones();
  const { zoneId: paramZoneId } = useLocalSearchParams<{ zoneId?: string }>();

  const [entries, setEntries]       = useState<QueueEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeZone, setActiveZone] = useState<ZoneLocation | null>(null);

  // Once the passenger has explicitly chosen a zone (via Zones tab "View
  // board" or the in-page Use-my-location flow), we stop auto-overriding
  // their pick on tab switches and app foregrounds. They reclaim control
  // by tapping "📍" (re-detect) or picking another zone.
  const manualPickRef = useRef(false);

  // GPS-detect with a single top-level timeout that covers permission +
  // location. Falls back to the first zone only if there is no current
  // selection — never clobbers an existing pick.
  const detectViaGPS = useCallback(async () => {
    if (zones.length === 0) return;
    const loc = await tryGetUserLocation(8000);
    if (!loc) {
      setActiveZone(prev => prev ?? zones[0]);
      return;
    }
    const { latitude, longitude } = loc.coords;
    const nearest = zones
      .map(z => ({ z, d: getDistanceKm(latitude, longitude, z.latitude, z.longitude) }))
      .sort((a, b) => a.d - b.d)[0]?.z;
    if (nearest) {
      setActiveZone(nearest);
      manualPickRef.current = false;
      saveActiveZone(nearest.id, false);
    } else {
      setActiveZone(prev => prev ?? zones[0]);
    }
  }, [zones]);

  // First-mount zone resolution. Priority order:
  //   1. zoneId param (handled by useFocusEffect below)
  //   2. Persisted zone from AsyncStorage (within TTL)
  //   3. GPS-detect
  // Persistence means after a crash/restart the user returns to their last
  // zone instead of defaulting to Saint-Raymond McDonald's (zones[0]).
  const didInitialDetect = useRef(false);
  useEffect(() => {
    if (didInitialDetect.current) return;
    if (zones.length === 0) return;
    didInitialDetect.current = true;
    if (paramZoneId) return; // focus handler will resolve it
    (async () => {
      const stored = await loadActiveZone();
      if (stored) {
        const z = zones.find(z => z.id === stored.zoneId);
        if (z) {
          setActiveZone(z);
          manualPickRef.current = stored.manual;
          // If the user explicitly picked, don't auto-override with GPS now.
          if (stored.manual) return;
        }
      }
      detectViaGPS();
    })();
  }, [zones.length, paramZoneId, detectViaGPS]);

  // Param-driven zone changes: fires on every focus, but only acts when a
  // zoneId param is present (i.e., the user just picked a zone via Zones
  // tab). Bottom-nav re-entry without params is a no-op, so the user's
  // pick survives tab switches.
  useFocusEffect(useCallback(() => {
    if (!paramZoneId || zones.length === 0) return;
    const z = zones.find(z => z.id === paramZoneId);
    if (z) {
      setActiveZone(z);
      manualPickRef.current = true;
      saveActiveZone(z.id, true);
    }
  }, [paramZoneId, zones]));

  // App foreground re-detect — only when the user hasn't pinned a zone.
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => {
      if (state === "active" && !manualPickRef.current) detectViaGPS();
    });
    return () => sub.remove();
  }, [detectViaGPS]);

  const handleUseMyLocation = () => {
    manualPickRef.current = false;
    detectViaGPS();
  };

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
        <TouchableOpacity onPress={handleUseMyLocation} style={s.locBtn} activeOpacity={0.7}>
          <Text style={s.locBtnText}>📍</Text>
        </TouchableOpacity>
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
          <View style={s.loadingBlock}>
            <ActivityIndicator color={Colors.accent} size="large" />
            <Text style={s.empty}>Loading…</Text>
          </View>
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
                onPress={() => router.push({ pathname: "/(passenger)/loading", params: { dest: r.dest, zoneId: activeZone?.id } })}
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
  locBtn:        { paddingHorizontal: 8, paddingVertical: 4, marginRight: 4 },
  locBtnText:    { fontSize: 16 },
  scroll:        { padding: 16, paddingBottom: 24 },
  routeCard:     { flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border, borderRadius: 12, marginBottom: 10 },
  routeName:     { fontSize: 14, fontWeight: "700", color: Colors.t1 },
  routeMeta:     { fontSize: 11, color: Colors.t3, marginTop: 4, letterSpacing: 0.5, fontWeight: "600" },
  routeCount:    { fontSize: 28, fontWeight: "900", color: Colors.t2, letterSpacing: -0.5, minWidth: 56, textAlign: "right" },
  routeCountHot: { color: Colors.accent },
  empty:         { color: Colors.t3, textAlign: "center", marginTop: 40 },
  loadingBlock:  { alignItems: "center", marginTop: 60, gap: 12 },
  emptyBlock:    { alignItems: "center", marginTop: 40 },
  emptyHeading:  { color: Colors.t1, fontSize: 16, fontWeight: "700", marginBottom: 8 },
});
