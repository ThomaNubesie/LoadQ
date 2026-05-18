import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { supabase } from "../../services/supabase";
import { ReferralAPI, ReferralProgress } from "../../services/referral";
import { Colors } from "../../constants/colors";
import BottomNav from "../../components/BottomNav";

const GOAL = 10;

export default function ReferralScreen() {
  const router = useRouter();
  const [driverId, setDriverId] = useState<string | null>(null);
  const [prog, setProg]         = useState<ReferralProgress | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setDriverId(user?.id ?? null);
      setProg(await ReferralAPI.myProgress());
      setLoading(false);
    })();
  }, []);

  const link = driverId ? ReferralAPI.link(driverId) : "";

  const onShare = () => {
    if (!link) return;
    Share.share({ message: `Ride with me on LoadQ. Sign up here: ${link}` });
  };

  const qualified = prog?.qualified ?? 0;
  const waiverActive = !!prog?.waiver_until && new Date(prog.waiver_until).getTime() > Date.now();
  const waiverBanked = (prog?.waiver_months ?? 0) > 0;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/profile")}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>Refer & earn</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.accent} style={{ flex: 1 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 96, alignItems: "center" }}>
          <Text style={s.lead}>
            Passengers scan this code with their phone camera to sign up under you.
          </Text>

          <View style={s.qrBox}>
            {link ? <QRCode value={link} size={196} backgroundColor="#fff" /> : null}
          </View>

          <TouchableOpacity style={s.shareBtn} onPress={onShare}>
            <Text style={s.shareText}>Share my link</Text>
          </TouchableOpacity>

          {waiverActive ? (
            <View style={[s.statusBox, s.statusOk]}>
              <Text style={s.statusTitle}>🎁 Free month active</Text>
              <Text style={s.statusSub}>
                Your subscription is waived until{" "}
                {new Date(prog!.waiver_until as string).toLocaleDateString()}.
              </Text>
            </View>
          ) : waiverBanked ? (
            <View style={[s.statusBox, s.statusOk]}>
              <Text style={s.statusTitle}>🎉 You earned a free month</Text>
              <Text style={s.statusSub}>
                It starts automatically when your current paid period ends.
              </Text>
            </View>
          ) : (
            <View style={s.statusBox}>
              <Text style={s.statusTitle}>{qualified} / {GOAL}</Text>
              <Text style={s.statusSub}>
                referred passengers who have each completed 3+ trips. Reach {GOAL}{" "}
                to earn one free month of LoadQ.
              </Text>
              <View style={s.barTrack}>
                <View style={[s.barFill, { width: `${Math.min(100, (qualified / GOAL) * 100)}%` }]} />
              </View>
              <Text style={s.metaText}>
                {prog?.referred_total ?? 0} total passengers signed up with your code
              </Text>
            </View>
          )}
        </ScrollView>
      )}
      <BottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  back:        { fontSize: 20, color: Colors.t2, width: 24 },
  title:       { fontSize: 17, fontWeight: "700", color: Colors.t1 },
  lead:        { fontSize: 14, color: Colors.t2, textAlign: "center", lineHeight: 20, marginBottom: 20 },
  qrBox:       { backgroundColor: "#fff", padding: 18, borderRadius: 16, marginBottom: 18 },
  shareBtn:    { backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 36, marginBottom: 24 },
  shareText:   { color: "#fff", fontSize: 15, fontWeight: "700" },
  statusBox:   { width: "100%", backgroundColor: Colors.card, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: Colors.border },
  statusOk:    { borderColor: "#10B981" },
  statusTitle: { fontSize: 20, fontWeight: "800", color: Colors.t1, marginBottom: 6, textAlign: "center" },
  statusSub:   { fontSize: 13, color: Colors.t2, lineHeight: 19, textAlign: "center" },
  barTrack:    { height: 8, backgroundColor: Colors.border, borderRadius: 4, marginTop: 14, overflow: "hidden" },
  barFill:     { height: 8, backgroundColor: Colors.accent, borderRadius: 4 },
  metaText:    { fontSize: 12, color: Colors.t3, textAlign: "center", marginTop: 12 },
});
