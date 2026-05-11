import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { DriversAPI } from "../../services/drivers";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

export default function ProfileSetupScreen() {
  const router = useRouter();
  const { t }  = useStrings();
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [dob,       setDob]       = useState("");
  const [sex,       setSex]       = useState<"male"|"female"|"other"|"">("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");

  const formatDob = (val: string) => {
    const digits = val.replace(/\D/g, "");
    if (digits.length <= 2)  return digits;
    if (digits.length <= 4)  return `${digits.slice(0,2)} / ${digits.slice(2)}`;
    return `${digits.slice(0,2)} / ${digits.slice(2,4)} / ${digits.slice(4,8)}`;
  };

  const handleNext = async () => {
    if (!firstName.trim() || !lastName.trim()) { setError("Please enter your full name"); return; }
    setLoading(true);
    await DriversAPI.createOrUpdate({
      full_name: `${firstName.trim()} ${lastName.trim()}`,
    });
    setLoading(false);
    router.push("/(auth)/vehicle-setup");
  };

  const SEX_OPTIONS: { key: "male"|"female"|"other"; label: string }[] = [
    { key: "male",   label: t.male   },
    { key: "female", label: t.female },
    { key: "other",  label: t.other  },
  ];

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        <Text style={s.logo}>LOADQ</Text>
        <View style={s.stepRow}>
          <Text style={s.stepText}>1 {t.stepOf} 3</Text>
          <View style={s.stepBar}><View style={[s.stepFill, { width: "33%" }]} /></View>
        </View>
        <Text style={s.title}>{t.setupProfile}</Text>
        <Text style={s.sub}>{t.setupProfileSub}</Text>

        <Text style={s.label}>{t.firstName.toUpperCase()}</Text>
        <TextInput
          style={s.input}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="Jean"
          placeholderTextColor={Colors.t3}
          autoCapitalize="words"
        />

        <Text style={s.label}>{t.lastName.toUpperCase()}</Text>
        <TextInput
          style={s.input}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Martin"
          placeholderTextColor={Colors.t3}
          autoCapitalize="words"
        />

        <Text style={s.label}>{t.dateOfBirth.toUpperCase()}</Text>
        <TextInput
          style={s.input}
          value={dob}
          onChangeText={v => setDob(formatDob(v))}
          placeholder={t.dobPlaceholder}
          placeholderTextColor={Colors.t3}
          keyboardType="number-pad"
          maxLength={14}
        />

        <Text style={s.label}>{t.sex.toUpperCase()}</Text>
        <View style={s.sexRow}>
          {SEX_OPTIONS.map(o => (
            <TouchableOpacity
              key={o.key}
              style={[s.sexBtn, sex === o.key && s.sexBtnActive]}
              onPress={() => setSex(o.key)}
              activeOpacity={0.8}
            >
              <Text style={[s.sexBtnText, sex === o.key && s.sexBtnTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {!!error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity
          style={[s.btn, (!firstName || !lastName || loading) && s.btnDisabled]}
          onPress={handleNext}
          disabled={!firstName || !lastName || loading}
          activeOpacity={0.85}
        >
          <Text style={s.btnText}>{loading ? t.loading : t.next + " →"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: Colors.bg },
  inner:           { padding: 24, paddingBottom: 48 },
  logo:            { fontSize: 24, fontWeight: "900", color: Colors.accent, letterSpacing: 3, marginBottom: 16 },
  stepRow:         { marginBottom: 24 },
  stepText:        { color: Colors.t3, fontSize: 11, marginBottom: 6 },
  stepBar:         { height: 3, backgroundColor: Colors.border, borderRadius: 2 },
  stepFill:        { height: 3, backgroundColor: Colors.accent, borderRadius: 2 },
  title:           { fontSize: 22, fontWeight: "700", color: Colors.t1, marginBottom: 6 },
  sub:             { fontSize: 13, color: Colors.t2, marginBottom: 28, lineHeight: 20 },
  label:           { fontSize: 10, fontWeight: "700", color: Colors.t3, letterSpacing: 0.8, marginBottom: 6 },
  input:           { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 14, color: Colors.t1, fontSize: 15, marginBottom: 18 },
  sexRow:          { flexDirection: "row", gap: 10, marginBottom: 24 },
  sexBtn:          { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: "center" },
  sexBtnActive:    { borderColor: Colors.accent, backgroundColor: Colors.accent + "15" },
  sexBtnText:      { color: Colors.t2, fontSize: 13, fontWeight: "600" },
  sexBtnTextActive:{ color: Colors.accent },
  error:           { color: Colors.red, fontSize: 13, marginBottom: 12 },
  btn:             { backgroundColor: Colors.accent, borderRadius: 14, padding: 16, alignItems: "center", marginTop: 8 },
  btnDisabled:     { opacity: 0.4 },
  btnText:         { fontSize: 16, fontWeight: "700", color: Colors.accentText },
});
