import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert, ActivityIndicator, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { AuthAPI } from "../../services/auth";
import { DriversAPI } from "../../services/drivers";
import { MessagesAPI } from "../../services/messages";
import { supabase } from "../../services/supabase";
import { useStrings, setLang } from "../../hooks/useStrings";
import { clearMyAvatarCache } from "../../hooks/useMyAvatar";
import { Colors } from "../../constants/colors";
import { Driver, Vehicle } from "../../constants/types";
import { Lang } from "../../constants/i18n";
import { getVehicleImageUrl } from "../../utils/vehicleImage";
import { VEHICLE_TYPES } from "../../constants/vehicles";
import BottomNav from "../../components/BottomNav";
import VerifiedBadge from "../../components/VerifiedBadge";

export default function ProfileScreen() {
  const router      = useRouter();
  const { t, lang } = useStrings();
  const [driver,    setDriver]    = useState<Driver|null>(null);
  const [vehicles,  setVehicles]  = useState<Vehicle[]>([]);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [unread,    setUnread]    = useState<number>(0);

  useEffect(() => {
    DriversAPI.getMe().then(setDriver);
    DriversAPI.getVehicles().then(setVehicles);
    supabase.auth.getUser().then(({ data }) => setAuthEmail(data.user?.email ?? null));
  }, []);

  useFocusEffect(useCallback(() => {
    MessagesAPI.unreadCount().then(setUnread);
  }, []));

  const handleSignOut = async () => {
    await AuthAPI.signOut();
    router.replace("/(auth)/language");
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t.deleteAccount,
      t.deleteAccountDriverBody,
      [
        { text: t.cancel, style: "cancel" },
        { text: t.deleteForever, style: "destructive", onPress: async () => {
          const { error } = await supabase.rpc("delete_my_account");
          if (error) { Alert.alert(t.couldNotDelete, error.message); return; }
          await AuthAPI.signOut();
          router.replace("/(auth)/language");
        }},
      ],
    );
  };

  const handlePickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t.permissionNeeded, t.photoPermissionBody);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setUploading(true);
    const { url, error } = await DriversAPI.uploadAvatar(result.assets[0].uri);
    setUploading(false);
    if (error) { Alert.alert(t.error, error); return; }
    if (url) {
      setDriver(d => d ? { ...d, avatar_url: url } : d);
      clearMyAvatarCache();
    }
  };

  const shortId = driver?.id ? `#${driver.id.slice(0, 8).toUpperCase()}` : "—";
  const emailDisplay = driver?.email || authEmail || "—";
  const phoneDisplay = driver?.phone || "—";

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
        <TouchableOpacity onPress={() => router.replace("/(app)/zone-select")}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t.profile}</Text>
        <View style={{ width:24 }} />
      </View>

      <ScrollView contentContainerStyle={s.inner}>
        {/* Avatar */}
        <View style={s.avatar}>
          <TouchableOpacity onPress={handlePickAvatar} disabled={uploading} activeOpacity={0.8}>
            <View style={s.avatarCircle}>
              {driver?.avatar_url ? (
                <Image source={{ uri: driver.avatar_url }} style={s.avatarImg} />
              ) : (
                <Text style={s.avatarEmoji}>👤</Text>
              )}
              <View style={s.avatarEditBadge}>
                {uploading
                  ? <ActivityIndicator size="small" color={Colors.accentText} />
                  : <Text style={s.avatarEditIcon}>✎</Text>}
              </View>
            </View>
          </TouchableOpacity>
          <View style={s.nameRow}>
            <Text style={s.name}>{driver?.full_name || t.driverLabel}</Text>
            {driver?.verified && <VerifiedBadge size={20} />}
          </View>
          <TouchableOpacity onPress={handlePickAvatar} disabled={uploading}>
            <Text style={s.avatarHint}>
              {uploading ? t.loading : (driver?.avatar_url ? t.changePhoto : t.addPhoto)}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Identity */}
        <View style={s.card}>
          <View style={s.identRow}>
            <Text style={s.identKey}>{t.emailAddress}</Text>
            <Text style={s.identVal} numberOfLines={1}>{emailDisplay}</Text>
          </View>
          <View style={s.identRow}>
            <Text style={s.identKey}>{t.phoneNumber}</Text>
            <Text style={s.identVal} numberOfLines={1}>{phoneDisplay}</Text>
          </View>
          <View style={[s.identRow, { borderBottomWidth: 0 }]}>
            <Text style={s.identKey}>{t.driverId}</Text>
            <Text style={s.identVal} numberOfLines={1}>{shortId}</Text>
          </View>
        </View>

        {/* Subscription */}
        <View style={s.card}>
          <View style={s.cardRow}>
            <Text style={s.cardTitle}>{t.subscriptionTitle}</Text>
            <View style={[s.badge, { backgroundColor:subColor+"20", borderColor:subColor+"40" }]}>
              <Text style={[s.badgeText, { color:subColor }]}>{subLabel}</Text>
            </View>
          </View>
          <Text style={s.cardSub}>{driver?.subscription_plan === "annual" ? t.annual : t.monthly} {t.planSuffix}</Text>
          {driver?.subscription_ends_at && (
            <Text style={s.cardNote}>{t.renewsOn} {new Date(driver.subscription_ends_at).toLocaleDateString()}</Text>
          )}
        </View>

        {/* Vehicles */}
        <Text style={s.sectionLabel}>{t.myVehicles.toUpperCase()}</Text>
        {vehicles.length === 0 ? (
          <View style={s.emptyVehicle}>
            <Text style={s.emptyText}>{t.noVehiclesYet}</Text>
            <TouchableOpacity style={s.addBtn} onPress={() => router.push("/(auth)/vehicle-setup")}>
              <Text style={s.addBtnText}>+ {t.addVehicle}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {vehicles.map(v => (
              <View key={v.id} style={[s.vehicleCard, v.is_active && s.vehicleCardActive]}>
                <Image
                  source={{ uri: getVehicleImageUrl(v.make, v.model, v.year, "side", v.color || undefined) }}
                  style={s.vehicleImg}
                  resizeMode="contain"
                />
                <View style={s.vehicleInfo}>
                  <View style={s.vehicleRow}>
                    <Text style={s.vehicleName}>{v.year} {v.make} {v.model}</Text>
                    {v.is_active && <View style={s.activeDot}><Text style={s.activeDotText}>{t.activeBadge}</Text></View>}
                  </View>
                  <Text style={s.vehiclePlate}>{v.plate}{v.color ? ` · ${v.color}` : ""}</Text>
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

        <TouchableOpacity style={s.historyBtn} onPress={() => router.push("/(app)/loading-history")} activeOpacity={0.85}>
          <Text style={s.historyBtnText}>📋  {t.loadingHistoryLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.historyBtn} onPress={() => router.push("/(app)/referral")} activeOpacity={0.85}>
          <Text style={s.historyBtnText}>🎁  {t.referAndEarn}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.historyBtn} onPress={() => router.push("/(app)/messages" as any)} activeOpacity={0.85}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={s.historyBtnText}>💬  {t.messagesLabel}</Text>
            {unread > 0 && (
              <View style={s.unreadBadge}>
                <Text style={s.unreadBadgeText}>{unread > 99 ? "99+" : unread}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {driver?.is_admin && (
          <>
            <TouchableOpacity style={s.adminBtn} onPress={() => router.push("/(app)/admin-zones")} activeOpacity={0.85}>
              <Text style={s.adminBtnText}>🛠  {t.adminZones}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.adminBtn} onPress={() => router.push("/(app)/admin-destinations")} activeOpacity={0.85}>
              <Text style={s.adminBtnText}>🗺  {t.adminDestinations}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.adminBtn} onPress={() => router.push("/(app)/admin-verify")} activeOpacity={0.85}>
              <Text style={s.adminBtnText}>👥  {t.adminUsers}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.adminBtn} onPress={() => router.push("/(app)/admin-inbox" as any)} activeOpacity={0.85}>
              <Text style={s.adminBtnText}>📨  {t.adminInbox}</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}>
          <Text style={s.signOutText}>{t.signOut}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.deleteAccountBtn} onPress={handleDeleteAccount}>
          <Text style={s.deleteAccountText}>{t.deleteAccountAction}</Text>
        </TouchableOpacity>

        <View style={{ alignItems: "center", marginTop: 20 }}>
          <Text style={{ color: Colors.t3, fontSize: 11.5, textAlign: "center" }}>{t.ownedBy}</Text>
          <TouchableOpacity onPress={() => Linking.openURL("https://www.concordexpress.ca").catch(() => {})}>
            <Text style={{ color: Colors.accent, fontSize: 11.5, fontWeight: "600", marginTop: 2 }}>www.concordexpress.ca</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <BottomNav />
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
  avatarCircle:      { width:88, height:88, borderRadius:44, backgroundColor:Colors.card, borderWidth:1, borderColor:Colors.border, alignItems:"center", justifyContent:"center", marginBottom:10, overflow:"hidden" },
  avatarEmoji:       { fontSize:40 },
  avatarImg:         { width:88, height:88, borderRadius:44 },
  avatarEditBadge:   { position:"absolute", bottom:0, right:0, width:28, height:28, borderRadius:14, backgroundColor:Colors.accent, alignItems:"center", justifyContent:"center", borderWidth:2, borderColor:Colors.bg },
  avatarEditIcon:    { color:Colors.accentText, fontSize:14, fontWeight:"700" },
  avatarHint:        { fontSize:12, color:Colors.accent, marginTop:6, fontWeight:"600" },
  nameRow:           { flexDirection:"row", alignItems:"center", gap:8, marginTop:4 },
  name:              { fontSize:20, fontWeight:"700", color:Colors.t1 },
  identRow:          { flexDirection:"row", justifyContent:"space-between", alignItems:"center", paddingVertical:10, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  identKey:          { color:Colors.t3, fontSize:12, fontWeight:"600" },
  identVal:          { color:Colors.t1, fontSize:13, fontWeight:"500", maxWidth:"60%", textAlign:"right" },
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
  editVehicleBtn:    { alignSelf:"flex-start", marginTop:8, backgroundColor:Colors.accent+"15", borderRadius:8, paddingHorizontal:10, paddingVertical:5, borderWidth:0.5, borderColor:Colors.accent+"40" },
  editVehicleText:   { color:Colors.accent, fontSize:11, fontWeight:"700" },
  vehicleMeta:       { flexDirection:"row", gap:4 },
  vehicleType:       { fontSize:11, color:Colors.t3 },
  vehicleSeats:      { fontSize:11, color:Colors.t3 },
  addBtn:            { backgroundColor:Colors.card, borderRadius:12, padding:12, alignItems:"center", borderWidth:1, borderColor:Colors.border, marginBottom:24 },
  addBtnText:        { color:Colors.accent, fontSize:13, fontWeight:"600" },
  langRow:           { flexDirection:"row", gap:10, marginBottom:32 },
  langBtn:           { flex:1, backgroundColor:Colors.card, borderRadius:10, padding:12, borderWidth:1, borderColor:Colors.border, alignItems:"center" },
  langBtnActive:     { borderColor:Colors.accent, backgroundColor:Colors.accent+"12" },
  langBtnText:       { fontSize:13, fontWeight:"600", color:Colors.t2 },
  historyBtn:        { backgroundColor:Colors.card, borderRadius:12, padding:14, alignItems:"center", borderWidth:0.5, borderColor:Colors.border, marginBottom:10 },
  historyBtnText:    { color:Colors.t1, fontSize:14, fontWeight:"700" },
  unreadBadge:       { marginLeft:8, minWidth:22, height:22, borderRadius:11, backgroundColor:Colors.red, paddingHorizontal:6, alignItems:"center", justifyContent:"center" },
  unreadBadgeText:   { color:"#fff", fontSize:11, fontWeight:"800" },
  adminBtn:          { backgroundColor:Colors.accent+"12", borderRadius:12, padding:14, alignItems:"center", borderWidth:0.5, borderColor:Colors.accent+"40", marginBottom:10 },
  adminBtnText:      { color:Colors.accent, fontSize:14, fontWeight:"700" },
  signOutBtn:        { backgroundColor:Colors.red+"15", borderRadius:12, padding:14, alignItems:"center", borderWidth:0.5, borderColor:Colors.red+"30" },
  signOutText:       { color:Colors.red, fontSize:14, fontWeight:"600" },
  deleteAccountBtn:  { marginTop:18, padding:12, alignItems:"center" },
  deleteAccountText: { color:Colors.t3, fontSize:13, textDecorationLine:"underline" },
});
