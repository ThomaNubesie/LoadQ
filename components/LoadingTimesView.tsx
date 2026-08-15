// Loading-times graph (Google-Maps "popular times" style) from real
// loading_history. Shown on both the passenger and driver sides (NOT a tab —
// reached from an entry point on each board). Gold bar = current hour,
// accent bars = busy/rush hours, grey = quiet. Day-of-week tabs.
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { Colors } from "../constants/colors";
import { useStrings } from "../hooks/useStrings";
import { LoadingStatsAPI, LoadingStats } from "../services/loadingStats";

// Column order Mon..Sun; value is the Postgres dow index (0=Sun..6=Sat).
const DAY_COLS = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTER = ["M", "T", "W", "T", "F", "S", "S"];

function ampm(h: number): string {
  const s = h % 12 === 0 ? 12 : h % 12;
  return `${s}${h < 12 ? "a" : "p"}`;
}

export default function LoadingTimesView({
  zoneId, zoneName, destination, accent = Colors.accent,
}: {
  zoneId: string;
  zoneName?: string | null;
  destination?: string | null;
  accent?: string;
}) {
  const { t } = useStrings();
  const now = new Date();
  const [dow, setDow] = useState(now.getDay());
  const [stats, setStats] = useState<LoadingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    setLoading(true);
    LoadingStatsAPI.get(zoneId, dow).then(s => { if (on) { setStats(s); setLoading(false); } });
    return () => { on = false; };
  }, [zoneId, dow]);

  const all = stats?.hours ?? [];
  const shown = all.filter(h => h.hour >= 6 && h.hour <= 23);
  const peak = Math.max(1, ...shown.map(h => h.departures));
  const rushThresh = peak * 0.7;
  const nowHour = now.getHours();
  const peakHour = shown.reduce((a, b) => (b.departures > (a?.departures ?? -1) ? b : a), shown[0])?.hour ?? 12;
  const enough = (stats?.total ?? 0) >= 12;

  return (
    <View style={s.wrap}>
      <Text style={s.title}>{t("loadingTimesTitle")}</Text>
      {!!(zoneName || destination) && (
        <Text style={s.sub}>{[zoneName, destination].filter(Boolean).join(" → ")}</Text>
      )}

      <View style={s.dayTabs}>
        {DAY_COLS.map((d, i) => (
          <TouchableOpacity key={d} style={[s.dayTab, dow === d && { backgroundColor: accent, borderColor: accent }]} onPress={() => setDow(d)} activeOpacity={0.8}>
            <Text style={[s.dayTabTxt, dow === d && { color: Colors.accentText }]}>{DAY_LETTER[i]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={accent} /></View>
      ) : !enough ? (
        <View style={s.center}><Text style={s.empty}>{t("loadingTimesEmpty")}</Text></View>
      ) : (
        <>
          <View style={s.chart}>
            {shown.map(h => {
              const isNow = h.hour === nowHour;
              const isRush = h.departures >= rushThresh && h.departures > 0;
              const pct = Math.max(4, Math.round((h.departures / peak) * 100));
              const color = isNow ? Colors.yellow : isRush ? accent : Colors.cardAlt;
              return <View key={h.hour} style={[s.bar, { height: `${pct}%`, backgroundColor: color }]} />;
            })}
          </View>
          <View style={s.axis}>
            {[6, 9, 12, 15, 18, 21].map(h => <Text key={h} style={s.axisTxt}>{ampm(h)}</Text>)}
          </View>

          <View style={[s.note, { backgroundColor: accent + "1A", borderColor: accent + "66" }]}>
            <Text style={[s.noteTxt, { color: accent }]}>
              {t("loadingTimesBusiest", { time: ampm(peakHour).replace("a", " AM").replace("p", " PM") })}
            </Text>
          </View>
          <Text style={s.footer}>{t("loadingTimesFooter")}</Text>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap:    { padding: 16 },
  title:   { color: Colors.t1, fontSize: 19, fontWeight: "800" },
  sub:     { color: Colors.t2, fontSize: 12.5, marginTop: 3, marginBottom: 12 },
  dayTabs: { flexDirection: "row", gap: 6, marginTop: 8, marginBottom: 16 },
  dayTab:  { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 9, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  dayTabTxt: { color: Colors.t2, fontWeight: "800", fontSize: 13 },
  chart:   { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 160, paddingTop: 6 },
  bar:     { flex: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 5 },
  axis:    { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 6, marginTop: 2 },
  axisTxt: { color: Colors.t3, fontSize: 10 },
  note:    { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 16 },
  noteTxt: { fontWeight: "700", fontSize: 12.5, flex: 1, lineHeight: 18 },
  footer:  { color: Colors.t3, fontSize: 11, textAlign: "center", marginTop: 12, lineHeight: 16 },
  center:  { height: 200, alignItems: "center", justifyContent: "center" },
  empty:   { color: Colors.t2, fontSize: 13, textAlign: "center", paddingHorizontal: 20, lineHeight: 19 },
});
