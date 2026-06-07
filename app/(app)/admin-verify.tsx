import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, RefreshControl, Alert, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { Colors } from "../../constants/colors";
import BottomNav from "../../components/BottomNav";
import VerifiedBadge from "../../components/VerifiedBadge";

type Role = "driver" | "passenger";
type Filter = "all" | "pending" | "verified" | "blocked";

interface UserRow {
  id:         string;
  full_name:  string;
  email:      string | null;
  phone:      string | null;
  avatar_url: string | null;
  role:       Role;
  verified:   boolean;
  blocked:    boolean;
  created_at: string;
}

// Status chips per role. Passengers have no verification, so they only get
// the All / Blocked split; drivers keep the full set.
const DRIVER_FILTERS: { key: Filter; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "pending",  label: "Pending" },
  { key: "verified", label: "Verified" },
  { key: "blocked",  label: "Blocked" },
];
const PASSENGER_FILTERS: { key: Filter; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "blocked",  label: "Blocked" },
];

export default function AdminUsersScreen() {
  const router = useRouter();
  const [rows, setRows]         = useState<UserRow[]>([]);
  const [q, setQ]               = useState("");
  const [roleTab, setRoleTab]   = useState<Role>("driver");
  const [filter, setFilter]     = useState<Filter>("pending");

  // Switching role resets a role-incompatible status chip (e.g. Passengers
  // can't be "pending"/"verified").
  const switchRole = (role: Role) => {
    setRoleTab(role);
    if (role === "passenger" && (filter === "pending" || filter === "verified")) {
      setFilter("all");
    }
  };
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefresh] = useState(false);
  const [busy, setBusy]         = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: drivers }, { data: passengers }] = await Promise.all([
      supabase.from("drivers")
        .select("id, full_name, email, phone, avatar_url, verified, blocked, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("passengers")
        .select("id, full_name, email, phone, avatar_url, blocked, created_at")
        .order("created_at", { ascending: false }),
    ]);

    const driverRows: UserRow[] = (drivers ?? []).map((d: any) => ({
      id: d.id, full_name: d.full_name || "(no name)",
      email: d.email, phone: d.phone, avatar_url: d.avatar_url,
      role: "driver",
      verified: !!d.verified, blocked: !!d.blocked,
      created_at: d.created_at,
    }));
    const passengerRows: UserRow[] = (passengers ?? []).map((p: any) => ({
      id: p.id, full_name: p.full_name || "(no name)",
      email: p.email, phone: p.phone, avatar_url: p.avatar_url,
      role: "passenger",
      verified: false, blocked: !!p.blocked,
      created_at: p.created_at,
    }));
    const merged = [...driverRows, ...passengerRows]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    setRows(merged);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefresh(true);
    await load();
    setRefresh(false);
  }, [load]);

  const toggleVerified = async (r: UserRow) => {
    if (r.role !== "driver") return;
    setBusy(r.id);
    const { error } = await supabase.rpc("set_driver_verified", { p_id: r.id, p_val: !r.verified });
    setBusy(null);
    if (error) { Alert.alert("Could not update", error.message); return; }
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, verified: !x.verified } : x));
  };

  const toggleBlocked = async (r: UserRow) => {
    setBusy(r.id);
    const { error } = await supabase.rpc("set_user_blocked", {
      p_id: r.id, p_table: r.role === "driver" ? "drivers" : "passengers", p_val: !r.blocked,
    });
    setBusy(null);
    if (error) { Alert.alert("Could not update", error.message); return; }
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, blocked: !x.blocked } : x));
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(r => {
      // role tab
      if (r.role !== roleTab) return false;
      // filter chip
      if (filter === "pending"  && (r.role !== "driver" || r.verified || r.blocked)) return false;
      if (filter === "verified" && !r.verified) return false;
      if (filter === "blocked"  && !r.blocked) return false;
      // search
      if (!term) return true;
      return (r.full_name.toLowerCase().includes(term)
          || (r.email   ?? "").toLowerCase().includes(term)
          || (r.phone   ?? "").toLowerCase().includes(term));
    });
  }, [rows, q, filter, roleTab]);

  const counts = useMemo(() => ({
    driver:    rows.filter(r => r.role === "driver").length,
    passenger: rows.filter(r => r.role === "passenger").length,
  }), [rows]);

  const statusFilters = roleTab === "driver" ? DRIVER_FILTERS : PASSENGER_FILTERS;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/profile")}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>Manage users</Text>
        <TouchableOpacity onPress={() => router.push("/(app)/admin-add-user" as any)}>
          <Text style={s.addBtn}>+</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={s.search}
        placeholder="Search name, email, or phone"
        placeholderTextColor={Colors.t3}
        value={q}
        onChangeText={setQ}
      />

      <View style={s.roleTabs}>
        {([
          { key: "driver"    as Role, label: `Drivers`,    n: counts.driver },
          { key: "passenger" as Role, label: `Passengers`, n: counts.passenger },
        ]).map(rt => (
          <TouchableOpacity
            key={rt.key}
            style={[s.roleTab, roleTab === rt.key && s.roleTabActive]}
            onPress={() => switchRole(rt.key)}
            activeOpacity={0.85}
          >
            <Text style={[s.roleTabText, roleTab === rt.key && s.roleTabTextActive]}>
              {rt.label} ({rt.n})
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.tabs}>
        {statusFilters.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[s.tab, filter === f.key && s.tabActive]}
            onPress={() => setFilter(f.key)}
            activeOpacity={0.85}
          >
            <Text style={[s.tabText, filter === f.key && s.tabTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={i => `${i.role}-${i.id}`}
        contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
        ListEmptyComponent={!loading ? <Text style={s.empty}>No users</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[s.row, item.blocked && s.rowBlocked]}
            activeOpacity={0.85}
            onPress={() => router.push({ pathname: "/(app)/admin-user" as any, params: { id: item.id, role: item.role } })}
          >
            {item.avatar_url
              ? <Image source={{ uri: item.avatar_url }} style={s.avatar} />
              : <View style={s.avatarPh}><Text style={{ fontSize: 18 }}>👤</Text></View>}

            <View style={{ flex: 1 }}>
              <View style={s.nameRow}>
                <Text style={s.name} numberOfLines={1}>{item.full_name}</Text>
                {item.verified && <VerifiedBadge size={14} />}
              </View>
              <Text style={s.meta} numberOfLines={1}>
                <Text style={[s.roleChip, item.role === "driver" ? s.roleDriver : s.rolePassenger]}>
                  {item.role === "driver" ? "Driver" : "Passenger"}
                </Text>
                <Text style={s.metaDot}>  ·  </Text>
                {item.email || item.phone || "—"}
              </Text>
            </View>

            <View style={s.actions}>
              {item.role === "driver" && (
                <TouchableOpacity
                  style={[s.miniBtn, item.verified ? s.miniBtnOn : s.miniBtnOff]}
                  disabled={busy === item.id}
                  onPress={() => toggleVerified(item)}
                >
                  <Text style={[s.miniBtnText, item.verified ? s.onText : s.offText]}>
                    {item.verified ? "✓" : "Verify"}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[s.miniBtn, item.blocked ? s.miniBtnBlock : s.miniBtnOff]}
                disabled={busy === item.id}
                onPress={() => toggleBlocked(item)}
              >
                <Text style={[s.miniBtnText, item.blocked ? s.blockText : s.offText]}>
                  {item.blocked ? "Blocked" : "Block"}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
      />
      <BottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.bg },
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  back:         { fontSize: 20, color: Colors.t2, width: 24 },
  addBtn:       { fontSize: 28, color: Colors.accent, width: 24, textAlign: "right", lineHeight: 28, fontWeight: "300" },
  title:        { fontSize: 17, fontWeight: "700", color: Colors.t1 },
  search:       { margin: 16, marginBottom: 0, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 11, color: Colors.t1 },
  roleTabs:     { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  roleTab:      { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: "center" },
  roleTabActive:{ backgroundColor: Colors.accent+"20", borderColor: Colors.accent },
  roleTabText:  { fontSize: 13, fontWeight: "800", color: Colors.t2 },
  roleTabTextActive: { color: Colors.accent },
  tabs:         { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingTop: 12 },
  tab:          { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  tabActive:    { backgroundColor: Colors.accent+"20", borderColor: Colors.accent },
  tabText:      { fontSize: 12, fontWeight: "700", color: Colors.t2 },
  tabTextActive:{ color: Colors.accent },
  row:          { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.card, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: Colors.border },
  rowBlocked:   { borderColor: Colors.red+"55", backgroundColor: Colors.red+"08" },
  avatar:       { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.cardAlt },
  avatarPh:     { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  nameRow:      { flexDirection: "row", alignItems: "center", gap: 6 },
  name:         { fontSize: 14, fontWeight: "700", color: Colors.t1, flexShrink: 1 },
  meta:         { fontSize: 11, color: Colors.t3, marginTop: 3 },
  roleChip:     { fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  roleDriver:   { color: Colors.accent },
  rolePassenger:{ color: Colors.blue },
  metaDot:      { color: Colors.t3 },
  actions:      { flexDirection: "row", gap: 6 },
  miniBtn:      { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, minWidth: 56, alignItems: "center" },
  miniBtnOn:    { backgroundColor: Colors.green+"18", borderColor: Colors.green },
  miniBtnOff:   { backgroundColor: "transparent", borderColor: Colors.border },
  miniBtnBlock: { backgroundColor: Colors.red+"18", borderColor: Colors.red },
  miniBtnText:  { fontSize: 11, fontWeight: "800" },
  onText:       { color: Colors.green },
  offText:      { color: Colors.t2 },
  blockText:    { color: Colors.red },
  empty:        { textAlign: "center", color: Colors.t3, marginTop: 40 },
});
