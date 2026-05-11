import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { AuthAPI } from "../../services/auth";
import { DriversAPI } from "../../services/drivers";
import { useStrings, setLang } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { Driver } from "../../constants/types";
import { Lang } from "../../constants/i18n";

export default function ProfileScreen() {
  const router    = useRouter();
  const { t, lang } = useStrings();
  const [driver, setDriver] = useState<Driver|null>(null);

  useEffect(() => {
    DriversAPI.getMe().then(setDriver);
  }, []);

  const handleSignOut = () => {
    Alert.alert(t.signOut, "Are you sure?", [
      { text: t.cancel, style:"cancel" },
      { text: t.signOut, style:"destructive", onPress: async () => {
        await AuthAPI.signOut();
        router.replace("/(auth)/language");
      }},
    ]);
  };

  const handleLang = async (l: Lang) => {
    await setLang(l);
  };

  const subColor = driver?.subscription_status === "active" ? Colors.accent
    : driver?.subscription_status === "trialing" ? Colors.blue
    : driver?.subscription_status === "grace"    ? Colors.yellow
    : Colors.red;

  const subLabel = driver?.subscription_status === "trialing" ? t.subTrialing
    : driver?.subscription_status === "active"   ? t.subActive
    : driver?.subscription_status === "grace"    ? t.subGrace
    : t.subExpired;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t.profile}</Text>
        <View style={{ width:24 }} />
      </View>

      <ScrollView contentContainerStyle={s.inner}>
        <View style={s.avatar}>
          <Text style={{ fontSize:36 }}>👤</Text>
          <Text style={s.name}>{driver?.full_name || "Driver"}</Text>
          <Text style={s.phone}>{driver?.phone}</Text>
        </View>

        <View style={s.subCard}>
          <View style={{ flexDirection:"row", justifyContent:"space-between", alignItems:"center" }}>
            <Text style={s.subTitle}>Subscription</Text>
            <View style={[s.subBadge, { backgroundColor: subColor+"20", borderColor: subColor+"40" }]}>
              <Text style={[s.subBadgeText, { color: subColor }]}>{subLabel}</Text>
            </View>
          </View>
          <Text style={s.subPlan}>{driver?.subscription_plan === "annual" ? t.annual : t.monthly} plan</Text>
          {driver?.subscription_ends_at && (
            <Text style={s.subEnd}>{t.renewsOn} {new Date(driver.subscription_ends_at).toLocaleDateString()}</Text>
          )}
        </View>

        <Text style={s.sectionLabel}>{t.language.toUpperCase()}</Text>
        <View style={s.langRow}>
          {(["en","fr"] as Lang[]).map(l => (
            <TouchableOpacity
              key={l}
              style={[s.langBtn, lang === l && s.langBtnActive]}
              onPress={() => handleLang(l)}
            >
              <Text style={[s.langBtnText, lang === l && { color: Colors.accent }]}>
                {l === "en" ? "🇨🇦 English" : "🇫🇷 Français"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}>
          <Text style={s.signOutText}>{t.signOut}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:    { flex:1, backgroundColor:Colors.bg },
  header:       { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:16 },
  back:         { fontSize:20, color:Colors.t2 },
  title:        { fontSize:17, fontWeight:"700", color:Colors.t1 },
  inner:        { padding:20, paddingBottom:60 },
  avatar:       { alignItems:"center", marginBottom:28 },
  name:         { fontSize:20, fontWeight:"700", color:Colors.t1, marginTop:10 },
  phone:        { fontSize:13, color:Colors.t3, marginTop:4 },
  subCard:      { backgroundColor:Colors.card, borderRadius:14, padding:16, borderWidth:0.5, borderColor:Colors.border, marginBottom:24 },
  subTitle:     { fontSize:14, fontWeight:"600", color:Colors.t1 },
  subBadge:     { borderRadius:6, paddingHorizontal:8, paddingVertical:3, borderWidth:0.5 },
  subBadgeText: { fontSize:11, fontWeight:"600" },
  subPlan:      { fontSize:12, color:Colors.t2, marginTop:6 },
  subEnd:       { fontSize:11, color:Colors.t3, marginTop:3 },
  sectionLabel: { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:10 },
  langRow:      { flexDirection:"row", gap:10, marginBottom:32 },
  langBtn:      { flex:1, backgroundColor:Colors.card, borderRadius:10, padding:12, borderWidth:1, borderColor:Colors.border, alignItems:"center" },
  langBtnActive:{ borderColor:Colors.accent, backgroundColor:Colors.accent+"12" },
  langBtnText:  { fontSize:13, fontWeight:"600", color:Colors.t2 },
  signOutBtn:   { backgroundColor:Colors.red+"15", borderRadius:12, padding:14, alignItems:"center", borderWidth:0.5, borderColor:Colors.red+"30" },
  signOutText:  { color:Colors.red, fontSize:14, fontWeight:"600" },
});
