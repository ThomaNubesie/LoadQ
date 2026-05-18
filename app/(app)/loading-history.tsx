import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { HistoryAPI, LoadingHistoryRow } from "../../services/history";
import { getRegionName } from "../../constants/pricing";
import { Colors } from "../../constants/colors";

const REASON_LABEL: Record<string, string> = {
  departed:   "Departed",
  timeout_2h: "2h timeout",
  eod_close:  "Day close",
};
const REASON_COLOR: Record<string, string> = {
  departed:   "#22C55E",
  timeout_2h: Colors.yellow,
  eod_close:  Colors.red,
};

export default function LoadingHistoryScreen() {
  const router = useRouter();
  const [rows,    setRows]    = useState<LoadingHistoryRow[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      let admin = false;
      if (user) {
        const { data } = await supabase.from("drivers").select("is_admin").eq("id", user.id).maybeSingle();
        admin = !!data?.is_admin;
      }
      setIsAdmin(admin);
      setRows(admin ? await HistoryAPI.listAll() : await HistoryAPI.listMine());
      setLoading(false);
    })();
  }, []);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/profile")}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>Loading history</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={s.scopeNote}>
        {isAdmin === null ? "" : isAdmin
          ? `All drivers · ${rows.length} most recent sessions`
          : "Your loading sessions · last 7 days"}
      </Text>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={Colors.accent} /></View>
      ) : rows.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyEmoji}>📭</Text>
          <Text style={s.emptyText}>No loading sessions recorded yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {rows.map(r => {
            const start = r.load_start_at ? new Date(r.load_start_at) : null;
            const end   = new Date(r.ended_at);
            const mins  = start ? Math.round((end.getTime() - start.getTime()) / 60000) : null;
            return (
              <View key={r.id} style={s.row}>
                <View style={s.rowTop}>
                  {isAdmin && (
                    r.driver?.avatar_url
                      ? <Image source={{ uri: r.driver.avatar_url }} style={s.avatar} />
                      : <View style={s.avatarFallback}><Text>👤</Text></View>
                  )}
                  <View style={{ flex: 1 }}>
                    {isAdmin && <Text style={s.driverName}>{r.driver?.full_name || "Driver"}</Text>}
                    <Text style={s.route}>
                      {r.zone_id} → {getRegionName(r.destination_region) || "—"}
                    </Text>
                  </View>
                  <View style={[s.reasonBadge, { backgroundColor: (REASON_COLOR[r.end_reason] || Colors.t3) + "22", borderColor: (REASON_COLOR[r.end_reason] || Colors.t3) + "55" }]}>
                    <Text style={[s.reasonText, { color: REASON_COLOR[r.end_reason] || Colors.t3 }]}>
                      {REASON_LABEL[r.end_reason] || r.end_reason}
                    </Text>
                  </View>
                </View>
                <View style={s.metaRow}>
                  <Text style={s.meta}>
                    {end.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </Text>
                  <Text style={s.meta}>· {r.seats_filled} seats</Text>
                  {mins !== null && <Text style={s.meta}>· {mins} min loaded</Text>}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:      { flex:1, backgroundColor:Colors.bg },
  header:         { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:16, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  back:           { fontSize:20, color:Colors.t2, width:24 },
  title:          { fontSize:17, fontWeight:"700", color:Colors.t1 },
  scopeNote:      { fontSize:11, color:Colors.t3, paddingHorizontal:16, paddingVertical:10 },
  center:         { flex:1, alignItems:"center", justifyContent:"center", padding:32 },
  emptyEmoji:     { fontSize:44, marginBottom:10 },
  emptyText:      { fontSize:14, color:Colors.t2, textAlign:"center" },
  row:            { backgroundColor:Colors.card, borderRadius:12, padding:12, marginBottom:8, borderWidth:0.5, borderColor:Colors.border },
  rowTop:         { flexDirection:"row", alignItems:"center", gap:10 },
  avatar:         { width:34, height:34, borderRadius:17, backgroundColor:Colors.cardAlt },
  avatarFallback: { width:34, height:34, borderRadius:17, backgroundColor:Colors.bg, alignItems:"center", justifyContent:"center", borderWidth:0.5, borderColor:Colors.border },
  driverName:     { fontSize:13, fontWeight:"700", color:Colors.t1 },
  route:          { fontSize:12, color:Colors.t2, marginTop:2 },
  reasonBadge:    { borderRadius:6, paddingHorizontal:7, paddingVertical:3, borderWidth:0.5 },
  reasonText:     { fontSize:10, fontWeight:"700" },
  metaRow:        { flexDirection:"row", gap:6, marginTop:8, flexWrap:"wrap" },
  meta:           { fontSize:11, color:Colors.t3 },
});
