import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Star } from "lucide-react-native";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { PassengerBoardAPI } from "../../services/passengerBoard";
import { getRegionName } from "../../constants/pricing";

// Raw tag keys sent to loadq_rate_driver; labels localized via t().
const TAGS = [
  { key: "on_time",      label: "tag_on_time" },
  { key: "safe_driving", label: "tag_safe_driving" },
  { key: "friendly",     label: "tag_friendly" },
  { key: "clean_car",    label: "tag_clean_car" },
  { key: "good_music",   label: "tag_good_music" },
] as const;

function initials(name?: string): string {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function RateScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const { tripId, driverName, dest } = useLocalSearchParams<{ tripId: string; driverName?: string; dest?: string }>();

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
    if (stars < 1) { setErr(t("rateRide")); return; }
    setSubmitting(true); setErr(null);
    const { error } = await PassengerBoardAPI.rateDriver(tripId, stars, [...tags], note.trim() || undefined);
    setSubmitting(false);
    if (error) { setErr(error); return; }
    Alert.alert(t("ratingThanks"), undefined, [{ text: "OK", onPress: () => router.replace("/(passenger)/board" as any) }]);
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}><ChevronLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{t("rateRide")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <View style={s.driver}>
          <View style={s.avatar}><Text style={s.avatarTxt}>{initials(driverName)}</Text></View>
          <Text style={s.name}>{driverName || t("newDriver")}</Text>
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

        <TextInput
          style={s.note}
          placeholder={t("addNoteOptional")}
          placeholderTextColor={Colors.t3}
          value={note}
          onChangeText={setNote}
          multiline
        />

        {err && <Text style={s.err}>{err}</Text>}

        <TouchableOpacity style={[s.submit, (stars < 1 || submitting) && s.submitOff]} disabled={stars < 1 || submitting} onPress={submit} activeOpacity={0.85}>
          {submitting ? <ActivityIndicator color={Colors.accentPText} /> : <Text style={s.submitTxt}>{t("submitRating")}</Text>}
        </TouchableOpacity>
        <Text style={s.foot}>{t("driverRatesYouToo")}</Text>
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
  driver:   { alignItems: "center", marginTop: 8 },
  avatar:   { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  avatarTxt:{ color: Colors.t1, fontWeight: "800", fontSize: 20 },
  name:     { color: Colors.t1, fontSize: 17, fontWeight: "800" },
  route:    { color: Colors.t3, fontSize: 12.5, marginTop: 3 },
  stars:    { flexDirection: "row", justifyContent: "center", gap: 8, marginVertical: 18 },
  lbl:      { color: Colors.t3, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase", textAlign: "center", marginBottom: 10 },
  tags:     { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  tag:      { borderWidth: 1, borderColor: Colors.border, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7 },
  tagOn:    { backgroundColor: "rgba(255,107,0,0.14)", borderColor: Colors.accentP },
  tagTxt:   { color: Colors.t2, fontSize: 12.5, fontWeight: "600" },
  tagTxtOn: { color: Colors.accentP },
  note:     { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12, color: Colors.t1, fontSize: 14, height: 74, marginTop: 16, textAlignVertical: "top" },
  err:      { color: Colors.red, fontSize: 12, marginTop: 10, textAlign: "center" },
  submit:   { backgroundColor: Colors.accentP, borderRadius: 13, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  submitOff:{ opacity: 0.5 },
  submitTxt:{ color: Colors.accentPText, fontWeight: "800", fontSize: 15 },
  foot:     { color: Colors.t3, fontSize: 10.5, textAlign: "center", marginTop: 10 },
});
