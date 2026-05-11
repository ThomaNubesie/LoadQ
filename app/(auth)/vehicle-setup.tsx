import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Image } from "react-native";
import { useRouter } from "expo-router";
import { DriversAPI } from "../../services/drivers";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { VEHICLE_TYPES, getSeatsForType } from "../../constants/vehicles";
import { VehicleType } from "../../constants/types";
import { getVehicleImageUrl, getFallbackColor } from "../../utils/vehicleImage";

export default function VehicleSetupScreen() {
  const router = useRouter();
  const { t }  = useStrings();
  const [type,    setType]    = useState<VehicleType>("minibus");
  const [make,    setMake]    = useState("");
  const [model,   setModel]   = useState("");
  const [year,    setYear]    = useState("");
  const [plate,   setPlate]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const seats  = getSeatsForType(type);
  const imgUrl = make && model ? getVehicleImageUrl(make, model, year ? parseInt(year) : undefined) : null;

  const handleNext = async () => {
    if (!make || !model || !plate) { setError("Please fill in all vehicle fields"); return; }
    setLoading(true);
    const { error: err } = await DriversAPI.addVehicle({ type, make:make.trim(), model:model.trim(), year:parseInt(year)||new Date().getFullYear(), plate:plate.trim().toUpperCase() });
    setLoading(false);
    if (err) { setError(err); return; }
    router.push("/(auth)/email-setup");
  };

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← {t.back}</Text>
        </TouchableOpacity>

        <Text style={s.logo}>LOADQ</Text>
        <View style={s.stepRow}>
          <Text style={s.stepText}>2 {t.stepOf} 3</Text>
          <View style={s.stepBar}><View style={[s.stepFill, { width:"66%" }]} /></View>
        </View>
        <Text style={s.title}>{t.setupVehicle}</Text>
        <Text style={s.sub}>{t.setupVehicleSub}</Text>

        <Text style={s.label}>{t.vehicleType.toUpperCase()}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:18 }}>
          <View style={{ flexDirection:"row", gap:8 }}>
            {(Object.entries(VEHICLE_TYPES) as [VehicleType, any][]).map(([key, val]) => (
              <TouchableOpacity key={key} style={[s.typeChip, type===key && s.typeChipActive]} onPress={() => setType(key)} activeOpacity={0.8}>
                <Text style={[s.typeChipText, type===key && { color:Colors.accent }]}>{val.label}</Text>
                <Text style={[s.typeChipSeats, type===key && { color:Colors.accent }]}>{val.seats} {t.seats}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View style={s.imgBox}>
          {imgUrl ? (
            <Image source={{ uri:imgUrl }} style={s.img} resizeMode="contain" />
          ) : (
            <View style={s.imgPlaceholder}>
              <Text style={{ fontSize:36 }}>🚌</Text>
              <Text style={{ color:Colors.t3, fontSize:11, marginTop:6 }}>Enter make & model to preview</Text>
            </View>
          )}
          <View style={s.seatBadge}><Text style={s.seatBadgeText}>{seats} {t.seats}</Text></View>
        </View>

        <Text style={s.label}>{t.makeModel.toUpperCase()}</Text>
        <View style={{ flexDirection:"row", gap:10, marginBottom:18 }}>
          <TextInput style={[s.input,{flex:1}]} value={make} onChangeText={setMake} placeholder="Toyota" placeholderTextColor={Colors.t3} autoCapitalize="words" />
          <TextInput style={[s.input,{flex:1.5}]} value={model} onChangeText={setModel} placeholder="HiAce" placeholderTextColor={Colors.t3} autoCapitalize="words" />
        </View>

        <View style={{ flexDirection:"row", gap:10, marginBottom:18 }}>
          <View style={{ flex:1 }}>
            <Text style={s.label}>{t.year.toUpperCase()}</Text>
            <TextInput style={s.input} value={year} onChangeText={setYear} placeholder="2020" placeholderTextColor={Colors.t3} keyboardType="number-pad" maxLength={4} />
          </View>
          <View style={{ flex:1.5 }}>
            <Text style={s.label}>{t.plateNumber.toUpperCase()}</Text>
            <TextInput style={s.input} value={plate} onChangeText={v => setPlate(v.toUpperCase())} placeholder="ABC-1234" placeholderTextColor={Colors.t3} autoCapitalize="characters" />
          </View>
        </View>

        {!!error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity style={[s.btn, (!make||!model||!plate||loading) && s.btnOff]} onPress={handleNext} disabled={!make||!model||!plate||loading} activeOpacity={0.85}>
          <Text style={s.btnText}>{loading ? t.loading : t.next + " →"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:     { flex:1, backgroundColor:Colors.bg },
  inner:         { padding:24, paddingBottom:48, paddingTop:80 },
  backBtn:       { position:"absolute", top:52, left:24, zIndex:10 },
  backText:      { color:Colors.t2, fontSize:14 },
  logo:          { fontSize:24, fontWeight:"900", color:Colors.accent, letterSpacing:3, marginBottom:16 },
  stepRow:       { marginBottom:24 },
  stepText:      { color:Colors.t3, fontSize:11, marginBottom:6 },
  stepBar:       { height:3, backgroundColor:Colors.border, borderRadius:2 },
  stepFill:      { height:3, backgroundColor:Colors.accent, borderRadius:2 },
  title:         { fontSize:22, fontWeight:"700", color:Colors.t1, marginBottom:6 },
  sub:           { fontSize:13, color:Colors.t2, marginBottom:24, lineHeight:20 },
  label:         { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:6 },
  typeChip:      { paddingHorizontal:14, paddingVertical:10, borderRadius:10, borderWidth:1, borderColor:Colors.border, backgroundColor:Colors.card, alignItems:"center", minWidth:80 },
  typeChipActive:{ borderColor:Colors.accent, backgroundColor:Colors.accent+"15" },
  typeChipText:  { color:Colors.t2, fontSize:11, fontWeight:"600" },
  typeChipSeats: { color:Colors.t3, fontSize:10, marginTop:2 },
  imgBox:        { height:130, backgroundColor:Colors.card, borderRadius:14, borderWidth:1, borderColor:Colors.border, marginBottom:20, overflow:"hidden", justifyContent:"center", alignItems:"center", position:"relative" },
  img:           { width:"100%", height:"100%" },
  imgPlaceholder:{ alignItems:"center" },
  seatBadge:     { position:"absolute", bottom:8, right:8, backgroundColor:Colors.accent, borderRadius:8, paddingHorizontal:10, paddingVertical:4 },
  seatBadgeText: { color:Colors.accentText, fontSize:11, fontWeight:"700" },
  input:         { backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, padding:14, color:Colors.t1, fontSize:15 },
  error:         { color:Colors.red, fontSize:13, marginBottom:12 },
  btn:           { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginTop:8 },
  btnOff:        { opacity:0.4 },
  btnText:       { fontSize:16, fontWeight:"700", color:Colors.accentText },
});
