import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import BottomNav from "../../components/BottomNav";
import { AlertsAPI, AlertRow } from "../../services/alerts";
import { ArrowLeft, Bell, CircleCheckBig, Timer, MessageSquare, Car, Moon, AlarmClock, Hourglass, Smile, Megaphone } from "lucide-react-native";

// Every alert kind renders as a vector icon; unmapped kinds fall back to a bell.
function AlertIcon({ kind }: { kind: AlertRow["kind"] }) {
  switch (kind) {
    case "return":       return <Car size={22} color={Colors.t1} strokeWidth={2} />;
    case "slot_open":    return <CircleCheckBig size={22} color={Colors.t1} strokeWidth={2} />;
    case "moved_back":   return <Timer size={22} color={Colors.t1} strokeWidth={2} />;
    case "removed":      return <Moon size={22} color={Colors.t1} strokeWidth={2} />;
    case "lowtime":      return <AlarmClock size={22} color={Colors.t1} strokeWidth={2} />;
    case "expiry_nudge": return <Hourglass size={22} color={Colors.t1} strokeWidth={2} />;
    case "released":     return <Smile size={22} color={Colors.t1} strokeWidth={2} />;
    case "headback":     return <Megaphone size={22} color={Colors.t1} strokeWidth={2} />;
    case "message":      return <MessageSquare size={22} color={Colors.t1} strokeWidth={2} />;
    default:             return <Bell size={22} color={Colors.t1} strokeWidth={2} />;
  }
}

// Show bilingual alert bodies ("EN\nFR") split by 🇬🇧/🇫🇷 flags. Bodies that are
// single-language or already flag-prefixed are left as-is.
function flagBody(body: string): string {
  const parts = body.split("\n").map(p => p.trim()).filter(Boolean);
  if (parts.length === 2 && !parts[0].startsWith("🇬🇧") && !parts[0].startsWith("🇫🇷")) {
    return `🇬🇧 ${parts[0]}\n🇫🇷 ${parts[1]}`;
  }
  return body;
}

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
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const [items, setItems]       = useState<AlertRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const listRef = useRef<FlatList<AlertRow>>(null);

  const load = useCallback(async () => {
    const rows = await AlertsAPI.list();
    setItems(rows);
    setLoading(false);
    AlertsAPI.markAllRead();
  }, []);

  useEffect(() => { load(); }, [load]);

  // Arrived from a tapped notification → scroll to + highlight that alert.
  useEffect(() => {
    if (!focus || items.length === 0) return;
    const idx = items.findIndex(i => i.ref === focus || i.id === focus);
    if (idx < 0) return;
    setHighlightId(items[idx].id);
    const t1 = setTimeout(() => {
      try { listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 }); } catch { /* out of range */ }
    }, 350);
    const t2 = setTimeout(() => setHighlightId(null), 4500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [focus, items]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/zone-select")}>
          <ArrowLeft size={20} color={Colors.t2} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={s.title}>{t.notifications}</Text>
        <View style={{ width:24 }} />
      </View>

      {!loading && items.length === 0 ? (
        <View style={s.empty}>
          <Bell size={48} color={Colors.t1} strokeWidth={2} style={s.emptyEmoji} />
          <Text style={s.emptyText}>No alerts yet</Text>
          <Text style={s.emptySub}>You'll be notified when your slot opens or it's time to head back to the zone</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding:16, paddingBottom:96 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
          onScrollToIndexFailed={info => {
            setTimeout(() => { try { listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.3 }); } catch { /* ignore */ } }, 450);
          }}
          renderItem={({ item }) => (
            <View style={[s.row, !item.read_at && s.rowUnread, item.id === highlightId && s.rowFocus]}>
              <AlertIcon kind={item.kind} />
              <View style={{ flex:1 }}>
                <Text style={s.rowTitle}>{item.title}</Text>
                <Text style={s.rowBody}>{flagBody(item.body)}</Text>
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
  rowFocus:   { borderColor:Colors.accent, borderWidth:2, backgroundColor:Colors.accent+"20" },
  rowIcon:    { fontSize:22 },
  rowTitle:   { fontSize:14, fontWeight:"700", color:Colors.t1, marginBottom:3 },
  rowBody:    { fontSize:13, color:Colors.t2, lineHeight:19 },
  rowTime:    { fontSize:11, color:Colors.t3, marginTop:6 },
});
