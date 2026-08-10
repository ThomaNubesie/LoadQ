import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CourierPayAPI, type PayoutReceipt, type T4Year } from "../../services/courierPay";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { ArrowLeft, Package } from "lucide-react-native";

const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

export default function CourierEarningsScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PayoutReceipt[]>([]);
  const [years, setYears] = useState<T4Year[]>([]);

  useEffect(() => {
    (async () => {
      const r = await CourierPayAPI.receipts();
      setRows(r); setYears(CourierPayAPI.summarize(r)); setLoading(false);
    })();
  }, []);

  const thisYear = new Date().getUTCFullYear();
  const dateLabel = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={20} color={Colors.t2} strokeWidth={2} /></TouchableOpacity>
        <Text style={s.title}>{t.payTitle}</Text>
        <View style={{ width: 20 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={Colors.accent} /></View>
      ) : rows.length === 0 ? (
        <View style={s.center}>
          <Package size={30} color={Colors.t3} strokeWidth={1.8} />
          <Text style={s.empty}>{t.payNone}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text style={s.sub}>{t.paySub}</Text>

          {/* T4 summary per year */}
          <Text style={s.section}>{t.payT4}</Text>
          {years.map((y) => (
            <View key={y.year} style={[s.yearCard, y.year === thisYear && s.yearCardActive]}>
              <View>
                <Text style={s.yearNum}>{y.year}{y.year === thisYear ? ` · ${t.payThisYear}` : ""}</Text>
                <Text style={s.yearMeta}>{y.count} {t.payDeliveries}</Text>
              </View>
              <Text style={[s.yearTotal, y.year === thisYear && { color: Colors.accent }]}>{money(y.total_cents)}</Text>
            </View>
          ))}

          {/* Itemized receipts */}
          <Text style={s.section}>{t.payReceipts}</Text>
          {rows.map((r) => (
            <View key={r.id} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowRoute} numberOfLines={1}>{[r.trip_from, r.trip_to].filter(Boolean).join(" → ") || (r.parcel_code || "—")}</Text>
                <Text style={s.rowMeta}>{dateLabel(r.paid_at)}{r.method ? ` · ${r.method}` : ""}{r.parcel_code ? ` · ${r.parcel_code}` : ""}</Text>
              </View>
              <Text style={s.rowAmt}>{money(r.amount_cents)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  title:     { fontSize: 17, fontWeight: "700", color: Colors.t1 },
  center:    { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 30 },
  empty:     { color: Colors.t3, fontSize: 14 },
  sub:       { color: Colors.t2, fontSize: 13, marginBottom: 4 },
  section:   { color: Colors.t3, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  yearCard:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 15, marginBottom: 9 },
  yearCardActive: { borderColor: Colors.accent },
  yearNum:   { color: Colors.t1, fontWeight: "800", fontSize: 15 },
  yearMeta:  { color: Colors.t3, fontSize: 12, marginTop: 2 },
  yearTotal: { color: Colors.t1, fontWeight: "900", fontSize: 20 },
  row:       { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border, borderRadius: 12, padding: 13, marginBottom: 8 },
  rowRoute:  { color: Colors.t1, fontWeight: "700", fontSize: 14 },
  rowMeta:   { color: Colors.t3, fontSize: 12, marginTop: 2 },
  rowAmt:    { color: Colors.t1, fontWeight: "800", fontSize: 15 },
});
