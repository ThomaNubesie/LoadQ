import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, RefreshControl, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Check, Search } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { supabase } from "../../services/supabase";

const money = (c: number) => `$${((c ?? 0) / 100).toFixed(2)}`;

type Unpaid = { pay_ref: string; kind: string; amount_cents: number; origin: string | null; dropoff: string | null; scheduled_date: string | null; created_at: string };

export default function AdminPaymentsScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Unpaid[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("loadq_admin_unpaid");
    setRows((data as Unpaid[]) ?? []); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  async function markPaid(r: string) {
    const ref2 = r.trim().toUpperCase();
    if (!ref2) return;
    setBusy(ref2);
    const { data, error } = await supabase.rpc("loadq_admin_mark_paid", { p_ref: ref2 });
    setBusy(null);
    const res = data as any;
    if (error || !res?.ok) {
      Alert.alert("Mark paid", error?.message || (res?.error === "already_paid" ? "Already paid." : res?.error === "ref_not_found" ? "Reference not found." : res?.error === "not_admin" ? "Admin only." : "Failed."));
      return;
    }
    Alert.alert("Marked paid", `${ref2} → ${res.kind} confirmed. It will now appear on the board/offers.`);
    setRef("");
    await load();
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>Payments</Text>
        <View style={{ width: 22 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>

          <Text style={s.lead}>Mark an Interac payment as received when the auto-matcher misses it. Enter the LQ- reference from the e-Transfer, or tap a request below.</Text>

          <View style={s.searchRow}>
            <View style={s.searchField}>
              <Search size={16} color={Colors.t3} />
              <TextInput
                value={ref} onChangeText={setRef} placeholder="LQ-XXXXX" placeholderTextColor={Colors.t3}
                autoCapitalize="characters" autoCorrect={false} style={s.input}
              />
            </View>
            <TouchableOpacity style={[s.markBtn, (!ref.trim() || busy) && { opacity: 0.5 }]} onPress={() => markPaid(ref)} disabled={!ref.trim() || !!busy} activeOpacity={0.85}>
              {busy === ref.trim().toUpperCase() ? <ActivityIndicator color={Colors.accentText} /> : <><Check size={16} color={Colors.accentText} /><Text style={s.markTxt}>Mark paid</Text></>}
            </TouchableOpacity>
          </View>

          <Text style={s.hd}>Awaiting payment</Text>
          {loading ? <ActivityIndicator color={Colors.accent} style={{ marginTop: 20 }} /> :
            rows.length === 0 ? <Text style={s.empty}>Nothing awaiting payment.</Text> :
            rows.map((r) => (
              <View key={r.pay_ref} style={s.card}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={s.ref}>{r.pay_ref}</Text>
                    <View style={s.kindTag}><Text style={s.kindTxt}>{r.kind}</Text></View>
                    {!!r.scheduled_date && <Text style={s.date}>{r.scheduled_date}</Text>}
                  </View>
                  {!!r.origin && <Text style={s.route} numberOfLines={1}>{r.origin}{r.dropoff ? ` → ${r.dropoff}` : ""}</Text>}
                  <Text style={s.amt}>{money(r.amount_cents)}</Text>
                </View>
                <TouchableOpacity style={[s.rowBtn, busy === r.pay_ref && { opacity: 0.5 }]} onPress={() => markPaid(r.pay_ref)} disabled={!!busy} activeOpacity={0.85}>
                  {busy === r.pay_ref ? <ActivityIndicator color={Colors.accentText} /> : <Text style={s.rowBtnTxt}>Mark paid</Text>}
                </TouchableOpacity>
              </View>
            ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  title: { color: Colors.t1, fontSize: 18, fontWeight: "800" },
  lead: { color: Colors.t2, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  searchRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  searchField: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 12 },
  input: { flex: 1, color: Colors.t1, fontSize: 15, paddingVertical: 12, fontWeight: "700" },
  markBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.accent, borderRadius: 12, paddingHorizontal: 14, justifyContent: "center" },
  markTxt: { color: Colors.accentText, fontWeight: "800", fontSize: 13 },
  hd: { color: Colors.t1, fontWeight: "800", fontSize: 15, marginBottom: 10 },
  empty: { color: Colors.t3, fontSize: 13, marginTop: 8 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 13, padding: 13, marginBottom: 9 },
  ref: { color: Colors.t1, fontWeight: "900", fontSize: 14 },
  kindTag: { backgroundColor: Colors.cardAlt, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  kindTxt: { color: Colors.t2, fontSize: 10, fontWeight: "800" },
  date: { color: Colors.accentWarmText, fontSize: 11, fontWeight: "800" },
  route: { color: Colors.t3, fontSize: 12, marginTop: 3 },
  amt: { color: Colors.accent, fontWeight: "900", fontSize: 14, marginTop: 4 },
  rowBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 },
  rowBtnTxt: { color: Colors.accentText, fontWeight: "800", fontSize: 12.5 },
});
