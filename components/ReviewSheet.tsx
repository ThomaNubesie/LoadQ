// Reusable two-way review modal: stars + quick tags + written review.
// Used by both the passenger (rating the driver) and the driver (rating the rider).
import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Star, X } from "lucide-react-native";
import { Colors } from "../constants/colors";
import { useStrings } from "../hooks/useStrings";
import { ReviewsAPI } from "../services/reviews";

const DRIVER_TAGS = ["On time", "Friendly", "Clean car", "Safe driving", "Great music", "Helpful"];
const RIDER_TAGS = ["Ready on time", "Polite", "Easy pickup", "Respectful", "Clear address", "Great company"];

export default function ReviewSheet({
  visible, onClose, onDone, tripRef, tripKind, rateRole, counterparty,
}: {
  visible: boolean;
  onClose: () => void;
  onDone?: () => void;
  tripRef: string;
  tripKind: "scheduled" | "feeder";
  rateRole: "driver" | "passenger"; // who you're rating
  counterparty: string | null;
}) {
  const { lang } = useStrings();
  const fr = lang === "fr";
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const TAGS = rateRole === "driver" ? DRIVER_TAGS : RIDER_TAGS;

  const toggle = (t: string) => setTags((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);

  async function submit() {
    if (stars < 1) { Alert.alert(fr ? "Note" : "Rating", fr ? "Choisissez une note." : "Pick a star rating."); return; }
    setBusy(true);
    const res = await ReviewsAPI.submit(tripRef, tripKind, stars, tags, text.trim() || null);
    setBusy(false);
    if (res.error || !res.ok) { Alert.alert(fr ? "Note" : "Rating", res.error || "—"); return; }
    onDone?.(); onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.backdrop} behavior="padding">
        <View style={s.sheet}>
          <View style={s.head}>
            <Text style={s.title}>{rateRole === "driver" ? (fr ? "Évaluez le chauffeur" : "Rate your driver") : (fr ? "Évaluez le passager" : "Rate your rider")}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><X size={20} color={Colors.t2} /></TouchableOpacity>
          </View>
          {!!counterparty && <Text style={s.who}>{counterparty}</Text>}
          <View style={s.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <TouchableOpacity key={n} onPress={() => setStars(n)} hitSlop={6} activeOpacity={0.7}>
                <Star size={38} color={Colors.yellow} fill={n <= stars ? Colors.yellow : "transparent"} strokeWidth={1.5} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.tags}>
            {TAGS.map((t) => (
              <TouchableOpacity key={t} style={[s.tag, tags.includes(t) && s.tagOn]} onPress={() => toggle(t)} activeOpacity={0.8}>
                <Text style={[s.tagTxt, tags.includes(t) && s.tagTxtOn]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            value={text} onChangeText={setText} multiline
            placeholder={fr ? "Écrire un avis (optionnel)" : "Write a review (optional)"}
            placeholderTextColor={Colors.t3} style={s.review}
          />
          <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={Colors.accentText} /> : <Text style={s.btnTxt}>{fr ? "Envoyer" : "Submit review"}</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: Colors.t1, fontSize: 18, fontWeight: "800" },
  who: { color: Colors.t2, fontSize: 13, fontWeight: "700", textAlign: "center" },
  stars: { flexDirection: "row", justifyContent: "center", gap: 10, paddingVertical: 4 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  tag: { borderWidth: 1, borderColor: Colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: Colors.card },
  tagOn: { backgroundColor: "rgba(47,111,224,0.1)", borderColor: Colors.accent },
  tagTxt: { color: Colors.t2, fontWeight: "700", fontSize: 12 },
  tagTxtOn: { color: Colors.accent },
  review: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12, minHeight: 76, color: Colors.t1, fontSize: 14, textAlignVertical: "top" },
  btn: { backgroundColor: Colors.accent, borderRadius: 13, alignItems: "center", paddingVertical: 14 },
  btnTxt: { color: Colors.accentText, fontWeight: "800", fontSize: 15 },
});
