import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Alert, Linking, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { Colors } from "../../constants/colors";
import VerifiedBadge from "../../components/VerifiedBadge";

type Role = "driver" | "passenger";

interface UserDetail {
  id:                  string;
  full_name:           string;
  email:               string | null;
  phone:               string | null;
  avatar_url:          string | null;
  dob:                 string | null;
  sex:                 string | null;
  verified:            boolean;
  blocked:             boolean;
  is_admin:            boolean;
  subscription_status: string | null;
  trial_ends_at:       string | null;
  trust_score:         number | null;
  created_at:          string;
}

interface ActivityItem {
  key:     string;
  when:    string;
  title:   string;
  detail?: string;
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return "—"; }
}
function fmtWhen(iso: string) {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function AdminUserScreen() {
  const router = useRouter();
  const { id, role } = useLocalSearchParams<{ id: string; role: Role }>();
  const isDriver = role === "driver";

  const [user, setUser]         = useState<UserDetail | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState({ full_name: "", email: "", phone: "" });

  const load = useCallback(async () => {
    if (!id) return;
    if (isDriver) {
      const { data } = await supabase.from("drivers")
        .select("id, full_name, email, phone, avatar_url, dob, sex, verified, blocked, is_admin, subscription_status, trial_ends_at, trust_score, created_at")
        .eq("id", id).maybeSingle();
      if (data) setUser(data as UserDetail);

      const { data: hist } = await supabase.from("loading_history")
        .select("id, zone_id, destination_region, ended_at, end_reason, seats_filled")
        .eq("driver_id", id)
        .order("ended_at", { ascending: false })
        .limit(20);
      setActivity((hist ?? []).map((h: any) => ({
        key: h.id, when: h.ended_at,
        title: `${h.zone_id} → ${h.destination_region ?? "—"}`,
        detail: `${h.seats_filled} seats · ${h.end_reason.replace("_", " ")}`,
      })));
    } else {
      const { data } = await supabase.from("passengers")
        .select("id, full_name, email, phone, avatar_url, dob, sex, blocked, created_at")
        .eq("id", id).maybeSingle();
      if (data) setUser({
        ...data as any,
        verified: false, is_admin: false,
        subscription_status: null, trial_ends_at: null, trust_score: null,
      });

      const { data: trips } = await supabase.from("trips")
        .select("id, zone_id, destination_region, price_paid, created_at, driver:drivers(full_name)")
        .eq("passenger_id", id)
        .order("created_at", { ascending: false })
        .limit(20);
      setActivity((trips ?? []).map((t: any) => ({
        key: t.id, when: t.created_at,
        title: `${t.zone_id} → ${t.destination_region}`,
        detail: `with ${t.driver?.full_name ?? "driver"} · C$${t.price_paid}`,
      })));
    }
    setLoading(false);
  }, [id, isDriver]);

  useEffect(() => { load(); }, [load]);

  const toggleVerified = async () => {
    if (!user || !isDriver) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_driver_verified", { p_id: user.id, p_val: !user.verified });
    setBusy(false);
    if (error) { Alert.alert("Could not update", error.message); return; }
    setUser(u => u ? { ...u, verified: !u.verified } : u);
  };

  const toggleBlocked = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_user_blocked", {
      p_id: user.id, p_table: isDriver ? "drivers" : "passengers", p_val: !user.blocked,
    });
    setBusy(false);
    if (error) { Alert.alert("Could not update", error.message); return; }
    setUser(u => u ? { ...u, blocked: !u.blocked } : u);
  };

  const sendEmail = () => {
    if (!user?.email) { Alert.alert("No email on file"); return; }
    Linking.openURL(`mailto:${user.email}?subject=LoadQ`);
  };

  const openThread = () => {
    if (!user) return;
    router.push({ pathname: "/(app)/admin-thread" as any, params: { id: user.id, role, name: user.full_name } });
  };

  const startEdit = () => {
    if (!user) return;
    setDraft({
      full_name: user.full_name || "",
      email:     user.email     || "",
      phone:     user.phone     || "",
    });
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_update_user_basics", {
      p_id:        user.id,
      p_table:     isDriver ? "drivers" : "passengers",
      p_full_name: draft.full_name,
      p_email:     draft.email,
      p_phone:     draft.phone,
    });
    setBusy(false);
    if (error) { Alert.alert("Could not update", error.message); return; }
    setUser(u => u ? {
      ...u,
      full_name: draft.full_name.trim(),
      email:     draft.email.trim()  || null,
      phone:     draft.phone.trim()  || null,
    } : u);
    setEditing(false);
  };

  const openPrint = () => {
    if (!user) return;
    router.push({ pathname: "/(app)/admin-print-user" as any, params: { id: user.id, role } });
  };

  if (loading || !user) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>←</Text></TouchableOpacity>
          <Text style={s.title}>User</Text><View style={{ width: 24 }} />
        </View>
        <Text style={s.empty}>{loading ? "Loading…" : "User not found"}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>←</Text></TouchableOpacity>
        <Text style={s.title}>User</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <View style={s.hero}>
          {user.avatar_url
            ? <Image source={{ uri: user.avatar_url }} style={s.avatar} />
            : <View style={s.avatarPh}><Text style={{ fontSize: 36 }}>👤</Text></View>}
          <View style={s.nameRow}>
            <Text style={s.name}>{user.full_name || "(no name)"}</Text>
            {user.verified && <VerifiedBadge size={18} />}
          </View>
          <View style={s.chipRow}>
            <Text style={[s.chip, isDriver ? s.chipDriver : s.chipPassenger]}>
              {isDriver ? "DRIVER" : "PASSENGER"}
            </Text>
            {user.is_admin && <Text style={[s.chip, s.chipAdmin]}>ADMIN</Text>}
            {user.blocked && <Text style={[s.chip, s.chipBlocked]}>BLOCKED</Text>}
          </View>
        </View>

        <View style={s.card}>
          {editing ? (
            <>
              <EditRow k="Name"  value={draft.full_name} onChange={v => setDraft(d => ({ ...d, full_name: v }))} />
              <EditRow k="Email" value={draft.email}     onChange={v => setDraft(d => ({ ...d, email: v }))} keyboardType="email-address" />
              <EditRow k="Phone" value={draft.phone}     onChange={v => setDraft(d => ({ ...d, phone: v }))} keyboardType="phone-pad" last />
            </>
          ) : (
            <>
              <Row k="Email" v={user.email || "—"} />
              <Row k="Phone" v={user.phone || "—"} />
              <Row k="Date of birth" v={fmtDate(user.dob)} />
              <Row k="Sex" v={user.sex || "—"} />
              <Row k="Joined" v={fmtDate(user.created_at)} />
              {isDriver && <Row k="Subscription" v={user.subscription_status || "—"} />}
              {isDriver && user.trial_ends_at && <Row k="Trial ends" v={fmtDate(user.trial_ends_at)} />}
              {isDriver && <Row k="Trust score" v={String(Math.round(user.trust_score ?? 0))} last />}
            </>
          )}
        </View>

        {editing ? (
          <View style={s.actionGrid}>
            <TouchableOpacity style={[s.actionBtn, s.actAccent]} disabled={busy} onPress={saveEdit} activeOpacity={0.85}>
              <Text style={[s.actionText, s.txtAccent]}>{busy ? "Saving…" : "💾  Save"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.actNeutral]} disabled={busy} onPress={cancelEdit} activeOpacity={0.85}>
              <Text style={[s.actionText, s.txtT1]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.actionGrid}>
            {isDriver && (
              <TouchableOpacity
                style={[s.actionBtn, user.verified ? s.actVerified : s.actNeutral]}
                disabled={busy}
                onPress={toggleVerified}
                activeOpacity={0.85}
              >
                <Text style={[s.actionText, user.verified ? s.txtGreen : s.txtT1]}>
                  {user.verified ? "✓ Verified" : "Verify"}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.actionBtn, user.blocked ? s.actBlocked : s.actNeutral]}
              disabled={busy}
              onPress={toggleBlocked}
              activeOpacity={0.85}
            >
              <Text style={[s.actionText, user.blocked ? s.txtRed : s.txtT1]}>
                {user.blocked ? "Unblock" : "Block"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.actNeutral]} onPress={sendEmail} activeOpacity={0.85}>
              <Text style={[s.actionText, s.txtT1]}>✉️  Email</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.actAccent]} onPress={openThread} activeOpacity={0.85}>
              <Text style={[s.actionText, s.txtAccent]}>💬  Message</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.actNeutral]} onPress={startEdit} activeOpacity={0.85}>
              <Text style={[s.actionText, s.txtT1]}>✏️  Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.actNeutral]} onPress={openPrint} activeOpacity={0.85}>
              <Text style={[s.actionText, s.txtT1]}>🖨  Print</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={s.sectionLabel}>{isDriver ? "LOADING HISTORY" : "TRIPS"}</Text>
        {activity.length === 0 ? (
          <Text style={s.empty}>No activity yet.</Text>
        ) : activity.map(a => (
          <View key={a.key} style={s.activityRow}>
            <View style={s.dot} />
            <View style={{ flex: 1 }}>
              <Text style={s.activityTitle}>{a.title}</Text>
              {a.detail && <Text style={s.activityDetail}>{a.detail}</Text>}
            </View>
            <Text style={s.activityWhen}>{fmtWhen(a.when)}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <View style={[r.row, last && { borderBottomWidth: 0 }]}>
      <Text style={r.k}>{k}</Text>
      <Text style={r.v} numberOfLines={1}>{v}</Text>
    </View>
  );
}

function EditRow({
  k, value, onChange, keyboardType, last,
}: { k: string; value: string; onChange: (v: string) => void; keyboardType?: "default" | "email-address" | "phone-pad"; last?: boolean }) {
  return (
    <View style={[r.row, last && { borderBottomWidth: 0 }]}>
      <Text style={r.k}>{k}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        style={r.input}
        keyboardType={keyboardType || "default"}
        autoCapitalize={keyboardType === "email-address" ? "none" : "words"}
        placeholderTextColor={Colors.t3}
      />
    </View>
  );
}

const r = StyleSheet.create({
  row:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  k:     { color: Colors.t3, fontSize: 12, fontWeight: "600" },
  v:     { color: Colors.t1, fontSize: 13, fontWeight: "500", maxWidth: "60%", textAlign: "right" },
  input: { color: Colors.t1, fontSize: 13, fontWeight: "500", maxWidth: "60%", textAlign: "right", padding: 0, flex: 1, marginLeft: 8 },
});

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.bg },
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  back:         { fontSize: 20, color: Colors.t2, width: 24 },
  title:        { fontSize: 17, fontWeight: "700", color: Colors.t1 },
  hero:         { alignItems: "center", marginBottom: 16 },
  avatar:       { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.cardAlt, marginBottom: 10 },
  avatarPh:     { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  nameRow:      { flexDirection: "row", alignItems: "center", gap: 8 },
  name:         { fontSize: 20, fontWeight: "800", color: Colors.t1 },
  chipRow:      { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap", justifyContent: "center" },
  chip:         { fontSize: 10, fontWeight: "900", letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: "hidden" },
  chipDriver:   { color: Colors.accent, backgroundColor: Colors.accent+"22", borderWidth: 0.5, borderColor: Colors.accent+"55" },
  chipPassenger:{ color: Colors.blue,   backgroundColor: Colors.blue+"22",   borderWidth: 0.5, borderColor: Colors.blue+"55" },
  chipAdmin:    { color: Colors.green,  backgroundColor: Colors.green+"22",  borderWidth: 0.5, borderColor: Colors.green+"55" },
  chipBlocked:  { color: Colors.red,    backgroundColor: Colors.red+"22",    borderWidth: 0.5, borderColor: Colors.red+"55" },
  card:         { backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: Colors.border, marginBottom: 16 },
  actionGrid:   { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 22 },
  actionBtn:    { flexBasis: "48%", flexGrow: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", borderWidth: 1 },
  actNeutral:   { backgroundColor: Colors.card,        borderColor: Colors.border },
  actVerified:  { backgroundColor: Colors.green+"18",  borderColor: Colors.green },
  actBlocked:   { backgroundColor: Colors.red+"18",    borderColor: Colors.red },
  actAccent:    { backgroundColor: Colors.accent+"18", borderColor: Colors.accent },
  actionText:   { fontSize: 13, fontWeight: "800" },
  txtT1:        { color: Colors.t1 },
  txtGreen:     { color: Colors.green },
  txtRed:       { color: Colors.red },
  txtAccent:    { color: Colors.accent },
  sectionLabel: { fontSize: 10, fontWeight: "800", color: Colors.t3, letterSpacing: 0.8, marginBottom: 10 },
  activityRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 0.3, borderBottomColor: Colors.border },
  dot:          { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.accent },
  activityTitle:{ color: Colors.t1, fontSize: 13, fontWeight: "700" },
  activityDetail:{ color: Colors.t3, fontSize: 11, marginTop: 2 },
  activityWhen: { color: Colors.t3, fontSize: 11 },
  empty:        { color: Colors.t3, textAlign: "center", marginTop: 30, fontSize: 13 },
});
