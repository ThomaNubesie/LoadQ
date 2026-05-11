import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { AuthAPI } from "../../services/auth";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

export default function SignInScreen() {
  const router = useRouter();
  const { t }  = useStrings();
  const [phone,   setPhone]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const formatPhone = (val: string) => {
    const d = val.replace(/\D/g, "");
    if (d.length <= 3)  return d;
    if (d.length <= 6)  return `(${d.slice(0,3)}) ${d.slice(3)}`;
    return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,10)}`;
  };

  const handleSend = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setError("Please enter a valid 10-digit number"); return; }
    setLoading(true); setError("");
    const { error: err } = await AuthAPI.sendOTP("+1" + digits);
    setLoading(false);
    if (err) { setError(err); return; }
    router.push({ pathname:"/(auth)/otp", params:{ phone: "+1" + digits } });
  };

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={s.inner} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Text style={s.logo}>LOADQ</Text>
        <Text style={s.title}>{t.signIn}</Text>
        <Text style={s.sub}>{t.phoneNumber}</Text>

        <View style={s.inputRow}>
          <View style={s.dialBadge}><Text style={s.dialText}>🇨🇦 +1</Text></View>
          <TextInput
            style={s.input}
            value={phone}
            onChangeText={v => { setPhone(formatPhone(v)); setError(""); }}
            placeholder="(613) 555-0100"
            placeholderTextColor={Colors.t3}
            keyboardType="phone-pad"
            maxLength={14}
          />
        </View>

        {!!error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity
          style={[s.btn, (phone.replace(/\D/g,"").length < 10 || loading) && s.btnOff]}
          onPress={handleSend}
          disabled={phone.replace(/\D/g,"").length < 10 || loading}
          activeOpacity={0.85}
        >
          <Text style={s.btnText}>{loading ? t.loading : t.sendCode + " →"}</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:Colors.bg },
  inner:     { flex:1, padding:24, justifyContent:"center" },
  logo:      { fontSize:28, fontWeight:"900", color:Colors.accent, letterSpacing:3, marginBottom:28 },
  title:     { fontSize:26, fontWeight:"700", color:Colors.t1, marginBottom:8 },
  sub:       { fontSize:14, color:Colors.t2, marginBottom:32 },
  inputRow:  { flexDirection:"row", alignItems:"center", backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, marginBottom:16, overflow:"hidden" },
  dialBadge: { paddingHorizontal:14, paddingVertical:16, borderRightWidth:1, borderRightColor:Colors.border },
  dialText:  { color:Colors.t1, fontSize:14, fontWeight:"600" },
  input:     { flex:1, padding:16, color:Colors.t1, fontSize:16 },
  error:     { color:Colors.red, fontSize:13, marginBottom:12 },
  btn:       { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center" },
  btnOff:    { opacity:0.4 },
  btnText:   { fontSize:16, fontWeight:"700", color:Colors.accentText },
});
