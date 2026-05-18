import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, RefreshControl, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { Colors } from "../../constants/colors";
import BottomNav from "../../components/BottomNav";

interface Row {
  id: string;
  full_name: string;
  phone: string | null;
  verified: boolean;
}

export default function AdminVerifyScreen() {
  const router = useRouter();
  const [rows, setRows]         = useState<Row[]>([]);
  const [q, setQ]               = useState("");
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefresh] = useState(false);
  const [busy, setBusy]         = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("drivers")
      .select("id, full_name, phone, verified")
      .order("created_at", { ascending: false });
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefresh(true);
    await load();
    setRefresh(false);
  }, [load]);

  const toggle = async (r: Row) => {
    setBusy(r.id);
    const { error } = await supabase.rpc("set_driver_verified", { p_id: r.id, p_val: !r.verified });
    setBusy(null);
    if (error) {
      Alert.alert("Could not update", error.message);
      return;
    }
    setRows(prev => prev.map(x => (x.id === r.id ? { ...x, verified: !x.verified } : x)));
  };

  const filtered = rows.filter(r =>
    !q.trim() ||
    r.full_name?.toLowerCase().includes(q.toLowerCase()) ||
    (r.phone ?? "").includes(q)
  );

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/profile")}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>Verify drivers</Text>
        <View style={{ width: 24 }} />
      </View>

      <TextInput
        style={s.search}
        placeholder="Search name or phone"
        placeholderTextColor={Colors.t3}
        value={q}
        onChangeText={setQ}
      />

      <FlatList
        data={filtered}
        keyExtractor={i => i.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
        ListEmptyComponent={!loading ? <Text style={s.empty}>No drivers</Text> : null}
        renderItem={({ item }) => (
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{item.full_name || "(no name)"}</Text>
              <Text style={s.phone}>{item.phone || "no phone"}</Text>
            </View>
            <TouchableOpacity
              style={[s.toggle, item.verified ? s.on : s.off]}
              disabled={busy === item.id}
              onPress={() => toggle(item)}
            >
              <Text style={[s.toggleText, item.verified ? s.onText : s.offText]}>
                {busy === item.id ? "…" : item.verified ? "✓ Verified" : "Verify"}
              </Text>
            </TouchableOpacity>
          </View>
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
  search:    { margin: 16, marginBottom: 0, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 11, color: Colors.t1 },
  row:       { flexDirection: "row", alignItems: "center", backgroundColor: Colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.border },
  name:      { fontSize: 15, fontWeight: "700", color: Colors.t1 },
  phone:     { fontSize: 12, color: Colors.t3, marginTop: 3 },
  toggle:    { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 9, borderWidth: 1 },
  on:        { backgroundColor: "#10B98118", borderColor: "#10B981" },
  off:       { backgroundColor: "transparent", borderColor: Colors.accent },
  toggleText:{ fontSize: 13, fontWeight: "700" },
  onText:    { color: "#10B981" },
  offText:   { color: Colors.accent },
  empty:     { textAlign: "center", color: Colors.t3, marginTop: 40 },
});
