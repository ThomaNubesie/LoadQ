import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Bell, CheckCircle2, Clock, Ticket, Car, Info } from "lucide-react-native";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { AlertsAPI, AlertRow } from "../../services/alerts";
import PassengerBottomNav from "../../components/PassengerBottomNav";

// Localize known passenger alert kinds; fall back to the stored title/body.
function present(a: AlertRow, t: (k: string) => string): { title: string; body: string; Icon: any; tint: string } {
  switch (a.kind) {
    case "reservation_sent": return { title: t("alReservationSentT"), body: t("alReservationSentB"), Icon: Ticket, tint: Colors.accentP };
    case "driver_accepted":  return { title: t("alDriverAcceptedT"),  body: t("alDriverAcceptedB"),  Icon: CheckCircle2, tint: Colors.green };
    case "hold_warning":     return { title: t("alHoldWarnT"),        body: a.body || t("alHoldWarnB"), Icon: Clock, tint: Colors.yellow };
    case "slot_open":        return { title: a.title, body: a.body, Icon: Car, tint: Colors.accentP };
    default:                 return { title: a.title, body: a.body, Icon: Info, tint: Colors.t2 };
  }
}

function ago(iso: string, t: (k: string, p?: any) => string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return t("justNow");
  const m = Math.floor(s / 60); if (m < 60) return t("minsAgo", { n: m });
  const h = Math.floor(m / 60); if (h < 24) return t("hoursAgo", { n: h });
  return new Date(iso).toLocaleDateString();
}

export default function AlertsScreen() {
  const { t } = useStrings();
  const [alerts, setAlerts]   = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => { setAlerts(await AlertsAPI.list()); }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => { await load(); if (active) setLoading(false); AlertsAPI.markAllRead().catch(() => {}); })();
    return () => { active = false; };
  }, [load]));

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <Text style={s.title}>{t("navAlerts")}</Text>
      {loading ? (
        <View style={s.center}><ActivityIndicator color={Colors.accentP} /></View>
      ) : alerts.length === 0 ? (
        <View style={s.center}>
          <Bell size={30} color={Colors.t3} strokeWidth={1.8} />
          <Text style={s.empty}>{t("noAlertsYet")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accentP} />}>
          {alerts.map(a => {
            const p = present(a, t as any);
            const unread = !a.read_at;
            const Icon = p.Icon;
            return (
              <View key={a.id} style={[s.row, unread && s.rowUnread]}>
                <View style={[s.iconWrap, { backgroundColor: p.tint + "22" }]}><Icon size={18} color={p.tint} strokeWidth={2.2} /></View>
                <View style={{ flex: 1 }}>
                  <View style={s.rowTop}>
                    <Text style={s.rowTitle} numberOfLines={1}>{p.title}</Text>
                    <Text style={s.rowTime}>{ago(a.created_at, t as any)}</Text>
                  </View>
                  <Text style={s.rowBody}>{p.body}</Text>
                </View>
                {unread && <View style={s.dot} />}
              </View>
            );
          })}
        </ScrollView>
      )}
      <PassengerBottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.bg },
  title:   { color: Colors.t1, fontSize: 17, fontWeight: "800", padding: 16 },
  center:  { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  empty:   { color: Colors.t3, fontSize: 14 },
  row:     { flexDirection: "row", alignItems: "flex-start", gap: 11, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 13, marginBottom: 9 },
  rowUnread: { borderColor: Colors.accentP + "66", backgroundColor: Colors.surface },
  iconWrap:{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTop:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowTitle:{ color: Colors.t1, fontSize: 13.5, fontWeight: "800", flexShrink: 1 },
  rowTime: { color: Colors.t3, fontSize: 10.5, fontWeight: "600" },
  rowBody: { color: Colors.t2, fontSize: 12.5, marginTop: 3, lineHeight: 17 },
  dot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accentP, marginTop: 4 },
});
