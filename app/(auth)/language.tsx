import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { useRouter } from "expo-router";
import { setLang } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { Lang, STRINGS } from "../../constants/i18n";

const LANGS: { code: Lang; label: string; flag: string; sub: string }[] = [
  { code: "en", label: "English",  flag: "🇨🇦", sub: "Continue in English"  },
  { code: "fr", label: "Français", flag: "🇫🇷", sub: "Continuer en français" },
];

export default function LanguageScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<Lang>("en");

  const handleContinue = async () => {
    await setLang(selected);
    router.replace("/(auth)/sign-in");
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.inner}>
        <View style={s.logoBox}>
          <Text style={s.logo}>LOADQ</Text>
          <Text style={s.logoSub}>Smart queue management</Text>
        </View>

        <Text style={s.title}>{STRINGS[selected].chooseLanguage}</Text>
        <Text style={s.sub}>{STRINGS[selected].langSub}</Text>

        <View style={s.options}>
          {LANGS.map(l => (
            <TouchableOpacity
              key={l.code}
              style={[s.option, selected === l.code && s.optionActive]}
              onPress={() => setSelected(l.code)}
              activeOpacity={0.8}
            >
              <Text style={s.flag}>{l.flag}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.langLabel, selected === l.code && s.langLabelActive]}>{l.label}</Text>
                <Text style={s.langSub}>{l.sub}</Text>
              </View>
              <View style={[s.radio, selected === l.code && s.radioActive]}>
                {selected === l.code && <View style={s.radioDot} />}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={s.btn} onPress={handleContinue} activeOpacity={0.85}>
          <Text style={s.btnText}>{STRINGS[selected].getStarted} →</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: Colors.bg },
  inner:           { flex: 1, padding: 24, justifyContent: "center" },
  logoBox:         { alignItems: "center", marginBottom: 48 },
  logo:            { fontSize: 36, fontWeight: "900", color: Colors.accent, letterSpacing: 4 },
  logoSub:         { fontSize: 13, color: Colors.t3, marginTop: 4, letterSpacing: 1 },
  title:           { fontSize: 22, fontWeight: "700", color: Colors.t1, marginBottom: 6 },
  sub:             { fontSize: 14, color: Colors.t2, marginBottom: 32, lineHeight: 22 },
  options:         { gap: 12, marginBottom: 40 },
  option:          { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: Colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.border },
  optionActive:    { borderColor: Colors.accent, backgroundColor: Colors.accent + "10" },
  flag:            { fontSize: 28 },
  langLabel:       { fontSize: 16, fontWeight: "600", color: Colors.t2 },
  langLabelActive: { color: Colors.t1 },
  langSub:         { fontSize: 11, color: Colors.t3, marginTop: 2 },
  radio:           { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.t3, alignItems: "center", justifyContent: "center" },
  radioActive:     { borderColor: Colors.accent },
  radioDot:        { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.accent },
  btn:             { backgroundColor: Colors.accent, borderRadius: 14, padding: 16, alignItems: "center" },
  btnText:         { fontSize: 16, fontWeight: "700", color: Colors.accentText },
});
