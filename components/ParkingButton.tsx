import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Image, Linking, Platform, ActivityIndicator, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ParkingAPI, type ParkingLink } from "../services/parking";
import { useStrings } from "../hooks/useStrings";
import { Colors } from "../constants/colors";
import { SquareParking, X, HelpCircle, ExternalLink } from "lucide-react-native";

// A6 · "Pay for parking". Self-contained: the pill button + the provider sheet +
// the one-time help card. Drop <ParkingButton /> anywhere on a driver screen.
export default function ParkingButton({ style }: { style?: any }) {
  const { t } = useStrings();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<ParkingLink[] | null>(null);
  const [helpUrl, setHelpUrl] = useState<string | null>(null);
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
    // First-tap help: auto-show once, then mark seen so it never nags again.
    try {
      const h = await ParkingAPI.help();
      setHelpUrl(h.card_url);
      if (h.auto_show && h.card_url) { setHelpOpen(true); ParkingAPI.markHelpSeen(); }
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
                {!!helpUrl && (
                  <TouchableOpacity onPress={() => setHelpOpen(true)} hitSlop={10} style={s.iconBtn}>
                    <HelpCircle size={20} color={Colors.t2} strokeWidth={2} />
                  </TouchableOpacity>
                )}
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
          </SafeAreaView>
        </View>
      </Modal>

      {/* Full-screen help card (auto once, or via the "?" control) */}
      <Modal visible={helpOpen && !!helpUrl} animationType="fade" transparent onRequestClose={() => setHelpOpen(false)}>
        <Pressable style={s.cardBackdrop} onPress={() => setHelpOpen(false)}>
          {!!helpUrl && <Image source={{ uri: helpUrl }} style={s.card} resizeMode="contain" />}
          <TouchableOpacity style={s.cardClose} onPress={() => setHelpOpen(false)} hitSlop={12}>
            <X size={22} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  pill:        { flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start", backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14 },
  pillTxt:     { color: Colors.t1, fontWeight: "700", fontSize: 13.5 },
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet:       { backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 10 },
  grab:        { width: 38, height: 4, borderRadius: 3, backgroundColor: "#333", alignSelf: "center", marginBottom: 12 },
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
  cardBackdrop:{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)", alignItems: "center", justifyContent: "center", padding: 16 },
  card:        { width: "100%", height: "82%" },
  cardClose:   { position: "absolute", top: 54, right: 22 },
});
