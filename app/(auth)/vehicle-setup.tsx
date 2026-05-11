import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, TextInput, ActivityIndicator, FlatList, Image } from "react-native";
import { useRouter } from "expo-router";
import { DriversAPI } from "../../services/drivers";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { VehicleType } from "../../constants/types";
import { getSeatsForType } from "../../constants/vehicles";
import { getVehicleImageUrl } from "../../utils/vehicleImage";

// Seat count by vehicle type keywords
function detectType(make: string, model: string): VehicleType {
  const m = (make + " " + model).toLowerCase();
  if (m.includes("hiace") || m.includes("urvan") || m.includes("sprinter") || m.includes("transit") || m.includes("express") || m.includes("savana")) return "minibus";
  if (m.includes("coaster") || m.includes("econoline") || m.includes("e-series")) return "van";
  if (m.includes("suburban") || m.includes("tahoe") || m.includes("expedition") || m.includes("sequoia") || m.includes("land cruiser") || m.includes("pilot") || m.includes("odyssey") || m.includes("sienna") || m.includes("armada") || m.includes("yukon")) return "suv";
  if (m.includes("explorer") || m.includes("4runner") || m.includes("pathfinder") || m.includes("prado") || m.includes("pajero") || m.includes("fortuner") || m.includes("rav4") || m.includes("cr-v") || m.includes("escape") || m.includes("equinox") || m.includes("cherokee")) return "suv";
  return "sedan";
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 30 }, (_, i) => String(CURRENT_YEAR - i));

export default function VehicleSetupScreen() {
  const router = useRouter();
  const { t }  = useStrings();

  const [step,    setStep]    = useState<"year"|"make"|"model"|"plate">("year");
  const [year,    setYear]    = useState("");
  const [make,    setMake]    = useState("");
  const [model,   setModel]   = useState("");
  const [plate,   setPlate]   = useState("");
  const [makes,   setMakes]   = useState<string[]>([]);
  const [models,  setModels]  = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState("");
  const [error,   setError]   = useState("");
  const [saving,  setSaving]  = useState(false);

  // Fetch makes when year selected
  useEffect(() => {
    if (!year) return;
    setLoading(true);
    setMakes([]);
    fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json`)
      .then(r => r.json())
      .then(data => {
        const list = (data.Results || []).map((r: any) => r.MakeName).sort();
        setMakes(list);
        setLoading(false);
      })
      .catch(() => {
        // Fallback makes list
        setMakes(["Acura","BMW","Buick","Cadillac","Chevrolet","Chrysler","Dodge","Ford","GMC","Honda","Hyundai","Infiniti","Jeep","Kia","Lexus","Lincoln","Mazda","Mercedes-Benz","Mitsubishi","Nissan","Ram","Subaru","Tesla","Toyota","Volkswagen","Volvo"]);
        setLoading(false);
      });
  }, [year]);

  // Fetch models when make selected
  useEffect(() => {
    if (!year || !make) return;
    setLoading(true);
    setModels([]);
    fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`)
      .then(r => r.json())
      .then(data => {
        const list = (data.Results || []).map((r: any) => r.Model_Name).filter(Boolean).sort();
        setModels(list.length > 0 ? list : ["Other"]);
        setLoading(false);
      })
      .catch(() => {
        setModels(["Other"]);
        setLoading(false);
      });
  }, [year, make]);

  const filtered = (list: string[]) =>
    search ? list.filter(i => i.toLowerCase().includes(search.toLowerCase())) : list;

  const detectedType  = make && model ? detectType(make, model) : "sedan";
  const seats         = getSeatsForType(detectedType);

  const handleSave = async () => {
    if (!plate.trim()) { setError("Please enter your plate number"); return; }
    setSaving(true);
    const { error: err } = await DriversAPI.addVehicle({
      type:  detectedType,
      make:  make.trim(),
      model: model.trim(),
      year:  parseInt(year),
      plate: plate.trim().toUpperCase(),
    });
    setSaving(false);
    if (err) { setError(err); return; }
    router.push("/(auth)/email-setup");
  };

  const renderList = (items: string[], onSelect: (v: string) => void) => (
    <View style={s.listBox}>
      <TextInput
        style={s.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search..."
        placeholderTextColor={Colors.t3}
      />
      {loading ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={filtered(items)}
          keyExtractor={i => i}
          style={{ maxHeight: 320 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.listItem}
              onPress={() => { onSelect(item); setSearch(""); }}
              activeOpacity={0.7}
            >
              <Text style={s.listItemText}>{item}</Text>
              <Text style={{ color: Colors.t3, fontSize: 16 }}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => {
          if (step === "year") router.back();
          else if (step === "make") setStep("year");
          else if (step === "model") setStep("make");
          else setStep("model");
        }} style={s.backBtn}>
          <Text style={s.backText}>← {t.back}</Text>
        </TouchableOpacity>

        <Text style={s.logo}>LOADQ</Text>
        <View style={s.stepRow}>
          <Text style={s.stepText}>2 {t.stepOf} 3</Text>
          <View style={s.stepBar}><View style={[s.stepFill, { width: "66%" }]} /></View>
        </View>

        <Text style={s.title}>{t.setupVehicle}</Text>

        {/* Breadcrumb */}
        <View style={s.breadcrumb}>
          <Text style={[s.crumb, year && s.crumbDone]}>{year || "Year"}</Text>
          {year && <><Text style={s.crumbSep}>›</Text><Text style={[s.crumb, make && s.crumbDone]}>{make || "Make"}</Text></>}
          {make && <><Text style={s.crumbSep}>›</Text><Text style={[s.crumb, model && s.crumbDone]}>{model || "Model"}</Text></>}
        </View>

        {/* Year selection */}
        {step === "year" && (
          <>
            <Text style={s.stepTitle}>Select year</Text>
            <FlatList
              data={YEARS}
              keyExtractor={i => i}
              numColumns={4}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.yearBtn, year === item && s.yearBtnActive]}
                  onPress={() => { setYear(item); setStep("make"); setMake(""); setModel(""); }}
                  activeOpacity={0.7}
                >
                  <Text style={[s.yearBtnText, year === item && { color: Colors.accent }]}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        {/* Make selection */}
        {step === "make" && (
          <>
            <Text style={s.stepTitle}>Select make</Text>
            {renderList(makes, (v) => { setMake(v); setStep("model"); setModel(""); })}
          </>
        )}

        {/* Model selection */}
        {step === "model" && (
          <>
            <Text style={s.stepTitle}>Select model</Text>
            {renderList(models, (v) => { setModel(v); setStep("plate"); })}
          </>
        )}

        {/* Plate + confirm */}
        {step === "plate" && (
          <>
            <View style={s.summaryCard}>
              <Image
                source={{ uri: getVehicleImageUrl(make, model, parseInt(year)) }}
                style={s.vehicleImg}
                resizeMode="contain"
              />
              <Text style={s.summaryTitle}>{year} {make} {model}</Text>
              <View style={s.typeBadge}>
                <Text style={s.typeBadgeText}>{detectedType.replace("_"," ")} · {seats} seats</Text>
              </View>
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

            {!!error && <Text style={s.error}>{error}</Text>}

            <TouchableOpacity
              style={[s.btn, (!plate || saving) && s.btnOff]}
              onPress={handleSave}
              disabled={!plate || saving}
              activeOpacity={0.85}
            >
              <Text style={s.btnText}>{saving ? t.loading : t.next + " →"}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:      { flex:1, backgroundColor:Colors.bg },
  inner:          { padding:24, paddingBottom:60, paddingTop:80 },
  backBtn:        { position:"absolute", top:52, left:24, zIndex:10 },
  backText:       { color:Colors.t2, fontSize:14 },
  logo:           { fontSize:24, fontWeight:"900", color:Colors.accent, letterSpacing:3, marginBottom:16 },
  stepRow:        { marginBottom:16 },
  stepText:       { color:Colors.t3, fontSize:11, marginBottom:6 },
  stepBar:        { height:3, backgroundColor:Colors.border, borderRadius:2 },
  stepFill:       { height:3, backgroundColor:Colors.accent, borderRadius:2 },
  title:          { fontSize:22, fontWeight:"700", color:Colors.t1, marginBottom:12 },
  breadcrumb:     { flexDirection:"row", alignItems:"center", gap:6, marginBottom:20, flexWrap:"wrap" },
  crumb:          { fontSize:13, color:Colors.t3, fontWeight:"500" },
  crumbDone:      { color:Colors.accent },
  crumbSep:       { color:Colors.t3, fontSize:13 },
  stepTitle:      { fontSize:16, fontWeight:"600", color:Colors.t1, marginBottom:12 },
  listBox:        { backgroundColor:Colors.card, borderRadius:14, borderWidth:1, borderColor:Colors.border, overflow:"hidden" },
  search:         { padding:14, color:Colors.t1, fontSize:14, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  listItem:       { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:14, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  listItemText:   { color:Colors.t1, fontSize:14 },
  yearBtn:        { flex:1, margin:4, backgroundColor:Colors.card, borderRadius:10, padding:12, alignItems:"center", borderWidth:1, borderColor:Colors.border },
  yearBtnActive:  { borderColor:Colors.accent, backgroundColor:Colors.accent+"15" },
  yearBtnText:    { color:Colors.t2, fontSize:13, fontWeight:"500" },
  summaryCard:    { backgroundColor:Colors.card, borderRadius:14, padding:16, borderWidth:1, borderColor:Colors.accent+"40", marginBottom:24 },
  vehicleImg:     { width:"100%", height:140, borderRadius:10, marginBottom:12 },
  summaryTitle:   { fontSize:18, fontWeight:"700", color:Colors.t1, marginBottom:8 },
  typeBadge:      { backgroundColor:Colors.accent+"20", borderRadius:8, paddingHorizontal:10, paddingVertical:4, alignSelf:"flex-start" },
  typeBadgeText:  { color:Colors.accent, fontSize:12, fontWeight:"600" },
  label:          { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.8, marginBottom:6 },
  input:          { backgroundColor:Colors.card, borderRadius:12, borderWidth:1, borderColor:Colors.border, padding:14, color:Colors.t1, fontSize:15, marginBottom:16 },
  error:          { color:Colors.red, fontSize:13, marginBottom:12 },
  btn:            { backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center" },
  btnOff:         { opacity:0.4 },
  btnText:        { fontSize:16, fontWeight:"700", color:Colors.accentText },
});
