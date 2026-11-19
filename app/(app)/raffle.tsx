// LoadQ Morning Raffle — fair lottery that builds the morning departure line.
// Two steps:
//   1. Check-in (05:00–06:01): tap "I'm at the lot" — location only, no code.
//   2. Draw (06:02–07:00): the hat holds exactly 1…N (N = drivers checked in),
//      sealed at 06:01. Enter today's code → you draw one unique number and go
//      straight onto the line at that spot. Nobody loads until 07:00; then the
//      undrawn are excluded and number 1 starts loading.
// Backend: shared DB loadq_raffle_* RPCs.
import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Dices, MapPin, Clock, ShieldCheck, Lock, Check } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { supabase } from "../../services/supabase";
import { RaffleAPI, RaffleStatus, RaffleOrderRow } from "../../services/raffle";
import { tryGetUserLocation } from "../../utils/gpsTimeout";
import { useStrings, TFn } from "../../hooks/useStrings";
import BottomNav from "../../components/BottomNav";

async function deviceId(): Promise<string> {
  let id = await AsyncStorage.getItem("raffleDeviceId");
  if (!id) { id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`; await AsyncStorage.setItem("raffleDeviceId", id); }
  return id;
}
const hhmm = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

// Map a backend error code to its localized message (falls back to the raw
// code, then a generic message).
function errMessage(t: TFn, code?: string): string {
  const map: Record<string, string> = {
    not_at_lot:        t.raffleErrNotAtLot,
    low_gps_accuracy:  t.raffleErrLowGps,
    location_required: t.raffleErrLocationReq,
    bad_code:          t.raffleErrBadCode,
    window_closed:     t.raffleErrWindowClosed,
    not_open:          t.raffleErrNotOpen,
    not_eligible:      t.raffleErrNotEligible,
    no_vehicle:        t.raffleErrNoVehicle,
    already_raffled:   t.raffleErrAlready,
    duplicate_device:  t.raffleErrDuplicateDevice,
    not_checked_in:    t.raffleErrNotCheckedIn,
    already_checked_in: t.raffleErrAlreadyCheckedIn,
    draw_not_open:     t.raffleErrDrawNotOpen,
  };
  return (code && map[code]) || code || t.raffleErrGeneric;
}

export default function Raffle() {
  const { t } = useStrings();
  const [st, setSt] = useState<RaffleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [board, setBoard] = useState<RaffleOrderRow[]>([]);
  const [myUid, setMyUid] = useState<string | null>(null);
  const [demo, setDemo] = useState<{ num: number; note: string } | null>(null);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMyUid(data.user?.id ?? null)); }, []);

  const refresh = useCallback(async () => {
    const s = await RaffleAPI.status();
    setSt(s);
    // Live board: numbers appear on the line as they're drawn.
    if (s.round_id && (s.phase === "draw" || s.status === "drawn" || s.already_raffled)) {
      RaffleAPI.result(s.round_id).then((r) => setBoard(r.order ?? [])).catch(() => {});
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    refresh();
    const iv = setInterval(refresh, 15000);
    return () => clearInterval(iv);
  }, [refresh]));

  const doSpin = () => {
    spin.setValue(0);
    Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  };

  const raffle = async () => {
    setErr(null); setBusy(true);
    // BOTH steps need a fix. Check-in proves you arrived; the draw proves you are
    // still there when you type the code. Without the second check a driver could
    // check in, leave, and draw from the road on a code someone texted him — which
    // a simulation on 2026-11-19 confirmed was possible from 55 km away. The admin
    // test tap (outside the window) is a non-registered dry run and needs nothing.
    const needsLocation = st?.phase === "checkin" || st?.phase === "draw";
    let lat: number | null = null, lng: number | null = null, accuracy: number | null = null;
    if (needsLocation) {
      const loc = await tryGetUserLocation(8000, Location.Accuracy.High);
      if (!loc) { setErr(errMessage(t, "location_required")); setBusy(false); return; }
      lat = loc.coords.latitude; lng = loc.coords.longitude; accuracy = loc.coords.accuracy ?? null;
    }
    const res = await RaffleAPI.enter({
      // the code belongs to the draw only — check-in never carries one
      lat, lng, accuracy, code: st?.phase === "checkin" ? "" : code.trim(), deviceId: await deviceId() });
    setBusy(false);
    if ("ok" in res && res.ok) {
      if (!res.checked_in) doSpin();
      if (res.registered === false) setDemo({ num: res.provisional_position ?? 0, note: res.note }); else setDemo(null);
      await refresh();
    } else setErr(errMessage(t, (res as any).error));
  };

  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "1440deg"] });

  if (loading) return <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={Colors.accent} /></SafeAreaView>;

  const s = st!;
  const phase = s.phase ?? "none";
  const drawn = s.status === "drawn";
  const lockAt = hhmm(s.draw_at) || "7:00";

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Dices size={26} color={Colors.accentWarm} strokeWidth={2} />
          <Text style={{ fontSize: 24, fontWeight: "800", color: Colors.t1 }}>{t.raffleTitle}</Text>
        </View>
        <Text style={{ fontSize: 13, color: Colors.t2, marginBottom: s.test_mode ? 8 : 16 }}>{t("raffleRoute", { time: lockAt })}</Text>
        {s.test_mode && (
          <View style={{ alignSelf: "flex-start", backgroundColor: Colors.yellow, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 16 }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: "#20140A" }}>{t.raffleTestMode}</Text>
          </View>
        )}

        {(phase === "none" || phase === "before") && !s.can_raffle && <Banner tone="muted" text={t.raffleNotRunning} />}
        {phase === "checkin" && !s.checked_in && !s.eligible && <Banner tone="warn" text={t.raffleNotEligibleLong} />}

        {/* Step 1 — check in at the lot (no code) */}
        {phase === "checkin" && s.can_raffle && (
          <View>
            <Banner tone="ok" icon={<Clock size={16} color={Colors.green} />} text={t("raffleCheckinOpen", { n: s.entrant_count, time: hhmm(s.checkin_closes_at ?? null) })} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }}>
              <MapPin size={14} color={Colors.t3} />
              <Text style={{ flex: 1, fontSize: 12, color: Colors.t3 }}>{t("raffleCheckinHint", { time: hhmm(s.checkin_closes_at ?? null) })}</Text>
            </View>
            {err && <Text style={{ color: Colors.red, marginTop: 10, fontWeight: "600" }}>{err}</Text>}
            <TouchableOpacity onPress={raffle} disabled={busy}
              style={{ marginTop: 16, backgroundColor: Colors.accent, borderRadius: 14, padding: 18, alignItems: "center", opacity: busy ? 0.5 : 1 }}>
              {busy ? <ActivityIndicator color={Colors.accentText} /> : <Text style={{ color: Colors.accentText, fontWeight: "800", fontSize: 16 }}>{t.raffleCheckinBtn}</Text>}
            </TouchableOpacity>
          </View>
        )}
        {phase === "checkin" && s.checked_in && (
          <Banner tone="ok" icon={<Check size={16} color={Colors.green} />} text={t("raffleCheckedIn", { time: hhmm(s.draw_opens_at ?? null) })} />)}

        {/* Between steps — hat sealed */}
        {phase === "sealing" && (
          <Banner tone="muted" icon={<Lock size={16} color={Colors.t2} />} text={t("raffleSealing", { n: s.hat_size ?? s.entrant_count, time: hhmm(s.draw_opens_at ?? null) })} />)}

        {/* Step 2 — draw with today's code */}
        {phase === "draw" && (
          <Banner tone="ok" icon={<Clock size={16} color={Colors.green} />} text={t("raffleDrawOpen", { d: s.drawn_count ?? 0, n: s.hat_size ?? 0, time: lockAt })} />)}
        {phase === "draw" && s.can_raffle && (
          <View>
            <Text style={{ fontSize: 11, fontWeight: "700", color: Colors.t3, letterSpacing: 0.6, marginTop: 14, marginBottom: 6 }}>{t.raffleCodeLabel}</Text>
            <TextInput value={code} onChangeText={setCode} placeholder="····" placeholderTextColor={Colors.t3} keyboardType="number-pad" maxLength={6}
              style={{ borderWidth: 1.5, borderColor: Colors.border, borderRadius: 14, padding: 16, fontSize: 24, fontWeight: "800",
                textAlign: "center", letterSpacing: 8, color: Colors.t1, backgroundColor: Colors.card }} />
            {err && <Text style={{ color: Colors.red, marginTop: 10, fontWeight: "600" }}>{err}</Text>}
            <TouchableOpacity onPress={raffle} disabled={busy || code.trim().length === 0}
              style={{ marginTop: 16, backgroundColor: Colors.accent, borderRadius: 14, padding: 18, alignItems: "center", opacity: busy || code.trim().length === 0 ? 0.5 : 1 }}>
              {busy ? <ActivityIndicator color={Colors.accentText} /> : <Text style={{ color: Colors.accentText, fontWeight: "800", fontSize: 16 }}>{t.raffleDrawBtn}</Text>}
            </TouchableOpacity>
          </View>
        )}
        {(phase === "draw" || phase === "sealing") && !s.checked_in && (
          <View style={{ marginTop: 10 }}>
            <Banner tone="warn" text={t("raffleNotCheckedIn", { close: hhmm(s.checkin_closes_at ?? null), time: lockAt })} />
          </View>)}
        {phase === "draw" && (
          <Text style={{ fontSize: 12, color: Colors.t3, marginTop: 10 }}>{t("raffleNoLoadingYet", { time: lockAt })}</Text>)}

        {/* Admin test tap (outside the window — not counted) */}
        {s.can_raffle && !s.window_open && phase !== "sealing" && (
          <View>
            <Banner tone="muted" text={t.raffleAdminTest} />
            {err && <Text style={{ color: Colors.red, marginTop: 10, fontWeight: "600" }}>{err}</Text>}
            <TouchableOpacity onPress={raffle} disabled={busy}
              style={{ marginTop: 14, backgroundColor: Colors.t1, borderRadius: 14, padding: 18, alignItems: "center", opacity: busy ? 0.5 : 1 }}>
              {busy ? <ActivityIndicator color={Colors.bg} /> : <Text style={{ color: Colors.bg, fontWeight: "800", fontSize: 16 }}>{t.raffleTestBtn}</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Your number (real entry or admin demo) */}
        {(s.already_raffled || demo) && (
          <View style={{ alignItems: "center", marginVertical: 18 }}>
            <Animated.View style={{ transform: [{ rotate: spinDeg }], width: 150, height: 150, borderRadius: 75,
              borderWidth: 10, borderColor: Colors.accentWarm, borderTopColor: Colors.yellow, alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <Dices size={36} color={Colors.accentWarm} />
            </Animated.View>
            <Text style={{ fontSize: 13, color: Colors.t2 }}>{demo ? t.raffleTestNumber : t.raffleYourNumber}</Text>
            <Text style={{ fontSize: 56, fontWeight: "900", color: Colors.accentWarm, lineHeight: 62 }}>{demo ? demo.num : (s.my_number ?? "—")}</Text>
            <Text style={{ fontSize: 13, color: demo ? Colors.yellow : Colors.t2, textAlign: "center", marginTop: 4, fontWeight: demo ? "700" : "400" }}>
              {demo ? t.raffleTestNote : t.raffleSameOdds}
            </Text>
          </View>
        )}

        {s.excluded && <Banner tone="warn" text={t("raffleExcluded", { time: lockAt })} />}
        {phase === "closed" && !s.already_raffled && !s.excluded && s.status !== "none" && (
          <Banner tone="muted" icon={<Lock size={16} color={Colors.t2} />} text={drawn ? t.raffleLineLocked : t.raffleCheckinClosed} />)}

        {/* Live board */}
        {board.length > 0 && (
          <View style={{ marginTop: 22 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: "800", color: Colors.t1 }}>{t.raffleTodaysLine}</Text>
              {drawn && <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Lock size={12} color={Colors.t3} /><Text style={{ fontSize: 11, color: Colors.t3 }}>{t.raffleLocked}</Text></View>}
            </View>
            {board.map((r) => {
              const me = r.driver_id === myUid;
              return (
                <View key={r.driver_id} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, marginBottom: 8,
                  borderRadius: 12, backgroundColor: me ? Colors.card : Colors.cardAlt, borderWidth: me ? 2 : 1, borderColor: me ? Colors.accent : Colors.border }}>
                  <View style={{ width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center",
                    backgroundColor: r.pos === 1 ? Colors.accentWarm : (me ? Colors.accent : Colors.card), borderWidth: 1, borderColor: Colors.border }}>
                    <Text style={{ fontWeight: "900", color: (r.pos === 1 || me) ? "#fff" : Colors.t1 }}>{r.pos}</Text>
                  </View>
                  <Text style={{ flex: 1, fontWeight: "700", color: Colors.t1 }}>{me ? t.raffleYou : r.name}</Text>
                  <Text style={{ fontSize: 12, color: Colors.t2 }}>{t("raffleSeats", { n: r.seats })}</Text>
                </View>
              );
            })}
          </View>
        )}

        {s.seed_commit && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18, padding: 12, borderRadius: 12, backgroundColor: Colors.cardAlt }}>
            <ShieldCheck size={18} color={Colors.green} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: Colors.t1 }}>{t.raffleProvablyFair}</Text>
              <Text style={{ fontSize: 11, color: Colors.t2 }} numberOfLines={1}>{drawn ? t.raffleSeedRevealed : t.raffleSeedCommitted} · {s.seed_commit.slice(0, 16)}…</Text>
            </View>
          </View>
        )}
      </ScrollView>
      <BottomNav />
    </View>
  );
}

function Banner({ tone, text, icon }: { tone: "ok" | "warn" | "muted"; text: string; icon?: React.ReactNode }) {
  const bg = tone === "ok" ? "rgba(18,161,80,0.12)" : tone === "warn" ? "rgba(226,76,76,0.12)" : Colors.cardAlt;
  const fg = tone === "ok" ? Colors.green : tone === "warn" ? Colors.red : Colors.t2;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, backgroundColor: bg }}>
      {icon}
      <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: fg }}>{text}</Text>
    </View>
  );
}
