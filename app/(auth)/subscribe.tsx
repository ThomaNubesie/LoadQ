import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import type { PurchasesPackage, PurchasesOffering } from "react-native-purchases";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { DriversAPI } from "../../services/drivers";
import { BillingAPI } from "../../services/billing";
import { Driver } from "../../constants/types";

export default function SubscribeScreen() {
  const router     = useRouter();
  const { t }  = useStrings();
  // v1 ships monthly-only (no annual product in the stores yet).
  const [plan, setPlan] = useState<"annual"|"monthly">("monthly");
  const [driver, setDriver] = useState<Driver | null>(null);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [loadingOffer, setLoadingOffer] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    DriversAPI.getMe().then(setDriver);
    BillingAPI.getCurrentOffering().then(o => { setOffering(o); setLoadingOffer(false); });
  }, []);

  const pkgMonthly: PurchasesPackage | null = offering?.monthly ?? null;
  const pkgAnnual:  PurchasesPackage | null = offering?.annual  ?? null;
  const selectedPkg = plan === "annual" ? pkgAnnual : pkgMonthly;

  const trialEnded = driver?.subscription_status === "trialing"
    && driver?.trial_ends_at
    && new Date(driver.trial_ends_at).getTime() < Date.now();
  const onHold = driver && (
    driver.subscription_status === "expired"
    || driver.subscription_status === "cancelled"
    || trialEnded
  );

  const handleSubscribe = async () => {
    if (!selectedPkg) {
      Alert.alert("Unavailable", "Subscription products aren't available right now. Try again shortly.");
      return;
    }
    setBusy(true);
    const { ok, error } = await BillingAPI.purchase(selectedPkg);
    setBusy(false);
    if (ok) { router.replace("/(app)/zone-select"); return; }
    if (error && error !== "cancelled") Alert.alert("Purchase failed", error);
  };

  const handleRestore = async () => {
    setBusy(true);
    const { ok, error } = await BillingAPI.restore();
    setBusy(false);
    if (ok) { router.replace("/(app)/zone-select"); return; }
    Alert.alert("Restore", error ? error : "No active subscription found for this account.");
  };

  // Prices come from the store (localized). Fall back to static labels if the
  // offering hasn't loaded (dev without RC keys).
  const monthlyPrice = pkgMonthly?.product.priceString ?? "C$30";
  const annualPrice  = pkgAnnual?.product.priceString  ?? "C$360";

  // Monthly-only for v1. (Annual returns when an annual store product exists.)
  const PLANS = [
    { key:"monthly" as const, name:t.monthly, price:monthlyPrice, full:null, per:t.perMonth, desc:t.billedMonthly, badge:null, perks:["Full queue access","Seat tracking + peer confirm","Priority queue on join","Loading history","14-day free trial"], popular:true },
  ];

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.inner}>
        <TouchableOpacity onPress={() => router.replace("/(auth)/email-setup")} style={s.backBtn}>
          <Text style={s.backText}>← {t.back}</Text>
        </TouchableOpacity>

        <View style={s.logoBox}>
          <Text style={s.logo}>LOADQ</Text>
          <Text style={s.logoSub}>Driver subscription</Text>
        </View>

        {onHold ? (
          <View style={s.holdBanner}>
            <Text style={s.holdTitle}>⏸ {t.accountOnHold}</Text>
            <Text style={s.holdSub}>{t.accountOnHoldSub}</Text>
          </View>
        ) : (
          <View style={s.trialBanner}>
            <Text style={s.trialText}>🎁 {t.freeTrial}</Text>
          </View>
        )}

        <Text style={s.title}>{t.choosePlan}</Text>

        {PLANS.map(p => (
          <TouchableOpacity key={p.key} style={[s.card, plan===p.key && (p.popular ? s.cardPop : s.cardActive)]} onPress={() => setPlan(p.key)} activeOpacity={0.85}>
            <View style={s.cardHeader}>
              <View>
                <View style={{ flexDirection:"row", alignItems:"center", gap:8 }}>
                  <Text style={[s.cardName, plan===p.key && { color:Colors.t1 }]}>{p.name}</Text>
                  {p.badge && <View style={s.badge}><Text style={s.badgeText}>{p.badge}</Text></View>}
                </View>
                <Text style={s.cardDesc}>{p.desc}</Text>
              </View>
              <View style={{ alignItems:"flex-end" }}>
                <Text style={[s.price, p.popular && { color:Colors.accent }]}>{p.price}</Text>
                <Text style={s.pricePer}>{p.per}</Text>
                {p.full && <Text style={s.priceFull}>{p.full}</Text>}
              </View>
            </View>
            <View style={s.perks}>
              {p.perks.map((perk,i) => (
                <View key={i} style={s.perkRow}>
                  <Text style={s.perkCheck}>✓</Text>
                  <Text style={s.perkText}>{perk}</Text>
                </View>
              ))}
            </View>
            <View style={[s.radio, plan===p.key && s.radioActive]}>
              {plan===p.key && <View style={s.radioDot} />}
            </View>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[s.btn, (busy || loadingOffer) && { opacity: 0.5 }]}
          onPress={handleSubscribe}
          disabled={busy || loadingOffer}
          activeOpacity={0.85}
        >
          {busy || loadingOffer
            ? <ActivityIndicator color={Colors.accentText} />
            : <Text style={s.btnText}>{t.startTrial} — {plan==="annual" ? t.annual : t.monthly} →</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={handleRestore} disabled={busy} style={{ alignItems:"center", paddingVertical:10 }}>
          <Text style={{ color:Colors.t2, fontSize:13, fontWeight:"600" }}>Restore purchases</Text>
        </TouchableOpacity>

        <View style={s.secureRow}>
          <Text style={s.secureBadge}>🔒 14-day free trial</Text>
          <Text style={s.secureBadge}>{t.cancelAnytime}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex:1, backgroundColor:Colors.bg },
  inner:       { padding:24, paddingBottom:48, paddingTop:64 },
  backBtn:     { position:"absolute", top:52, left:24, zIndex:10 },
  backText:    { color:Colors.t2, fontSize:14 },
  logoBox:     { alignItems:"center", marginBottom:24 },
  logo:        { fontSize:28, fontWeight:"900", color:Colors.accent, letterSpacing:3 },
  logoSub:     { fontSize:12, color:Colors.t3, marginTop:3 },
  trialBanner: { backgroundColor:Colors.yellow+"18", borderWidth:0.5, borderColor:Colors.yellow+"44", borderRadius:10, padding:10, marginBottom:20 },
  trialText:   { color:Colors.yellow, fontSize:13, textAlign:"center" },
  holdBanner:  { backgroundColor:Colors.red+"15", borderWidth:0.5, borderColor:Colors.red+"40", borderRadius:10, padding:14, marginBottom:20 },
  holdTitle:   { color:Colors.red, fontSize:14, fontWeight:"800", textAlign:"center", marginBottom:4 },
  holdSub:     { color:Colors.t2, fontSize:12, textAlign:"center", lineHeight:18 },
  title:       { fontSize:20, fontWeight:"700", color:Colors.t1, marginBottom:16 },
  card:        { backgroundColor:Colors.card, borderRadius:14, padding:16, marginBottom:12, borderWidth:1, borderColor:Colors.border },
  cardActive:  { borderColor:Colors.accent, backgroundColor:Colors.accent+"08" },
  cardPop:     { borderColor:Colors.accent, borderWidth:1.5, backgroundColor:Colors.accent+"08" },
  cardHeader:  { flexDirection:"row", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 },
  cardName:    { fontSize:15, fontWeight:"600", color:Colors.t2 },
  cardDesc:    { fontSize:11, color:Colors.t3, marginTop:2 },
  badge:       { backgroundColor:Colors.accent+"25", borderRadius:5, paddingHorizontal:6, paddingVertical:2 },
  badgeText:   { color:Colors.accent, fontSize:9, fontWeight:"600" },
  price:       { fontSize:20, fontWeight:"700", color:Colors.t1 },
  pricePer:    { fontSize:10, color:Colors.t3 },
  priceFull:   { fontSize:10, color:Colors.t3 },
  perks:       { gap:6 },
  perkRow:     { flexDirection:"row", alignItems:"center", gap:8 },
  perkCheck:   { color:Colors.accent, fontSize:12, fontWeight:"700" },
  perkText:    { color:Colors.t2, fontSize:12 },
  radio:       { position:"absolute", top:16, right:16, width:18, height:18, borderRadius:9, borderWidth:2, borderColor:Colors.t3, alignItems:"center", justifyContent:"center" },
  radioActive: { borderColor:Colors.accent },
  radioDot:    { width:8, height:8, borderRadius:4, backgroundColor:Colors.accent },
  btn:         { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginTop:8, marginBottom:12 },
  btnText:     { fontSize:15, fontWeight:"700", color:Colors.accentText },
  secureRow:   { flexDirection:"row", justifyContent:"center", gap:12 },
  secureBadge: { color:Colors.t3, fontSize:11 },
});
