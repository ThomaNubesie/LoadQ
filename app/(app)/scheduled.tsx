import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, RefreshControl, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { ArrowLeft, MapPin, Flag, Phone, CalendarClock, Users, Navigation, Play, Check } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import BottomNav from "../../components/BottomNav";
import DriverTrackMap from "../../components/DriverTrackMap";
import { ScheduledAPI, ScheduledOpen, ScheduledMine, timeBlockLabel } from "../../services/scheduled";

const ACTIVE = ["en_route", "arrived", "picked_up"];

const money = (c: number) => `$${((c ?? 0) / 100).toFixed(2)}`;

export default function ScheduledScreen() {
  const router = useRouter();
  const { t, lang } = useStrings();
  const fr = lang === "fr";
  const [open, setOpen] = useState<ScheduledOpen[]>([]);
  const [mine, setMine] = useState<ScheduledMine[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);

  const load = useCallback(async () => {
    const [o, m] = await Promise.all([ScheduledAPI.open(), ScheduledAPI.mine()]);
    setOpen(o); setMine(m); setLoading(false);
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  // Share GPS while any claimed trip is active (en_route/arrived/picked_up).
  const activeTrip = mine.find((r) => ACTIVE.includes(r.status));
  useEffect(() => {
    if (!activeTrip) return;
    let alive = true; let sub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        let { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") status = (await Location.requestForegroundPermissionsAsync()).status;
        if (status !== "granted") return;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Highest, distanceInterval: 25, timeInterval: 12000 },
          (loc) => { if (!alive) return; const p = { lat: loc.coords.latitude, lng: loc.coords.longitude }; setMyLoc(p); ScheduledAPI.ping(activeTrip.request_id, p.lat, p.lng); },
        );
      } catch { /* GPS unavailable */ }
    })();
    return () => { alive = false; sub?.remove(); };
  }, [activeTrip?.request_id]);

  // Evolving primary action: Start trip -> Arrived -> Picked up -> Complete.
  const NEXT: Record<string, { to: "en_route" | "arrived" | "picked_up" | "completed"; en: string; fr: string; icon: any }> = {
    assigned:  { to: "en_route",  en: "Start trip",       fr: "Démarrer",        icon: Play },
    paid:      { to: "en_route",  en: "Start trip",       fr: "Démarrer",        icon: Play },
    en_route:  { to: "arrived",   en: "Arrived at pickup", fr: "Arrivé au départ", icon: MapPin },
    arrived:   { to: "picked_up", en: "Picked up",        fr: "Passager à bord",  icon: Check },
    picked_up: { to: "completed", en: "Complete trip",    fr: "Terminer",         icon: Check },
  };
  async function advance(r: ScheduledMine) {
    const step = NEXT[r.status]; if (!step) return;
    if (step.to === "completed") {
      Alert.alert(fr ? "Terminer la course ?" : "Complete trip?", fr ? "Confirmez le dépôt à l'adresse d'arrivée." : "Confirm drop-off at the destination address.", [
        { text: fr ? "Annuler" : "Cancel", style: "cancel" },
        { text: fr ? "Terminer" : "Complete", onPress: () => doAdvance(r, "completed") },
      ]);
      return;
    }
    doAdvance(r, step.to);
  }
  async function doAdvance(r: ScheduledMine, to: "en_route" | "arrived" | "picked_up" | "completed") {
    setBusy(r.request_id);
    const res = await ScheduledAPI.advance(r.request_id, to);
    setBusy(null);
    if (res.error || !res.ok) { Alert.alert(fr ? "Course" : "Trip", res.error || "—"); return; }
    await load();
  }

  const dayLabel = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString(fr ? "fr-CA" : "en-CA", { weekday: "long", month: "short", day: "numeric" });

  async function claim(r: ScheduledOpen) {
    setBusy(r.request_id);
    const res = await ScheduledAPI.claim(r.request_id);
    setBusy(null);
    if (res.error || !res.ok) { Alert.alert(fr ? "Course planifiée" : "Scheduled trip", res.error === "already_taken" ? (fr ? "Déjà prise." : "Already taken.") : (res.error || "—")); await load(); return; }
    await load();
  }
  function confirmDecline(r: ScheduledMine) {
    Alert.alert(
      fr ? "Refuser la course ?" : "Decline this trip?",
      fr ? "Vous pouvez refuser jusqu'à 3 h avant. La course sera réouverte." : "You can decline up to 3h before. The trip re-opens to other drivers.",
      [
        { text: fr ? "Annuler" : "Cancel", style: "cancel" },
        {
          text: fr ? "Refuser" : "Decline", style: "destructive", onPress: async () => {
            setBusy(r.request_id);
            const res = await ScheduledAPI.decline(r.request_id);
            setBusy(null);
            if (res.error || !res.ok) { Alert.alert(fr ? "Trop tard" : "Too late", res.error === "past_cutoff" ? (fr ? `Refus impossible à moins de ${res.cutoff_hours ?? 3} h.` : `Can't decline within ${res.cutoff_hours ?? 3}h of pickup.`) : (res.error || "—")); return; }
            await load();
          },
        },
      ],
    );
  }
  const nav = (lat: number | null, lng: number | null) => {
    if (lat == null || lng == null) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`).catch(() => {});
  };

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{fr ? "Courses planifiées" : "Scheduled trips"}</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={Colors.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>

          <Text style={s.hd}>{fr ? "Mes courses" : "My trips"}</Text>
          {mine.length === 0 ? <Text style={s.empty}>{fr ? "Aucune course réservée." : "None claimed yet."}</Text> :
            mine.map(r => {
                const active = ACTIVE.includes(r.status);
                const toDrop = r.status === "picked_up";
                const target = toDrop ? { lat: r.dropoff_lat, lng: r.dropoff_lng } : { lat: r.origin_lat, lng: r.origin_lng };
                const step = NEXT[r.status];
                return (
                  <View key={r.request_id} style={[s.card, { borderColor: Colors.accent }]}>
                    <View style={s.dayRow}><CalendarClock size={15} color={Colors.accent} /><Text style={s.day}>{dayLabel(r.scheduled_date)}{r.time_block ? " · " + timeBlockLabel(r.time_block, fr) : ""}</Text><Text style={s.fare}>{money(r.fare_cents)}</Text></View>
                    {active && (
                      <View style={s.statusPill}><Text style={s.statusTxt}>{r.status === "en_route" ? (fr ? "En route vers le départ" : "On the way to pickup") : r.status === "arrived" ? (fr ? "Arrivé au départ" : "At pickup") : (fr ? "Passager à bord — vers l'arrivée" : "On board — to drop-off")}</Text></View>
                    )}
                    <Route origin={r.origin} dropoff={r.dropoff} seats={r.seats} />
                    {!!r.rider && <Text style={s.rider}>{r.rider}{r.rider_phone ? ` · ${r.rider_phone}` : ""}</Text>}
                    {active && myLoc && target.lat != null && target.lng != null && (
                      <View style={{ marginTop: 10 }}><DriverTrackMap driver={myLoc} pickup={{ lat: target.lat, lng: target.lng }} height={150} /></View>
                    )}
                    <View style={s.actions}>
                      <TouchableOpacity style={s.ghost} onPress={() => nav(target.lat, target.lng)} activeOpacity={0.85}><Navigation size={14} color={Colors.accent} /><Text style={s.ghostTxt}>{fr ? "Naviguer" : "Navigate"}</Text></TouchableOpacity>
                      {!!r.rider_phone && <TouchableOpacity style={s.ghost} onPress={() => Linking.openURL(`tel:${r.rider_phone}`)} activeOpacity={0.85}><Phone size={14} color={Colors.accent} /><Text style={s.ghostTxt}>{fr ? "Appeler" : "Call"}</Text></TouchableOpacity>}
                      {!active && <TouchableOpacity style={s.declineBtn} onPress={() => confirmDecline(r)} disabled={busy === r.request_id} activeOpacity={0.85}><Text style={s.declineTxt}>{busy === r.request_id ? "…" : (fr ? "Refuser" : "Decline")}</Text></TouchableOpacity>}
                    </View>
                    {!!step && (
                      <TouchableOpacity style={[s.primaryBtn, busy === r.request_id && { opacity: 0.6 }]} onPress={() => advance(r)} disabled={busy === r.request_id} activeOpacity={0.85}>
                        <step.icon size={17} color={Colors.accentText} />
                        <Text style={s.primaryTxt}>{busy === r.request_id ? "…" : (fr ? step.fr : step.en)}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
            })}

          <Text style={[s.hd, { marginTop: 22 }]}>{fr ? "À réserver" : "Open to claim"}</Text>
          {open.length === 0 ? <Text style={s.empty}>{fr ? "Aucune course disponible." : "No open trips right now."}</Text> :
            open.map(r => (
              <View key={r.request_id} style={s.card}>
                <View style={s.dayRow}><CalendarClock size={15} color={Colors.accentWarmText} /><Text style={s.day}>{dayLabel(r.scheduled_date)}{r.time_block ? " · " + timeBlockLabel(r.time_block, fr) : ""}</Text><Text style={s.fare}>{money(r.fare_cents)}</Text></View>
                <Route origin={r.origin} dropoff={r.dropoff} seats={r.seats} />
                <TouchableOpacity style={[s.claimBtn, busy === r.request_id && { opacity: 0.6 }]} onPress={() => claim(r)} disabled={busy === r.request_id} activeOpacity={0.85}>
                  <Text style={s.claimTxt}>{busy === r.request_id ? "…" : (fr ? "Réserver cette course" : "Claim this trip")}</Text>
                </TouchableOpacity>
              </View>
            ))}
        </ScrollView>
      )}
      <BottomNav />
    </SafeAreaView>
  );
}

function Route({ origin, dropoff, seats }: { origin: string; dropoff: string; seats: number }) {
  return (
    <View style={{ marginTop: 8 }}>
      <View style={s.legRow}><View style={[s.dot, { backgroundColor: Colors.accent }]} /><Text style={s.leg} numberOfLines={1}>{origin}</Text></View>
      <View style={s.legLine} />
      <View style={s.legRow}><Flag size={11} color={Colors.accentWarmText} /><Text style={s.leg} numberOfLines={1}>{dropoff}</Text></View>
      {seats > 1 && <View style={[s.legRow, { marginTop: 6 }]}><Users size={12} color={Colors.t2} /><Text style={[s.leg, { color: Colors.t2, fontWeight: "800" }]}>{seats} seats</Text></View>}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  title: { color: Colors.t1, fontSize: 18, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hd: { color: Colors.t1, fontWeight: "800", fontSize: 15, marginBottom: 10 },
  empty: { color: Colors.t3, fontSize: 12.5, marginBottom: 8 },
  card: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 13, marginBottom: 10 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  day: { color: Colors.t1, fontWeight: "800", fontSize: 13.5, flex: 1 },
  fare: { color: Colors.accent, fontWeight: "900", fontSize: 14 },
  legRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  legLine: { width: 1, height: 12, backgroundColor: Colors.border, marginLeft: 4, marginVertical: 1 },
  leg: { color: Colors.t2, fontSize: 12.5, flex: 1 },
  rider: { color: Colors.t3, fontSize: 12, marginTop: 8 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  ghost: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: Colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  ghostTxt: { color: Colors.accent, fontWeight: "800", fontSize: 11.5 },
  declineBtn: { marginLeft: "auto", borderWidth: 1.5, borderColor: Colors.red, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 },
  declineTxt: { color: Colors.red, fontWeight: "800", fontSize: 11.5 },
  claimBtn: { backgroundColor: Colors.accent, borderRadius: 11, alignItems: "center", paddingVertical: 12, marginTop: 12 },
  claimTxt: { color: Colors.accentText, fontWeight: "800", fontSize: 13.5 },
  statusPill: { alignSelf: "flex-start", backgroundColor: "rgba(47,111,224,0.12)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8 },
  statusTxt: { color: Colors.accent, fontWeight: "800", fontSize: 11 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: Colors.accent, borderRadius: 11, paddingVertical: 13, marginTop: 10 },
  primaryTxt: { color: Colors.accentText, fontWeight: "800", fontSize: 14 },
});
