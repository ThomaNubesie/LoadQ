import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { ReferralAPI, DriverCard } from "../../services/referral";
import { PassengersAPI } from "../../services/passengers";
import { Colors } from "../../constants/colors";
import VerifiedBadge from "../../components/VerifiedBadge";

export default function ReferralCardScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [card, setCard]       = useState<DriverCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode]       = useState<"guest" | "passenger" | "other">("guest");
  const [done, setDone]       = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) { setLoading(false); return; }
      const c = await ReferralAPI.getDriverCard(id);
      setCard(c);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMode("guest");
        await ReferralAPI.setPendingRef(id);
      } else {
        const me = await PassengersAPI.getMe();
        if (me) {
          setMode("passenger");
          if (me.referred_by) setDone(true);
        } else {
          setMode("other");
        }
      }
      setLoading(false);
    })();
  }, [id]);

  const handleSignup = () => router.replace("/(auth)/language");

  const handleLinkExisting = async () => {
    if (!id) return;
    await PassengersAPI.createOrUpdate({ referred_by: id });
    setDone(true);
  };

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator color={Colors.accent} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (!card) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.center}>
          <Text style={s.emoji}>🔍</Text>
          <Text style={s.title}>Driver not found</Text>
          <Text style={s.sub}>This referral link is invalid or has expired.</Text>
          <TouchableOpacity style={s.btn} onPress={() => router.replace("/")}>
            <Text style={s.btnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.center}>
        <Text style={s.brand}>LOADQ</Text>

        <View style={s.cardBox}>
          <View style={s.row}>
            <Text style={s.name}>{card.full_name}</Text>
            {card.verified
              ? <VerifiedBadge size={20} />
              : <Text style={s.badgeNo}>Unverified</Text>}
          </View>
          {card.vehicle_make ? (
            <Text style={s.vehicle}>
              {card.vehicle_make} {card.vehicle_model}
              {card.vehicle_plate ? `  ·  ${card.vehicle_plate}` : ""}
              {card.vehicle_seats ? `  ·  ${card.vehicle_seats} seats` : ""}
            </Text>
          ) : (
            <Text style={s.vehicle}>No active vehicle on file</Text>
          )}
          <Text style={s.trust}>Trust score {Math.round(card.trust_score ?? 0)}</Text>
        </View>

        {mode === "guest" && (
          <>
            <Text style={s.sub}>Sign up as a passenger to ride with {card.full_name.split(" ")[0]}.</Text>
            <TouchableOpacity style={s.btn} onPress={handleSignup}>
              <Text style={s.btnText}>Sign up to ride</Text>
            </TouchableOpacity>
          </>
        )}

        {mode === "passenger" && (
          done ? (
            <Text style={s.sub}>You're linked to this driver. 🎉</Text>
          ) : (
            <TouchableOpacity style={s.btn} onPress={handleLinkExisting}>
              <Text style={s.btnText}>Set as my referring driver</Text>
            </TouchableOpacity>
          )
        )}

        {mode === "other" && (
          <Text style={s.sub}>Driver profile preview.</Text>
        )}

        <TouchableOpacity onPress={() => router.replace("/")}>
          <Text style={s.skip}>Not now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center:    { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  emoji:     { fontSize: 44, marginBottom: 14 },
  brand:     { fontSize: 26, fontWeight: "900", color: Colors.accent, letterSpacing: 4, marginBottom: 28 },
  cardBox:   { width: "100%", backgroundColor: Colors.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: Colors.border, marginBottom: 22 },
  row:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  name:      { fontSize: 18, fontWeight: "800", color: Colors.t1, flex: 1 },
  badgeOk:   { fontSize: 12, fontWeight: "700", color: "#10B981" },
  badgeNo:   { fontSize: 12, fontWeight: "700", color: Colors.t3 },
  vehicle:   { fontSize: 14, color: Colors.t2, marginBottom: 6 },
  trust:     { fontSize: 12, color: Colors.t3 },
  title:     { fontSize: 18, fontWeight: "700", color: Colors.t1, marginBottom: 8 },
  sub:       { fontSize: 14, color: Colors.t2, textAlign: "center", lineHeight: 20, marginBottom: 18 },
  btn:       { backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 15, paddingHorizontal: 40, width: "100%", alignItems: "center", marginBottom: 14 },
  btnText:   { color: "#fff", fontSize: 16, fontWeight: "700" },
  skip:      { fontSize: 14, color: Colors.t3, padding: 8 },
});
