import { useCallback, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { DriversAPI } from "../../services/drivers";
import { StripeWebCheckoutAPI } from "../../services/billing";
import { Driver } from "../../constants/types";

// Apple-compliant 3.1.5(a) flow: the in-app button opens system Safari to
// the public checkout page on loadq.ca. Stripe processes the card on the
// web. The Stripe webhook updates drivers.subscription_status server-side.
// When checkout finishes, Stripe's success_url is loadq://subscribe/done
// which deep-links back here and we refresh the driver row.
//
// We keep the look-and-feel of the previous RevenueCat paywall so the
// experience is familiar; only the underlying payment mechanism changed.
export default function SubscribeScreen() {
  const router    = useRouter();
  const { t }     = useStrings();
  const [plan, setPlan]               = useState<"annual"|"monthly">("monthly");
  const [driver, setDriver]           = useState<Driver | null>(null);
  const [busy, setBusy]               = useState(false);

  const refreshDriver = useCallback(async () => {
    const d = await DriversAPI.getMe();
    setDriver(d);
    return d;
  }, []);

  useEffect(() => { refreshDriver(); }, [refreshDriver]);

  // When Safari hands us back via loadq://subscribe/done, refresh the
  // driver row — the webhook should have flipped subscription_status to
  // 'active' by then. If it has, leave the paywall.
  useEffect(() => {
    const sub = Linking.addEventListener("url", async ({ url }) => {
      if (!url.includes("subscribe/done")) return;
      // Webhook propagation can take a second or two; refresh a few times.
      for (let i = 0; i < 5; i++) {
        const d = await refreshDriver();
        if (d?.subscription_status === "active") {
          router.replace("/(app)/zone-select");
          return;
        }
        await new Promise(r => setTimeout(r, 1500));
      }
      // Webhook didn't land within ~7s — let the user retry. The Stripe
      // session might still be processing; status check on next focus
      // will catch it.
      Alert.alert(t.almostThere, t.paymentBeingConfirmed);
    });
    return () => sub.remove();
  }, [refreshDriver, router]);

  const trialEnded = driver?.subscription_status === "trialing"
    && driver?.trial_ends_at
    && new Date(driver.trial_ends_at).getTime() < Date.now();
  const hadHistory = !!(driver?.trial_ends_at || driver?.subscription_ends_at);
  const onHold = !!driver && hadHistory && (
    driver.subscription_status === "expired"
    || driver.subscription_status === "cancelled"
    || trialEnded
  );

  const handleSubscribe = async () => {
    if (!driver?.id) {
      Alert.alert(t.signInRequired, t.signInBeforeSubscribe);
      return;
    }
    setBusy(true);
    try {
      await StripeWebCheckoutAPI.openCheckout(driver.id, plan);
      // Safari is now showing the checkout page. We leave busy=true so the
      // button stays disabled until Linking returns the user — at which
      // point the listener above refreshes the driver row and navigates.
    } catch (e: any) {
      setBusy(false);
      Alert.alert(t.cantOpenCheckout, e?.message ?? t.pleaseTryAgain);
    }
  };

  // Static prices for now — the web page handles real billing and Stripe
  // is the source of truth. These labels are informational only.
  const PLANS = [
    { key:"monthly" as const, name:t.monthly, price:"C$34.99", full:null, per:t.perMonth, desc:t.billedMonthly, badge:null, perks:[t.fullQueueAccess, t.seatTrackingPeer, t.priorityQueueOnJoin, t.loadingHistory, t.thirtyDayFreeTrial], popular:true },
  ];

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.inner}>
        <TouchableOpacity onPress={() => router.replace("/(auth)/welcome")} style={s.backBtn}>
          <Text style={s.backText}>← {t.back}</Text>
        </TouchableOpacity>

        <View style={s.logoBox}>
          <Text style={s.logo}>LOADQ</Text>
          <Text style={s.logoSub}>{t.driverSubscription}</Text>
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
          style={[s.btn, busy && { opacity: 0.5 }]}
          onPress={handleSubscribe}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy
            ? <ActivityIndicator color={Colors.accentText} />
            : <Text style={s.btnText}>{t.continueOnWeb}</Text>}
        </TouchableOpacity>

        <Text style={s.disclaimer}>{t.subscribeDisclaimer}</Text>

        <View style={s.secureRow}>
          <Text style={s.secureBadge}>🔒 {t.thirtyDayFreeTrial}</Text>
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
  radio:       { position:"absolute", bottom:16, right:16, width:18, height:18, borderRadius:9, borderWidth:2, borderColor:Colors.t3, alignItems:"center", justifyContent:"center" },
  radioActive: { borderColor:Colors.accent },
  radioDot:    { width:8, height:8, borderRadius:4, backgroundColor:Colors.accent },
  btn:         { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginTop:8, marginBottom:12 },
  btnText:     { fontSize:15, fontWeight:"700", color:Colors.accentText },
  disclaimer:  { color:Colors.t3, fontSize:11, textAlign:"center", lineHeight:16, paddingHorizontal:8, marginBottom:14 },
  secureRow:   { flexDirection:"row", justifyContent:"center", gap:12 },
  secureBadge: { color:Colors.t3, fontSize:11 },
});
