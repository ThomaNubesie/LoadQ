// Theme selector (Light / Dark / Azure). Applying reloads the app so every
// StyleSheet re-creates with the new palette. Drop <ThemePicker /> in a profile.
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Colors } from "../constants/colors";
import { useStrings } from "../hooks/useStrings";
import { currentTheme, setTheme, ThemeName } from "../services/theme";

export default function ThemePicker() {
  const { lang } = useStrings();
  const fr = lang === "fr";
  const cur = currentTheme();
  const OPTS: { key: ThemeName; label: string; swatch: string }[] = [
    { key: "light", label: fr ? "Clair" : "Light", swatch: "#FAF6EF" },
    { key: "dark", label: fr ? "Sombre" : "Dark", swatch: "#15171C" },
    { key: "azure", label: "Azure", swatch: "#1B2740" },
  ];

  const pick = (t: ThemeName) => {
    if (t === cur) return;
    Alert.alert(
      fr ? "Changer de thème" : "Change theme",
      fr ? "L'application va se recharger pour appliquer le thème." : "The app will reload to apply the theme.",
      [
        { text: fr ? "Annuler" : "Cancel", style: "cancel" },
        { text: fr ? "Appliquer" : "Apply", onPress: () => { setTheme(t); } },
      ],
    );
  };

  return (
    <View style={s.wrap}>
      <Text style={s.label}>{fr ? "Thème" : "Theme"}</Text>
      <View style={s.seg}>
        {OPTS.map((o) => {
          const on = o.key === cur;
          return (
            <TouchableOpacity key={o.key} style={[s.opt, on && s.optOn]} onPress={() => pick(o.key)} activeOpacity={0.85}>
              <View style={[s.swatch, { backgroundColor: o.swatch }]} />
              <Text style={[s.optTxt, on && s.optTxtOn]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 6 },
  label: { color: Colors.t2, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginLeft: 2 },
  seg: { flexDirection: "row", gap: 8 },
  opt: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12, paddingVertical: 11 },
  optOn: { borderColor: Colors.accent },
  swatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1, borderColor: "rgba(128,128,128,0.35)" },
  optTxt: { color: Colors.t2, fontWeight: "800", fontSize: 12.5 },
  optTxtOn: { color: Colors.accent },
});
