import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { AuthAPI } from "../../services/auth";
import { DriversAPI } from "../../services/drivers";
import { useStrings, setLang } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { Driver, Vehicle } from "../../constants/types";
import { Lang } from "../../constants/i18n";
import { getVehicleImageUrl } from "../../utils/vehicleImage";
import { VEHICLE_TYPES } from "../../constants/vehicles";

export default function ProfileScreen() {
  const router      = useRouter();
  const navigation = useNavigation();
  const goBack = () => { if (navigation.canGoBack()) goBack(); else router.replace("/(app)/zone-select"); };
  const { t, lang } = useStrings();
  const [driver,   setDriver]   = useState<Driver|null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  useEffect(() => {
    DriversAPI.getMe().then(setDriver);
    DriversAPI.getVehicles().then(setVehicles);
  }, []);

  const handleSignOut = async () => {
    await AuthAPI.signOut();
    router.replace("/(auth)/language");
  };

  const subColor = driver?.subscription_status === "active"   ? Colors.accent
    : driver?.subscription_status === "trialing"  ? Colors.blue
    : driver?.subscription_status === "grace"     ? Colors.yellow
    : Colors.red;

  const subLabel = driver?.subscription_status === "trialing" ? t.subTrialing
    : driver?.subscription_status === "active"    ? t.subActive
    : driver?.subscription_status === "grace"     ? t.subGrace
    : t.subExpired;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack()}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t.profile}</Text>
        <View style={{ width:24 }} />
      </View>

      <ScrollView contentContainerStyle={s.inner}>
        {/* Avatar */}
        <View style={s.avatar}>
          <View style={s.avatarCircle}>
            <Text style={s.avatarEmoji}>👤</Text>
          </View>
          <Text style={s.name}>{driver?.full_name || "Driver"}</Text>
          <Text style={s.phone}>{driver?.phone}</Text>
        </View>

        {/* Subscription */}
        <View style={s.card}>
          <View style={s.cardRow}>
            <Text style={s.cardTitle}>Subscription</Text>
            <View style={[s.badge, { backgroundColor:subColor+"20", borderColor:subColor+"40" }]}>
              <Text style={[s.badgeText, { color:subColor }]}>{subLabel}</Text>
            </View>
          </View>
          <Text style={s.cardSub}>{driver?.subscription_plan === "annual" ? t.annual : t.monthly} plan</Text>
          {driver?.subscription_ends_at && (
            <Text style={s.cardNote}>{t.renewsOn} {new Date(driver.subscription_ends_at).toLocaleDateString()}</Text>
          )}
        </View>

        {/* Vehicles */}
        <Text style={s.sectionLabel}>{t.myVehicles.toUpperCase()}</Text>
        {vehicles.length === 0 ? (
          <View style={s.emptyVehicle}>
            <Text style={s.emptyText}>No vehicles added yet</Text>
            <TouchableOpacity style={s.addBtn} onPress={() => router.push("/(auth)/vehicle-setup")}>
              <Text style={s.addBtnText}>+ {t.addVehicle}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {vehicles.map(v => (
              <View key={v.id} style={[s.vehicleCard, v.is_active && s.vehicleCardActive]}>
                <Image
                  source={{ uri: getVehicleImageUrl(v.make, v.model, v.year) }}
                  style={s.vehicleImg}
                  resizeMode="contain"
                />
                <View style={s.vehicleInfo}>
                  <View style={s.vehicleRow}>
                    <Text style={s.vehicleName}>{v.year} {v.make} {v.model}</Text>
                    {v.is_active && <View style={s.activeDot}><Text style={s.activeDotText}>Active</Text></View>}
                  </View>
                  <Text style={s.vehiclePlate}>{v.plate}</Text>
                  <View style={s.vehicleMeta}>
                    <Text style={s.vehicleType}>{VEHICLE_TYPES[v.type]?.label || v.type}</Text>
                    <Text style={s.vehicleSeats}>· {v.seats} {t.seats}</Text>
                  </View>
                </View>
              </View>
            ))}
            <TouchableOpacity style={s.addBtn} onPress={() => router.push("/(auth)/vehicle-setup")}>
              <Text style={s.addBtnText}>+ {t.addVehicle}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Language */}
        <Text style={s.sectionLabel}>{t.language.toUpperCase()}</Text>
        <View style={s.langRow}>
          {(["en","fr"] as Lang[]).map(l => (
            <TouchableOpacity key={l} style={[s.langBtn, lang===l && s.langBtnActive]} onPress={() => setLang(l)}>
              <Text style={[s.langBtnText, lang===l && { color:Colors.accent }]}>
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
  container:         { flex:1, backgroundColor:Colors.bg },
  header:            { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:16 },
  back:              { fontSize:20, color:Colors.t2 },
  title:             { fontSize:17, fontWeight:"700", color:Colors.t1 },
  inner:             { padding:20, paddingBottom:60 },
  avatar:            { alignItems:"center", marginBottom:24 },
  avatarCircle:      { width:72, height:72, borderRadius:36, backgroundColor:Colors.card, borderWidth:1, borderColor:Colors.border, alignItems:"center", justifyContent:"center", marginBottom:10 },
  avatarEmoji:       { fontSize:32 },
  name:              { fontSize:20, fontWeight:"700", color:Colors.t1 },
  phone:             { fontSize:13, color:Colors.t3, marginTop:4 },
  card:              { backgroundColor:Colors.card, borderRadius:14, padding:16, borderWidth:0.5, borderColor:Colors.border, marginBottom:24 },
  cardRow:           { flexDirection:"row", justifyContent:"space-between", alignItems:"center", marginBottom:6 },
  cardTitle:         { fontSize:14, fontWeight:"600", color:Colors.t1 },
  badge:             { borderRadius:6, paddingHorizontal:8, paddingVertical:3, borderWidth:0.5 },
  badgeText:         { fontSize:11, fontWeight:"600" },
  cardSub:           { fontSize:12, color:Colors.t2 },
  cardNote:          { fontSize:11, color:Colors.t3, marginTop:3 },
  sectionLabel:      { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:10 },
  emptyVehicle:      { backgroundColor:Colors.card, borderRadius:14, padding:20, alignItems:"center", marginBottom:16, borderWidth:0.5, borderColor:Colors.border },
  emptyText:         { color:Colors.t2, fontSize:13, marginBottom:12 },
  vehicleCard:       { backgroundColor:Colors.card, borderRadius:14, marginBottom:12, borderWidth:0.5, borderColor:Colors.border, overflow:"hidden" },
  vehicleCardActive: { borderColor:Colors.accent+"60" },
  vehicleImg:        { width:"100%", height:120, backgroundColor:Colors.cardAlt },
  vehicleInfo:       { padding:12 },
  vehicleRow:        { flexDirection:"row", alignItems:"center", justifyContent:"space-between", marginBottom:4 },
  vehicleName:       { fontSize:14, fontWeight:"600", color:Colors.t1 },
  activeDot:         { backgroundColor:Colors.accent+"20", borderRadius:6, paddingHorizontal:7, paddingVertical:2 },
  activeDotText:     { color:Colors.accent, fontSize:10, fontWeight:"600" },
  vehiclePlate:      { fontSize:12, color:Colors.t2, marginBottom:4 },
  vehicleMeta:       { flexDirection:"row", gap:4 },
  vehicleType:       { fontSize:11, color:Colors.t3 },
  vehicleSeats:      { fontSize:11, color:Colors.t3 },
  addBtn:            { backgroundColor:Colors.card, borderRadius:12, padding:12, alignItems:"center", borderWidth:1, borderColor:Colors.border, marginBottom:24 },
  addBtnText:        { color:Colors.accent, fontSize:13, fontWeight:"600" },
  langRow:           { flexDirection:"row", gap:10, marginBottom:32 },
  langBtn:           { flex:1, backgroundColor:Colors.card, borderRadius:10, padding:12, borderWidth:1, borderColor:Colors.border, alignItems:"center" },
  langBtnActive:     { borderColor:Colors.accent, backgroundColor:Colors.accent+"12" },
  langBtnText:       { fontSize:13, fontWeight:"600", color:Colors.t2 },
  signOutBtn:        { backgroundColor:Colors.red+"15", borderRadius:12, padding:14, alignItems:"center", borderWidth:0.5, borderColor:Colors.red+"30" },
  signOutText:       { color:Colors.red, fontSize:14, fontWeight:"600" },
});
