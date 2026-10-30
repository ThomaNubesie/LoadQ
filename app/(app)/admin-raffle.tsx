// LoadQ Morning Raffle — in-app admin control, tiered. ANY raffle admin can see
// the live board and set / rotate today's lot code. The LEAD admin (pinned to one
// account in loadq_raffle_config.lead_admin_id) also gets the enable/disable toggle,
// test-mode toggle, and the force-draw button. Every action is enforced server-side
// (loadq_raffle_* RPCs); the UI just hides the lead-only controls for sub-admins.
import { useCallback, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Switch, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { ArrowLeft, Lock, Dices, ShieldCheck, Shuffle, Clock } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import { RaffleAPI, RaffleAdminCtx, RaffleMonitorRow } from "../../services/raffle";

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : ""); // 'HH:MM:SS' -> 'HH:MM'

export default function AdminRaffle() {
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [ctx, setCtx] = useState<RaffleAdminCtx | null>(null);
  const [rows, setRows] = useState<RaffleMonitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCode, setNewCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    const c = await RaffleAPI.adminCtx();
    setCtx(c);
    if (c.is_admin && !c.error) setRows(await RaffleAPI.monitor());
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]));

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(null), 2600); };
  const mapErr = (e: string) =>
    e === "no_round" ? t.raffleAdminNoRound
    : e === "not_lead" ? t.raffleAdminLeadOnly
    : (e === "not_admin" || e === "forbidden") ? t.raffleAdminForbidden
    : e;

  const statusLabel = (s?: string) =>
    s === "open" ? t.raffleAdminStOpen
    : s === "locked" ? t.raffleAdminStLocked
    : s === "drawn" ? t.raffleAdminStDrawn
    : t.raffleAdminStNone;

  const saveCode = async () => {
    const len = ctx?.code_len ?? 4;
    if (!new RegExp(`^[0-9]{${len}}$`).test(newCode.trim())) { Alert.alert(t("raffleAdminBadCode", { n: len })); return; }
    setBusy("code");
    const r = await RaffleAPI.setCode(newCode.trim());
    setBusy(null);
    if (r.error) Alert.alert(mapErr(r.error)); else { setNewCode(""); showFlash(t.raffleAdminCodeSaved); load(); }
  };
  const randomCode = () => {
    const len = ctx?.code_len ?? 4;
    let s = ""; for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
    setNewCode(s);
  };
  const onToggleEnabled = async (v: boolean) => {
    setBusy("enabled");
    const r = await RaffleAPI.setEnabled(v);
    setBusy(null);
    if (r.error) Alert.alert(mapErr(r.error)); else load();
  };
  const onToggleTest = async (v: boolean) => {
    setBusy("test");
    const r = await RaffleAPI.setTestMode(v);
    setBusy(null);
    if (r.error) Alert.alert(mapErr(r.error)); else load();
  };
  const onForceDraw = () => {
    Alert.alert(t.raffleAdminForceDraw, t.raffleAdminDrawConfirm, [
      { text: t.raffleAdminCancel, style: "cancel" },
      { text: t.raffleAdminDraw, style: "destructive", onPress: async () => {
          setBusy("draw");
          const r = await RaffleAPI.forceDraw();
          setBusy(null);
          if (r.error) Alert.alert(mapErr(r.error)); else { showFlash(t.raffleAdminDrawDone); load(); }
      } },
    ]);
  };

  const Header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12 }}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
        <ArrowLeft size={24} color={Colors.t1} />
      </TouchableOpacity>
      <Dices size={22} color={Colors.accentWarm} strokeWidth={2} />
      <Text style={{ fontSize: 20, fontWeight: "800", color: Colors.t1 }}>{t.raffleAdminTitle}</Text>
    </View>
  );

  if (loading) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={Colors.accent} /></SafeAreaView>;
  }

  if (!ctx || !ctx.is_admin || ctx.error) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg }}>
        {Header}
        <View style={{ alignItems: "center", justifyContent: "center", flex: 1, padding: 30 }}>
          <Lock size={40} color={Colors.t3} />
          <Text style={{ marginTop: 14, fontSize: 15, fontWeight: "600", color: Colors.t2, textAlign: "center" }}>{t.raffleAdminForbidden}</Text>
        </View>
      </View>
    );
  }

  const lead = ctx.is_lead;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {Header}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={insets.top + 8}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {/* Role + route */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <View style={{ backgroundColor: lead ? Colors.accentWarm : Colors.cardAlt, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: "800", color: lead ? "#fff" : Colors.t2 }}>{lead ? t.raffleAdminLeadChip : t.raffleAdminAdminChip}</Text>
            </View>
            <Text style={{ fontSize: 13, color: Colors.t2 }}>Universal Grocery → Montréal</Text>
          </View>

          {flash && (
            <View style={{ backgroundColor: "rgba(18,161,80,0.12)", borderRadius: 10, padding: 10, marginBottom: 12 }}>
              <Text style={{ color: Colors.green, fontWeight: "700", fontSize: 13 }}>{flash}</Text>
            </View>
          )}

          {/* Status card */}
          <View style={{ backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
              <Text style={{ fontSize: 13, color: Colors.t2 }}>{t.raffleAdminStatus}</Text>
              <Text style={{ fontSize: 13, fontWeight: "800", color: ctx.status === "open" ? Colors.green : ctx.status === "drawn" || ctx.status === "locked" ? Colors.t2 : Colors.t3 }}>{statusLabel(ctx.status)}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Clock size={13} color={Colors.t3} />
                <Text style={{ fontSize: 12, color: Colors.t3 }}>{t("raffleAdminWindow", { open: hhmm(ctx.checkin_opens_local) || "6:00", close: hhmm(ctx.draw_at_local) || "7:15" })}</Text>
              </View>
              <Text style={{ fontSize: 12, color: Colors.t3 }}>{t("raffleAdminEntrants", { n: ctx.entrant_count })}</Text>
            </View>
          </View>

          {/* Daily code — any admin */}
          <View style={{ backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 14 }}>
            <Text style={{ fontSize: 14, fontWeight: "800", color: Colors.t1 }}>{t.raffleAdminCodeTitle}</Text>
            <Text style={{ fontSize: 12, color: Colors.t3, marginTop: 2, marginBottom: 10 }}>{t.raffleAdminCodeHint}</Text>
            <Text style={{ fontSize: 34, fontWeight: "900", letterSpacing: 8, color: Colors.accentWarm, textAlign: "center", marginBottom: 12 }}>{ctx.code ?? "––––"}</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TextInput value={newCode} onChangeText={setNewCode} placeholder={"•".repeat(ctx.code_len)} placeholderTextColor={Colors.t3}
                keyboardType="number-pad" maxLength={ctx.code_len}
                style={{ flex: 1, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12, padding: 12, fontSize: 20, fontWeight: "800", textAlign: "center", letterSpacing: 6, color: Colors.t1, backgroundColor: Colors.bg }} />
              <TouchableOpacity onPress={randomCode} style={{ borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }}>
                <Shuffle size={18} color={Colors.t2} />
                <Text style={{ fontSize: 10, color: Colors.t3, marginTop: 2 }}>{t.raffleAdminRandom}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={saveCode} disabled={busy === "code" || newCode.trim().length === 0}
              style={{ marginTop: 12, backgroundColor: Colors.accent, borderRadius: 12, padding: 14, alignItems: "center", opacity: busy === "code" || newCode.trim().length === 0 ? 0.5 : 1 }}>
              {busy === "code" ? <ActivityIndicator color={Colors.accentText} /> : <Text style={{ color: Colors.accentText, fontWeight: "800", fontSize: 15 }}>{t.raffleAdminSaveCode}</Text>}
            </TouchableOpacity>
          </View>

          {/* Lead-only controls */}
          {lead && (
            <View style={{ backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 14 }}>
              <Text style={{ fontSize: 14, fontWeight: "800", color: Colors.t1, marginBottom: 12 }}>{t.raffleAdminLeadSection}</Text>

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: Colors.t1 }}>{t.raffleAdminEnable}</Text>
                  <Text style={{ fontSize: 12, color: Colors.t3 }}>{t.raffleAdminEnableHint}</Text>
                </View>
                <Switch value={ctx.enabled} onValueChange={onToggleEnabled} disabled={busy === "enabled"}
                  trackColor={{ true: Colors.accentWarm, false: Colors.border }} />
              </View>

              <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 10 }} />

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: Colors.t1 }}>{t.raffleAdminTestMode}</Text>
                  <Text style={{ fontSize: 12, color: Colors.t3 }}>{t.raffleAdminTestHint}</Text>
                </View>
                <Switch value={ctx.test_mode} onValueChange={onToggleTest} disabled={busy === "test"}
                  trackColor={{ true: Colors.yellow, false: Colors.border }} />
              </View>

              <TouchableOpacity onPress={onForceDraw} disabled={busy === "draw" || ctx.status === "drawn"}
                style={{ marginTop: 16, backgroundColor: Colors.t1, borderRadius: 12, padding: 14, alignItems: "center", opacity: busy === "draw" || ctx.status === "drawn" ? 0.5 : 1 }}>
                {busy === "draw" ? <ActivityIndicator color={Colors.bg} /> : <Text style={{ color: Colors.bg, fontWeight: "800", fontSize: 15 }}>{t.raffleAdminForceDraw}</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* Live monitor */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <ShieldCheck size={16} color={Colors.t2} />
            <Text style={{ fontSize: 15, fontWeight: "800", color: Colors.t1 }}>{t.raffleAdminMonitor}</Text>
          </View>
          {rows.length === 0 ? (
            <Text style={{ fontSize: 13, color: Colors.t3, paddingVertical: 10 }}>{t.raffleAdminNoEntrants}</Text>
          ) : (
            rows.map((r) => (
              <View key={r.driver_id} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, marginBottom: 8, borderRadius: 12, backgroundColor: Colors.cardAlt, borderWidth: 1, borderColor: Colors.border }}>
                <View style={{ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border }}>
                  <Text style={{ fontWeight: "900", color: Colors.t1, fontSize: 13 }}>{r.provisional}</Text>
                </View>
                <Text style={{ flex: 1, fontSize: 12, color: Colors.t2 }}>{new Date(r.checked_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Pill ok={r.geo_ok} okLabel={t.raffleAdminGeoOk} noLabel={t.raffleAdminGeoNo} />
                  <Pill ok={r.code_ok} okLabel="code" noLabel="code" />
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Pill({ ok, okLabel, noLabel }: { ok: boolean; okLabel: string; noLabel: string }) {
  return (
    <View style={{ backgroundColor: ok ? "rgba(18,161,80,0.14)" : "rgba(226,76,76,0.14)", borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 }}>
      <Text style={{ fontSize: 10, fontWeight: "700", color: ok ? Colors.green : Colors.red }}>{ok ? okLabel : noLabel}</Text>
    </View>
  );
}
