import { useState } from "react";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { supabase } from "../../services/supabase";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

export default function SignInScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { t }   = useStrings();
  const { role, mode } = useLocalSearchParams<{ role?: "driver" | "passenger"; mode?: "signin" | "signup" }>();
  const isSignIn = mode === "signin";
  const intendedRole: "driver" | "passenger" = role === "passenger" ? "passenger" : "driver";
  const [email,        setEmail]        = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");

  // Soft launch: email-only auth. Phone/SMS is deferred until Twilio is on a
  // paid plan, so the phone path is intentionally not exposed here.
  const emailValid   = email.includes("@") && email.includes(".");
  const emailsMatch  = email.trim().toLowerCase() === confirmEmail.trim().toLowerCase();
  const canSend      = emailValid && confirmEmail.length > 0 && emailsMatch;

  const handleSend = async () => {
    if (!emailsMatch) { setError(t.emailsDoNotMatch); return; }
    setLoading(true); setError("");
    const addr = email.trim().toLowerCase();
    // Sign-in must NOT create accounts — an unknown email should fail so the
    // user is told to sign up, instead of silently spawning a duplicate.
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: !isSignIn },
    });
    setLoading(false);
    if (err) {
      const m = err.message.toLowerCase();
      if (isSignIn && (m.includes("not allowed") || m.includes("signups") || m.includes("not found"))) {
        setError(t.noAccountFound);
      } else {
        setError(err.message);
      }
      return;
    }
    router.push({ pathname:"/(auth)/otp", params:{ phone: addr, isEmail:"true", role: intendedRole, mode: isSignIn ? "signin" : "signup" } });
  };

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView
        style={s.inner}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
      >
        <TouchableOpacity onPress={() => router.replace("/(auth)/welcome")} style={s.backBtn}>
          <Text style={s.backText}>← {t.back}</Text>
        </TouchableOpacity>
        <Text style={s.logo}>LOADQ</Text>
        <Text style={s.title}>
          {isSignIn ? t.welcomeBack : intendedRole === "passenger" ? t.passengerSignup : t.driverSignup}
        </Text>
        {isSignIn && <Text style={s.subtitle}>{t.signInSub}</Text>}

        <Text style={s.label}>{t.emailAddress.toUpperCase()}</Text>
        <TextInput
          style={s.input}
          value={email}
          onChangeText={v => { setEmail(v); setError(""); }}
          placeholder="you@email.com"
          placeholderTextColor={Colors.t3}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={s.label}>{t.confirmEmail.toUpperCase()}</Text>
        <TextInput
          style={[s.input, confirmEmail.length > 0 && !emailsMatch && s.inputError]}
          value={confirmEmail}
          onChangeText={v => { setConfirmEmail(v); setError(""); }}
          placeholder="you@email.com"
          placeholderTextColor={Colors.t3}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {confirmEmail.length > 0 && !emailsMatch && (
          <Text style={s.fieldMsg}>{t.emailsDoNotMatch}</Text>
        )}

        {!!error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity
          style={[s.btn, (!canSend || loading) && s.btnOff]}
          onPress={handleSend}
          disabled={!canSend || loading}
          activeOpacity={0.85}
        >
          <Text style={s.btnText}>{loading ? t.loading : t.sendCode + " →"}</Text>
        </TouchableOpacity>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex:1, backgroundColor:Colors.bg },
  inner:       { flex:1, padding:24, justifyContent:"center" },
  backBtn:     { position:"absolute", top:60, left:24 },
  backText:    { color:Colors.t2, fontSize:14 },
  logo:        { fontSize:28, fontWeight:"900", color:Colors.accent, letterSpacing:3, marginBottom:28 },
  title:       { fontSize:26, fontWeight:"700", color:Colors.t1, marginBottom:24 },
  subtitle:    { fontSize:14, color:Colors.t2, marginTop:-16, marginBottom:24, lineHeight:20 },
  label:       { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:6 },
  input:       { backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, padding:14, color:Colors.t1, fontSize:15, marginBottom:16 },
  inputError:  { borderColor:Colors.red, marginBottom:4 },
  fieldMsg:    { color:Colors.red, fontSize:12, marginBottom:12 },
  phoneRow:    { flexDirection:"row", alignItems:"center", backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, marginBottom:16, overflow:"hidden" },
  dialBadge:   { paddingHorizontal:14, paddingVertical:14, borderRightWidth:1, borderRightColor:Colors.border },
  dialText:    { color:Colors.t1, fontSize:14, fontWeight:"600" },
  phoneInput:  { flex:1, padding:14, color:Colors.t1, fontSize:15 },
  error:       { color:Colors.red, fontSize:13, marginBottom:12 },
  btn:         { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginBottom:12 },
  btnOff:      { opacity:0.4 },
  btnText:     { fontSize:16, fontWeight:"700", color:Colors.accentText },
  altBtn:      { alignItems:"center", padding:10 },
  altText:     { color:Colors.accent, fontSize:13, fontWeight:"600" },
});
