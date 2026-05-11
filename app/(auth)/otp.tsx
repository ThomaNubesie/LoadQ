import { useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { DriversAPI } from "../../services/drivers";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

export default function OTPScreen() {
  const router = useRouter();
  const { t }  = useStrings();
  const { phone, isEmail } = useLocalSearchParams<{ phone: string; isEmail?: string }>();
  const [otp,     setOtp]     = useState(["","","","","",""]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const inputs = useRef<TextInput[]>([]);

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

    if (verifyError) { setError(verifyError.message); setLoading(false); return; }

    const driver = await DriversAPI.getMe();
    setLoading(false);

    if (!driver || !driver.full_name) {
      router.replace("/(auth)/profile-setup");
    } else {
      const hasSub = await DriversAPI.hasActiveSubscription();
      router.replace(hasSub ? "/(app)/zone-select" : "/(auth)/subscribe");
    }
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.inner}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
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

        <TouchableOpacity onPress={() => router.back()} style={s.wrongNum}>
          <Text style={s.wrongNumText}>← {t.wrongNumber}</Text>
        </TouchableOpacity>
      </View>
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
