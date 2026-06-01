import { useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { DriversAPI } from "../../services/drivers";
import { PassengersAPI } from "../../services/passengers";
import { resolveHome } from "../../services/authRoute";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

export default function OTPScreen() {
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const { t }  = useStrings();
  const { phone, isEmail, role, mode } = useLocalSearchParams<{ phone: string; isEmail?: string; role?: "driver" | "passenger"; mode?: "signin" | "signup" }>();
  const isSignIn = mode === "signin";
  const intendedRole: "driver" | "passenger" = role === "passenger" ? "passenger" : "driver";
  const [otp,     setOtp]     = useState(["","","","","",""]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const inputs       = useRef<TextInput[]>([]);
  const verifyingRef = useRef(false);
  const verifiedCode = useRef<string | null>(null);

  const handleChange = (val: string, idx: number) => {
    if (val.length === 6) {
      const digits = val.split("");
      setOtp(digits);
      handleVerify(val);
      return;
    }
    const next = [...otp];
    next[idx] = val;
    setOtp(next);
    if (val && idx < 5) inputs.current[idx + 1]?.focus();
    if (next.every(d => d !== "")) handleVerify(next.join(""));
  };

  const handleVerify = async (code: string) => {
    if (code.length !== 6) return;
    // Guard against re-entry (autofill triggers onChangeText per character,
    // which can fire handleVerify more than once for the same 6-digit code;
    // the second call hits "token expired" because the token was consumed).
    if (verifyingRef.current) return;
    if (verifiedCode.current === code) return;
    verifyingRef.current = true;

    setLoading(true);
    setError("");

    let verifyError = null;
    if (isEmail === "true") {
      const { error } = await supabase.auth.verifyOtp({ email: phone, token: code, type: "email" });
      verifyError = error;
    } else {
      const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
      verifyError = error;
    }

    if (verifyError) {
      verifyingRef.current = false;
      setError(verifyError.message);
      setLoading(false);
      return;
    }

    verifiedCode.current = code;

    // Does this account already exist on either side?
    const [driver, passenger] = await Promise.all([
      DriversAPI.getMe(),
      PassengersAPI.getMe(),
    ]);
    const hasAccount = !!(driver || passenger);

    setLoading(false);

    // Sign-in, OR an already-registered account regardless of which role
    // button was tapped: send them wherever they actually belong. This is
    // what makes returning users "remembered" and removes the old hard
    // role-mismatch lockout.
    if (isSignIn || hasAccount) {
      router.replace(await resolveHome());
      return;
    }

    // Brand-new account from the sign-up flow → start the chosen role's setup.
    router.replace(intendedRole === "passenger" ? "/(auth)/passenger-setup" : "/(auth)/profile-setup");
  };

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
      >
      <View style={s.inner}>
        <TouchableOpacity onPress={() => router.replace("/(auth)/sign-in")} style={s.backBtn}>
          <Text style={s.backText}>← {t.back}</Text>
        </TouchableOpacity>
        <Text style={s.logo}>LOADQ</Text>
        <Text style={s.title}>{t.verifyCode}</Text>
        <Text style={s.sub}>{t.codeSentTo}{" "}<Text style={{ color:Colors.accent }}>{phone}</Text></Text>

        <View style={s.otpRow}>
          {otp.map((digit, i) => (
            <TextInput
              key={i}
              ref={r => { if (r) inputs.current[i] = r; }}
              style={[s.otpBox, digit && s.otpBoxFilled, !!error && s.otpBoxError]}
              value={digit}
              onChangeText={v => handleChange(v, i)}
              onKeyPress={e => { if (e.nativeEvent.key === "Backspace" && !otp[i] && i > 0) inputs.current[i-1]?.focus(); }}
              keyboardType="number-pad"
              maxLength={i === 0 ? 6 : 1}
              selectTextOnFocus
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
            />
          ))}
        </View>

        {!!error  && <Text style={s.error}>{error}</Text>}
        {loading  && <Text style={s.loading}>{t.loading}</Text>}

        <TouchableOpacity
          style={[s.btn, (otp.some(d => !d) || loading) && s.btnOff]}
          onPress={() => handleVerify(otp.join(""))}
          disabled={otp.some(d => !d) || loading}
          activeOpacity={0.85}
        >
          <Text style={s.btnText}>{t.verifyCode} →</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace("/(auth)/sign-in")} style={s.wrongNum}>
          <Text style={s.wrongNumText}>← {isEmail === "true" ? t.wrongEmail : t.wrongNumber}</Text>
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:    { flex:1, backgroundColor:Colors.bg },
  inner:        { flex:1, padding:24, justifyContent:"center" },
  backBtn:      { position:"absolute", top:60, left:24 },
  backText:     { color:Colors.t2, fontSize:14 },
  logo:         { fontSize:24, fontWeight:"900", color:Colors.accent, letterSpacing:3, marginBottom:24 },
  title:        { fontSize:24, fontWeight:"700", color:Colors.t1, marginBottom:8 },
  sub:          { fontSize:14, color:Colors.t2, marginBottom:36, lineHeight:22 },
  otpRow:       { flexDirection:"row", gap:10, marginBottom:20 },
  otpBox:       { width:46, height:56, borderRadius:12, borderWidth:2, borderColor:Colors.border, backgroundColor:Colors.card, fontSize:22, fontWeight:"800", color:Colors.t1, textAlign:"center" },
  otpBoxFilled: { borderColor:Colors.accent },
  otpBoxError:  { borderColor:Colors.red },
  error:        { color:Colors.red, fontSize:13, marginBottom:16 },
  loading:      { color:Colors.t2, fontSize:13, marginBottom:16 },
  btn:          { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginBottom:16 },
  btnOff:       { opacity:0.4 },
  btnText:      { fontSize:16, fontWeight:"700", color:Colors.accentText },
  wrongNum:     { alignItems:"center", padding:8 },
  wrongNumText: { color:Colors.t3, fontSize:13 },
});
