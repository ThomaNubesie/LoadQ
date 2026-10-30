// LoadQ Morning Raffle — fair lottery that builds the morning departure line.
// Present at the lot + today's code → tap Raffle before the 7:15 cutoff → you're
// assigned a number (fixed by a committed seed, so tap order gives no edge). At
// the cutoff the line locks. Backend: shared DB loadq_raffle_* RPCs.
import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Dices, MapPin, Clock, ShieldCheck, Lock } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { supabase } from "../../services/supabase";
import { RaffleAPI, RaffleStatus, RaffleOrderRow } from "../../services/raffle";
import { tryGetUserLocation } from "../../utils/gpsTimeout";
import BottomNav from "../../components/BottomNav";

async function deviceId(): Promise<string> {
  let id = await AsyncStorage.getItem("raffleDeviceId");
  if (!id) { id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`; await AsyncStorage.setItem("raffleDeviceId", id); }
  return id;
}
const hhmm = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
const ERRORS: Record<string, string> = {
  not_at_lot: "You're not at the lot yet — move closer to check in.",
  low_gps_accuracy: "Weak GPS signal — step into the open and try again.",
  location_required: "Turn on location to check in at the lot.",
  bad_code: "Wrong code. Ask for today's code posted at the lot.",
  window_closed: "Too late — the 7:15 cutoff has passed.",
  not_open: "The raffle isn't open right now.",
  not_eligible: "Your driver account isn't eligible to raffle.",
  no_vehicle: "No active vehicle on your account.",
  already_raffled: "You've already raffled today.",
  duplicate_device: "This device already raffled another driver today.",
};

export default function Raffle() {
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
    if (s.round_id && (s.status === "drawn" || s.already_raffled)) {
      RaffleAPI.result(s.round_id).then((r) => setBoard(r.order ?? [])).catch(() => {});
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]));

  const doSpin = () => {
    spin.setValue(0);
    Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  };

  const raffle = async () => {
    setErr(null); setBusy(true);
    const loc = await tryGetUserLocation(8000, Location.Accuracy.High);
    if (!loc) { setErr(ERRORS.location_required); setBusy(false); return; }
    const res = await RaffleAPI.enter({
      lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: loc.coords.accuracy ?? null,
      code: code.trim(), deviceId: await deviceId() });
    setBusy(false);
    if ("ok" in res && res.ok) {
      doSpin();
      if (res.registered === false) setDemo({ num: res.provisional_position, note: res.note }); else setDemo(null);
      await refresh();
    } else setErr(ERRORS[(res as any).error] ?? (res as any).error ?? "Something went wrong.");
  };

  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "1440deg"] });

  if (loading) return <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={Colors.accent} /></SafeAreaView>;

  const s = st!;
  const drawn = s.status === "drawn";
  const closed = s.status === "locked" || drawn || (!s.window_open && s.status !== "none" && !s.can_raffle && !s.already_raffled);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 30 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Dices size={26} color={Colors.accentWarm} strokeWidth={2} />
          <Text style={{ fontSize: 24, fontWeight: "800", color: Colors.t1 }}>Morning Raffle</Text>
        </View>
        <Text style={{ fontSize: 13, color: Colors.t2, marginBottom: s.test_mode ? 8 : 16 }}>Universal Grocery → Montréal · cutoff {hhmm(s.draw_at) || "7:15"}</Text>
        {s.test_mode && (
          <View style={{ alignSelf: "flex-start", backgroundColor: Colors.yellow, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 16 }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: "#20140A" }}>TEST MODE · dry run — doesn't change the real line</Text>
          </View>
        )}

        {s.status === "none" && <Banner tone="muted" text="The raffle isn't running right now. It opens at 6:00 AM." />}
        {s.window_open && !s.already_raffled && !s.eligible && (
          <Banner tone="warn" text="Your driver account isn't eligible to raffle (needs a verified account and an active vehicle)." />)}

        {/* Real check-in (window open) */}
        {s.can_raffle && s.window_open && (
          <View>
            <Banner tone="ok" icon={<Clock size={16} color={Colors.green} />} text={`Check-in open · ${s.entrant_count} drivers in · closes ${hhmm(s.draw_at)}`} />
            <Text style={{ fontSize: 11, fontWeight: "700", color: Colors.t3, letterSpacing: 0.6, marginTop: 14, marginBottom: 6 }}>TODAY'S CODE (posted at the lot)</Text>
            <TextInput value={code} onChangeText={setCode} placeholder="····" placeholderTextColor={Colors.t3} keyboardType="number-pad" maxLength={6}
              style={{ borderWidth: 1.5, borderColor: Colors.border, borderRadius: 14, padding: 16, fontSize: 24, fontWeight: "800",
                textAlign: "center", letterSpacing: 8, color: Colors.t1, backgroundColor: Colors.card }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
              <MapPin size={14} color={Colors.t3} />
              <Text style={{ fontSize: 12, color: Colors.t3 }}>We'll confirm you're at the lot when you tap.</Text>
            </View>
            {err && <Text style={{ color: Colors.red, marginTop: 10, fontWeight: "600" }}>{err}</Text>}
            <TouchableOpacity onPress={raffle} disabled={busy || code.trim().length === 0}
              style={{ marginTop: 16, backgroundColor: Colors.accent, borderRadius: 14, padding: 18, alignItems: "center", opacity: busy || code.trim().length === 0 ? 0.5 : 1 }}>
              {busy ? <ActivityIndicator color={Colors.accentText} /> : <Text style={{ color: Colors.accentText, fontWeight: "800", fontSize: 16 }}>RAFFLE MY SPOT</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Admin test tap (outside window — not counted) */}
        {s.can_raffle && !s.window_open && (
          <View>
            <Banner tone="muted" text="Outside the 6:00–7:15 window. As a raffle admin you can test a tap — it won't be registered." />
            {err && <Text style={{ color: Colors.red, marginTop: 10, fontWeight: "600" }}>{err}</Text>}
            <TouchableOpacity onPress={raffle} disabled={busy}
              style={{ marginTop: 14, backgroundColor: Colors.t1, borderRadius: 14, padding: 18, alignItems: "center", opacity: busy ? 0.5 : 1 }}>
              {busy ? <ActivityIndicator color={Colors.bg} /> : <Text style={{ color: Colors.bg, fontWeight: "800", fontSize: 16 }}>TEST THE RAFFLE</Text>}
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
            <Text style={{ fontSize: 13, color: Colors.t2 }}>{demo ? "Test number" : (drawn ? "Your number" : "Your number (final at cutoff)")}</Text>
            <Text style={{ fontSize: 56, fontWeight: "900", color: Colors.accentWarm, lineHeight: 62 }}>{demo ? demo.num : (s.my_number ?? "—")}</Text>
            <Text style={{ fontSize: 13, color: demo ? Colors.yellow : Colors.t2, textAlign: "center", marginTop: 4, fontWeight: demo ? "700" : "400" }}>
              {demo ? demo.note : "Everyone present had the same odds — the order you checked in didn't matter."}
            </Text>
          </View>
        )}

        {closed && !s.already_raffled && s.status !== "none" && (
          <Banner tone="muted" icon={<Lock size={16} color={Colors.t2} />} text={drawn ? "The line is locked for today." : "Check-in is closed for today."} />)}

        {/* Live board */}
        {board.length > 0 && (
          <View style={{ marginTop: 22 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: "800", color: Colors.t1 }}>Today's line</Text>
              {drawn && <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Lock size={12} color={Colors.t3} /><Text style={{ fontSize: 11, color: Colors.t3 }}>locked</Text></View>}
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
                  <Text style={{ flex: 1, fontWeight: "700", color: Colors.t1 }}>{me ? "You" : r.name}</Text>
                  <Text style={{ fontSize: 12, color: Colors.t2 }}>{r.seats} seats</Text>
                </View>
              );
            })}
          </View>
        )}

        {s.seed_commit && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18, padding: 12, borderRadius: 12, backgroundColor: Colors.cardAlt }}>
            <ShieldCheck size={18} color={Colors.green} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: Colors.t1 }}>Provably fair</Text>
              <Text style={{ fontSize: 11, color: Colors.t2 }} numberOfLines={1}>seed {drawn ? "revealed" : "committed"} · {s.seed_commit.slice(0, 16)}…</Text>
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
