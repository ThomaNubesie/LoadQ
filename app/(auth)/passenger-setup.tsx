import { useState } from "react";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { PassengersAPI } from "../../services/passengers";
import { ReferralAPI } from "../../services/referral";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

type Sex = "male" | "female" | "other";

export default function PassengerSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t }  = useStrings();
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [dob,       setDob]       = useState("");
  const [phone,     setPhone]     = useState("");
  const [sex,       setSex]       = useState<Sex | "">("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [invalid,   setInvalid]   = useState<Record<string, string>>({});

  const clearInvalid = (k: string) =>
    setInvalid(prev => (prev[k] ? { ...prev, [k]: "" } : prev));

  const formatDob = (val: string) => {
    const d = val.replace(/\D/g, "");
    if (d.length <= 2)  return d;
    if (d.length <= 4)  return `${d.slice(0,2)} / ${d.slice(2)}`;
    return `${d.slice(0,2)} / ${d.slice(2,4)} / ${d.slice(4,8)}`;
  };

  const parseDobIso = (val: string): string | null => {
    const d = val.replace(/\D/g, "");
    if (d.length !== 8) return null;
    const day   = d.slice(0, 2);
    const month = d.slice(2, 4);
    const year  = d.slice(4, 8);
    const test = new Date(`${year}-${month}-${day}`);
    if (Number.isNaN(test.getTime())) return null;
    return `${year}-${month}-${day}`;
  };

  const handleNext = async () => {
    setError("");
    const dobIso = parseDobIso(dob);
    const phoneDigits = phone.replace(/\D/g, "");
    const errs: Record<string, string> = {};
    if (!firstName.trim()) errs.firstName = t.fieldRequired;
    if (!lastName.trim())  errs.lastName  = t.fieldRequired;
    if (!dob.trim())       errs.dob = t.fieldRequired;
    else if (!dobIso)      errs.dob = t.invalidDob;
    if (!phone.trim())     errs.phone = t.fieldRequired;
    else if (phoneDigits.length < 10) errs.phone = t.invalidPhone;
    if (!sex)              errs.sex = t.selectAnOption;
    if (Object.keys(errs).length > 0) { setInvalid(errs); return; }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const referredBy = await ReferralAPI.consumePendingRef();
    const { error: err } = await PassengersAPI.createOrUpdate({
      full_name: `${firstName.trim()} ${lastName.trim()}`,
      phone: phoneDigits,
      ...(user?.email ? { email: user.email } : {}),
      ...(dobIso ? { dob: dobIso } : {}),
      ...(sex ? { sex } : {}),
      ...(referredBy && referredBy !== user?.id ? { referred_by: referredBy } : {}),
    });
    setLoading(false);
    if (err) {
      setError(`Couldn't save profile: ${err}`);
      return;
    }
    router.replace("/(passenger)/queue");
  };

  const SEX_OPTIONS: { key: Sex; label: string }[] = [
    { key: "male",   label: t.male   },
    { key: "female", label: t.female },
    { key: "other",  label: t.other  },
  ];

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
      >
      <ScrollView contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.replace("/(auth)/welcome")} style={s.backBtn}>
          <Text style={s.backText}>← {t.back}</Text>
        </TouchableOpacity>

        <Text style={s.logo}>LOADQ</Text>
        <Text style={s.title}>{t.passengerProfile}</Text>
        <Text style={s.sub}>{t.passengerProfileSub}</Text>

        <Text style={s.label}>{t.firstName.toUpperCase()}</Text>
        <TextInput style={[s.input, invalid.firstName && s.inputError]} value={firstName} onChangeText={v => { setFirstName(v); clearInvalid("firstName"); }} placeholder="Jean" placeholderTextColor={Colors.t3} autoCapitalize="words" />
        {!!invalid.firstName && <Text style={s.fieldMsg}>{invalid.firstName}</Text>}

        <Text style={s.label}>{t.lastName.toUpperCase()}</Text>
        <TextInput style={[s.input, invalid.lastName && s.inputError]} value={lastName} onChangeText={v => { setLastName(v); clearInvalid("lastName"); }} placeholder="Martin" placeholderTextColor={Colors.t3} autoCapitalize="words" />
        {!!invalid.lastName && <Text style={s.fieldMsg}>{invalid.lastName}</Text>}

        <Text style={s.label}>{t.dateOfBirth.toUpperCase()}</Text>
        <TextInput
          style={[s.input, invalid.dob && s.inputError]}
          value={dob}
          onChangeText={v => { setDob(formatDob(v)); clearInvalid("dob"); }}
          placeholder={t.dobPlaceholder}
          placeholderTextColor={Colors.t3}
          keyboardType="number-pad"
          maxLength={14}
        />
        {!!invalid.dob && <Text style={s.fieldMsg}>{invalid.dob}</Text>}

        <Text style={s.label}>{t.phoneNumber.toUpperCase()}</Text>
        <TextInput
          style={[s.input, invalid.phone && s.inputError]}
          value={phone}
          onChangeText={v => { setPhone(v); clearInvalid("phone"); }}
          placeholder={t.phonePlaceholder}
          placeholderTextColor={Colors.t3}
          keyboardType="phone-pad"
          maxLength={20}
        />
        {!!invalid.phone && <Text style={s.fieldMsg}>{invalid.phone}</Text>}

        <Text style={s.label}>{t.sex.toUpperCase()}</Text>
        <View style={s.sexRow}>
          {SEX_OPTIONS.map(o => (
            <TouchableOpacity
              key={o.key}
              style={[s.sexBtn, sex === o.key && s.sexBtnActive, invalid.sex && s.sexBtnError]}
              onPress={() => { setSex(o.key); clearInvalid("sex"); }}
              activeOpacity={0.8}
            >
              <Text style={[s.sexText, sex === o.key && s.sexTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {!!invalid.sex && <Text style={[s.fieldMsg, { marginTop:-16 }]}>{invalid.sex}</Text>}

        {!!error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity
          style={[s.btn, loading && s.btnOff]}
          onPress={handleNext}
          disabled={loading}
          activeOpacity={0.85}
        >
          <Text style={s.btnText}>{loading ? t.loading : t.next + " →"}</Text>
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex:1, backgroundColor:Colors.bg },
  inner:       { padding:24, paddingBottom:48, paddingTop:80 },
  backBtn:     { position:"absolute", top:52, left:24, zIndex:10 },
  backText:    { color:Colors.t2, fontSize:14 },
  logo:        { fontSize:24, fontWeight:"900", color:Colors.accent, letterSpacing:3, marginBottom:16 },
  title:       { fontSize:22, fontWeight:"700", color:Colors.t1, marginBottom:6 },
  sub:         { fontSize:13, color:Colors.t2, marginBottom:28, lineHeight:20 },
  label:       { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:6 },
  input:       { backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, padding:14, color:Colors.t1, fontSize:15, marginBottom:18 },
  inputError:  { borderColor:Colors.red, marginBottom:4 },
  fieldMsg:    { color:Colors.red, fontSize:12, marginBottom:14 },
  sexRow:      { flexDirection:"row", gap:10, marginBottom:24 },
  sexBtn:      { flex:1, padding:12, borderRadius:10, borderWidth:1, borderColor:Colors.border, backgroundColor:Colors.card, alignItems:"center" },
  sexBtnActive:{ borderColor:Colors.accent, backgroundColor:Colors.accent+"15" },
  sexBtnError: { borderColor:Colors.red },
  sexText:     { color:Colors.t2, fontSize:13, fontWeight:"600" },
  sexTextActive:{ color:Colors.accent },
  error:       { color:Colors.red, fontSize:13, marginBottom:12 },
  btn:         { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginTop:8 },
  btnOff:      { opacity:0.4 },
  btnText:     { fontSize:16, fontWeight:"700", color:Colors.accentText },
});
