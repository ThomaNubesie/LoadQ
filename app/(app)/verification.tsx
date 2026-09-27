import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Modal, Pressable, TextInput, KeyboardAvoidingView, Platform, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { ArrowLeft, Camera, Images, FileText, ShieldCheck, Car, CheckCircle2, Clock3, XCircle, AlertTriangle, X, BadgeCheck, ScrollText, FileCheck, ClipboardCheck, MapPin, Phone, Globe } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import { DriverDocsAPI, DOC_TYPES, DocType, DriverDoc, ScreeningConsent, RequiredDoc, DocSource, DocCity, Province } from "../../services/driverDocs";
import VerifiedBadge from "../../components/VerifiedBadge";
import BottomNav from "../../components/BottomNav";

// Line icons, stroke-only and transparent, matching the three already on this screen — the
// document cards sit on the card background and a filled glyph would read as a sticker.
//
// Chosen to be legible as documents rather than decorative: an official verification, a
// record, an attested statement, an inspection result. NOTE: lucide 1.27 has no
// `FileSignature` or `Fingerprint` — importing either compiles and then crashes the screen.
const ICONS: Record<DocType, any> = {
  drivers_license:     FileText,       // the licence itself
  insurance:           ShieldCheck,    // cover
  registration:        Car,            // the vehicle permit
  police_record_check: BadgeCheck,     // an official check, cleared
  driving_record:      ScrollText,     // a record issued by the ministry
  charges_declaration: FileCheck,      // a statement the driver attests to
  safety_certificate:  ClipboardCheck, // an inspection, passed
};

export default function VerificationScreen() {
  const router = useRouter();
  const { t, lang } = useStrings();
  const [docs, setDocs] = useState<Record<string, DriverDoc>>({});
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<DocType | null>(null);
  const [consent, setConsent] = useState<ScreeningConsent | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  // What the City requires TODAY, fetched rather than compiled in — so a by-law change
  // reaches drivers without an App Store release.
  const [required, setRequired] = useState<RequiredDoc[] | null>(null);
  // Ontario and Québec issue different papers from different bodies. Asked once, then every
  // outstanding document says where that driver actually goes for it.
  const [province, setProvince] = useState<Province | null>(null);
  const [sources, setSources] = useState<Record<string, DocSource>>({});
  // A police record check is issued by the service that polices where the driver lives, so the
  // province alone sends someone in Laval to the SPVM. The list is this province's towns plus the
  // one across the river: an Ontario licence with a Gatineau address still needs the SPVG, but an
  // Ontario driver has no business being offered Laval or Longueuil.
  const [city, setCity] = useState<string>("");
  const [cities, setCities] = useState<DocCity[]>([]);
  // Ontario alone has a couple of dozen towns with their own police service, which is more than a
  // row of chips can carry. One button that opens a searchable list scales and reads better.
  const [cityOpen, setCityOpen] = useState(false);
  const [citySearch, setCitySearch] = useState("");

  // Photo-source + expiry sheet state for the doc currently being uploaded.
  const [sheetFor, setSheetFor] = useState<DocType | null>(null);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [expiry, setExpiry] = useState("");

  // The three original labels are translated in the app; anything the City adds later arrives
  // already worded, in both languages, from the server.
  const bundled: Partial<Record<DocType, string>> = {
    drivers_license: t.docDriversLicense,
    insurance: t.docInsurance,
    registration: t.docRegistration,
  };
  const labelFor = (dt: DocType) => {
    const r = required?.find((x) => x.doc_type === dt);
    return bundled[dt] ?? (lang === "fr" ? r?.label_fr : r?.label_en) ?? dt;
  };
  const helpFor = (dt: DocType) => {
    const r = required?.find((x) => x.doc_type === dt);
    return (lang === "fr" ? r?.help_fr : r?.help_en) ?? null;
  };
  // Offline, or before the first fetch, show the full set rather than a short one.
  const types: DocType[] = required?.length
    ? required.map((r) => r.doc_type)
    : DOC_TYPES;

  const refreshSources = async (p: Province, town: string) => {
    const list = await DriverDocsAPI.sources(p, town).catch(() => []);
    const byType: Record<string, DocSource> = {};
    for (const x of list) byType[x.doc_type] = x;
    setSources(byType);
  };

  const load = useCallback(async () => {
    try {
      const { docs, verified } = await DriverDocsAPI.getMine();
      const map: Record<string, DriverDoc> = {};
      for (const d of docs) map[d.doc_type] = d;
      setDocs(map);
      setVerified(verified);
      setConsent(await DriverDocsAPI.getConsent().catch(() => null));
      setRequired(await DriverDocsAPI.required().catch(() => null));
      const prov = await DriverDocsAPI.getProvince().catch(() => null);
      setProvince(prov);
      const town = await DriverDocsAPI.getCity().catch(() => "");
      setCity(town);
      // Loaded whether or not a province is on file: a driver choosing one for the first time has
      // to see the towns in the same breath.
      setCities(await DriverDocsAPI.sourceCities(prov ?? "ON").catch(() => []));
      if (prov) await refreshSources(prov, town);
    } catch { /* offline / not signed in — leave empty */ }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const approvedCount = types.filter((dt) => docs[dt]?.status === "approved").length;

  const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { year: "numeric", month: "short", day: "numeric" });

  // Consent gate: a driver must accept the verification consent before any
  // upload — it's the legal basis for the licence/registration/record checks.
  const openUpload = (dt: DocType) => {
    if (!consent) { Alert.alert(t.consentTitle, t.consentRequired); return; }
    setSheetFor(dt);
  };

  const agreeConsent = async () => {
    setConsentBusy(true);
    const { error } = await DriverDocsAPI.recordConsent();
    setConsentBusy(false);
    if (error) { Alert.alert(t.error, error); return; }
    setConsent(await DriverDocsAPI.getConsent().catch(() => null));
  };

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

  // Every document type here carries an expiry date, and the server now rejects a
  // submission without one (loadq_driver_doc_submit). Letting the driver skip it only
  // bought an upload, a wait, and a refusal — so the date is required before Save works.
  const expiryOk = (() => {
    const v = expiry.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + "T00:00:00");
    return !isNaN(d.getTime()) && d.getTime() > Date.now();
  })();

  const submit = async () => {
    const docType = sheetFor;
    if (!docType || !pendingUri || !expiryOk) return;
    const iso = expiry.trim();
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

  const chooseProvince = async (p: Province) => {
    setProvince(p);                      // answer immediately; the save is not worth a spinner
    const offered = await DriverDocsAPI.sourceCities(p).catch(() => [] as DocCity[]);
    setCities(offered);
    // Keep the town if the new province still offers it — someone correcting a mistyped province
    // should not lose their answer — and drop it if it is no longer on the list.
    const keep = offered.some((c) => c.city === city) ? city : "";
    if (keep !== city) { setCity(keep); await DriverDocsAPI.setCity(keep); }
    await refreshSources(p, keep);
    const { error } = await DriverDocsAPI.setProvince(p);
    if (error) Alert.alert(lang === "fr" ? "Non enregistré" : "Not saved", error);
  };

  // Gatineau under Ontario is deliberate, not a leak. Naming the province is what keeps an
  // out-of-province town from reading as a bug — it was reported as one when unlabelled.
  const crossing = (town: string): string | null => {
    const row = cities.find((c) => c.city === town);
    if (!row || row.province === province) return null;
    if (row.province === "QC") return fr ? "Québec" : "Quebec";
    if (row.province === "NB") return fr ? "Nouveau-Brunswick" : "New Brunswick";
    return "Ontario";
  };

  const chooseCity = async (town: string) => {
    const next = town === city ? "" : town;   // tapping the chosen town again clears it
    setCity(next);
    setCityOpen(false);
    setCitySearch("");
    if (province) await refreshSources(province, next);
    const { error } = await DriverDocsAPI.setCity(next);
    if (error) Alert.alert(lang === "fr" ? "Non enregistré" : "Not saved", error);
  };

  const fr = lang === "fr";
  const sourceFor = (dt: DocType) => sources[dt] ?? null;

  const ctaLabel = (dt: DocType): string => {
    const st = docs[dt]?.status;
    if (!st) return t.docUpload;
    if (st === "approved") return t.docReplace;
    if (st === "rejected" || st === "expired") return t.docReupload;
    return t.docReplace;
  };

  return (
    <SafeAreaView style={s.container} edges={["left", "right"]}>
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

        {!loading && (consent ? (
          <View style={s.consentDone}>
            <CheckCircle2 size={14} color={Colors.green} strokeWidth={2.4} />
            <Text style={s.consentDoneTxt}>{t("consentGivenOn", { date: new Date(consent.consented_at).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { year: "numeric", month: "short", day: "numeric" }) })}</Text>
          </View>
        ) : (
          <View style={s.consentCard}>
            <Text style={s.consentTitle}>{t.consentTitle}</Text>
            <Text style={s.consentBody}>{t.consentBody}</Text>
            <TouchableOpacity style={[s.btn, consentBusy && s.btnBusy]} onPress={agreeConsent} disabled={consentBusy} activeOpacity={0.85}>
              <Text style={s.btnTxt}>{consentBusy ? t.consentSaving : t.consentAgree}</Text>
            </TouchableOpacity>
          </View>
        ))}

        {!loading && (
          <View style={s.provCard}>
            <Text style={s.provTitle}>
              {fr ? "Votre permis vient de quelle province ?" : "Which province licenses you?"}
            </Text>
            <Text style={s.provSub}>
              {fr
                ? "On vous dira où obtenir chaque document, près de chez vous."
                : "We'll tell you where to get each document, where you live."}
            </Text>
            <View style={s.provRow}>
              {(["ON", "QC", "NB"] as Province[]).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[s.provBtn, province === p && s.provBtnOn]}
                  onPress={() => chooseProvince(p)}
                  activeOpacity={0.85}
                >
                  <Text style={[s.provBtnTxt, province === p && s.provBtnTxtOn]}>
                    {p === "ON" ? "Ontario" : p === "QC" ? "Québec" : "N.-B."}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {!!province && cities.length > 0 && (
              <>
                <Text style={[s.provSub, { marginTop: 13 }]}>
                  {fr
                    ? "Où habitez-vous ? La vérification de police se fait au service de police de votre adresse."
                    : "Where do you live? The record check is issued by the police service for your address."}
                </Text>
                <TouchableOpacity
                  style={[s.cityPick, !!city && s.cityPickOn]}
                  onPress={() => { setCitySearch(""); setCityOpen(true); }}
                  activeOpacity={0.85}
                >
                  <MapPin size={15} color={city ? Colors.accent : Colors.t3} strokeWidth={2} />
                  <Text style={[s.cityPickTxt, !!city && s.cityPickTxtOn]}>
                    {city || (fr ? "Choisir votre ville" : "Choose your town")}
                  </Text>
                  {!!city && crossing(city) && (
                    <Text style={s.cityProv}>{crossing(city)}</Text>
                  )}
                  <Text style={s.cityPickCaret}>›</Text>
                </TouchableOpacity>
                <Text style={s.cityHint}>
                  {fr
                    ? "Ville absente de la liste ? Laissez vide — on vous indiquera la règle provinciale."
                    : "Town not listed? Leave it unset — we'll show the provincial rule."}
                </Text>
              </>
            )}
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 28 }} />
        ) : (
          types.map((dt) => {
            const doc = docs[dt];
            const meta = statusMeta(dt);
            const CardIcon = ICONS[dt];
            return (
              <View key={dt} style={s.card}>
                <View style={s.crow}>
                  <View style={s.cardIco}><CardIcon size={19} color={Colors.t2} strokeWidth={2} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.cname}>{labelFor(dt)}</Text>
                    {!doc && helpFor(dt) ? <Text style={s.chelp}>{helpFor(dt)}</Text> : null}
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

                {/* Where to get it — only while it is still outstanding. Once a document is
                    filed the driver does not need the address again, and the card gets long. */}
                {(!doc || doc.status === "rejected" || doc.status === "expired") && sourceFor(dt) && (() => {
                  const src = sourceFor(dt)!;
                  const org = fr ? src.org_fr : src.org_en;
                  const where = fr ? src.where_fr : src.where_en;
                  const cost = fr ? src.cost_fr : src.cost_en;
                  const wait = fr ? src.turnaround_fr : src.turnaround_en;
                  return (
                    <View style={s.where}>
                      <Text style={s.whereOrg}>{org}</Text>
                      {!!where && <Text style={s.whereSub}>{where}</Text>}
                      {!!src.address && (
                        <View style={s.whereLine}>
                          <MapPin size={12} color={Colors.t3} strokeWidth={2} />
                          <Text style={s.whereTxt}>{src.address}</Text>
                        </View>
                      )}
                      {!!src.phone && (
                        <TouchableOpacity style={s.whereLine} onPress={() => Linking.openURL(`tel:${src.phone}`)} activeOpacity={0.7}>
                          <Phone size={12} color={Colors.accent} strokeWidth={2} />
                          <Text style={[s.whereTxt, s.whereLink]}>{src.phone}</Text>
                        </TouchableOpacity>
                      )}
                      {!!src.url && (
                        <TouchableOpacity style={s.whereLine} onPress={() => Linking.openURL(src.url!)} activeOpacity={0.7}>
                          <Globe size={12} color={Colors.accent} strokeWidth={2} />
                          <Text style={[s.whereTxt, s.whereLink]} numberOfLines={1}>
                            {fr ? "Ouvrir le site officiel" : "Open the official site"}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {(!!cost || !!wait) && (
                        <Text style={s.whereMeta}>{[cost, wait].filter(Boolean).join(" · ")}</Text>
                      )}
                    </View>
                  );
                })()}

                {doc?.status === "rejected" && !!doc.review_notes && (
                  <View style={s.reason}><Text style={s.reasonTxt}>“{doc.review_notes}”</Text></View>
                )}

                {busy === dt ? (
                  <View style={[s.btn, s.btnBusy]}><ActivityIndicator size="small" color={Colors.accentText} /><Text style={s.btnTxt}>{t.docUploading}</Text></View>
                ) : doc?.status === "pending" ? (
                  <TouchableOpacity style={[s.btn, s.btnGhost]} onPress={() => openUpload(dt)} activeOpacity={0.85}>
                    <Text style={[s.btnTxt, { color: Colors.t1 }]}>{t.docReplace}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[s.btn, doc?.status === "approved" && s.btnGhost]} onPress={() => openUpload(dt)} activeOpacity={0.85}>
                    <Text style={[s.btnTxt, doc?.status === "approved" && { color: Colors.t1 }]}>{ctaLabel(dt)}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Where the driver lives — searchable, because Ontario's list is long */}
      <Modal visible={cityOpen} transparent animationType="slide" onRequestClose={() => setCityOpen(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <Pressable style={s.mOverlay} onPress={() => setCityOpen(false)} />
          <View style={s.mSheet}>
            <View style={s.mGrip} />
            <View style={s.mHead}>
              <Text style={s.mTitle}>{fr ? "Votre ville" : "Your town"}</Text>
              <TouchableOpacity onPress={() => setCityOpen(false)} hitSlop={8}>
                <X size={20} color={Colors.t3} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.mInput}
              value={citySearch}
              onChangeText={setCitySearch}
              placeholder={fr ? "Rechercher…" : "Search…"}
              placeholderTextColor={Colors.t3}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <ScrollView style={{ maxHeight: 320, marginTop: 8 }} keyboardShouldPersistTaps="handled">
              {cities
                .filter((c) => c.city.toLowerCase().includes(citySearch.trim().toLowerCase()))
                .map((c) => (
                  <TouchableOpacity key={c.city} style={s.cityRow} onPress={() => chooseCity(c.city)} activeOpacity={0.8}>
                    <Text style={[s.cityRowTxt, city === c.city && s.cityRowTxtOn]}>{c.city}</Text>
                    {c.province !== province && (
                      <Text style={s.cityProv}>{crossing(c.city)}</Text>
                    )}
                    {city === c.city && <Text style={s.cityRowTick}>✓</Text>}
                  </TouchableOpacity>
                ))}
              {cities.filter((c) => c.city.toLowerCase().includes(citySearch.trim().toLowerCase())).length === 0 && (
                <Text style={s.cityNone}>
                  {fr
                    ? "Aucune ville trouvée. Laissez vide — la règle provinciale s'appliquera."
                    : "No town found. Leave it unset — the provincial rule applies."}
                </Text>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Source picker → expiry sheet */}
      <Modal visible={sheetFor !== null} transparent animationType="slide" onRequestClose={closeSheet}>
        {/* The expiry field sits in this sheet, so the keyboard has to be handled here:
            1. Android got behavior={undefined}, which lifts nothing — the keyboard covered the
               field and the Save button. "height" is what works there.
            2. The sheet is a flex sibling of the dim, not absolutely positioned, so "padding"
               does lift it on iOS; the offset is 0 because a Modal starts at the screen top.
            3. Nothing scrolled, so on a short screen the Save button had nowhere to go.
               keyboardShouldPersistTaps="handled" keeps the first tap on Save from being
               swallowed by the keyboard dismissing. Same three as the admin-docs reject sheet. */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <Pressable style={s.mOverlay} onPress={closeSheet} />
          <View style={s.mSheet}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 4 }}
            >
            <View style={s.mGrip} />
            <View style={s.mHead}>
              <Text style={s.mTitle}>{sheetFor ? labelFor(sheetFor) : ""}</Text>
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
                <TouchableOpacity
                  style={[s.mSave, !expiryOk && { opacity: 0.45 }]}
                  disabled={!expiryOk}
                  onPress={submit}
                  activeOpacity={0.85}
                >
                  <Text style={s.mSaveTxt}>{t.docSave}</Text>
                </TouchableOpacity>
              </>
            )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <BottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg },

  // Province chooser — two taps wide, because there are two provinces and a dropdown for two
  // choices is a dropdown too many.
  provCard:    { backgroundColor: Colors.card, borderRadius: 14, padding: 14, marginBottom: 12 },
  provTitle:   { fontSize: 14, fontWeight: "700", color: Colors.t1 },
  provSub:     { fontSize: 12, color: Colors.t3, marginTop: 3, lineHeight: 17 },
  provRow:     { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 11 },
  provBtn:     { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: "center",
                 borderWidth: 1, borderColor: Colors.border, backgroundColor: "transparent" },
  provBtnOn:   { borderColor: Colors.accent, backgroundColor: Colors.accent + "1A" },
  provBtnTxt:  { fontSize: 13.5, fontWeight: "700", color: Colors.t2 },
  provBtnTxtOn:{ color: Colors.accent },
  cityPick:    { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 9,
                 paddingVertical: 11, paddingHorizontal: 13, borderRadius: 12,
                 borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  cityPickOn:  { borderColor: Colors.accent },
  cityPickTxt: { flex: 1, fontSize: 13.5, fontWeight: "600", color: Colors.t3 },
  cityPickTxtOn: { color: Colors.t1 },
  cityPickCaret: { fontSize: 18, color: Colors.t3, marginTop: -2 },
  cityProv:    { fontSize: 10, fontWeight: "700", color: Colors.t3 },
  cityRow:     { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12,
                 borderBottomWidth: 1, borderBottomColor: Colors.border },
  cityRowTxt:  { flex: 1, fontSize: 14.5, fontWeight: "600", color: Colors.t2 },
  cityRowTxtOn:{ color: Colors.accent, fontWeight: "800" },
  cityRowTick: { color: Colors.accent, fontWeight: "800" },
  cityNone:    { fontSize: 12.5, color: Colors.t3, paddingVertical: 14, lineHeight: 18 },
  cityHint:    { fontSize: 11.5, color: Colors.t3, marginTop: 7 },

  // Where to get the document. Sits inside the card, under the name, while it is outstanding.
  where:       { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  whereOrg:    { fontSize: 13, fontWeight: "700", color: Colors.t1 },
  whereSub:    { fontSize: 12, color: Colors.t2, marginTop: 3, lineHeight: 17 },
  whereLine:   { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 6 },
  whereTxt:    { fontSize: 12, color: Colors.t2, flexShrink: 1 },
  whereLink:   { color: Colors.accent, fontWeight: "600" },
  whereMeta:   { fontSize: 11.5, color: Colors.t3, marginTop: 7 },

  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  title:       { fontSize: 17, fontWeight: "700", color: Colors.t1 },
  chelp:       { fontSize: 11.5, color: Colors.t3, marginTop: 2, lineHeight: 16 },
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

  consentCard: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 15, marginBottom: 16 },
  consentTitle:{ fontSize: 14.5, fontWeight: "800", color: Colors.t1, marginBottom: 7 },
  consentBody: { fontSize: 12.5, lineHeight: 18, color: Colors.t2 },
  consentDone: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: Colors.green + "14", borderWidth: 1, borderColor: Colors.green + "33", borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, marginBottom: 16 },
  consentDoneTxt: { color: Colors.green, fontSize: 12, fontWeight: "700" },

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
  mSheet:      { maxHeight: "82%", backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: Colors.border, padding: 18, paddingBottom: 30 },
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
});
