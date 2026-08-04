// Unattended proof-of-delivery. After scanning a DELIVERY parcel with no answer,
// the courier photographs the drop (door+unit / side / building) + notes, then
// submits -> kolis-deliver-proof marks delivered and emails/SMSes the Kolis card
// to sender + recipient. No distance gate.
import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Alert, ActivityIndicator, Image, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { ChevronLeft, Camera } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import { KolisAPI } from "../../services/kolis";

const PINK = "#E6127A";
type Kind = "door" | "side" | "building";
type Shot = { uri?: string; url?: string; busy?: boolean };

export default function KolisProofScreen() {
  const router = useRouter();
  const { lang } = useStrings();
  const fr = lang === "fr";
  const insets = useSafeAreaInsets();
  const { parcelId, code, from, to, addr } = useLocalSearchParams<{ parcelId: string; code?: string; from?: string; to?: string; addr?: string }>();

  const [photos, setPhotos] = useState<Record<Kind, Shot>>({ door: {}, side: {}, building: {} });
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const label = (k: Kind) => k === "door" ? (fr ? "Porte + colis + nº d'unité" : "Door + package + unit #")
    : k === "side" ? (fr ? "Vue de côté" : "Side view") : (fr ? "Immeuble" : "Building");

  async function capture(kind: Kind) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert(fr ? "Caméra" : "Camera", fr ? "Autorisez la caméra pour photographier la livraison." : "Camera permission is needed to photograph the delivery."); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    const uri = r.assets[0].uri;
    setPhotos(p => ({ ...p, [kind]: { uri, busy: true } }));
    const up = await KolisAPI.uploadProofPhoto(String(parcelId), uri, kind);
    if (up.error || !up.url) { setPhotos(p => ({ ...p, [kind]: { uri } })); Alert.alert(fr ? "Téléversement" : "Upload", up.error || (fr ? "Échec du téléversement" : "Upload failed")); return; }
    setPhotos(p => ({ ...p, [kind]: { uri, url: up.url } }));
  }

  const doorReady = !!photos.door.url;
  const anyBusy = !!(photos.door.busy || photos.side.busy || photos.building.busy);

  async function submit() {
    if (!doorReady) { Alert.alert(fr ? "Photos" : "Photos", fr ? "Prenez d'abord la photo de la porte." : "Take the door photo first."); return; }
    setSubmitting(true);
    let lat: number | null = null, lng: number | null = null;
    try { const loc = await Location.getCurrentPositionAsync({}); lat = loc.coords.latitude; lng = loc.coords.longitude; } catch { /* best effort */ }
    const r = await KolisAPI.submitDeliveryProof(String(parcelId), {
      door_url: photos.door.url!, side_url: photos.side.url, building_url: photos.building.url,
      notes: notes.trim() || undefined, unit: unit.trim() || undefined, lat, lng,
    });
    setSubmitting(false);
    if (!r.ok) { Alert.alert("Kolis", r.error || (fr ? "Impossible d'envoyer la preuve." : "Couldn't submit proof.")); return; }
    Alert.alert("Kolis", fr ? "Livré — preuve envoyée à l'expéditeur et au destinataire." : "Delivered — proof sent to sender & recipient.",
      [{ text: "OK", onPress: () => router.replace("/(app)/kolis-carrying" as any) }]);
  }

  const Tile = ({ kind, big }: { kind: Kind; big?: boolean }) => {
    const ph = photos[kind];
    return (
      <TouchableOpacity onPress={() => capture(kind)} activeOpacity={0.85}
        style={[big ? s.mainTile : s.smTile, ph.url ? { borderColor: Colors.green, borderStyle: "solid" } : null]}>
        {ph.uri ? <Image source={{ uri: ph.uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" /> : null}
        {ph.busy ? <ActivityIndicator color="#fff" />
          : ph.url ? <View style={s.doneBadge}><Text style={s.doneTxt}>✓</Text></View>
          : (
            <View style={{ alignItems: "center", gap: 6 }}>
              <View style={big ? s.camBig : s.camSm}><Camera size={big ? 20 : 15} color="#fff" /></View>
              <Text style={s.tileTxt}>{label(kind)}</Text>
              {big ? <Text style={s.tileSub}>{fr ? "Colis à la porte, nº d'unité visible" : "Package at the door, unit number visible"}</Text> : null}
            </View>
          )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}><ChevronLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{fr ? "Preuve de livraison" : "Proof of delivery"}</Text>
        <View style={s.kchip}><Text style={s.kchipTxt}>KOLIS</Text></View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}>
        <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
          {!!code && (
            <View style={s.parcel}>
              <Text><Text style={s.pcode}>{code}</Text><Text style={s.pmeta}>{from && to ? `  ·  ${from} → ${to}` : ""}</Text></Text>
              {!!addr && <Text style={s.pmeta2}>{addr}</Text>}
            </View>
          )}
          <View style={s.noans}>
            <Text style={s.noansB}>{fr ? "Pas de réponse ?" : "No answer?"}</Text>
            <Text style={s.noansP}>{fr ? "Laissez le colis en sécurité et photographiez-le. L'expéditeur et le destinataire reçoivent la preuve." : "Leave it safely at the door and photograph it. Sender & recipient get proof instantly."}</Text>
          </View>

          <Text style={s.lbl}>{fr ? "Photos requises" : "Required photos"}</Text>
          <Tile kind="door" big />
          <View style={s.two}><Tile kind="side" /><Tile kind="building" /></View>

          <Text style={s.lbl}>{fr ? "Nº d'unité (optionnel)" : "Unit number (optional)"}</Text>
          <TextInput style={s.input} value={unit} onChangeText={setUnit} placeholder={fr ? "ex. 252" : "e.g. 252"} placeholderTextColor={Colors.t3} keyboardType="default" />

          <Text style={s.lbl}>{fr ? "Notes (optionnel)" : "Notes (optional)"}</Text>
          <TextInput style={s.note} value={notes} onChangeText={setNotes} multiline
            placeholder={fr ? "ex. Appelé deux fois, sans réponse. Laissé à la porte…" : "e.g. Called twice, no answer. Left by the door…"} placeholderTextColor={Colors.t3} />

          <TouchableOpacity style={[s.submit, (!doorReady || submitting || anyBusy) && { opacity: 0.5 }]} disabled={!doorReady || submitting || anyBusy} onPress={submit} activeOpacity={0.85}>
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text style={s.submitTxt}>{fr ? "Envoyer la preuve" : "Submit proof"}{code ? ` → ${code}` : ""}</Text>
                <Text style={s.submitSub}>{fr ? "Marque livré · envoie la carte aux deux" : "Marks delivered · emails the card to both"}</Text>
              </>
            )}
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
  kchip:    { backgroundColor: PINK, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  kchipTxt: { color: "#fff", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  parcel:   { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 11, marginBottom: 12 },
  pcode:    { color: PINK, fontWeight: "800", fontSize: 13 },
  pmeta:    { color: Colors.t2, fontSize: 11.5 },
  pmeta2:   { color: Colors.t2, fontSize: 11.5, marginTop: 3 },
  noans:    { backgroundColor: "rgba(230,18,122,0.10)", borderWidth: 1, borderColor: "rgba(230,18,122,0.35)", borderRadius: 11, padding: 11, marginBottom: 14 },
  noansB:   { color: "#fff", fontSize: 12.5, fontWeight: "800" },
  noansP:   { color: Colors.t2, fontSize: 11, marginTop: 2, lineHeight: 15 },
  lbl:      { color: Colors.t3, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase", marginBottom: 8, marginTop: 4 },
  mainTile: { height: 150, borderWidth: 1.5, borderColor: PINK, borderStyle: "dashed", borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 9, overflow: "hidden", backgroundColor: Colors.surface },
  two:      { flexDirection: "row", gap: 9, marginBottom: 6 },
  smTile:   { flex: 1, height: 92, borderWidth: 1.5, borderColor: Colors.border, borderStyle: "dashed", borderRadius: 12, alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: Colors.card },
  camBig:   { width: 38, height: 38, borderRadius: 11, backgroundColor: PINK, alignItems: "center", justifyContent: "center" },
  camSm:    { width: 28, height: 28, borderRadius: 9, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  tileTxt:  { color: Colors.t1, fontSize: 12, fontWeight: "700" },
  tileSub:  { color: Colors.t3, fontSize: 10 },
  doneBadge:{ position: "absolute", top: 7, right: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.green, alignItems: "center", justifyContent: "center" },
  doneTxt:  { color: "#08130d", fontWeight: "900", fontSize: 13 },
  input:    { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12, color: Colors.t1, fontSize: 14, marginBottom: 6 },
  note:     { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12, color: Colors.t1, fontSize: 14, height: 74, textAlignVertical: "top", marginBottom: 8 },
  submit:   { backgroundColor: PINK, borderRadius: 13, paddingVertical: 13, alignItems: "center", marginTop: 12 },
  submitTxt:{ color: "#fff", fontWeight: "800", fontSize: 14 },
  submitSub:{ color: "rgba(255,255,255,0.85)", fontWeight: "600", fontSize: 10, marginTop: 2 },
});
