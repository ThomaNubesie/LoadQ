import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { AuthAPI } from "../../services/auth";
import { PassengersAPI, Passenger } from "../../services/passengers";
import { supabase } from "../../services/supabase";
import { useStrings, setLang } from "../../hooks/useStrings";
import { clearMyAvatarCache } from "../../hooks/useMyAvatar";
import { Colors } from "../../constants/colors";
import { Lang } from "../../constants/i18n";
import PassengerBottomNav from "../../components/PassengerBottomNav";

export default function PassengerProfileScreen() {
  const router      = useRouter();
  const { t, lang } = useStrings();
  const [passenger, setPassenger] = useState<Passenger | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    PassengersAPI.getMe().then(setPassenger);
    supabase.auth.getUser().then(({ data }) => setAuthEmail(data.user?.email ?? null));
  }, []);

  const handleSignOut = async () => {
    await AuthAPI.signOut();
    router.replace("/(auth)/language");
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
    const { url, error } = await PassengersAPI.uploadAvatar(result.assets[0].uri);
    setUploading(false);
    if (error) { Alert.alert(t.error, error); return; }
    if (url) {
      setPassenger(p => p ? { ...p, avatar_url: url } : p);
      clearMyAvatarCache();
    }
  };

  const shortId = passenger?.id ? `#${passenger.id.slice(0, 8).toUpperCase()}` : "—";
  const emailDisplay = passenger?.email || authEmail || "—";
  const phoneDisplay = passenger?.phone || "—";

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>{t.profile}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={s.inner}>
        <View style={s.avatar}>
          <TouchableOpacity onPress={handlePickAvatar} disabled={uploading} activeOpacity={0.8}>
            <View style={s.avatarCircle}>
              {passenger?.avatar_url ? (
                <Image source={{ uri: passenger.avatar_url }} style={s.avatarImg} />
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
          <Text style={s.name}>{passenger?.full_name || "Passenger"}</Text>
          <TouchableOpacity onPress={handlePickAvatar} disabled={uploading}>
            <Text style={s.avatarHint}>
              {uploading ? t.loading : (passenger?.avatar_url ? t.changePhoto : t.addPhoto)}
            </Text>
          </TouchableOpacity>
        </View>

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
            <Text style={s.identKey}>{t.passengerId}</Text>
            <Text style={s.identVal} numberOfLines={1}>{shortId}</Text>
          </View>
        </View>

        <Text style={s.sectionLabel}>{t.language.toUpperCase()}</Text>
        <View style={s.langRow}>
          {(["en","fr"] as Lang[]).map(l => (
            <TouchableOpacity key={l} style={[s.langBtn, lang===l && s.langBtnActive]} onPress={() => setLang(l)}>
              <Text style={[s.langBtnText, lang===l && { color: Colors.accent }]}>
                {l === "en" ? "🇨🇦 English" : "🇫🇷 Français"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}>
          <Text style={s.signOutText}>{t.signOut}</Text>
        </TouchableOpacity>
      </ScrollView>

      <PassengerBottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:         { flex:1, backgroundColor:Colors.bg },
  header:            { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:16 },
  title:             { fontSize:17, fontWeight:"700", color:Colors.t1 },
  inner:             { padding:20, paddingBottom:120 },
  avatar:            { alignItems:"center", marginBottom:24 },
  avatarCircle:      { width:88, height:88, borderRadius:44, backgroundColor:Colors.card, borderWidth:1, borderColor:Colors.border, alignItems:"center", justifyContent:"center", marginBottom:10, overflow:"hidden" },
  avatarEmoji:       { fontSize:40 },
  avatarImg:         { width:88, height:88, borderRadius:44 },
  avatarEditBadge:   { position:"absolute", bottom:0, right:0, width:28, height:28, borderRadius:14, backgroundColor:Colors.accent, alignItems:"center", justifyContent:"center", borderWidth:2, borderColor:Colors.bg },
  avatarEditIcon:    { color:Colors.accentText, fontSize:14, fontWeight:"700" },
  avatarHint:        { fontSize:12, color:Colors.accent, marginTop:6, fontWeight:"600" },
  name:              { fontSize:20, fontWeight:"700", color:Colors.t1, marginTop:4 },
  card:              { backgroundColor:Colors.card, borderRadius:14, padding:16, borderWidth:0.5, borderColor:Colors.border, marginBottom:24 },
  identRow:          { flexDirection:"row", justifyContent:"space-between", alignItems:"center", paddingVertical:10, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  identKey:          { color:Colors.t3, fontSize:12, fontWeight:"600" },
  identVal:          { color:Colors.t1, fontSize:13, fontWeight:"500", maxWidth:"60%", textAlign:"right" },
  sectionLabel:      { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:10 },
  langRow:           { flexDirection:"row", gap:10, marginBottom:32 },
  langBtn:           { flex:1, backgroundColor:Colors.card, borderRadius:10, padding:12, borderWidth:1, borderColor:Colors.border, alignItems:"center" },
  langBtnActive:     { borderColor:Colors.accent, backgroundColor:Colors.accent+"12" },
  langBtnText:       { fontSize:13, fontWeight:"600", color:Colors.t2 },
  signOutBtn:        { backgroundColor:Colors.red+"15", borderRadius:12, padding:14, alignItems:"center", borderWidth:0.5, borderColor:Colors.red+"30" },
  signOutText:       { color:Colors.red, fontSize:14, fontWeight:"600" },
});
