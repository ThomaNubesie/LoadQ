import { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { QueueAPI, type AdminQueueRow, type AdminPaxReservation } from "../../services/queue";
import { ZonesAPI, type ZoneRow } from "../../services/zones";
import { getRegionName, getDestinationsFrom, DESTINATION_CITIES } from "../../constants/pricing";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { ArrowLeft, Search } from "lucide-react-native";

type Mode = "driver" | "passenger";
type PaxMode = "auto" | "keep" | "release";

export default function AdminRelocateScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [mode, setMode] = useState<Mode>("driver");
  const [flash, setFlash] = useState("");

  useEffect(() => {
    (async () => {
      const admin = await QueueAPI.isAdmin();
      setAllowed(admin);
      if (admin) { try { setZones(await ZonesAPI.list()); } catch { /* noop */ } }
    })();
  }, []);

  const toast = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3500); };

  if (allowed === null) return <SafeAreaView style={s.container}><View style={s.center}><ActivityIndicator color={Colors.accent} /></View></SafeAreaView>;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/profile")}><ArrowLeft size={20} color={Colors.t2} strokeWidth={2} /></TouchableOpacity>
        <Text style={s.title}>{t.arTitle}</Text>
        <View style={{ width: 24 }} />
      </View>

      {!allowed
        ? <View style={s.center}><Text style={s.denyTitle}>{t.notAuthorisedTitle}</Text><Text style={s.denyText}>{t.notAuthorisedBody}</Text></View>
        : (
          <>
            <View style={s.modeRow}>
              {(["driver", "passenger"] as const).map((m) => (
                <TouchableOpacity key={m} style={[s.modeChip, mode === m && s.modeChipOn]} onPress={() => setMode(m)}>
                  <Text style={[s.modeChipTxt, mode === m && s.modeChipTxtOn]}>{m === "driver" ? t.arDriver : t.arPassenger}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!!flash && <Text style={s.flash}>{flash}</Text>}
            {mode === "driver"
              ? <DriverMode zones={zones} onDone={toast} />
              : <PassengerMode zones={zones} onDone={toast} />}
          </>
        )}
    </SafeAreaView>
  );
}

const isActiveRow = (r: AdminQueueRow) => ["loading", "waiting", "standby"].includes(r.status);

function ZonePicker({ zones, value, onChange }: { zones: ZoneRow[]; value: string; onChange: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
      {zones.map((z) => (
        <TouchableOpacity key={z.id} style={[s.chip, value === z.id && s.chipOn]} onPress={() => onChange(z.id)}>
          <Text style={[s.chipTxt, value === z.id && s.chipTxtOn]}>{z.name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function DriverMode({ zones, onDone }: { zones: ZoneRow[]; onDone: (m: string) => void }) {
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const [srcZone, setSrcZone] = useState("");
  const [rows, setRows] = useState<AdminQueueRow[]>([]);
  const [entryId, setEntryId] = useState("");
  const [dstZone, setDstZone] = useState("");
  const [dstDest, setDstDest] = useState("");
  const [pos, setPos] = useState("");
  const [pax, setPax] = useState<PaxMode>("auto");
  const [busy, setBusy] = useState(false);

  const loadSrc = async (z: string) => {
    setSrcZone(z); setEntryId(""); setRows([]);
    if (z) setRows((await QueueAPI.adminZoneActiveDrivers(z)).filter(isActiveRow));
  };
  const entry = rows.find((r) => r.id === entryId) || null;
  const dstRegion = zones.find((z) => z.id === dstZone)?.region ?? null;
  const dests = useMemo(() => getDestinationsFrom(dstRegion), [dstRegion]);

  const submit = async () => {
    if (!entry || !dstZone) return;
    setBusy(true);
    const release = pax === "auto" ? null : pax === "release";
    const { error } = await QueueAPI.adminRelocateDriver(entry.id, dstZone, dstDest || null, pos ? Number(pos) : null, release);
    setBusy(false);
    if (error) { onDone(error); return; }
    onDone(t.arMovedDriver); await loadSrc(srcZone); setEntryId(""); setPos("");
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
    >
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
      <Text style={s.lbl}>{t.arFromZone}</Text>
      <ZonePicker zones={zones} value={srcZone} onChange={loadSrc} />

      {srcZone !== "" && (
        <View style={{ marginTop: 10 }}>
          {rows.length === 0 && <Text style={s.muted}>{t.arNoDrivers}</Text>}
          {rows.map((r) => (
            <TouchableOpacity key={r.id} style={[s.pickRow, entryId === r.id && s.pickRowOn]} onPress={() => setEntryId(r.id)}>
              <Text style={s.num}>{r.position}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.pickName}>{r.driver?.full_name || "(no name)"}</Text>
                <Text style={s.pickSub}>{r.destination_region ? `→ ${getRegionName(r.destination_region)}` : t.arNoDest}{r.seats_locked ? ` · ${r.seats_locked}🔒` : ""}{r.seats_boarded ? ` · ${r.seats_boarded}✓` : ""}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {entry && (
        <View style={s.panel}>
          <Text style={s.lbl}>{t.arToZone}</Text>
          <ZonePicker zones={zones} value={dstZone} onChange={(z) => { setDstZone(z); setDstDest(""); }} />

          <Text style={s.lbl}>{t.arToDest}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <TouchableOpacity style={[s.chip, dstDest === "" && s.chipOn]} onPress={() => setDstDest("")}><Text style={[s.chipTxt, dstDest === "" && s.chipTxtOn]}>{t.arKeepDest}</Text></TouchableOpacity>
            {(dests.length ? dests : DESTINATION_CITIES.map((d) => d.code)).map((code) => (
              <TouchableOpacity key={code} style={[s.chip, dstDest === code && s.chipOn]} onPress={() => setDstDest(code)}><Text style={[s.chipTxt, dstDest === code && s.chipTxtOn]}>{getRegionName(code)}</Text></TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={s.lbl}>{t.arPosition}</Text>
          <TextInput style={s.input} value={pos} onChangeText={(v) => setPos(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder={t.arEndOfLine} placeholderTextColor={Colors.t3} />

          <Text style={s.lbl}>{t.arPax}</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {(["auto", "keep", "release"] as const).map((p) => (
              <TouchableOpacity key={p} style={[s.chip, pax === p && s.chipOn]} onPress={() => setPax(p)}>
                <Text style={[s.chipTxt, pax === p && s.chipTxtOn]}>{p === "auto" ? t.arPaxAuto : p === "keep" ? t.arPaxKeep : t.arPaxRelease}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={[s.cta, (!dstZone || busy) && s.ctaOff]} onPress={submit} disabled={!dstZone || busy}>
            <Text style={s.ctaTxt}>{busy ? "…" : t.arRelocate}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PassengerMode({ zones, onDone }: { zones: ZoneRow[]; onDone: (m: string) => void }) {
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; full_name: string | null; phone: string | null }[]>([]);
  const [pax, setPax] = useState<{ id: string; full_name: string | null } | null>(null);
  const [resv, setResv] = useState<AdminPaxReservation | null>(null);
  const [dstZone, setDstZone] = useState("");
  const [rows, setRows] = useState<AdminQueueRow[]>([]);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);

  const search = async () => setResults(await QueueAPI.adminSearchPassengers(q));
  const pick = async (p: { id: string; full_name: string | null }) => {
    setPax(p); setResults([]); setQ(p.full_name || ""); setResv(await QueueAPI.adminPassengerReservation(p.id));
  };
  const loadDst = async (z: string) => {
    setDstZone(z); setTargetId(""); setRows([]);
    if (z) setRows((await QueueAPI.adminZoneActiveDrivers(z)).filter(isActiveRow));
  };
  const submit = async () => {
    if (!pax || !targetId) return;
    setBusy(true);
    const { error } = await QueueAPI.adminRelocatePassenger(pax.id, targetId, null);
    setBusy(false);
    if (error) { onDone(error); return; }
    onDone(t.arMovedPassenger); setResv(await QueueAPI.adminPassengerReservation(pax.id)); setTargetId("");
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
    >
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
      <Text style={s.lbl}>{t.arFindPassenger}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput style={[s.input, { flex: 1 }]} value={q} onChangeText={setQ} onSubmitEditing={search} placeholder={t.arSearch} placeholderTextColor={Colors.t3} returnKeyType="search" />
        <TouchableOpacity style={s.searchBtn} onPress={search}><Search size={16} color={Colors.accentText} /></TouchableOpacity>
      </View>
      {results.map((p) => (
        <TouchableOpacity key={p.id} style={s.pickRow} onPress={() => pick(p)}>
          <View style={{ flex: 1 }}><Text style={s.pickName}>{p.full_name || "(no name)"}</Text><Text style={s.pickSub}>{p.phone || ""}</Text></View>
        </TouchableOpacity>
      ))}

      {pax && (
        <View style={s.resv}>
          <Text style={s.lbl}>{t.arCurrent}</Text>
          {resv?.entry
            ? <Text style={s.pickName}>{resv.entry.driver?.full_name || "(driver)"} · #{resv.entry.position} → {resv.entry.destination_region ? getRegionName(resv.entry.destination_region) : "—"}  <Text style={s.muted}>({resv.claimStatus})</Text></Text>
            : <Text style={s.muted}>{t.arNoReservation}</Text>}
        </View>
      )}

      {pax && (
        <View style={s.panel}>
          <Text style={s.lbl}>{t.arToZone}</Text>
          <ZonePicker zones={zones} value={dstZone} onChange={loadDst} />
          <View style={{ marginTop: 10 }}>
            {dstZone !== "" && rows.length === 0 && <Text style={s.muted}>{t.arNoDrivers}</Text>}
            {rows.map((r) => {
              const seats = r.vehicle?.seats ?? 0;
              const taken = (r.seats_locked ?? 0) + (r.seats_boarded ?? 0);
              const full = seats > 0 && taken >= seats;
              return (
                <TouchableOpacity key={r.id} style={[s.pickRow, targetId === r.id && s.pickRowOn, full && { opacity: 0.4 }]} disabled={full} onPress={() => setTargetId(r.id)}>
                  <Text style={s.num}>{r.position}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.pickName}>{r.driver?.full_name || "(no name)"}</Text>
                    <Text style={s.pickSub}>{r.destination_region ? `→ ${getRegionName(r.destination_region)}` : t.arNoDest} · {taken}/{seats || "?"}{full ? ` · ${t.arFull}` : ""}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity style={[s.cta, (!targetId || busy) && s.ctaOff]} onPress={submit} disabled={!targetId || busy}>
            <Text style={s.ctaTxt}>{busy ? "…" : t.arRelocate}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.bg },
  header:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  title:      { fontSize: 17, fontWeight: "700", color: Colors.t1 },
  center:     { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  denyTitle:  { fontSize: 18, fontWeight: "700", color: Colors.t1, marginBottom: 8 },
  denyText:   { fontSize: 13, color: Colors.t3, textAlign: "center" },
  modeRow:    { flexDirection: "row", gap: 8, padding: 16, paddingBottom: 4 },
  modeChip:   { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border, alignItems: "center" },
  modeChipOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  modeChipTxt:{ color: Colors.t2, fontWeight: "800", fontSize: 14 },
  modeChipTxtOn: { color: Colors.accentText },
  flash:      { color: Colors.accent, fontSize: 13, fontWeight: "700", paddingHorizontal: 16, paddingTop: 8 },
  lbl:        { fontSize: 12, color: Colors.t3, fontWeight: "800", marginTop: 16, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 },
  muted:      { color: Colors.t3, fontSize: 13, paddingVertical: 8 },
  chip:       { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border },
  chipOn:     { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipTxt:    { color: Colors.t2, fontWeight: "700", fontSize: 13 },
  chipTxtOn:  { color: Colors.accentText },
  pickRow:    { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 0.5, borderColor: Colors.border, backgroundColor: Colors.card, marginBottom: 8 },
  pickRowOn:  { borderColor: Colors.accent, borderWidth: 1.5 },
  num:        { fontWeight: "800", color: Colors.t1, fontSize: 16, minWidth: 24, textAlign: "center" },
  pickName:   { color: Colors.t1, fontWeight: "700", fontSize: 14 },
  pickSub:    { color: Colors.t3, fontSize: 12, marginTop: 2 },
  panel:      { marginTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.border, paddingTop: 8 },
  input:      { backgroundColor: Colors.card, borderColor: Colors.border, borderWidth: 1, borderRadius: 10, color: Colors.t1, paddingVertical: 12, paddingHorizontal: 14, fontSize: 15 },
  searchBtn:  { backgroundColor: Colors.accent, borderRadius: 10, width: 46, alignItems: "center", justifyContent: "center" },
  resv:       { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 0.5, borderStyle: "dashed", borderColor: Colors.border },
  cta:        { marginTop: 20, backgroundColor: Colors.accent, borderRadius: 12, padding: 15, alignItems: "center" },
  ctaOff:     { opacity: 0.45 },
  ctaTxt:     { color: Colors.accentText, fontWeight: "800", fontSize: 16 },
});
