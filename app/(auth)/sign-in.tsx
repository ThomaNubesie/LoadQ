import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { DriversAPI } from "../../services/drivers";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

export default function SignInScreen() {
  const router  = useRouter();
  const { t }   = useStrings();
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const handleTestLogin = async () => {
    setLoading(true);
    const { error: err } = await supabase.auth.signInAnonymously();
    if (err) { setError(err.message); setLoading(false); return; }
    const driver = await DriversAPI.getMe();
    setLoading(false);
    if (!driver || !driver.full_name) {
      router.replace("/(auth)/profile-setup");
    } else {
      const hasSub = await DriversAPI.hasActiveSubscription();
      router.replace(hasSub ? "/(app)/queue" : "/(auth)/subscribe");
    }
  };

  const handleSend = async () => {
    if (!email.includes("@")) { setError("Please enter a valid email"); return; }
    setLoading(true); setError("");
    const { error: err } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase() });
    setLoading(false);
    if (err) { setError(err.message); return; }
    router.push({ pathname:"/(auth)/otp", params:{ phone: email.trim().toLowerCase(), isEmail:"true" } });
  };

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={s.inner} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TouchableOpacity onPress={() => router.replace("/(auth)/language")} style={s.backBtn}>
          <Text style={s.backText}>← {t.back}</Text>
        </TouchableOpacity>
        <Text style={s.logo}>LOADQ</Text>
        <Text style={s.title}>{t.signIn}</Text>

        <Text style={s.label}>EMAIL ADDRESS</Text>
        <TextInput
          style={s.input}
          value={email}
          onChangeText={v => { setEmail(v); setError(""); }}
          placeholder="you@email.com"
          placeholderTextColor={Colors.t3}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        {!!error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity
          style={[s.btn, (!email.includes("@") || loading) && s.btnOff]}
          onPress={handleSend}
          disabled={!email.includes("@") || loading}
          activeOpacity={0.85}
        >
          <Text style={s.btnText}>{loading ? t.loading : t.sendCode + " →"}</Text>
        </TouchableOpacity>

        <View style={s.divider}><Text style={s.dividerText}>or</Text></View>

        <TouchableOpacity style={s.testBtn} onPress={handleTestLogin} disabled={loading} activeOpacity={0.85}>
          <Text style={s.testBtnText}>🧪 Test login (skip email)</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:Colors.bg },
  inner:     { flex:1, padding:24, justifyContent:"center" },
  backBtn:   { position:"absolute", top:60, left:24 },
  backText:  { color:Colors.t2, fontSize:14 },
  logo:      { fontSize:28, fontWeight:"900", color:Colors.accent, letterSpacing:3, marginBottom:28 },
  title:     { fontSize:26, fontWeight:"700", color:Colors.t1, marginBottom:24 },
  label:     { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:6 },
  input:     { backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, padding:14, color:Colors.t1, fontSize:15, marginBottom:16 },
  error:     { color:Colors.red, fontSize:13, marginBottom:12 },
  btn:       { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginBottom:16 },
  btnOff:    { opacity:0.4 },
  btnText:   { fontSize:16, fontWeight:"700", color:Colors.accentText },
  divider:   { alignItems:"center", marginVertical:16 },
  dividerText:{ color:Colors.t3, fontSize:13 },
  testBtn:   { backgroundColor:Colors.card, borderRadius:14, padding:14, alignItems:"center", borderWidth:1, borderColor:Colors.border },
  testBtnText:{ color:Colors.t2, fontSize:14 },
});
