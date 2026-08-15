import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Navigation, Check, Flag } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import { PickupAPI, MyPickup } from "../../services/pickup";

export default function PickupStatusScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const { request_id } = useLocalSearchParams<{ request_id: string }>();
  const [mp, setMp] = useState<MyPickup | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!request_id) return;
    const r = await PickupAPI.myPickup(String(request_id));
    setMp(r); setLoading(false);
  }, [request_id]);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 8000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  const onTheWay = mp ? ["picked_up", "dropped", "arrived"].includes(mp.status) : false;
  const seq = mp?.seq ?? 1;
  const total = mp?.total_stops ?? 1;

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{t("pickupStatusTitle")}</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={Colors.accentP} /></View>
      ) : !mp ? (
        <View style={s.center}><Text style={s.muted}>{t("pickupStatusNone")}</Text></View>
      ) : (
        <View style={{ padding: 16 }}>
          {/* progress dots */}
          <View style={s.prog}>
            {Array.from({ length: Math.min(total, 6) }).map((_, i) => {
              const done = i < (mp.picked_up_before ?? 0);
              const cur = i === seq - 1;
              return (
                <View key={i} style={s.progItem}>
                  <View style={[s.dot, done && s.dotDone, cur && s.dotCur]}>
                    {done ? <Check size={12} color="#08210f" /> : <Text style={[s.dotN, cur && { color: Colors.accentPText }]}>{i + 1}</Text>}
                  </View>
                  {i < Math.min(total, 6) - 1 && <View style={[s.bar, i < seq - 1 && s.barOn]} />}
                </View>
              );
            })}
          </View>

          <View style={s.big}>
            <Text style={s.bigK}>{onTheWay ? t("pickupOnWay") : t("pickupYouAre")}</Text>
            {!onTheWay && <Text style={s.bigV}><Text style={{ color: Colors.accentP }}>{seq}</Text> {t("pickupOfN", { n: total })}</Text>}
          </View>

          <View style={[s.tag, onTheWay ? s.tagWay : s.tagWait]}>
            {onTheWay ? <Flag size={15} color={Colors.accentP} /> : <Navigation size={15} color={Colors.accentP} />}
            <Text style={s.tagTxt}>
              {onTheWay ? t("pickupTagWay") : (mp.eta_min != null ? t("pickupTagEta", { n: mp.eta_min }) : t("pickupTagWaiting"))}
            </Text>
          </View>

          <View style={s.card}>
            {!!mp.driver?.name && <View style={s.row}><Text style={s.rk}>{t("pickupDriver")}</Text><Text style={s.rv}>{mp.driver.name}</Text></View>}
            {!!mp.driver?.car && <View style={s.row}><Text style={s.rk}>{t("pickupCar")}</Text><Text style={s.rv}>{mp.driver.car}{mp.driver.plate ? ` · ${mp.driver.plate}` : ""}</Text></View>}
            <View style={s.row}><Text style={s.rk}>{t("pickupThen")}</Text><Text style={s.rv}>{t("pickupBoardVan")}</Text></View>
          </View>

          {mp.paid && (
            <TouchableOpacity style={s.receiptBtn} activeOpacity={0.85}
              onPress={() => router.push({ pathname: "/(passenger)/pickup-receipt" as any, params: { request_id: String(request_id) } })}>
              <Text style={s.receiptBtnTxt}>{t("receiptView")}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  title: { color: Colors.t1, fontSize: 18, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: Colors.t2 },
  prog: { flexDirection: "row", alignItems: "center", marginVertical: 8 },
  progItem: { flexDirection: "row", alignItems: "center", flex: 1 },
  dot: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  dotDone: { backgroundColor: Colors.green },
  dotCur: { backgroundColor: Colors.accentP },
  dotN: { color: Colors.t3, fontSize: 11, fontWeight: "800" },
  bar: { flex: 1, height: 2, backgroundColor: Colors.border },
  barOn: { backgroundColor: Colors.accentP },
  big: { alignItems: "center", marginTop: 18 },
  bigK: { color: Colors.t2, fontSize: 12 },
  bigV: { fontSize: 30, fontWeight: "900", color: Colors.t1, marginTop: 6 },
  tag: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 11, marginTop: 16, borderWidth: 1 },
  tagWait: { backgroundColor: "rgba(234,106,30,0.12)", borderColor: "rgba(234,106,30,0.5)" },
  tagWay: { backgroundColor: "rgba(234,106,30,0.12)", borderColor: "rgba(234,106,30,0.5)" },
  tagTxt: { color: Colors.accentP, fontWeight: "800", fontSize: 13 },
  card: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginTop: 18 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  rk: { color: Colors.t2, fontSize: 13 },
  rv: { color: Colors.t1, fontWeight: "700", fontSize: 13 },
  receiptBtn: { borderWidth: 1.5, borderColor: Colors.accentP, borderRadius: 12, alignItems: "center", paddingVertical: 13, marginTop: 16 },
  receiptBtnTxt: { color: Colors.accentP, fontWeight: "800", fontSize: 14 },
});
