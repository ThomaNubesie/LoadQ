import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import { ArrowLeft, Navigation, Phone, Play, MapPin, Check, Clock, Users, Flag } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import DriverTrackMap from "../../components/DriverTrackMap";
import { ScheduledAPI, ScheduledMine, timeBlockLabel } from "../../services/scheduled";

const money = (c: number) => `$${((c ?? 0) / 100).toFixed(2)}`;
const ACTIVE = ["en_route", "arrived", "picked_up"];

// Arrival-time chips (30-min slots). Within the trip's block if it has one;
// otherwise a full-day range (6 AM–10 PM) so the driver can always send a time.
function etaSlots(block: string | null): string[] {
  const [a, b] = (block && /^\d\d-\d\d$/.test(block)) ? block.split("-").map((n) => parseInt(n, 10)) : [6, 22];
  const out: string[] = [];
  for (let h = a; h < b; h++) for (const m of [0, 30]) {
    const hr = h % 12 === 0 ? 12 : h % 12; const ap = h < 12 ? "AM" : "PM";
    out.push(`${hr}:${String(m).padStart(2, "0")} ${ap}`);
  }
  return out;
}

export default function ScheduledTripScreen() {
  const router = useRouter();
  const { t, lang } = useStrings();
  const fr = lang === "fr";
  const { request_id } = useLocalSearchParams<{ request_id: string }>();
  const [trip, setTrip] = useState<ScheduledMine | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const all = await ScheduledAPI.mine();
    setTrip(all.find((r) => r.request_id === String(request_id)) ?? null);
    setLoading(false);
  }, [request_id]);
  useEffect(() => { load(); timer.current = setInterval(load, 15000); return () => { if (timer.current) clearInterval(timer.current); }; }, [load]);

  const active = trip ? ACTIVE.includes(trip.status) : false;
  const toDrop = trip?.status === "picked_up";
  const target = trip ? (toDrop ? { lat: trip.dropoff_lat, lng: trip.dropoff_lng } : { lat: trip.origin_lat, lng: trip.origin_lng }) : { lat: null, lng: null };

  // Share GPS while active.
  useEffect(() => {
    if (!trip || !active) return;
    let alive = true; let sub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        let { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") status = (await Location.requestForegroundPermissionsAsync()).status;
        if (status !== "granted") return;
        sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Highest, distanceInterval: 25, timeInterval: 12000 },
          (loc) => { if (!alive) return; const p = { lat: loc.coords.latitude, lng: loc.coords.longitude }; setMyLoc(p); ScheduledAPI.ping(trip.request_id, p.lat, p.lng); });
      } catch { /* GPS off */ }
    })();
    return () => { alive = false; sub?.remove(); };
  }, [trip?.request_id, active]);

  const NEXT: Record<string, { to: "en_route" | "arrived" | "picked_up" | "completed"; en: string; fr: string; icon: any }> = {
    assigned:  { to: "en_route",  en: "Start trip",        fr: "Démarrer",         icon: Play },
    paid:      { to: "en_route",  en: "Start trip",        fr: "Démarrer",         icon: Play },
    en_route:  { to: "arrived",   en: "Arrived at pickup", fr: "Arrivé au départ", icon: MapPin },
    arrived:   { to: "picked_up", en: "Picked up",         fr: "Passager à bord",  icon: Check },
    picked_up: { to: "completed", en: "Complete trip",     fr: "Terminer",         icon: Check },
  };

  async function advance() {
    if (!trip) return; const step = NEXT[trip.status]; if (!step) return;
    const go = async () => { setBusy(true); const res = await ScheduledAPI.advance(trip.request_id, step.to); setBusy(false); if (res.error || !res.ok) { Alert.alert(fr ? "Course" : "Trip", res.error || "—"); return; } await load(); };
    if (step.to === "completed") { Alert.alert(fr ? "Terminer la course ?" : "Complete trip?", fr ? "Confirmez le dépôt." : "Confirm drop-off.", [{ text: fr ? "Annuler" : "Cancel", style: "cancel" }, { text: fr ? "Terminer" : "Complete", onPress: go }]); return; }
    go();
  }
  async function sendEta(eta: string) {
    if (!trip) return; setBusy(true);
    const res = await ScheduledAPI.setEta(trip.request_id, eta); setBusy(false);
    if (res.error || !res.ok) { Alert.alert(fr ? "Course" : "Trip", res.error || "—"); return; }
    Alert.alert(fr ? "Envoyé" : "Sent", fr ? `Le passager a été notifié : arrivée vers ${eta}.` : `Rider notified: arriving around ${eta}.`);
    await load();
  }
  const nav = () => { if (target.lat == null) return; const q = `${target.lat},${target.lng}`; Linking.openURL(Platform.select({ ios: `http://maps.apple.com/?daddr=${q}&dirflg=d`, android: `google.navigation:q=${q}`, default: `https://www.google.com/maps/dir/?api=1&destination=${q}` })!).catch(() => {}); };

  const step = trip ? NEXT[trip.status] : null;

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{fr ? "Course" : "Trip"}</Text>
        <View style={{ width: 22 }} />
      </View>
      {loading ? <View style={s.center}><ActivityIndicator color={Colors.accent} /></View> : !trip ? <View style={s.center}><Text style={s.muted}>{fr ? "Course introuvable." : "Trip not found."}</Text></View> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {active && myLoc && target.lat != null && target.lng != null && (
            <View style={{ marginBottom: 12 }}><DriverTrackMap driver={myLoc} pickup={{ lat: target.lat as number, lng: target.lng as number }} height={180} /></View>
          )}
          <View style={s.card}>
            <Row k={fr ? "Date" : "Date"} v={`${new Date(trip.scheduled_date + "T12:00:00").toLocaleDateString(fr ? "fr-CA" : "en-CA", { weekday: "long", month: "short", day: "numeric" })}${trip.time_block ? " · " + timeBlockLabel(trip.time_block, fr) : ""}`} />
            {!!trip.pickup_time && <Row k={fr ? "Heure préférée" : "Preferred time"} v={trip.pickup_time} icon={<Clock size={13} color={Colors.t2} />} />}
            {!!trip.rider && <Row k={fr ? "Passager" : "Rider"} v={trip.rider} />}
            <Row k={fr ? "Départ" : "Pickup"} v={trip.origin} />
            <Row k={fr ? "Arrivée" : "Drop-off"} v={trip.dropoff} icon={<Flag size={12} color={Colors.accentWarmText} />} />
            <Row k={fr ? "Type · places" : "Type · seats"} v={`${trip.ride_type === "whole" ? (fr ? "Voiture entière" : "Whole car") : (fr ? "Partagée" : "Share")} · ${trip.seats}`} icon={<Users size={13} color={Colors.t2} />} />
            <Row k={fr ? "Vous gagnez" : "You earn"} v={money(trip.fare_cents)} />
            {!!trip.driver_eta && <Row k={fr ? "Arrivée annoncée" : "Told rider"} v={trip.driver_eta} />}
          </View>

          <Text style={s.lbl}>{fr ? "Annoncez votre heure d'arrivée au passager" : "Tell the rider your arrival time"}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingVertical: 2 }}>
            {etaSlots(trip.time_block).map((slot) => (
              <TouchableOpacity key={slot} style={[s.tchip, trip.driver_eta === slot && s.tchipOn]} onPress={() => sendEta(slot)} disabled={busy} activeOpacity={0.85}>
                <Text style={[s.tchipTxt, trip.driver_eta === slot && s.tchipTxtOn]}>{slot}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={s.actions}>
            <TouchableOpacity style={s.ghost} onPress={nav} activeOpacity={0.85}><Navigation size={15} color={Colors.accent} /><Text style={s.ghostTxt}>{fr ? "Naviguer" : "Navigate"}</Text></TouchableOpacity>
            {!!trip.rider_phone && <TouchableOpacity style={s.ghost} onPress={() => Linking.openURL(`tel:${trip.rider_phone}`)} activeOpacity={0.85}><Phone size={15} color={Colors.accent} /><Text style={s.ghostTxt}>{fr ? "Appeler" : "Call"}</Text></TouchableOpacity>}
          </View>

          {!!step && (
            <TouchableOpacity style={[s.primaryBtn, busy && { opacity: 0.6 }]} onPress={advance} disabled={busy} activeOpacity={0.85}>
              <step.icon size={17} color={Colors.accentText} /><Text style={s.primaryTxt}>{busy ? "…" : (fr ? step.fr : step.en)}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ k, v, icon }: { k: string; v: string; icon?: React.ReactNode }) {
  return (
    <View style={s.row}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>{icon}<Text style={s.rk}>{k}</Text></View>
      <Text style={s.rv} numberOfLines={2}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  title: { color: Colors.t1, fontSize: 18, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: Colors.t2 },
  card: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 13 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 6 },
  rk: { color: Colors.t2, fontSize: 12.5 },
  rv: { color: Colors.t1, fontWeight: "800", fontSize: 13, flex: 1, textAlign: "right" },
  lbl: { color: Colors.t2, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  tchip: { borderWidth: 1, borderColor: Colors.border, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: Colors.card },
  tchipOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  tchipTxt: { color: Colors.t1, fontWeight: "800", fontSize: 12.5 },
  tchipTxtOn: { color: Colors.accentText },
  actions: { flexDirection: "row", gap: 9, marginTop: 16 },
  ghost: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: Colors.border, borderRadius: 11, paddingVertical: 11 },
  ghostTxt: { color: Colors.accent, fontWeight: "800", fontSize: 13 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 14, marginTop: 12 },
  primaryTxt: { color: Colors.accentText, fontWeight: "800", fontSize: 15 },
});
