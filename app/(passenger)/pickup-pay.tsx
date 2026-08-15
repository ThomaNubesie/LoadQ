import { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { ArrowLeft, Copy, Clock, Check } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import { PickupAPI, fmtMoney } from "../../services/pickup";

export default function PickupPayScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const p = useLocalSearchParams<{ request_id: string; pay_ref: string; interac_to: string; total_cents: string; dest: string }>();
  const [copied, setCopied] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const total = fmtMoney(Number(p.total_cents || 0));

  async function copy(kind: string, value: string) {
    await Clipboard.setStringAsync(value);
    setCopied(kind);
    setTimeout(() => setCopied(c => (c === kind ? null : c)), 1500);
  }

  // Poll for the Interac match; auto-advance to tracking when paid.
  useEffect(() => {
    if (!p.request_id) return;
    const check = async () => {
      const mp = await PickupAPI.myPickup(String(p.request_id));
      if (mp?.paid) {
        setPaid(true);
        if (timer.current) clearInterval(timer.current);
        setTimeout(() => router.replace({ pathname: "/(passenger)/pickup-status" as any, params: { request_id: String(p.request_id) } }), 1200);
      }
    };
    check();
    timer.current = setInterval(check, 8000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [p.request_id]);

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{t("confirmPayTitle")}</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={s.lead}>{t("payLead")}</Text>

        <View style={s.line}>
          <View style={{ flex: 1 }}><Text style={s.k}>{t("payAmount")}</Text><Text style={s.v}>{total}</Text></View>
        </View>
        <View style={s.line}>
          <View style={{ flex: 1 }}><Text style={s.k}>{t("paySendTo")}</Text><Text style={s.v}>{p.interac_to}</Text></View>
          <TouchableOpacity style={s.copy} onPress={() => copy("to", String(p.interac_to))} hitSlop={8}>
            {copied === "to" ? <Check size={13} color={Colors.green} /> : <Copy size={13} color={Colors.t2} />}
            <Text style={s.copyTxt}>{copied === "to" ? t("payCopied") : t("payCopy")}</Text>
          </TouchableOpacity>
        </View>
        <View style={[s.line, s.codeLine]}>
          <View style={{ flex: 1 }}><Text style={s.k}>{t("payCode")}</Text><Text style={s.code}>{p.pay_ref}</Text></View>
          <TouchableOpacity style={[s.copy, s.copyAccent]} onPress={() => copy("code", String(p.pay_ref))} hitSlop={8}>
            {copied === "code" ? <Check size={13} color={Colors.green} /> : <Copy size={13} color={Colors.accentP} />}
            <Text style={[s.copyTxt, { color: Colors.accentP }]}>{copied === "code" ? t("payCopied") : t("payCopy")}</Text>
          </TouchableOpacity>
        </View>

        <View style={s.statusWrap}>
          {paid ? (
            <View style={[s.pill, { backgroundColor: Colors.green + "22" }]}>
              <Check size={15} color={Colors.green} />
              <Text style={[s.pillTxt, { color: Colors.green }]}>{t("payMatched")}</Text>
            </View>
          ) : (
            <View style={s.pill}>
              <ActivityIndicator size="small" color={Colors.yellow} />
              <Text style={s.pillTxt}>{t("payWaiting")}</Text>
            </View>
          )}
        </View>
        <Text style={s.hint}>{t("payHint")}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  title: { color: Colors.t1, fontSize: 18, fontWeight: "800" },
  lead: { color: Colors.t2, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  line: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 13, marginBottom: 10 },
  codeLine: { borderColor: Colors.accentP },
  k: { color: Colors.t2, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  v: { color: Colors.t1, fontWeight: "800", fontSize: 15, marginTop: 3 },
  code: { color: Colors.accentP, fontWeight: "800", fontSize: 20, letterSpacing: 1, marginTop: 3, fontVariant: ["tabular-nums"] },
  copy: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 7 },
  copyAccent: { borderColor: Colors.accentP },
  copyTxt: { color: Colors.t2, fontWeight: "800", fontSize: 11 },
  statusWrap: { alignItems: "center", marginTop: 12 },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(245,200,66,0.14)", borderWidth: 1, borderColor: "rgba(245,200,66,0.5)", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  pillTxt: { color: Colors.yellow, fontWeight: "800", fontSize: 12.5 },
  hint: { color: Colors.t3, fontSize: 11, textAlign: "center", marginTop: 12, lineHeight: 16 },
});
