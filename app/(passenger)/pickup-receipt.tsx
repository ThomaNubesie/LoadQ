import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Save, Mail, MessageSquare, Send } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import { ReceiptAPI, PickupReceipt, fmtMoney } from "../../services/pickup";
import { PassengersAPI } from "../../services/passengers";
import { getRegionName } from "../../constants/pricing";

type Tab = "inapp" | "email" | "sms";

export default function PickupReceiptScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useStrings();
  const { request_id } = useLocalSearchParams<{ request_id: string }>();
  const [rc, setRc] = useState<PickupReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("inapp");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Tab | null>(null);

  useEffect(() => {
    if (!request_id) return;
    ReceiptAPI.get(String(request_id)).then(r => { setRc(r); setLoading(false); });
    PassengersAPI.getMe().then(p => { if (p) setContact(p.email || p.phone || ""); });
  }, [request_id]);

  function switchTab(nx: Tab) {
    setTab(nx); setSent(null);
    PassengersAPI.getMe().then(p => { if (p) setContact(nx === "sms" ? (p.phone || "") : (p.email || "")); });
  }

  async function deliver() {
    if (!rc || !contact.trim()) { Alert.alert(t("receiptTitle"), t("receiptNeedContact")); return; }
    setSending(true);
    const { ok, error } = await ReceiptAPI.send(rc.request_id, tab === "sms" ? "sms" : "email", contact.trim());
    setSending(false);
    if (error || !ok) { Alert.alert(t("receiptTitle"), error || t("receiptFailed")); return; }
    setSent(tab);
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{t("receiptTitle")}</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={Colors.accentP} /></View>
      ) : !rc ? (
        <View style={s.center}><Text style={s.muted}>{t("receiptNone")}</Text></View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
        >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          {/* Branded receipt (LoadQ wordmark, not Concord letterhead) */}
          <View style={s.rcpt}>
            <View style={s.rcptHd}>
              <View style={s.wordmark}><Text style={s.wordmarkTxt}>LoadQ</Text></View>
              <Text style={s.rcptTitle}>{t("receiptHeading")}</Text>
              <Text style={s.rcptSub}>{rc.code}</Text>
            </View>
            <View style={s.rcptBody}>
              <Row k={t("receiptPickup")} v={rc.pickup || "—"} />
              <Row k={t("receiptDest")} v={rc.destination ? getRegionName(rc.destination) : "—"} />
              <Row k={t("receiptService")} v={t("receiptFeeder")} />
              {!!rc.driver && <Row k={t("receiptDriver")} v={rc.driver} />}
              <View style={{ height: 6 }} />
              <Row k={t("receiptFee")} v={fmtMoney(rc.fee_cents)} />
              <Row k={t("receiptTax")} v={fmtMoney(rc.tax_cents)} />
              <View style={s.totRow}>
                <Text style={s.totK}>{t("receiptTotal")}</Text>
                <Text style={s.totV}>{fmtMoney(rc.total_cents)}</Text>
              </View>
            </View>
            <View style={s.rcptFt}>
              <Text style={s.ftTxt}>LoadQ — operated by Concord Express Co Inc. · Ottawa · {rc.hst_number} · loadq.ca</Text>
            </View>
          </View>

          {/* Delivery */}
          <View style={s.tabs}>
            {(["inapp", "email", "sms"] as Tab[]).map(k => (
              <TouchableOpacity key={k} style={[s.tab, tab === k && s.tabOn]} onPress={() => switchTab(k)} activeOpacity={0.8}>
                {k === "inapp" ? <Save size={16} color={tab === k ? Colors.accentP : Colors.t2} /> : k === "email" ? <Mail size={16} color={tab === k ? Colors.accentP : Colors.t2} /> : <MessageSquare size={16} color={tab === k ? Colors.accentP : Colors.t2} />}
                <Text style={[s.tabTxt, tab === k && s.tabTxtOn]}>{t(k === "inapp" ? "receiptInApp" : k === "email" ? "receiptEmail" : "receiptSms")}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === "inapp" ? (
            <Text style={s.hint}>{t("receiptScreenshot")}</Text>
          ) : (
            <>
              <TextInput
                style={s.input}
                value={contact}
                onChangeText={setContact}
                placeholder={tab === "email" ? t("receiptEmailPh") : t("receiptPhonePh")}
                placeholderTextColor={Colors.t3}
                keyboardType={tab === "email" ? "email-address" : "phone-pad"}
                autoCapitalize="none"
              />
              <TouchableOpacity style={[s.send, (sending || sent === tab) && { opacity: 0.6 }]} onPress={deliver} disabled={sending || sent === tab} activeOpacity={0.85}>
                {sending ? <ActivityIndicator color={Colors.accentPText} /> : <><Send size={15} color={Colors.accentPText} /><Text style={s.sendTxt}>{sent === tab ? t("receiptSent") : t("receiptSend")}</Text></>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <View style={s.row}><Text style={s.rowK}>{k}</Text><Text style={s.rowV} numberOfLines={1}>{v}</Text></View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  title: { color: Colors.t1, fontSize: 18, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: Colors.t2 },
  rcpt: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, overflow: "hidden" },
  rcptHd: { padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  wordmark: { alignSelf: "flex-start", backgroundColor: Colors.accentP, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 5 },
  wordmarkTxt: { color: Colors.accentPText, fontWeight: "900", fontSize: 14, letterSpacing: 0.3 },
  rcptTitle: { color: Colors.t1, fontSize: 15, fontWeight: "800", marginTop: 12 },
  rcptSub: { color: Colors.t2, fontSize: 11, marginTop: 2 },
  rcptBody: { padding: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, gap: 12 },
  rowK: { color: Colors.t2, fontSize: 12.5 },
  rowV: { color: Colors.t1, fontWeight: "700", fontSize: 12.5, flexShrink: 1, textAlign: "right" },
  totRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: Colors.border, borderStyle: "dashed", marginTop: 6, paddingTop: 9 },
  totK: { color: Colors.t2, fontSize: 13 },
  totV: { color: Colors.accentP, fontWeight: "900", fontSize: 16 },
  rcptFt: { padding: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  ftTxt: { color: Colors.t3, fontSize: 9.5, textAlign: "center", lineHeight: 14 },
  tabs: { flexDirection: "row", gap: 8, marginTop: 18 },
  tab: { flex: 1, flexDirection: "column", alignItems: "center", gap: 5, borderWidth: 1, borderColor: Colors.border, borderRadius: 11, paddingVertical: 11 },
  tabOn: { borderColor: Colors.accentP, backgroundColor: "rgba(234,106,30,0.08)" },
  tabTxt: { color: Colors.t2, fontWeight: "800", fontSize: 11.5 },
  tabTxtOn: { color: Colors.accentP },
  hint: { color: Colors.t3, fontSize: 12, textAlign: "center", marginTop: 16, lineHeight: 17 },
  input: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 11, padding: 13, color: Colors.t1, fontSize: 15, marginTop: 14 },
  send: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: Colors.accentP, borderRadius: 12, paddingVertical: 14, marginTop: 12 },
  sendTxt: { color: Colors.accentPText, fontWeight: "900", fontSize: 15 },
});
