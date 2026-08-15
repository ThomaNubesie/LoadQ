import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Image, Modal, Pressable, Alert, TextInput, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, X, Check, Ban, ExternalLink } from "lucide-react-native";
import { QueueAPI } from "../../services/queue";
import { AdminDocsAPI, AdminDocRow, DocType } from "../../services/driverDocs";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

type Filter = "pending" | "approved" | "rejected" | "expired" | "all";
const FILTERS: Filter[] = ["pending", "approved", "rejected", "expired", "all"];

const DOC_LABEL: Record<DocType, { en: string; fr: string }> = {
  drivers_license: { en: "Driver's licence", fr: "Permis de conduire" },
  insurance:       { en: "Insurance",        fr: "Assurance" },
  registration:    { en: "Registration",     fr: "Immatriculation" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return "—"; }
}

export default function AdminDocsScreen() {
  const router = useRouter();
  const { t, lang } = useStrings();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [rows, setRows] = useState<AdminDocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Full-image viewer + reject-note sheet
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null);
  const [rejectRow, setRejectRow] = useState<AdminDocRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const load = useCallback(async () => {
    try { setRows(await AdminDocsAPI.queue(filter)); } catch { setRows([]); }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    (async () => {
      const admin = await QueueAPI.isAdmin();
      setAllowed(admin);
      if (!admin) setLoading(false);
    })();
  }, []);

  useEffect(() => { if (allowed) { setLoading(true); load(); } }, [allowed, load]);

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  async function openImage(row: AdminDocRow) {
    const url = await AdminDocsAPI.signedUrl(row.storage_path);
    if (!url) { Alert.alert(t("adminDocs"), t("adminDocsNoImage")); return; }
    setViewer({ url, title: `${row.full_name ?? t("driver")} · ${DOC_LABEL[row.doc_type]?.[lang === "fr" ? "fr" : "en"] ?? row.doc_type}` });
  }

  async function approve(row: AdminDocRow) {
    setBusyId(row.doc_id);
    const { error, driver_verified } = await AdminDocsAPI.review(row.doc_id, "approved");
    setBusyId(null);
    if (error) { Alert.alert(t("adminDocs"), error); return; }
    await load();
    if (driver_verified) Alert.alert(t("adminDocs"), t("adminDocsVerified", { name: row.full_name ?? t("driver") }));
  }

  async function doReject() {
    if (!rejectRow) return;
    const row = rejectRow;
    setRejectRow(null);
    setBusyId(row.doc_id);
    const { error } = await AdminDocsAPI.review(row.doc_id, "rejected", rejectNote.trim() || null);
    setBusyId(null);
    setRejectNote("");
    if (error) { Alert.alert(t("adminDocs"), error); return; }
    await load();
  }

  if (allowed === false) {
    return <SafeAreaView style={s.screen} edges={["top"]}><View style={s.center}><Text style={s.muted}>{t("adminOnly")}</Text></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><ArrowLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{t("adminDocs")}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filters} contentContainerStyle={{ gap: 8, paddingHorizontal: 14 }}>
        {FILTERS.map(f => (
          <TouchableOpacity key={f} style={[s.pill, filter === f && s.pillOn]} onPress={() => setFilter(f)} activeOpacity={0.8}>
            <Text style={[s.pillTxt, filter === f && s.pillTxtOn]}>{t(`adminDocsF_${f}`)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={Colors.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
          {rows.length === 0 && <Text style={s.muted}>{t("adminDocsEmpty")}</Text>}
          {rows.map(row => {
            const label = DOC_LABEL[row.doc_type]?.[lang === "fr" ? "fr" : "en"] ?? row.doc_type;
            const busy = busyId === row.doc_id;
            return (
              <View key={row.doc_id} style={s.card}>
                <View style={s.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name} numberOfLines={1}>{row.full_name ?? t("driver")}</Text>
                    <Text style={s.meta} numberOfLines={1}>{label}{row.plate ? ` · ${row.plate}` : ""}</Text>
                    <Text style={s.meta2}>{t("adminDocsSubmitted")}: {fmtDate(row.submitted_at)}{row.expires_on ? ` · ${t("adminDocsExpires")}: ${fmtDate(row.expires_on)}` : ""}</Text>
                  </View>
                  <View style={[s.statusChip, statusStyle(row.status)]}><Text style={[s.statusTxt, statusTxtStyle(row.status)]}>{t(`adminDocsF_${row.status}` as any) || row.status}</Text></View>
                </View>

                {!!row.review_notes && <Text style={s.notes}>“{row.review_notes}”</Text>}

                <TouchableOpacity style={s.viewBtn} onPress={() => openImage(row)} activeOpacity={0.8}>
                  <ExternalLink size={15} color={Colors.accent} />
                  <Text style={s.viewBtnTxt}>{t("adminDocsView")}</Text>
                </TouchableOpacity>

                {(row.status === "pending" || row.status === "expired") && (
                  <View style={s.actions}>
                    <TouchableOpacity style={[s.actBtn, s.reject, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => { setRejectRow(row); setRejectNote(""); }} activeOpacity={0.85}>
                      <Ban size={15} color={Colors.red} /><Text style={[s.actTxt, { color: Colors.red }]}>{t("adminDocsReject")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.actBtn, s.approve, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => approve(row)} activeOpacity={0.85}>
                      <Check size={15} color={Colors.accentText} /><Text style={[s.actTxt, { color: Colors.accentText }]}>{t("adminDocsApprove")}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Image viewer */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={s.viewerDim} onPress={() => setViewer(null)}>
          <Text style={s.viewerTitle} numberOfLines={1}>{viewer?.title}</Text>
          {viewer && <Image source={{ uri: viewer.url }} style={s.viewerImg} resizeMode="contain" />}
          <TouchableOpacity style={s.viewerClose} onPress={() => setViewer(null)} hitSlop={10}><X size={26} color="#fff" /></TouchableOpacity>
        </Pressable>
      </Modal>

      {/* Reject note */}
      <Modal visible={!!rejectRow} transparent animationType="slide" onRequestClose={() => setRejectRow(null)}>
        <Pressable style={s.sheetDim} onPress={() => setRejectRow(null)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.grip} />
            <Text style={s.sheetTitle}>{t("adminDocsRejectTitle")}</Text>
            <TextInput
              style={s.input}
              value={rejectNote}
              onChangeText={setRejectNote}
              placeholder={t("adminDocsRejectPh")}
              placeholderTextColor={Colors.t3}
              multiline
            />
            <TouchableOpacity style={s.rejectConfirm} onPress={doReject} activeOpacity={0.85}>
              <Text style={s.rejectConfirmTxt}>{t("adminDocsReject")}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function statusStyle(st: string) {
  return st === "approved" ? { backgroundColor: Colors.green + "22" }
       : st === "rejected" ? { backgroundColor: Colors.red + "22" }
       : st === "expired"  ? { backgroundColor: Colors.yellow + "22" }
       : { backgroundColor: Colors.accent + "22" };
}
function statusTxtStyle(st: string) {
  return st === "approved" ? { color: Colors.green }
       : st === "rejected" ? { color: Colors.red }
       : st === "expired"  ? { color: Colors.yellow }
       : { color: Colors.accent };
}

const s = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.bg },
  header:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  title:   { color: Colors.t1, fontSize: 18, fontWeight: "800" },
  center:  { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  muted:   { color: Colors.t2, textAlign: "center", marginTop: 24 },
  filters: { flexGrow: 0, marginBottom: 6 },
  pill:    { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: Colors.border },
  pillOn:  { backgroundColor: Colors.accent, borderColor: Colors.accent },
  pillTxt: { color: Colors.t2, fontWeight: "700", fontSize: 12.5 },
  pillTxtOn: { color: Colors.accentText },
  card:    { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 13, marginBottom: 11 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  name:    { color: Colors.t1, fontWeight: "800", fontSize: 15 },
  meta:    { color: Colors.t2, fontSize: 12.5, marginTop: 2 },
  meta2:   { color: Colors.t3, fontSize: 11, marginTop: 3 },
  statusChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  statusTxt:  { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  notes:   { color: Colors.t2, fontStyle: "italic", fontSize: 12.5, marginTop: 9 },
  viewBtn: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 11, alignSelf: "flex-start" },
  viewBtnTxt: { color: Colors.accent, fontWeight: "800", fontSize: 13 },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  actBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 11, paddingVertical: 11 },
  reject:  { borderWidth: 1.5, borderColor: Colors.red },
  approve: { backgroundColor: Colors.accent },
  actTxt:  { fontWeight: "800", fontSize: 13.5 },
  viewerDim: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: 16 },
  viewerTitle: { color: "#fff", fontWeight: "700", fontSize: 13, marginBottom: 10, textAlign: "center" },
  viewerImg: { width: "100%", height: "78%" },
  viewerClose: { position: "absolute", top: 40, right: 20 },
  sheetDim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet:    { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: Colors.border, padding: 16, paddingBottom: 28 },
  grip:     { width: 36, height: 4, borderRadius: 3, backgroundColor: Colors.border, alignSelf: "center", marginBottom: 12 },
  sheetTitle: { color: Colors.t1, fontSize: 16, fontWeight: "800", marginBottom: 12 },
  input:    { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 11, padding: 12, color: Colors.t1, fontSize: 14, minHeight: 76, textAlignVertical: "top" },
  rejectConfirm: { backgroundColor: Colors.red, borderRadius: 12, alignItems: "center", paddingVertical: 14, marginTop: 14 },
  rejectConfirmTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
