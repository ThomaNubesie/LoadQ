import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Linking, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ParkingAPI, type ParkingLink } from "../services/parking";
import { useStrings } from "../hooks/useStrings";
import { Colors } from "../constants/colors";
import { SquareParking, X, HelpCircle, ExternalLink, Check } from "lucide-react-native";

// A6 · "Pay for parking". Self-contained: the pill button + the provider sheet +
// a native help card. Drop <ParkingButton /> anywhere on a driver screen.
export default function ParkingButton({ style }: { style?: any }) {
  const { t, lang } = useStrings();
  const fr = lang === "fr";
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<ParkingLink[] | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // Load providers on mount so the button hides entirely when an admin has
  // turned parking off (no active providers) — no dead button, no app release.
  useEffect(() => {
    let alive = true;
    ParkingAPI.list().then((l) => { if (alive) setLinks(l); }).catch(() => { if (alive) setLinks([]); });
    return () => { alive = false; };
  }, []);

  const openSheet = async () => {
    setOpen(true);
    setHelpOpen(false);
    // First-tap help: auto-show once, then mark seen so it never nags again.
    try {
      const h = await ParkingAPI.help();
      if (h.auto_show) { setHelpOpen(true); ParkingAPI.markHelpSeen(); }
    } catch { /* noop */ }
  };

  const openProvider = async (p: ParkingLink) => {
    const url = (Platform.OS === "ios" ? p.ios_url : p.android_url) || p.web_url;
    if (!url) return;
    try {
      const ok = await Linking.canOpenURL(url);
      await Linking.openURL(ok ? url : (p.web_url || url));
    } catch { /* the store link failed to open; nothing else to do */ }
  };

  // Native, bilingual help steps (no image → nothing can 404).
  const STEPS = fr
    ? ["Touchez Payer le stationnement pendant l'attente en file.",
       "Choisissez le fournisseur (ville / stationnement) dans la liste.",
       "Vous êtes dirigé vers l'app ou le site du fournisseur pour payer directement.",
       "Revenez sur LoadQ — votre place en file reste intacte."]
    : ["Tap Pay for parking while you wait in the queue.",
       "Pick your city / lot provider from the list.",
       "You're taken to the provider's app or site to pay them directly.",
       "Come back to LoadQ — your queue spot is untouched."];

  // Nothing to show until we know at least one provider is active.
  if (!links || links.length === 0) return null;

  return (
    <>
      <TouchableOpacity style={[s.pill, style]} onPress={openSheet} activeOpacity={0.85}>
        <SquareParking size={16} color={Colors.accent} strokeWidth={2.4} />
        <Text style={s.pillTxt}>{t.parkingBtn}</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={s.backdrop}>
          <SafeAreaView style={s.sheet} edges={["bottom"]}>
            <View style={s.grab} />
            <View style={s.head}>
              <Text style={s.title}>{t.parkingTitle}</Text>
              <View style={s.headActions}>
                <TouchableOpacity onPress={() => setHelpOpen(true)} hitSlop={10} style={s.iconBtn}>
                  <HelpCircle size={20} color={Colors.t2} strokeWidth={2} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10} style={s.iconBtn}>
                  <X size={20} color={Colors.t2} strokeWidth={2} />
                </TouchableOpacity>
              </View>
            </View>
            <Text style={s.sub}>{t.parkingSub}</Text>

            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {links === null ? (
                <ActivityIndicator color={Colors.accent} style={{ marginTop: 26 }} />
              ) : links.length === 0 ? (
                <Text style={s.empty}>{t.parkingNoProviders}</Text>
              ) : (
                links.map((p) => (
                  <TouchableOpacity key={p.id} style={s.row} onPress={() => openProvider(p)} activeOpacity={0.85}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowLabel}>{p.label}</Text>
                      {!!p.region && <Text style={s.rowRegion}>{p.region}</Text>}
                    </View>
                    <View style={s.openTag}>
                      <Text style={s.openTagTxt}>{t.parkingOpen}</Text>
                      <ExternalLink size={14} color={Colors.accent} strokeWidth={2.4} />
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <Text style={s.disclaimer}>{t.parkingDisclaimer}</Text>

            {/* Help card — an overlay INSIDE the sheet (not a 2nd Modal, which
                iOS won't stack). Reliable on both platforms. */}
            {helpOpen && (
              <View style={s.helpOverlay}>
                <View style={s.helpCard}>
                  <View style={s.helpTop}>
                    <SquareParking size={18} color={Colors.accentText} strokeWidth={2.4} />
                    <Text style={s.helpTopTxt}>{fr ? "Comment ça marche" : "How parking works"}</Text>
                    <TouchableOpacity onPress={() => setHelpOpen(false)} hitSlop={10} style={{ marginLeft: "auto" }}>
                      <X size={18} color={Colors.accentText} strokeWidth={2.4} />
                    </TouchableOpacity>
                  </View>
                  <View style={s.helpBody}>
                    {STEPS.map((step, i) => (
                      <View key={i} style={s.step}>
                        <View style={s.stepNum}><Text style={s.stepNumTxt}>{i + 1}</Text></View>
                        <Text style={s.stepTxt}>{step}</Text>
                      </View>
                    ))}
                    <View style={s.note}>
                      <Check size={14} color={Colors.green} strokeWidth={2.6} style={{ marginTop: 1 }} />
                      <Text style={s.noteTxt}>
                        {fr
                          ? "LoadQ ne facture pas le stationnement et ne prend aucune commission — vous payez le fournisseur directement."
                          : "LoadQ doesn't charge you for parking or take a cut — you pay the parking provider directly."}
                      </Text>
                    </View>
                    <TouchableOpacity style={s.helpBtn} onPress={() => setHelpOpen(false)} activeOpacity={0.85}>
                      <Text style={s.helpBtnTxt}>{fr ? "Compris" : "Got it"}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  pill:        { flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start", backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14 },
  pillTxt:     { color: Colors.t1, fontWeight: "700", fontSize: 13.5 },
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet:       { backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 10, overflow: "hidden" },
  grab:        { width: 38, height: 4, borderRadius: 3, backgroundColor: Colors.border, alignSelf: "center", marginBottom: 12 },
  head:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  iconBtn:     { padding: 4 },
  title:       { fontSize: 18, fontWeight: "800", color: Colors.t1 },
  sub:         { fontSize: 13, color: Colors.t2, marginTop: 4, marginBottom: 12, lineHeight: 18 },
  empty:       { color: Colors.t3, textAlign: "center", marginTop: 26, fontSize: 13 },
  row:         { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 9 },
  rowLabel:    { color: Colors.t1, fontWeight: "700", fontSize: 15 },
  rowRegion:   { color: Colors.t3, fontSize: 12, marginTop: 2 },
  openTag:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.accent, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  openTagTxt:  { color: Colors.accent, fontWeight: "800", fontSize: 12.5 },
  disclaimer:  { color: Colors.t3, fontSize: 11, lineHeight: 16, marginTop: 6, marginBottom: 6 },

  // Help overlay (inside the sheet)
  helpOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(10,11,14,0.55)", alignItems: "center", justifyContent: "center", padding: 18 },
  helpCard:    { width: "100%", backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 18, overflow: "hidden" },
  helpTop:     { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: Colors.accent, paddingHorizontal: 15, paddingVertical: 13 },
  helpTopTxt:  { color: Colors.accentText, fontWeight: "900", fontSize: 15 },
  helpBody:    { padding: 16 },
  step:        { flexDirection: "row", gap: 11, alignItems: "flex-start", marginBottom: 13 },
  stepNum:     { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  stepNumTxt:  { color: Colors.accent, fontWeight: "900", fontSize: 11 },
  stepTxt:     { flex: 1, color: Colors.t1, fontSize: 13, lineHeight: 18 },
  note:        { flexDirection: "row", gap: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 11, marginTop: 2 },
  noteTxt:     { flex: 1, color: Colors.t2, fontSize: 11.5, lineHeight: 16 },
  helpBtn:     { backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 12, alignItems: "center", marginTop: 14 },
  helpBtnTxt:  { color: Colors.accentText, fontWeight: "800", fontSize: 14 },
});
