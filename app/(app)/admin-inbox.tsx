import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { MessagesAPI, ConversationSummary } from "../../services/messages";
import { Colors } from "../../constants/colors";
import BottomNav from "../../components/BottomNav";

function fmtWhen(iso: string) {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString();
}

export default function AdminInboxScreen() {
  const router = useRouter();
  const [items, setItems]       = useState<ConversationSummary[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefresh] = useState(false);

  const load = useCallback(async () => {
    const data = await MessagesAPI.listConversationsForAdmin();
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefresh(true);
    await load();
    setRefresh(false);
  }, [load]);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/profile")}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>Admin · Inbox</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={items}
        keyExtractor={i => i.other_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
        ListEmptyComponent={!loading ? <Text style={s.empty}>No messages yet.{"\n"}Open a user's profile to start a thread.</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.85}
            onPress={() => router.push({ pathname: "/(app)/admin-thread" as any, params: { id: item.other_id, role: item.other_role, name: item.other_name } })}
          >
            {item.other_avatar
              ? <Image source={{ uri: item.other_avatar }} style={s.avatar} />
              : <View style={s.avatarPh}><Text style={{ fontSize: 18 }}>👤</Text></View>}
            <View style={{ flex: 1 }}>
              <View style={s.topRow}>
                <Text style={s.name} numberOfLines={1}>{item.other_name}</Text>
                <Text style={s.when}>{fmtWhen(item.last_at)}</Text>
              </View>
              <View style={s.bottomRow}>
                <Text style={[s.preview, item.unread > 0 && s.previewUnread]} numberOfLines={1}>
                  {item.last_body}
                </Text>
                {item.unread > 0 && (
                  <View style={s.badge}><Text style={s.badgeText}>{item.unread}</Text></View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
      <BottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  back:      { fontSize: 20, color: Colors.t2, width: 24 },
  title:     { fontSize: 17, fontWeight: "700", color: Colors.t1 },
  row:       { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 0.3, borderBottomColor: Colors.border },
  avatar:    { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.cardAlt },
  avatarPh:  { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  topRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name:      { fontSize: 14, fontWeight: "700", color: Colors.t1, flexShrink: 1 },
  when:      { fontSize: 11, color: Colors.t3 },
  bottomRow: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 8 },
  preview:   { fontSize: 12, color: Colors.t3, flex: 1 },
  previewUnread:{ color: Colors.t1, fontWeight: "700" },
  badge:     { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: Colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: Colors.accentText, fontSize: 11, fontWeight: "800" },
  empty:     { textAlign: "center", color: Colors.t3, marginTop: 40, lineHeight: 20 },
});
