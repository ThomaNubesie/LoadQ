import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

export default function PaymentScreen() {
  const router     = useRouter();
  const { t }  = useStrings();
  const { plan } = useLocalSearchParams<{ plan: "monthly"|"annual" }>();
  const [loading, setLoading] = useState(false);

  const isAnnual = plan === "annual";
  const monthly  = isAnnual ? "C$6.99" : "C$9.99";
  const total    = isAnnual ? "C$83.88 / year" : "C$9.99 / month";

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 7);
  const trialEndStr = trialEnd.toLocaleDateString("en-CA", { month:"long", day:"numeric" });

  const handleStartTrial = async () => {
    setLoading(true);
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);
    const subEndsAt = new Date();
    isAnnual ? subEndsAt.setFullYear(subEndsAt.getFullYear() + 1) : subEndsAt.setMonth(subEndsAt.getMonth() + 1);
    await supabase.from("drivers").update({
      subscription_status:  "trialing",
      subscription_plan:    plan,
      trial_ends_at:        trialEndsAt.toISOString(),
      subscription_ends_at: subEndsAt.toISOString(),
    }).eq("id", (await supabase.auth.getUser()).data.user?.id);
    setLoading(false);
    router.replace("/(app)/zone-select");
  };

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        {/* Back button */}
        <TouchableOpacity onPress={() => router.replace("/(auth)/subscribe")} style={s.backBtn}>
          <Text style={s.backText}>← {t.back}</Text>
        </TouchableOpacity>

        <Text style={s.logo}>LOADQ</Text>
        <Text style={s.title}>{t.paymentMethod}</Text>

        {/* Plan summary – stacked, no overlap */}
        <View style={s.planBox}>
          <View style={s.planRow}>
            <Text style={s.planKey}>Plan</Text>
            <Text style={s.planVal}>{isAnnual ? t.annual : t.monthly}</Text>
          </View>
          <View style={s.planRow}>
            <Text style={s.planKey}>Per month</Text>
            <Text style={s.planVal}>{monthly}</Text>
          </View>
          <View style={s.planRow}>
            <Text style={s.planKey}>Billed today</Text>
            <Text style={[s.planVal, { color:Colors.accent }]}>C$0.00</Text>
          </View>
          <View style={[s.planRow, { borderBottomWidth:0 }]}>
            <Text style={s.planKey}>{t.afterTrial}</Text>
            <Text style={[s.planVal, { color:Colors.blue }]}>{total}</Text>
          </View>
        </View>

        <Text style={s.label}>CARD NUMBER</Text>
        <TextInput style={s.input} placeholder="1234 5678 9012 3456" placeholderTextColor={Colors.t3} keyboardType="number-pad" />

        <View style={{ flexDirection:"row", gap:12 }}>
          <View style={{ flex:1 }}>
            <Text style={s.label}>EXPIRY</Text>
            <TextInput style={s.input} placeholder="MM / YY" placeholderTextColor={Colors.t3} keyboardType="number-pad" />
          </View>
          <View style={{ flex:1 }}>
            <Text style={s.label}>CVV</Text>
            <TextInput style={s.input} placeholder="•••" placeholderTextColor={Colors.t3} keyboardType="number-pad" secureTextEntry />
          </View>
        </View>

        <Text style={s.label}>NAME ON CARD</Text>
        <TextInput style={[s.input, { marginBottom:24 }]} placeholder="Jean Martin" placeholderTextColor={Colors.t3} autoCapitalize="words" />

        <TouchableOpacity style={[s.btn, loading && s.btnOff]} onPress={handleStartTrial} disabled={loading} activeOpacity={0.85}>
          <Text style={s.btnText}>{loading ? t.loading : `${t.startTrial} →`}</Text>
        </TouchableOpacity>

        <Text style={s.note}>You won't be charged until {trialEndStr}. Cancel anytime.</Text>
        <Text style={s.secure}>🔒 {t.securedStripe}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:Colors.bg },
  inner:     { padding:24, paddingTop:72, paddingBottom:48 },
  backBtn:   { position:"absolute", top:24, left:24, zIndex:10 },
  backText:  { color:Colors.t2, fontSize:14 },
  logo:      { fontSize:22, fontWeight:"900", color:Colors.accent, letterSpacing:3, marginBottom:20 },
  title:     { fontSize:22, fontWeight:"700", color:Colors.t1, marginBottom:20 },
  planBox:   { backgroundColor:Colors.card, borderRadius:14, borderWidth:1, borderColor:Colors.border, marginBottom:24, overflow:"hidden" },
  planRow:   { flexDirection:"row", justifyContent:"space-between", alignItems:"center", padding:14, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  planKey:   { color:Colors.t2, fontSize:13 },
  planVal:   { color:Colors.t1, fontSize:13, fontWeight:"600" },
  label:     { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:6, marginTop:4 },
  input:     { backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, padding:14, color:Colors.t1, fontSize:15, marginBottom:14 },
  btn:       { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginBottom:12 },
  btnOff:    { opacity:0.4 },
  btnText:   { fontSize:15, fontWeight:"700", color:Colors.accentText },
  note:      { color:Colors.t3, fontSize:12, textAlign:"center", marginBottom:8, lineHeight:18 },
  secure:    { color:Colors.t3, fontSize:11, textAlign:"center" },
});
