import { useCallback, useEffect, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { Colors } from "../../constants/colors";
import { HistoryAPI, LoadingHistoryRow } from "../../services/history";
import { QueueAPI } from "../../services/queue";
import { TripsAPI, Trip } from "../../services/trips";
import { getRegionName } from "../../constants/pricing";
import { sumSavings, COMPARE_MODES } from "../../constants/comparisons";
import { QueueEntry } from "../../constants/types";
import { useZones } from "../../hooks/useZones";
import { useStrings } from "../../hooks/useStrings";
import { loadActiveZone } from "../../utils/zoneStore";
import PassengerBottomNav from "../../components/PassengerBottomNav";

// Filter chips for the activity feed. Default is "today" (since 4 AM local).
// "Now" hides historical rows entirely — only in-progress loaders.
type Chip = "now" | "today" | "week" | "all";

// Unified activity row — collapses an in-progress queue entry OR a
// finished loading_history row into one shape so the feed can render them
// interleaved by timestamp.
interface ActivityRow {
  id:           string;
  kind:         "loading" | "departed" | "timeout_2h" | "eod_close";
  driverName:   string;
  driverId:     string | null;
  destination:  string | null | undefined;
  seatsFilled:  number;
  seatsTotal:   number;
  timestampMs:  number;
}

const KIND_META: Record<ActivityRow["kind"], { icon: string; color: string; label: string }> = {
  loading:    { icon: "⟳", color: Colors.accent, label: "loading" },
  departed:   { icon: "✓", color: "#22C55E",     label: "departed" },
  timeout_2h: { icon: "✗", color: Colors.red,    label: "timed out" },
  eod_close:  { icon: "✗", color: Colors.red,    label: "day close" },
};

function startOfToday4am(): number {
  const d = new Date();
  d.setHours(4, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
  return d.getTime();
}

function chipSinceMs(chip: Chip): number {
  switch (chip) {
    case "now":   return Date.now() - 6 * 60 * 60 * 1000;
    case "today": return startOfToday4am();
    case "week":  return Date.now() - 7 * 24 * 60 * 60 * 1000;
    case "all":   return 0;
  }
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000)            return "just now";
  if (diff < 60 * 60_000)       return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 24 * 60 * 60_000)  return `${Math.floor(diff / (60 * 60_000))} hr ago`;
  return `${Math.floor(diff / (24 * 60 * 60_000))} d ago`;
}

export default function PassengerHistoryScreen() {
  const { t } = useStrings();
  const { zones } = useZones();
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [chip, setChip]                 = useState<Chip>("today");
  const [historyRows, setHistoryRows]   = useState<LoadingHistoryRow[]>([]);
  const [loadingNow, setLoadingNow]     = useState<QueueEntry[]>([]);
  const [trips, setTrips]               = useState<Trip[]>([]);
  const [allTrips, setAllTrips]         = useState<Trip[]>([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);

  // Resolve the active zone the same way Board does: AsyncStorage first
  // (so the History feed matches the zone they're viewing on Board),
  // falling back to the first available zone.
  useEffect(() => {
    (async () => {
      const stored = await loadActiveZone();
      if (stored?.zoneId) setActiveZoneId(stored.zoneId);
      else if (zones.length > 0) setActiveZoneId(zones[0].id);
    })();
  }, [zones.length]);

  const load = useCallback(async (isRefresh = false) => {
    if (!activeZoneId) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const sinceMs = chipSinceMs(chip);
    const [hist, queue, mine, all] = await Promise.all([
      chip === "now" ? Promise.resolve([] as LoadingHistoryRow[]) : HistoryAPI.listForZone(activeZoneId, sinceMs),
      QueueAPI.getZoneQueue(activeZoneId),
      TripsAPI.listMine(),
      TripsAPI.listAllMine(),
    ]);
    setHistoryRows(hist);
    setLoadingNow(queue.filter(e => e.status === "loading"));
    setTrips(mine);
    setAllTrips(all);
    setLoading(false);
    setRefreshing(false);
  }, [activeZoneId, chip]);

  useEffect(() => { load(); }, [load]);

  // Refresh every 30s so the feed stays current without realtime subs.
  useEffect(() => {
    if (!activeZoneId) return;
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [activeZoneId, load]);

  const zone = zones.find(z => z.id === activeZoneId);

  const rows: ActivityRow[] = useMemo(() => {
    const fromHistory: ActivityRow[] = historyRows.map(r => ({
      id:           "h-" + r.id,
      kind:         (r.end_reason === "departed" ? "departed"
                   : r.end_reason === "timeout_2h" ? "timeout_2h"
                   : "eod_close") as ActivityRow["kind"],
      driverName:   r.driver?.full_name || t.driverLabel,
      driverId:     r.driver?.id || null,
      destination:  r.destination_region,
      seatsFilled:  r.seats_filled ?? 0,
      seatsTotal:   4,
      timestampMs:  new Date(r.ended_at).getTime(),
    }));
    const fromQueue: ActivityRow[] = loadingNow.map(e => ({
      id:           "q-" + e.id,
      kind:         "loading",
      driverName:   e.driver?.full_name || "Driver",
      driverId:     e.driver_id || null,
      destination:  e.destination_region,
      seatsFilled:  e.seats_boarded ?? 0,
      seatsTotal:   Math.max((e.vehicle?.seats || 4) - 1, 1),
      timestampMs:  e.load_start_at ? new Date(e.load_start_at).getTime() : Date.now(),
    }));
    return [...fromHistory, ...fromQueue].sort((a, b) => b.timestampMs - a.timestampMs);
  }, [historyRows, loadingNow]);

  const weekAgo    = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekTrips  = trips.filter(t => new Date(t.created_at).getTime() >= weekAgo);
  const weekSpent  = weekTrips.reduce((sum, t) => sum + Number(t.price_paid || 0), 0);

  // Map a trip's loading zone back to its region (fare origin) so the savings
  // comparison can look up competitor fares. Falls back to the zone id prefix.
  const regionForZone = useCallback(
    (zoneId: string) => zones.find(z => z.id === zoneId)?.region ?? zoneId.split("-")[0],
    [zones],
  );
  const toSavingsInput = useCallback(
    (list: Trip[]) => list.map(t => ({
      fromRegion: regionForZone(t.zone_id),
      toCity:     t.destination_region,
      paid:       Number(t.price_paid || 0),
    })),
    [regionForZone],
  );
  const lifetimeSavings = useMemo(() => sumSavings(toSavingsInput(allTrips)),  [allTrips,  toSavingsInput]);
  const weekSavings     = useMemo(() => sumSavings(toSavingsInput(weekTrips)), [weekTrips, toSavingsInput]);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>{t.boardHistory}{zone ? ` · ${zone.name.toUpperCase()}` : ""}</Text>
      </View>

      <View style={s.chipRow}>
        {(["now", "today", "week", "all"] as Chip[]).map(c => (
          <TouchableOpacity
            key={c}
            style={[s.chip, chip === c && s.chipActive]}
            onPress={() => setChip(c)}
            activeOpacity={0.85}
          >
            <Text style={[s.chipText, chip === c && s.chipTextActive]}>
              {c === "now" ? t.nowChip : c === "today" ? t.todayChip : c === "week" ? t.sevenDaysChip : t.allChip}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.accent} />}
      >
        {loading ? (
          <View style={s.loadingBlock}>
            <ActivityIndicator color={Colors.accent} size="large" />
            <Text style={s.empty}>{t.loading}</Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={s.emptyBlock}>
            <Text style={s.emptyEmoji}>📭</Text>
            <Text style={s.emptyText}>{t.boardActivityEmpty}</Text>
          </View>
        ) : (
          rows.map(r => {
            const meta = KIND_META[r.kind];
            return (
              <View key={r.id} style={s.row}>
                <Text style={[s.rowIcon, { color: meta.color }]}>{meta.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowRoute} numberOfLines={1}>
                    {zone ? zone.name.split(" ")[0] : "—"} → {getRegionName(r.destination) || "—"}
                  </Text>
                  <Text style={s.rowMeta} numberOfLines={1}>
                    {r.driverName} · {r.seatsFilled}/{r.seatsTotal} · {r.kind === "loading" ? "loading" : relativeTime(r.timestampMs)}
                  </Text>
                </View>
              </View>
            );
          })
        )}

        <View style={s.savingsCard}>
          <Text style={s.savingsLabel}>YOUR LOADQ SAVINGS</Text>
          <Text style={s.savingsBig}>C${Math.round(lifetimeSavings.bus)}</Text>
          <Text style={s.savingsSub}>
            saved vs the bus over {allTrips.length} trip{allTrips.length === 1 ? "" : "s"}
          </Text>

          <View style={s.savingsBreak}>
            {COMPARE_MODES.map(m => (
              <View key={m.key} style={s.savingsBreakRow}>
                <Text style={s.savingsBreakMode}>vs {m.label}</Text>
                <Text style={s.savingsBreakVal}>C${Math.round(lifetimeSavings[m.key])}</Text>
              </View>
            ))}
          </View>

          <Text style={s.savingsWeek}>
            This week: {weekTrips.length} trip{weekTrips.length === 1 ? "" : "s"} · spent C${weekSpent.toFixed(0)} · saved C${Math.round(weekSavings.bus)} vs bus
          </Text>
        </View>
      </ScrollView>

      <PassengerBottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: Colors.bg },
  header:           { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  title:            { fontSize: 13, fontWeight: "800", color: Colors.t1, letterSpacing: 2 },
  chipRow:          { flexDirection: "row", paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  chip:             { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border },
  chipActive:       { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipText:         { fontSize: 12, fontWeight: "700", color: Colors.t2 },
  chipTextActive:   { color: Colors.accentText },
  scroll:           { padding: 16, paddingBottom: 32 },
  empty:            { color: Colors.t3, textAlign: "center", marginTop: 40 },
  loadingBlock:     { alignItems: "center", marginTop: 60, gap: 12 },
  emptyBlock:       { alignItems: "center", marginTop: 60 },
  emptyEmoji:       { fontSize: 40, marginBottom: 10 },
  emptyText:        { fontSize: 13, color: Colors.t3, textAlign: "center" },
  row:              { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  rowIcon:          { fontSize: 20, fontWeight: "900", width: 22, textAlign: "center" },
  rowRoute:         { color: Colors.t1, fontSize: 13, fontWeight: "700" },
  rowMeta:          { color: Colors.t3, fontSize: 11, marginTop: 3, fontWeight: "500" },
  savingsCard:      { marginTop: 24, padding: 18, borderRadius: 16, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border, alignItems: "center" },
  savingsLabel:     { fontSize: 11, fontWeight: "800", color: Colors.t3, letterSpacing: 2, marginBottom: 6 },
  savingsBig:       { fontSize: 40, fontWeight: "900", color: Colors.accent, letterSpacing: -1 },
  savingsSub:       { fontSize: 12, color: Colors.t2, marginTop: 2, marginBottom: 14, fontWeight: "600" },
  savingsBreak:     { alignSelf: "stretch", gap: 2, borderTopWidth: 0.5, borderTopColor: Colors.border, paddingTop: 12 },
  savingsBreakRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 7 },
  savingsBreakMode: { fontSize: 13, color: Colors.t2, fontWeight: "600" },
  savingsBreakVal:  { fontSize: 14, color: Colors.t1, fontWeight: "800" },
  savingsWeek:      { fontSize: 11, color: Colors.t3, marginTop: 12, textAlign: "center", fontWeight: "500" },
});
