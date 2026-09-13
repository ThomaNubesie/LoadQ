import { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput,
         ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Check, ShieldAlert } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import Wordmark from "../../components/Wordmark";
import { UndertakingAPI, type UndertakingState } from "../../services/undertaking";
import { resolveHome } from "../../services/authRoute";

// Accepting the engagement, during sign-up.
//
// Two steps on purpose: read, then sign. The continue button stays disabled until the
// driver has actually scrolled to the end of the articles — a tick-box at the top of an
// unread document is worth nothing the day someone disputes a $100 fine, and Article 4 is
// exactly the kind of thing that gets disputed.
//
// Only drivers who joined on or after loadq_settings.undertaking_required_from see this;
// the 165 already on the platform signed on paper and are never asked.
export default function Engagement() {
  const router = useRouter();
  const { lang } = useStrings();
  const fr = lang === "fr";
  const [st, setSt] = useState<UndertakingState | null>(null);
  const [read, setRead] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [step, setStep] = useState<"read" | "sign">("read");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomReached = useRef(false);

  useEffect(() => {
    UndertakingAPI.get().then((s) => {
      setSt(s);
      if (s?.name) setName(s.name);
      // Already signed, or never required → this screen has nothing to ask.
      if (s && (!s.required || s.signed)) resolveHome().then((r) => router.replace(r as any));
    });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = (e: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 24) {
      bottomReached.current = true;
      if (!read) setRead(true);
    }
  };

  const sign = async () => {
    const n = name.trim();
    if (n.length < 3 || busy) return;
    setBusy(true);
    const { error } = await UndertakingAPI.sign(n);
    setBusy(false);
    if (error) { Alert.alert(fr ? "Signature refusée" : "Could not sign", error); return; }
    router.replace((await resolveHome()) as any);
  };

  if (!st) return (
    <SafeAreaView style={s.screen} edges={["left","right","bottom"]}>
      <View style={s.center}><ActivityIndicator color={Colors.accent} /></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.screen} edges={["left","right","bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={s.head}>
          <Wordmark style={{ fontSize: 18 }} />
          <Text style={s.step}>{fr ? "Étape 4 / 5" : "Step 4 / 5"}</Text>
        </View>

        {step === "read" ? (
          <>
            <Text style={s.h1}>{fr ? "Engagement du chauffeur" : "Driver undertaking"}</Text>
            <Text style={s.sub}>
              {fr ? `Version ${st.version} — adoptée par le Parlement. Faites défiler jusqu'en bas.`
                  : `Version ${st.version} — adopted by Parliament. Scroll to the end.`}
            </Text>

            <ScrollView style={s.doc} contentContainerStyle={{ paddingBottom: 10 }}
                        onScroll={onScroll} scrollEventThrottle={64}>
              {st.articles.map((a) => (
                <View key={a.no} style={s.art}>
                  <Text style={s.artNo}>{fr ? "ARTICLE" : "ARTICLE"} {a.no}</Text>
                  <Text style={s.artTitle}>
                    {fr ? a.title_fr : a.title_en}
                    {a.key && <Text style={s.key}>  {fr ? "clé" : "key"}</Text>}
                  </Text>
                  <Text style={s.artBody}>{fr ? a.body_fr : a.body_en}</Text>
                </View>
              ))}
              <Text style={s.end}>{fr ? "— fin du document —" : "— end of document —"}</Text>
            </ScrollView>

            <TouchableOpacity style={s.chk} activeOpacity={0.8} disabled={!read}
              onPress={() => setAgreed((v) => !v)}>
              <View style={[s.box, agreed && { backgroundColor: Colors.accent, borderColor: Colors.accent }]}>
                {agreed && <Check size={13} color={Colors.accentText} strokeWidth={3} />}
              </View>
              <Text style={[s.chkTxt, !read && { opacity: 0.5 }]}>
                {fr ? `J'ai lu et j'accepte les ${st.articles.length} articles.`
                    : `I have read and accept the ${st.articles.length} articles.`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={[s.btn, !(read && agreed) && s.btnOff]}
              disabled={!(read && agreed)} onPress={() => setStep("sign")} activeOpacity={0.85}>
              <Text style={s.btnTxt}>{fr ? "Accepter et continuer" : "Accept and continue"}</Text>
            </TouchableOpacity>
            {!read && <Text style={s.hint}>
              {fr ? "Le bouton s'active une fois le document lu jusqu'au bout."
                  : "The button becomes active once you have read to the end."}</Text>}
          </>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 20 }}>
            <Text style={s.h1}>{fr ? "Signature" : "Signature"}</Text>
            <Text style={s.sub}>
              {fr ? "Votre nom vaut signature électronique. Il est enregistré avec la date, l'heure et la version du document."
                  : "Your name is your electronic signature. It is recorded with the date, time and document version."}
            </Text>

            <Text style={s.lbl}>{fr ? "NOM COMPLET" : "FULL NAME"}</Text>
            <TextInput style={s.input} value={name} onChangeText={setName}
              placeholder={fr ? "Prénom et nom" : "First and last name"}
              placeholderTextColor={Colors.t3} autoCapitalize="words" returnKeyType="done" />

            <View style={s.rec}>
              <Row k={fr ? "Document" : "Document"} v={`${fr ? "Engagement" : "Undertaking"} ${st.version}`} />
              <Row k={fr ? "Numéro chauffeur" : "Driver number"} v="—" />
              <Row k={fr ? "Date" : "Date"} v={new Date().toLocaleString(fr ? "fr-CA" : "en-CA")} />
            </View>

            <View style={s.warn}>
              <ShieldAlert size={16} color={Colors.red} strokeWidth={2} />
              <Text style={s.warnTxt}>
                {fr ? "L'Article 5 — violence physique — entraîne une exclusion à vie. En signant, vous le reconnaissez."
                    : "Article 5 — physical violence — carries a lifetime ban. By signing you acknowledge this."}
              </Text>
            </View>

            <TouchableOpacity style={[s.btn, (name.trim().length < 3 || busy) && s.btnOff]}
              disabled={name.trim().length < 3 || busy} onPress={sign} activeOpacity={0.85}>
              <Text style={s.btnTxt}>{busy ? (fr ? "Signature…" : "Signing…")
                                            : (fr ? "Signer et continuer" : "Sign and continue")}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStep("read")} style={s.back}>
              <Text style={s.backTxt}>{fr ? "Relire les articles" : "Read the articles again"}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <View style={s.rr}><Text style={s.rk}>{k}</Text><Text style={s.rv}>{v}</Text></View>;
}

const s = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: Colors.bg, paddingHorizontal: 18 },
  center:   { flex: 1, alignItems: "center", justifyContent: "center" },
  head:     { flexDirection: "row", alignItems: "center", paddingTop: 6, paddingBottom: 12 },
  step:     { marginLeft: "auto", fontSize: 11, fontWeight: "800", color: Colors.t3 },
  h1:       { fontSize: 20, fontWeight: "800", color: Colors.t1, marginBottom: 4 },
  sub:      { fontSize: 13, color: Colors.t2, lineHeight: 19, marginBottom: 14 },
  doc:      { flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 14,
              paddingHorizontal: 13, backgroundColor: Colors.card },
  art:      { borderBottomWidth: 1, borderBottomColor: Colors.border, paddingVertical: 12 },
  artNo:    { fontSize: 10, fontWeight: "800", letterSpacing: 0.6, color: Colors.t3 },
  artTitle: { fontSize: 15, fontWeight: "800", color: Colors.t1, marginTop: 2 },
  key:      { fontSize: 10, fontWeight: "800", color: Colors.accentWarm },
  artBody:  { fontSize: 12.5, color: Colors.t2, lineHeight: 18.5, marginTop: 5 },
  end:      { textAlign: "center", fontSize: 11, color: Colors.t3, paddingVertical: 14 },
  chk:      { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1,
              borderColor: Colors.border, borderRadius: 12, padding: 13, marginTop: 14 },
  box:      { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border,
              alignItems: "center", justifyContent: "center" },
  chkTxt:   { flex: 1, fontSize: 13, color: Colors.t2, lineHeight: 18 },
  btn:      { backgroundColor: Colors.accent, borderRadius: 14, alignItems: "center",
              paddingVertical: 16, marginTop: 12 },
  btnOff:   { opacity: 0.45 },
  btnTxt:   { color: Colors.accentText, fontSize: 15.5, fontWeight: "800" },
  hint:     { fontSize: 11.5, color: Colors.t3, textAlign: "center", marginTop: 9, lineHeight: 16 },
  lbl:      { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.6, color: Colors.t3, marginBottom: 5 },
  input:    { backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.accent,
              borderRadius: 12, padding: 13, fontSize: 16, color: Colors.t1, fontWeight: "600" },
  rec:      { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
              borderRadius: 12, padding: 12, marginTop: 12 },
  rr:       { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  rk:       { fontSize: 12, color: Colors.t2 },
  rv:       { fontSize: 12, color: Colors.t1, fontWeight: "700" },
  warn:     { flexDirection: "row", gap: 9, alignItems: "flex-start", borderWidth: 1,
              borderColor: Colors.red + "44", backgroundColor: Colors.red + "14",
              borderRadius: 12, padding: 12, marginTop: 12 },
  warnTxt:  { flex: 1, fontSize: 12, color: Colors.red, lineHeight: 17, fontWeight: "600" },
  back:     { alignItems: "center", paddingVertical: 14 },
  backTxt:  { fontSize: 13, color: Colors.t2, fontWeight: "700" },
});
