import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { DriversAPI } from "../../services/drivers";
import { Vehicle } from "../../constants/types";
import { CAR_COLORS } from "../../constants/vehicles";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

export default function EditVehicleScreen() {
  const router = useRouter();
  const { t }  = useStrings();
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [plate,   setPlate]   = useState("");
  const [color,   setColor]   = useState("");
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");

  useEffect(() => {
    (async () => {
      if (!vehicleId) { setLoading(false); return; }
      const v = await DriversAPI.getVehicle(vehicleId);
      setVehicle(v);
      setPlate(v?.plate ?? "");
      setColor(v?.color ?? "");
      setLoading(false);
    })();
  }, [vehicleId]);

  const handleSave = async () => {
    if (!vehicle) return;
    if (!plate.trim()) { setError("Plate number is required"); return; }
    if (!color)        { setError("Please select a colour"); return; }
    setSaving(true);
    const { error: err } = await DriversAPI.updateVehicle(vehicle.id, { plate, color });
    setSaving(false);
    if (err) { setError(err); return; }
    router.replace("/(app)/profile");
  };

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.center}><ActivityIndicator color={Colors.accent} /></View>
      </SafeAreaView>
    );
  }

  if (!vehicle) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.replace("/(app)/profile")}><Text style={s.back}>←</Text></TouchableOpacity>
          <Text style={s.title}>Edit vehicle</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={s.center}><Text style={s.muted}>Vehicle not found.</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/profile")}><Text style={s.back}>←</Text></TouchableOpacity>
        <Text style={s.title}>Edit vehicle</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        <View style={s.summaryCard}>
          <Text style={s.summaryTitle}>{vehicle.year} {vehicle.make} {vehicle.model}</Text>
          <Text style={s.summarySub}>{vehicle.seats} seats · {vehicle.type.replace("_", " ")}</Text>
          <Text style={s.summaryNote}>To change make/model/year, remove this vehicle and add a new one.</Text>
        </View>

        <Text style={s.label}>{t.plateNumber.toUpperCase()}</Text>
        <TextInput
          style={s.input}
          value={plate}
          onChangeText={v => { setPlate(v.toUpperCase()); setError(""); }}
          placeholder="ABC-1234"
          placeholderTextColor={Colors.t3}
          autoCapitalize="characters"
        />

        <Text style={s.label}>CAR COLOUR</Text>
        <View style={s.colorRow}>
          {CAR_COLORS.map(c => (
            <TouchableOpacity
              key={c.name}
              style={[s.colorChip, color === c.name && s.colorChipActive]}
              onPress={() => { setColor(c.name); setError(""); }}
              activeOpacity={0.8}
            >
              <View style={[s.swatch, { backgroundColor: c.hex }]} />
              <Text style={[s.colorText, color === c.name && { color: Colors.accent }]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {!!error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity
          style={[s.btn, (!plate || !color || saving) && s.btnOff]}
          onPress={handleSave}
          disabled={!plate || !color || saving}
          activeOpacity={0.85}
        >
          <Text style={s.btnText}>{saving ? t.loading : t.save}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:      { flex:1, backgroundColor:Colors.bg },
  header:         { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:16, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  back:           { fontSize:20, color:Colors.t2, width:24 },
  title:          { fontSize:17, fontWeight:"700", color:Colors.t1 },
  inner:          { padding:20, paddingBottom:48 },
  center:         { flex:1, alignItems:"center", justifyContent:"center", padding:32 },
  muted:          { color:Colors.t3, fontSize:14 },
  summaryCard:    { backgroundColor:Colors.card, borderRadius:14, padding:16, borderWidth:1, borderColor:Colors.accent+"40", marginBottom:24 },
  summaryTitle:   { fontSize:18, fontWeight:"700", color:Colors.t1 },
  summarySub:     { fontSize:12, color:Colors.t2, marginTop:4 },
  summaryNote:    { fontSize:11, color:Colors.t3, marginTop:8, fontStyle:"italic" },
  label:          { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:6 },
  input:          { backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, padding:14, color:Colors.t1, fontSize:15, marginBottom:18 },
  colorRow:       { flexDirection:"row", flexWrap:"wrap", gap:8, marginBottom:18 },
  colorChip:      { flexDirection:"row", alignItems:"center", gap:6, paddingHorizontal:10, paddingVertical:8, borderRadius:10, borderWidth:1, borderColor:Colors.border, backgroundColor:Colors.card },
  colorChipActive:{ borderColor:Colors.accent, backgroundColor:Colors.accent+"15" },
  swatch:         { width:14, height:14, borderRadius:7, borderWidth:0.5, borderColor:Colors.border },
  colorText:      { color:Colors.t2, fontSize:12, fontWeight:"600" },
  error:          { color:Colors.red, fontSize:13, marginBottom:12 },
  btn:            { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginTop:4 },
  btnOff:         { opacity:0.4 },
  btnText:        { fontSize:16, fontWeight:"700", color:Colors.accentText },
});
