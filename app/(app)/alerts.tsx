import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import BottomNav from "../../components/BottomNav";
import { AlertsAPI, AlertRow } from "../../services/alerts";

const ICON: Record<AlertRow["kind"], string> = {
  return:       "🚕",
  slot_open:    "✅",
  moved_back:   "⏱",
  removed:      "🌙",
  lowtime:      "⏰",
  expiry_nudge: "⏳",
  released:     "🙂",
  headback:     "📣",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AlertsScreen() {
  const router = useRouter();
  const { t }  = useStrings();
  const [items, setItems]       = useState<AlertRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const rows = await AlertsAPI.list();
    setItems(rows);
    setLoading(false);
    AlertsAPI.markAllRead();
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/zone-select")}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t.notifications}</Text>
        <View style={{ width:24 }} />
      </View>

      {!loading && items.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyEmoji}>🔔</Text>
          <Text style={s.emptyText}>No alerts yet</Text>
          <Text style={s.emptySub}>You'll be notified when your slot opens or it's time to head back to the zone</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding:16, paddingBottom:96 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
          renderItem={({ item }) => (
            <View style={[s.row, !item.read_at && s.rowUnread]}>
              <Text style={s.rowIcon}>{ICON[item.kind] ?? "🔔"}</Text>
              <View style={{ flex:1 }}>
                <Text style={s.rowTitle}>{item.title}</Text>
                <Text style={s.rowBody}>{item.body}</Text>
                <Text style={s.rowTime}>{timeAgo(item.created_at)}</Text>
              </View>
            </View>
          )}
        />
      )}
      <BottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:  { flex:1, backgroundColor:Colors.bg },
  header:     { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:16, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  back:       { fontSize:20, color:Colors.t2, width:24 },
  title:      { fontSize:17, fontWeight:"700", color:Colors.t1 },
  empty:      { flex:1, alignItems:"center", justifyContent:"center", padding:32 },
  emptyEmoji: { fontSize:48, marginBottom:16 },
  emptyText:  { fontSize:18, fontWeight:"700", color:Colors.t1, marginBottom:8 },
  emptySub:   { fontSize:13, color:Colors.t3, textAlign:"center", lineHeight:20 },
  row:        { flexDirection:"row", gap:12, backgroundColor:Colors.card, borderRadius:12, padding:14, marginBottom:10, borderWidth:1, borderColor:Colors.border },
  rowUnread:  { borderColor:Colors.accent, backgroundColor:Colors.accent+"08" },
  rowIcon:    { fontSize:22 },
  rowTitle:   { fontSize:14, fontWeight:"700", color:Colors.t1, marginBottom:3 },
  rowBody:    { fontSize:13, color:Colors.t2, lineHeight:19 },
  rowTime:    { fontSize:11, color:Colors.t3, marginTop:6 },
});
