import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { DriversAPI } from "../../services/drivers";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function EmailSetupScreen() {
  const router     = useRouter();
  const navigation = useNavigation();
  const goBack = () => { if (navigation.canGoBack()) goBack(); else router.replace("/(auth)/vehicle-setup"); };
  const { t }  = useStrings();
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const handleNext = async () => {
    if (email && !EMAIL_REGEX.test(email)) { setError("Please enter a valid email"); return; }
    setLoading(true);
    if (email) await DriversAPI.createOrUpdate({ email: email.trim().toLowerCase() });
    setLoading(false);
    router.replace("/(auth)/subscribe");
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.inner}>
        <TouchableOpacity onPress={() => goBack()} style={s.backBtn}>
          <Text style={s.backText}>← {t.back}</Text>
        </TouchableOpacity>

        <Text style={s.logo}>LOADQ</Text>
        <View style={s.stepRow}>
          <Text style={s.stepText}>3 {t.stepOf} 3</Text>
          <View style={s.stepBar}><View style={[s.stepFill, { width:"100%" }]} /></View>
        </View>
        <Text style={s.title}>{t.setupEmail}</Text>
        <Text style={s.sub}>{t.emailRecovery}</Text>

        <Text style={s.label}>{t.emailAddress.toUpperCase()}</Text>
        <TextInput
          style={s.input}
          value={email}
          onChangeText={v => { setEmail(v); setError(""); }}
          placeholder="you@email.com"
          placeholderTextColor={Colors.t3}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />

        {!!error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity style={[s.btn, loading && s.btnOff]} onPress={handleNext} disabled={loading} activeOpacity={0.85}>
          <Text style={s.btnText}>{loading ? t.loading : t.next + " →"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace("/(auth)/subscribe")} style={s.skip}>
          <Text style={s.skipText}>{t.skip}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:  { flex:1, backgroundColor:Colors.bg },
  inner:      { flex:1, padding:24, justifyContent:"center" },
  backBtn:    { position:"absolute", top:60, left:24 },
  backText:   { color:Colors.t2, fontSize:14 },
  logo:       { fontSize:24, fontWeight:"900", color:Colors.accent, letterSpacing:3, marginBottom:16 },
  stepRow:    { marginBottom:24 },
  stepText:   { color:Colors.t3, fontSize:11, marginBottom:6 },
  stepBar:    { height:3, backgroundColor:Colors.border, borderRadius:2 },
  stepFill:   { height:3, backgroundColor:Colors.accent, borderRadius:2 },
  title:      { fontSize:22, fontWeight:"700", color:Colors.t1, marginBottom:6 },
  sub:        { fontSize:13, color:Colors.t2, marginBottom:28, lineHeight:20 },
  label:      { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:6 },
  input:      { backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, padding:14, color:Colors.t1, fontSize:15, marginBottom:18 },
  error:      { color:Colors.red, fontSize:13, marginBottom:12 },
  btn:        { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginBottom:12 },
  btnOff:     { opacity:0.4 },
  btnText:    { fontSize:16, fontWeight:"700", color:Colors.accentText },
  skip:       { alignItems:"center", padding:8 },
  skipText:   { color:Colors.t3, fontSize:13 },
});
