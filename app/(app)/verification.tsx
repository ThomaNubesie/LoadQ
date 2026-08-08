import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Modal, Pressable, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { ArrowLeft, Camera, Images, FileText, ShieldCheck, Car, CheckCircle2, Clock3, XCircle, AlertTriangle, X } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import { DriverDocsAPI, DOC_TYPES, DocType, DriverDoc } from "../../services/driverDocs";
import VerifiedBadge from "../../components/VerifiedBadge";
import BottomNav from "../../components/BottomNav";

const ICONS: Record<DocType, any> = { drivers_license: FileText, insurance: ShieldCheck, registration: Car };

export default function VerificationScreen() {
  const router = useRouter();
  const { t, lang } = useStrings();
  const [docs, setDocs] = useState<Record<string, DriverDoc>>({});
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<DocType | null>(null);

  // Photo-source + expiry sheet state for the doc currently being uploaded.
  const [sheetFor, setSheetFor] = useState<DocType | null>(null);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [expiry, setExpiry] = useState("");

  const label: Record<DocType, string> = {
    drivers_license: t.docDriversLicense,
    insurance: t.docInsurance,
    registration: t.docRegistration,
  };

  const load = useCallback(async () => {
    try {
      const { docs, verified } = await DriverDocsAPI.getMine();
      const map: Record<string, DriverDoc> = {};
      for (const d of docs) map[d.doc_type] = d;
      setDocs(map);
      setVerified(verified);
    } catch { /* offline / not signed in — leave empty */ }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const approvedCount = DOC_TYPES.filter((dt) => docs[dt]?.status === "approved").length;

  const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { year: "numeric", month: "short", day: "numeric" });

  // ── Picking & uploading ────────────────────────────────────────────────
  const pick = async (source: "camera" | "library") => {
    const docType = sheetFor;
    if (!docType) return;
    if (source === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert(t.permissionNeeded, t.docCameraPerm); return; }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert(t.permissionNeeded, t.photoPermissionBody); return; }
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, allowsEditing: false };
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets?.[0]?.uri) return;
    // Move to the expiry step (prefill with any existing expiry).
    setPendingUri(result.assets[0].uri);
    setExpiry(docs[docType]?.expires_on ?? "");
  };

  const submit = async (withExpiry: boolean) => {
    const docType = sheetFor;
    if (!docType || !pendingUri) return;
    const iso = withExpiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry.trim()) ? expiry.trim() : null;
    const uri = pendingUri;
    setSheetFor(null); setPendingUri(null); setExpiry("");
    setBusy(docType);
    const { error } = await DriverDocsAPI.upload(docType, uri, iso);
    setBusy(null);
    if (error) { Alert.alert(t.error, error); return; }
    await load();
  };

  const closeSheet = () => { setSheetFor(null); setPendingUri(null); setExpiry(""); };

  // ── Render helpers ─────────────────────────────────────────────────────
  const statusMeta = (dt: DocType): { text: string; color: string; Icon: any } => {
    const st = docs[dt]?.status;
    if (st === "approved") return { text: t.docApproved, color: Colors.green, Icon: CheckCircle2 };
    if (st === "pending")  return { text: t.docPending, color: Colors.yellow, Icon: Clock3 };
    if (st === "rejected") return { text: t.docRejected, color: Colors.red, Icon: XCircle };
    if (st === "expired")  return { text: t.docExpired, color: Colors.red, Icon: AlertTriangle };
    return { text: t.docNotSubmitted, color: Colors.t3, Icon: FileText };
  };

  const ctaLabel = (dt: DocType): string => {
    const st = docs[dt]?.status;
    if (!st) return t.docUpload;
    if (st === "approved") return t.docReplace;
    if (st === "rejected" || st === "expired") return t.docReupload;
    return t.docReplace;
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}><ArrowLeft size={20} color={Colors.t2} strokeWidth={2} /></TouchableOpacity>
        <Text style={s.title}>{t.verifTitle}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={s.inner}>
        {/* Overall status */}
        <View style={s.overall}>
          <View style={[s.ring, verified ? s.ringYes : s.ringNo]}>
            {verified ? <VerifiedBadge size={26} /> : <Text style={[s.ringTxt, { color: Colors.yellow }]}>{approvedCount}/3</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.overallLbl}>{verified ? t.verifVerified : t.verifNotVerified}</Text>
            <Text style={s.overallSub}>{verified ? t.verifAllSet : t(`verifApprovedCount`, { n: approvedCount })}</Text>
            {!verified && (
              <View style={s.prog}><View style={[s.progFill, { width: `${(approvedCount / 3) * 100}%` }]} /></View>
            )}
          </View>
        </View>

        {!verified && (
          <View style={s.gate}>
            <AlertTriangle size={15} color={Colors.accent} strokeWidth={2.2} />
            <Text style={s.gateTxt}>{t.verifGateBanner}</Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 28 }} />
        ) : (
          DOC_TYPES.map((dt) => {
            const doc = docs[dt];
            const meta = statusMeta(dt);
            const CardIcon = ICONS[dt];
            return (
              <View key={dt} style={s.card}>
                <View style={s.crow}>
                  <View style={s.cardIco}><CardIcon size={19} color={Colors.t2} strokeWidth={2} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.cname}>{label[dt]}</Text>
                    {doc?.status === "approved" && doc.expires_on
                      ? <Text style={s.cmeta}>{t("docExpiresOn", { date: fmtDate(doc.expires_on) })}</Text>
                      : doc?.status === "expired" && doc.expires_on
                      ? <Text style={[s.cmeta, { color: Colors.red }]}>{t("docExpiredOn", { date: fmtDate(doc.expires_on) })}</Text>
                      : doc?.submitted_at
                      ? <Text style={s.cmeta}>{t.docSubmitted}</Text>
                      : null}
                  </View>
                  <View style={[s.pill, { backgroundColor: meta.color + "22" }]}>
                    <meta.Icon size={12} color={meta.color} strokeWidth={2.4} />
                    <Text style={[s.pillTxt, { color: meta.color }]}>{meta.text}</Text>
                  </View>
                </View>

                {doc?.status === "rejected" && !!doc.review_notes && (
                  <View style={s.reason}><Text style={s.reasonTxt}>“{doc.review_notes}”</Text></View>
                )}

                {busy === dt ? (
                  <View style={[s.btn, s.btnBusy]}><ActivityIndicator size="small" color={Colors.accentText} /><Text style={s.btnTxt}>{t.docUploading}</Text></View>
                ) : doc?.status === "pending" ? (
                  <TouchableOpacity style={[s.btn, s.btnGhost]} onPress={() => setSheetFor(dt)} activeOpacity={0.85}>
                    <Text style={[s.btnTxt, { color: Colors.t1 }]}>{t.docReplace}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[s.btn, doc?.status === "approved" && s.btnGhost]} onPress={() => setSheetFor(dt)} activeOpacity={0.85}>
                    <Text style={[s.btnTxt, doc?.status === "approved" && { color: Colors.t1 }]}>{ctaLabel(dt)}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Source picker → expiry sheet */}
      <Modal visible={sheetFor !== null} transparent animationType="slide" onRequestClose={closeSheet}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={s.mOverlay} onPress={closeSheet} />
          <View style={s.mSheet}>
            <View style={s.mGrip} />
            <View style={s.mHead}>
              <Text style={s.mTitle}>{sheetFor ? label[sheetFor] : ""}</Text>
              <TouchableOpacity onPress={closeSheet} hitSlop={8}><X size={20} color={Colors.t3} /></TouchableOpacity>
            </View>

            {!pendingUri ? (
              <>
                <TouchableOpacity style={s.srcBtn} onPress={() => pick("camera")} activeOpacity={0.85}>
                  <Camera size={18} color={Colors.accent} strokeWidth={2} /><Text style={s.srcTxt}>{t.docTakePhoto}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.srcBtn} onPress={() => pick("library")} activeOpacity={0.85}>
                  <Images size={18} color={Colors.accent} strokeWidth={2} /><Text style={s.srcTxt}>{t.docChoosePhoto}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.mLabel}>{t.docAddExpiry}</Text>
                <TextInput style={s.mInput} value={expiry} onChangeText={setExpiry} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.t3} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
                <Text style={s.mHint}>{t.docExpiryHint}</Text>
                <TouchableOpacity style={s.mSave} onPress={() => submit(true)} activeOpacity={0.85}>
                  <Text style={s.mSaveTxt}>{t.docSave}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.mSkip} onPress={() => submit(false)} activeOpacity={0.85}>
                  <Text style={s.mSkipTxt}>{t.docSkip}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <BottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  title:       { fontSize: 17, fontWeight: "700", color: Colors.t1 },
  inner:       { padding: 20, paddingBottom: 80 },

  overall:     { flexDirection: "row", alignItems: "center", gap: 13, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border, borderRadius: 16, padding: 15, marginBottom: 14 },
  ring:        { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  ringNo:      { backgroundColor: Colors.yellow + "22", borderColor: Colors.yellow + "66" },
  ringYes:     { backgroundColor: Colors.green + "22", borderColor: Colors.green + "88" },
  ringTxt:     { fontSize: 15, fontWeight: "800" },
  overallLbl:  { fontSize: 15.5, fontWeight: "800", color: Colors.t1 },
  overallSub:  { fontSize: 12, color: Colors.t2, marginTop: 2 },
  prog:        { height: 5, borderRadius: 5, backgroundColor: Colors.cardAlt, marginTop: 8, overflow: "hidden" },
  progFill:    { height: "100%", borderRadius: 5, backgroundColor: Colors.yellow },

  gate:        { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: Colors.accent + "12", borderWidth: 1, borderColor: Colors.accent + "40", borderRadius: 12, padding: 12, marginBottom: 16 },
  gateTxt:     { flex: 1, color: "#ffd0ab", fontSize: 12.5, lineHeight: 17 },

  card:        { backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border, borderRadius: 14, padding: 14, marginBottom: 11 },
  crow:        { flexDirection: "row", alignItems: "center", gap: 12 },
  cardIco:     { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" },
  cname:       { fontSize: 14.5, fontWeight: "700", color: Colors.t1 },
  cmeta:       { fontSize: 11.5, color: Colors.t3, marginTop: 2 },
  pill:        { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20 },
  pillTxt:     { fontSize: 11, fontWeight: "800" },
  reason:      { marginTop: 11, backgroundColor: Colors.red + "17", borderWidth: 1, borderColor: Colors.red + "40", borderRadius: 10, padding: 10 },
  reasonTxt:   { color: "#ffb4b4", fontSize: 12, lineHeight: 17 },
  btn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 11, backgroundColor: Colors.accent, borderRadius: 11, paddingVertical: 11 },
  btnGhost:    { backgroundColor: "transparent", borderWidth: 1, borderColor: Colors.border },
  btnBusy:     { opacity: 0.85 },
  btnTxt:      { color: Colors.accentText, fontWeight: "800", fontSize: 13.5 },

  mOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  mSheet:      { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: Colors.border, padding: 18, paddingBottom: 30 },
  mGrip:       { width: 36, height: 4, borderRadius: 3, backgroundColor: Colors.border, alignSelf: "center", marginBottom: 12 },
  mHead:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  mTitle:      { color: Colors.t1, fontSize: 17, fontWeight: "800" },
  srcBtn:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border, borderRadius: 12, padding: 15, marginBottom: 10 },
  srcTxt:      { color: Colors.t1, fontSize: 14.5, fontWeight: "700" },
  mLabel:      { color: Colors.t3, fontSize: 10, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
  mInput:      { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 11, padding: 12, color: Colors.t1, fontSize: 15 },
  mHint:       { color: Colors.t3, fontSize: 11.5, marginTop: 6 },
  mSave:       { backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 14 },
  mSaveTxt:    { color: Colors.accentText, fontWeight: "800", fontSize: 14.5 },
  mSkip:       { paddingVertical: 12, alignItems: "center", marginTop: 2 },
  mSkipTxt:    { color: Colors.t3, fontSize: 13, fontWeight: "600" },
});
