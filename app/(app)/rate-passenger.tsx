import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Star } from "lucide-react-native";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { ReviewsAPI } from "../../services/reviews";
import { getRegionName } from "../../constants/pricing";

// Raw tag keys sent to loadq_rate_passenger; labels localized via t().
const TAGS = [
  { key: "ready",        label: "ptag_ready" },
  { key: "polite",       label: "ptag_polite" },
  { key: "correct_fare", label: "ptag_correct_fare" },
  { key: "easy",         label: "ptag_easy" },
] as const;

function initials(name?: string): string {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function RatePassengerScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const { tripId, passengerName, dest } = useLocalSearchParams<{ tripId: string; passengerName?: string; dest?: string }>();

  const [stars, setStars] = useState(0);
  const [tags, setTags]   = useState<Set<string>>(new Set());
  const [note, setNote]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  function toggleTag(k: string) {
    setTags(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  async function submit() {
    if (!tripId) return;
    if (stars < 1) { setErr(t("ratePassengerTitle")); return; }
    setSubmitting(true); setErr(null);
    const res = await ReviewsAPI.submit(tripId, "board", stars, [...tags], note.trim() || null);
    setSubmitting(false);
    if (res.error || !res.ok) { setErr(res.error || "—"); return; }
    Alert.alert(t("ratingThanks"), undefined, [{ text: "OK", onPress: () => router.back() }]);
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}><ChevronLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{t("ratePassengerTitle")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <View style={s.who}>
          <View style={s.avatar}><Text style={s.avatarTxt}>{initials(passengerName)}</Text></View>
          <Text style={s.name}>{passengerName || "Passenger"}</Text>
          {!!dest && <Text style={s.route}>→ {getRegionName(String(dest))}</Text>}
        </View>

        <View style={s.stars}>
          {[1, 2, 3, 4, 5].map(n => (
            <TouchableOpacity key={n} onPress={() => { setStars(n); setErr(null); }} activeOpacity={0.7}>
              <Star size={38} color={n <= stars ? Colors.yellow : Colors.cardAlt} fill={n <= stars ? Colors.yellow : "transparent"} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.lbl}>{t("whatWentWell")}</Text>
        <View style={s.tags}>
          {TAGS.map(({ key, label }) => {
            const on = tags.has(key);
            return (
              <TouchableOpacity key={key} style={[s.tag, on && s.tagOn]} onPress={() => toggleTag(key)} activeOpacity={0.8}>
                <Text style={[s.tagTxt, on && s.tagTxtOn]}>{t(label)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TextInput style={s.note} placeholder={t("addNoteOptional")} placeholderTextColor={Colors.t3}
          value={note} onChangeText={setNote} multiline />

        {err && <Text style={s.err}>{err}</Text>}

        <TouchableOpacity style={[s.submit, (stars < 1 || submitting) && s.submitOff]} disabled={stars < 1 || submitting} onPress={submit} activeOpacity={0.85}>
          {submitting ? <ActivityIndicator color={Colors.accentText} /> : <Text style={s.submitTxt}>{t("submitRating")}</Text>}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: Colors.bg },
  header:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  back:     { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  title:    { color: Colors.t1, fontSize: 16, fontWeight: "800" },
  who:      { alignItems: "center", marginTop: 8 },
  avatar:   { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  avatarTxt:{ color: Colors.t1, fontWeight: "800", fontSize: 20 },
  name:     { color: Colors.t1, fontSize: 17, fontWeight: "800" },
  route:    { color: Colors.t3, fontSize: 12.5, marginTop: 3 },
  stars:    { flexDirection: "row", justifyContent: "center", gap: 8, marginVertical: 18 },
  lbl:      { color: Colors.t3, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase", textAlign: "center", marginBottom: 10 },
  tags:     { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  tag:      { borderWidth: 1, borderColor: Colors.border, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7 },
  tagOn:    { backgroundColor: "rgba(76,130,240,0.14)", borderColor: Colors.accent },
  tagTxt:   { color: Colors.t2, fontSize: 12.5, fontWeight: "600" },
  tagTxtOn: { color: Colors.accent },
  note:     { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12, color: Colors.t1, fontSize: 14, height: 74, marginTop: 16, textAlignVertical: "top" },
  err:      { color: Colors.red, fontSize: 12, marginTop: 10, textAlign: "center" },
  submit:   { backgroundColor: Colors.accent, borderRadius: 13, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  submitOff:{ opacity: 0.5 },
  submitTxt:{ color: Colors.accentText, fontWeight: "800", fontSize: 15 },
});
