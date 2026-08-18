import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, RefreshControl, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, MapPin, Flag, Phone, CalendarClock, Users } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import BottomNav from "../../components/BottomNav";
import { ScheduledAPI, ScheduledOpen, ScheduledMine } from "../../services/scheduled";

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

  const load = useCallback(async () => {
    const [o, m] = await Promise.all([ScheduledAPI.open(), ScheduledAPI.mine()]);
    setOpen(o); setMine(m); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

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
            mine.map(r => (
              <View key={r.request_id} style={[s.card, { borderColor: Colors.accent }]}>
                <View style={s.dayRow}><CalendarClock size={15} color={Colors.accent} /><Text style={s.day}>{dayLabel(r.scheduled_date)}</Text><Text style={s.fare}>{money(r.fare_cents)}</Text></View>
                <Route origin={r.origin} dropoff={r.dropoff} seats={r.seats} />
                {!!r.rider && <Text style={s.rider}>{r.rider}{r.rider_phone ? ` · ${r.rider_phone}` : ""}</Text>}
                <View style={s.actions}>
                  <TouchableOpacity style={s.ghost} onPress={() => nav(r.origin_lat, r.origin_lng)} activeOpacity={0.85}><MapPin size={14} color={Colors.accent} /><Text style={s.ghostTxt}>{fr ? "Vers le domicile" : "To home"}</Text></TouchableOpacity>
                  {!!r.rider_phone && <TouchableOpacity style={s.ghost} onPress={() => Linking.openURL(`tel:${r.rider_phone}`)} activeOpacity={0.85}><Phone size={14} color={Colors.accent} /><Text style={s.ghostTxt}>{fr ? "Appeler" : "Call"}</Text></TouchableOpacity>}
                  <TouchableOpacity style={s.declineBtn} onPress={() => confirmDecline(r)} disabled={busy === r.request_id} activeOpacity={0.85}><Text style={s.declineTxt}>{busy === r.request_id ? "…" : (fr ? "Refuser" : "Decline")}</Text></TouchableOpacity>
                </View>
              </View>
            ))}

          <Text style={[s.hd, { marginTop: 22 }]}>{fr ? "À réserver" : "Open to claim"}</Text>
          {open.length === 0 ? <Text style={s.empty}>{fr ? "Aucune course disponible." : "No open trips right now."}</Text> :
            open.map(r => (
              <View key={r.request_id} style={s.card}>
                <View style={s.dayRow}><CalendarClock size={15} color={Colors.accentWarmText} /><Text style={s.day}>{dayLabel(r.scheduled_date)}</Text><Text style={s.fare}>{money(r.fare_cents)}</Text></View>
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
});
