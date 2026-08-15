import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Navigation, Check, Flag, Phone } from "lucide-react-native";
import { Linking } from "react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import BottomNav from "../../components/BottomNav";
import { DriversAPI } from "../../services/drivers";
import { PickupAPI, FeederRun } from "../../services/pickup";
import { tryGetUserLocation } from "../../utils/gpsTimeout";
import { supabase } from "../../services/supabase";

export default function FeederScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const [vehicle, setVehicle] = useState<{ id: string; seats: number; label: string } | null>(null);
  const [onDuty, setOnDuty] = useState(false);
  const [run, setRun] = useState<FeederRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRun = useCallback(async () => { setRun(await PickupAPI.myRun()); }, []);

  useEffect(() => {
    (async () => {
      const vs = await DriversAPI.getVehicles();
      const v = vs.find((x: any) => x.is_active) ?? vs[0];
      if (v) setVehicle({ id: v.id, seats: v.seats ?? 4, label: [v.color, v.make, v.model].filter(Boolean).join(" ") });
      // best-effort read current on-duty state
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: pd } = await supabase.from("loadq_pickup_drivers").select("on_duty").eq("driver_id", user.id).maybeSingle();
        if (pd?.on_duty) setOnDuty(true);
      }
      await loadRun();
      setLoading(false);
    })();
  }, [loadRun]);

  // Poll the run while on duty.
  useEffect(() => {
    if (!onDuty) { if (timer.current) clearInterval(timer.current); return; }
    timer.current = setInterval(loadRun, 15000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [onDuty, loadRun]);

  async function toggleDuty() {
    if (!vehicle) { Alert.alert(t("feederTitle"), t("feederNoVehicle")); return; }
    setBusy(true);
    const next = !onDuty;
    const loc = await tryGetUserLocation(6000);
    if (next && !loc) { setBusy(false); Alert.alert(t("feederTitle"), t("feederNeedGps")); return; }
    const { error } = await PickupAPI.goOnDuty(vehicle.id, loc?.coords.latitude ?? 0, loc?.coords.longitude ?? 0, next);
    setBusy(false);
    if (error) { Alert.alert(t("feederTitle"), error); return; }
    setOnDuty(next);
    if (next) await loadRun();
  }

  async function mark(reqId: string) {
    setBusy(true);
    const { error } = await PickupAPI.markStop(reqId);
    setBusy(false);
    if (error) { Alert.alert(t("feederTitle"), error); return; }
    await loadRun();
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{t("feederTitle")}</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={Colors.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
          <Text style={s.lead}>{t("feederLead")}</Text>

          <View style={s.dutyCard}>
            <View style={s.dutyRow}>
              <Navigation size={20} color={Colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={s.dutyTitle}>{t("feederOnDuty")}</Text>
                <Text style={s.dutySub}>{onDuty ? t("feederSharing") : t("feederShareGps")}</Text>
              </View>
              <TouchableOpacity style={[s.tgl, !onDuty && s.tglOff]} onPress={toggleDuty} disabled={busy} activeOpacity={0.8}>
                <View style={[s.knob, !onDuty && s.knobOff]} />
              </TouchableOpacity>
            </View>
            {!!vehicle && (
              <View style={s.stats}>
                <View style={s.stat}><Text style={s.statN}>{vehicle.seats}</Text><Text style={s.statL}>{t("feederSeatCap")}</Text></View>
                <View style={s.stat}><Text style={s.statN}>{run?.seats_filled ?? 0}</Text><Text style={s.statL}>{t("feederAssigned")}</Text></View>
                <View style={s.stat}><Text style={s.statN}>{run?.stops?.length ?? 0}</Text><Text style={s.statL}>{t("feederStops")}</Text></View>
              </View>
            )}
          </View>

          {onDuty && !run && (
            <Text style={s.waiting}>{t("feederWaiting")}</Text>
          )}

          {run && (
            <>
              <Text style={s.runHd}>{t("feederRunHd", { n: run.stops.length })}</Text>
              {run.stops.map((st, i) => (
                <View key={st.request_id} style={[s.stopCard, st.picked_up && s.stopDone]}>
                  <View style={[s.stopNum, st.picked_up && s.stopNumDone]}>
                    {st.picked_up ? <Check size={13} color="#08210f" /> : <Text style={s.stopNumTxt}>{st.seq}</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.stopName}>{st.name}</Text>
                    <Text style={s.stopAddr}>{st.address}{st.eta_min != null ? ` · ~${st.eta_min} min` : ""}</Text>
                  </View>
                  {st.picked_up ? (
                    <Text style={s.doneTag}>{t("feederPicked")}</Text>
                  ) : (
                    <View style={{ alignItems: "flex-end", gap: 6 }}>
                      {!!st.phone && <TouchableOpacity onPress={() => Linking.openURL(`tel:${st.phone}`)} hitSlop={6}><Phone size={16} color={Colors.t2} /></TouchableOpacity>}
                      <TouchableOpacity style={s.markBtn} onPress={() => mark(st.request_id)} disabled={busy} activeOpacity={0.85}>
                        <Text style={s.markTxt}>{t("feederMarkPicked")}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}
              <View style={s.drop}>
                <Flag size={16} color={Colors.accent} />
                <Text style={s.dropTxt}>{t("feederDropoff", { zone: run.dropoff_zone })}{run.run_min != null ? ` · ${run.run_min} min` : ""}</Text>
              </View>
            </>
          )}
        </ScrollView>
      )}
      <BottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  title: { color: Colors.t1, fontSize: 18, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  lead: { color: Colors.t2, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  dutyCard: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16 },
  dutyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  dutyTitle: { color: Colors.t1, fontWeight: "800", fontSize: 15 },
  dutySub: { color: Colors.t2, fontSize: 12, marginTop: 1 },
  tgl: { width: 46, height: 27, borderRadius: 999, backgroundColor: Colors.accent, justifyContent: "center" },
  tglOff: { backgroundColor: Colors.cardAlt },
  knob: { width: 21, height: 21, borderRadius: 11, backgroundColor: "#fff", alignSelf: "flex-end", marginRight: 3 },
  knobOff: { alignSelf: "flex-start", marginLeft: 3 },
  stats: { flexDirection: "row", gap: 8, marginTop: 16 },
  stat: { flex: 1, backgroundColor: Colors.cardAlt, borderRadius: 11, paddingVertical: 11, alignItems: "center" },
  statN: { color: Colors.t1, fontSize: 19, fontWeight: "800" },
  statL: { color: Colors.t2, fontSize: 10.5, marginTop: 2 },
  waiting: { color: Colors.t2, fontSize: 12.5, textAlign: "center", marginTop: 18, lineHeight: 18 },
  runHd: { color: Colors.t1, fontWeight: "800", fontSize: 15, marginTop: 22, marginBottom: 10 },
  stopCard: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 13, padding: 12, marginBottom: 9 },
  stopDone: { opacity: 0.55 },
  stopNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.accent, alignItems: "center", justifyContent: "center" },
  stopNumDone: { backgroundColor: Colors.green },
  stopNumTxt: { color: Colors.accentText, fontWeight: "900", fontSize: 11 },
  stopName: { color: Colors.t1, fontWeight: "700", fontSize: 14 },
  stopAddr: { color: Colors.t2, fontSize: 11.5, marginTop: 2 },
  doneTag: { color: Colors.green, fontWeight: "800", fontSize: 11 },
  markBtn: { borderWidth: 1.5, borderColor: Colors.accent, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 6 },
  markTxt: { color: Colors.accent, fontWeight: "800", fontSize: 11.5 },
  drop: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "rgba(255,107,0,0.10)", borderWidth: 1, borderColor: "rgba(255,107,0,0.5)", borderRadius: 12, padding: 12, marginTop: 4 },
  dropTxt: { color: Colors.accent, fontWeight: "700", fontSize: 12.5 },
});
