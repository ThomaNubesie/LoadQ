import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { DriversAPI } from "../../services/drivers";

export default function PaymentScreen() {
  const router = useRouter();
  const { t }  = useStrings();
  const { plan } = useLocalSearchParams<{ plan: "monthly"|"annual" }>();
  const [loading, setLoading] = useState(false);

  const isAnnual  = plan === "annual";
  const amount    = isAnnual ? "C$83.88" : "C$9.99";
  const perMonth  = isAnnual ? "C$6.99/mo" : "C$9.99/mo";

  // In production this would use Stripe SDK
  // For now simulate trial activation
  const handleStartTrial = async () => {
    setLoading(true);
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7);
    const subEnd = new Date();
    isAnnual ? subEnd.setFullYear(subEnd.getFullYear() + 1) : subEnd.setMonth(subEnd.getMonth() + 1);

    await DriversAPI.createOrUpdate({
      subscription_status: "trialing",
      subscription_plan:   plan,
      trial_ends_at:       trialEnd.toISOString(),
      subscription_ends_at: subEnd.toISOString(),
    });
    setLoading(false);
    router.replace("/(app)/queue");
  };

  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + 7);
  const trialEndStr = trialEndDate.toLocaleDateString("en-CA", { month:"long", day:"numeric" });

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.inner}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← {t.back}</Text>
        </TouchableOpacity>

        <Text style={s.title}>{t.paymentMethod}</Text>

        <View style={s.summary}>
          <View style={s.summaryRow}>
            <Text style={s.summaryKey}>{t.choosePlan}</Text>
            <Text style={s.summaryVal}>{isAnnual ? t.annual : t.monthly} · {perMonth}</Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryKey}>Billed today</Text>
            <Text style={s.summaryVal}>C$0.00</Text>
          </View>
          <View style={[s.summaryRow, { borderBottomWidth:0 }]}>
            <Text style={s.summaryKey}>{t.afterTrial}</Text>
            <Text style={[s.summaryVal, { color:Colors.blue }]}>{amount}</Text>
          </View>
        </View>

        <Text style={s.label}>CARD NUMBER</Text>
        <View style={s.inputRow}>
          <TextInput style={s.input} placeholder="1234 5678 9012 3456" placeholderTextColor={Colors.t3} keyboardType="number-pad" />
          <Text style={s.cardIcon}>💳</Text>
        </View>

        <View style={{ flexDirection:"row", gap:12, marginBottom:16 }}>
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

        <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handleStartTrial} disabled={loading} activeOpacity={0.85}>
          <Text style={s.btnText}>{loading ? t.loading : t.startTrial + " →"}</Text>
        </TouchableOpacity>

        <Text style={s.trialNote}>
          {t.trialNote.replace("your trial ends", `${trialEndStr}`)}
        </Text>

        <View style={s.secureRow}>
          <Text style={s.secureBadge}>🔒 {t.securedStripe}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex:1, backgroundColor:Colors.bg },
  inner:       { padding:24, paddingBottom:48 },
  backBtn:     { marginBottom:20 },
  backText:    { color:Colors.t2, fontSize:14 },
  title:       { fontSize:22, fontWeight:"700", color:Colors.t1, marginBottom:20 },
  summary:     { backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, marginBottom:24, overflow:"hidden" },
  summaryRow:  { flexDirection:"row", justifyContent:"space-between", padding:12, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  summaryKey:  { color:Colors.t2, fontSize:13 },
  summaryVal:  { color:Colors.t1, fontSize:13, fontWeight:"500" },
  label:       { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:6 },
  inputRow:    { flexDirection:"row", alignItems:"center", backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, marginBottom:16, paddingRight:14 },
  input:       { flex:1, backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, padding:14, color:Colors.t1, fontSize:15, marginBottom:16 },
  cardIcon:    { fontSize:18 },
  btn:         { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginBottom:12 },
  btnDisabled: { opacity:0.4 },
  btnText:     { fontSize:15, fontWeight:"700", color:Colors.accentText },
  trialNote:   { color:Colors.t3, fontSize:12, textAlign:"center", marginBottom:12, lineHeight:18 },
  secureRow:   { flexDirection:"row", justifyContent:"center" },
  secureBadge: { color:Colors.t3, fontSize:11 },
});
