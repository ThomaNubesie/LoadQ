import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Switch, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { Colors } from "../../constants/colors";
import { REGIONS, RegionCode } from "../../constants/zones";
import { ZonesAPI, ZoneRow } from "../../services/zones";
import { useZones } from "../../hooks/useZones";
import { DriversAPI } from "../../services/drivers";
import { supabase } from "../../services/supabase";

const COMMON_TZS = [
  "America/Toronto",    // Eastern (ON, QC)
  "America/Halifax",    // Atlantic (NS, NB, PE)
  "America/St_Johns",   // Newfoundland
  "America/Winnipeg",   // Central (MB)
  "America/Regina",     // Saskatchewan (no DST)
  "America/Edmonton",   // Mountain (AB)
  "America/Vancouver",  // Pacific (BC)
];

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export default function AdminZonesScreen() {
  const router = useRouter();
  const { zones, refresh } = useZones();

  const [isAdmin,     setIsAdmin]     = useState<boolean | null>(null);
  const [allowed,     setAllowed]     = useState<boolean | null>(null);
  const [name,        setName]        = useState("");
  const [address,     setAddress]     = useState("");
  const [region,      setRegion]      = useState<RegionCode>("ottawa");
  const [latitude,    setLatitude]    = useState("");
  const [longitude,   setLongitude]   = useState("");
  const [radius,      setRadius]      = useState("100");
  const [timezone,    setTimezone]    = useState("America/Toronto");
  const [isActive,    setIsActive]    = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [gpsLoading,  setGpsLoading]  = useState(false);
  const [error,       setError]       = useState("");

  // Inline edit of an existing zone's display name + address. Coordinates,
  // region and radius stay fixed here — those are set at creation. Renaming
  // lets admins shorten long labels (e.g. "Berri-UQAM — Sainte-Catherine")
  // that otherwise overflow the passenger header.
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [editName,    setEditName]    = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [savingEdit,  setSavingEdit]  = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAllowed(false); return; }
      const { data } = await supabase.from("drivers").select("is_admin").eq("id", user.id).maybeSingle();
      const admin = !!data?.is_admin;
      setIsAdmin(admin);
      setAllowed(admin);
    })();
  }, []);

  useEffect(() => {
    // Default the timezone field from the selected region.
    const r = REGIONS.find(r => r.code === region);
    if (r) setTimezone(r.timezone);
  }, [region]);

  const handleUseGps = async () => {
    setGpsLoading(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Location permission denied", "Enable location in Settings to auto-fill coordinates.");
      setGpsLoading(false);
      return;
    }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    setLatitude(loc.coords.latitude.toFixed(6));
    setLongitude(loc.coords.longitude.toFixed(6));
    setGpsLoading(false);
  };

  const handleSave = async () => {
    setError("");
    if (!name.trim())    return setError("Name is required");
    if (!address.trim()) return setError("Address is required");
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return setError("Latitude and longitude must be valid numbers");
    const rad = parseInt(radius, 10);
    if (Number.isNaN(rad) || rad <= 0)          return setError("Radius must be a positive integer");

    const id = `${region}-${slugify(name)}`;
    if (zones.some(z => z.id === id)) {
      return setError(`A zone with id "${id}" already exists — rename it`);
    }

    setSaving(true);
    const { error: addErr } = await ZonesAPI.add({
      id, name: name.trim(), region, address: address.trim(),
      latitude: lat, longitude: lon, radius_meters: rad,
      timezone, is_active: isActive,
    });
    setSaving(false);
    if (addErr) { setError(addErr); return; }
    await refresh();
    setName(""); setAddress(""); setLatitude(""); setLongitude(""); setRadius("100");
    Alert.alert("Zone added", `"${name}" is now available to drivers.`);
  };

  const handleToggleActive = async (zone: ZoneRow) => {
    const { error: tErr } = await ZonesAPI.setActive(zone.id, !zone.is_active);
    if (tErr) { Alert.alert("Error", tErr); return; }
    await refresh();
  };

  const startEditZone = (z: ZoneRow) => {
    setEditingId(z.id);
    setEditName(z.name);
    setEditAddress(z.address || "");
  };

  const saveEditZone = async (z: ZoneRow) => {
    if (!editName.trim()) { Alert.alert("Name required", "Zone name can't be empty."); return; }
    setSavingEdit(true);
    const { error: uErr } = await ZonesAPI.update(z.id, {
      name: editName.trim(),
      address: editAddress.trim() || null,
    });
    setSavingEdit(false);
    if (uErr) { Alert.alert("Could not update", uErr); return; }
    setEditingId(null);
    await refresh();
  };

  if (allowed === null) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.center}><ActivityIndicator color={Colors.accent} /></View>
      </SafeAreaView>
    );
  }
  if (!allowed) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.replace("/(app)/profile")}><Text style={s.back}>←</Text></TouchableOpacity>
          <Text style={s.title}>Admin · Zones</Text>
          <View style={{ width:24 }} />
        </View>
        <View style={s.center}>
          <Text style={s.denyTitle}>🔒 Not authorised</Text>
          <Text style={s.denyText}>This screen is for LoadQ admins only.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/profile")}><Text style={s.back}>←</Text></TouchableOpacity>
        <Text style={s.title}>Admin · Zones</Text>
        <View style={{ width:24 }} />
      </View>

      <ScrollView contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        <Text style={s.section}>NEW ZONE</Text>

        <Text style={s.label}>NAME</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="e.g. 140 George Street" placeholderTextColor={Colors.t3} />

        <Text style={s.label}>ADDRESS</Text>
        <TextInput style={s.input} value={address} onChangeText={setAddress} placeholder="140 George St, Ottawa, ON K1N 5T6" placeholderTextColor={Colors.t3} />

        <Text style={s.label}>REGION</Text>
        <View style={s.chipsRow}>
          {REGIONS.map(r => (
            <TouchableOpacity key={r.code} style={[s.chip, region === r.code && s.chipActive]} onPress={() => setRegion(r.code)}>
              <Text style={[s.chipText, region === r.code && s.chipTextActive]}>{r.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.row2}>
          <View style={{ flex:1 }}>
            <Text style={s.label}>LATITUDE</Text>
            <TextInput style={s.input} value={latitude} onChangeText={setLatitude} keyboardType="numbers-and-punctuation" placeholder="45.4268" placeholderTextColor={Colors.t3} />
          </View>
          <View style={{ flex:1 }}>
            <Text style={s.label}>LONGITUDE</Text>
            <TextInput style={s.input} value={longitude} onChangeText={setLongitude} keyboardType="numbers-and-punctuation" placeholder="-75.6910" placeholderTextColor={Colors.t3} />
          </View>
        </View>

        <TouchableOpacity style={s.gpsBtn} onPress={handleUseGps} disabled={gpsLoading} activeOpacity={0.85}>
          {gpsLoading
            ? <ActivityIndicator color={Colors.accent} size="small" />
            : <Text style={s.gpsBtnText}>📍 Use my current location</Text>}
        </TouchableOpacity>

        <View style={s.row2}>
          <View style={{ flex:1 }}>
            <Text style={s.label}>RADIUS (m)</Text>
            <TextInput style={s.input} value={radius} onChangeText={setRadius} keyboardType="number-pad" placeholder="100" placeholderTextColor={Colors.t3} />
          </View>
          <View style={{ flex:1 }}>
            <Text style={s.label}>TIMEZONE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap:6 }}>
              {COMMON_TZS.map(tz => (
                <TouchableOpacity key={tz} style={[s.tzChip, timezone === tz && s.chipActive]} onPress={() => setTimezone(tz)}>
                  <Text style={[s.chipText, timezone === tz && s.chipTextActive]} numberOfLines={1}>{tz.split("/")[1]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>

        <View style={s.activeRow}>
          <Text style={s.label}>ACTIVE</Text>
          <Switch value={isActive} onValueChange={setIsActive} trackColor={{ false:Colors.border, true:Colors.accent }} thumbColor="#fff" />
        </View>

        {!!error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity style={[s.saveBtn, saving && s.saveBtnOff]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
          <Text style={s.saveBtnText}>{saving ? "Saving…" : "+ Add zone"}</Text>
        </TouchableOpacity>

        <Text style={[s.section, { marginTop:32 }]}>EXISTING ({zones.length})</Text>
        {zones.map(z => (
          <View key={z.id} style={s.zoneCard}>
            {editingId === z.id ? (
              <View style={{ flex:1 }}>
                <Text style={s.label}>NAME</Text>
                <TextInput style={s.input} value={editName} onChangeText={setEditName} placeholder="Zone name" placeholderTextColor={Colors.t3} />
                <Text style={s.label}>ADDRESS</Text>
                <TextInput style={s.input} value={editAddress} onChangeText={setEditAddress} placeholder="Address" placeholderTextColor={Colors.t3} />
                <View style={s.editBtnRow}>
                  <TouchableOpacity style={[s.editSaveBtn, savingEdit && s.saveBtnOff]} onPress={() => saveEditZone(z)} disabled={savingEdit} activeOpacity={0.85}>
                    <Text style={s.editSaveText}>{savingEdit ? "Saving…" : "Save"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.editCancelBtn} onPress={() => setEditingId(null)} disabled={savingEdit} activeOpacity={0.85}>
                    <Text style={s.editCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                <View style={{ flex:1 }}>
                  <Text style={[s.zoneName, !z.is_active && { color: Colors.t3 }]}>{z.name}</Text>
                  <Text style={s.zoneAddr}>{z.address || "—"}</Text>
                  <Text style={s.zoneMeta}>{z.region}  ·  {z.timezone}  ·  {z.radius_meters}m  ·  {z.latitude.toFixed(4)}, {z.longitude.toFixed(4)}</Text>
                </View>
                <View style={s.zoneActions}>
                  <TouchableOpacity onPress={() => startEditZone(z)} style={s.zoneEditBtn} activeOpacity={0.7}>
                    <Text style={s.zoneEditText}>✏️</Text>
                  </TouchableOpacity>
                  <Switch value={z.is_active} onValueChange={() => handleToggleActive(z)} trackColor={{ false:Colors.border, true:Colors.accent }} thumbColor="#fff" />
                </View>
              </>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex:1, backgroundColor:Colors.bg },
  header:      { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:16, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  back:        { fontSize:20, color:Colors.t2, width:24 },
  title:       { fontSize:17, fontWeight:"700", color:Colors.t1 },
  inner:       { padding:20, paddingBottom:80 },
  center:      { flex:1, alignItems:"center", justifyContent:"center", padding:32 },
  denyTitle:   { fontSize:18, fontWeight:"700", color:Colors.t1, marginBottom:8 },
  denyText:    { fontSize:13, color:Colors.t3, textAlign:"center" },
  section:     { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:10 },
  label:       { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:6, marginTop:4 },
  input:       { backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, padding:12, color:Colors.t1, fontSize:14, marginBottom:14 },
  row2:        { flexDirection:"row", gap:10 },
  chipsRow:    { flexDirection:"row", flexWrap:"wrap", gap:6, marginBottom:14 },
  chip:        { paddingHorizontal:10, paddingVertical:6, borderRadius:8, borderWidth:1, borderColor:Colors.border, backgroundColor:Colors.card },
  tzChip:      { paddingHorizontal:10, paddingVertical:8, borderRadius:8, borderWidth:1, borderColor:Colors.border, backgroundColor:Colors.card },
  chipActive:  { borderColor:Colors.accent, backgroundColor:Colors.accent+"15" },
  chipText:    { color:Colors.t2, fontSize:12, fontWeight:"600" },
  chipTextActive:{ color:Colors.accent },
  gpsBtn:      { backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, padding:12, alignItems:"center", marginBottom:14 },
  gpsBtnText:  { color:Colors.accent, fontSize:13, fontWeight:"600" },
  activeRow:   { flexDirection:"row", alignItems:"center", justifyContent:"space-between", marginVertical:14, paddingVertical:6 },
  error:       { color:Colors.red, fontSize:12, marginBottom:8 },
  saveBtn:     { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginTop:4 },
  saveBtnOff:  { opacity:0.4 },
  saveBtnText: { fontSize:15, fontWeight:"700", color:Colors.accentText },
  zoneCard:    { flexDirection:"row", alignItems:"center", gap:10, backgroundColor:Colors.card, borderRadius:12, padding:12, marginBottom:8, borderWidth:0.5, borderColor:Colors.border },
  zoneName:    { fontSize:13, fontWeight:"600", color:Colors.t1 },
  zoneAddr:    { fontSize:11, color:Colors.t2, marginTop:2 },
  zoneMeta:    { fontSize:10, color:Colors.t3, marginTop:3 },
  zoneActions: { flexDirection:"row", alignItems:"center", gap:10 },
  zoneEditBtn: { padding:4 },
  zoneEditText:{ fontSize:16 },
  editBtnRow:  { flexDirection:"row", gap:8, marginTop:4 },
  editSaveBtn: { flex:1, backgroundColor:Colors.accent, borderRadius:10, paddingVertical:10, alignItems:"center" },
  editSaveText:{ color:Colors.accentText, fontSize:13, fontWeight:"700" },
  editCancelBtn:{ flex:1, backgroundColor:Colors.card, borderWidth:1, borderColor:Colors.border, borderRadius:10, paddingVertical:10, alignItems:"center" },
  editCancelText:{ color:Colors.t2, fontSize:13, fontWeight:"700" },
});
