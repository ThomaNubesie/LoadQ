import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { QueueAPI } from "../../services/queue";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

export default function AdminQueueHoursScreen() {
  const router = useRouter();
  const { t } = useStrings();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [reg,   setReg]   = useState("0");
  const [load,  setLoad]  = useState("5");
  const [close, setClose] = useState("23");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      let admin = false;
      if (user) {
        const { data } = await supabase.from("drivers").select("is_admin").eq("id", user.id).maybeSingle();
        admin = !!data?.is_admin;
      }
      setAllowed(admin);
      if (admin) {
        const w = await QueueAPI.getQueueWindow();
        setReg(String(w.register_open_hour));
        setLoad(String(w.load_open_hour));
        setClose(String(w.close_hour));
      }
      setLoading(false);
    })();
  }, []);

  const clampHour = (v: string): number | null => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 0 || n > 23) return null;
    return n;
  };

  const save = async () => {
    const r = clampHour(reg), l = clampHour(load), c = clampHour(close);
    if (r === null || l === null || c === null) {
      Alert.alert("Invalid", "Each hour must be a number from 0 to 23.");
      return;
    }
    setSaving(true);
    const { error } = await QueueAPI.setQueueWindow(r, l, c);
    setSaving(false);
    if (error) { Alert.alert("Error", error); return; }
    Alert.alert(t.savedLabel);
  };

  if (loading) {
    return (
      <SafeAreaView style={s.container}><View style={s.center}><ActivityIndicator color={Colors.accent} /></View></SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.replace("/(app)/profile")}><Text style={s.back}>←</Text></TouchableOpacity>
          <Text style={s.title}>{t.queueHoursTitle}</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={s.center}>
          <Text style={s.denyTitle}>{t.notAuthorisedTitle}</Text>
          <Text style={s.denyText}>{t.notAuthorisedBody}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const field = (label: string, value: string, onChange: (v: string) => void) => (
    <View style={s.row}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChange} keyboardType="number-pad" maxLength={2}
        style={s.input}
      />
    </View>
  );

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/profile")}><Text style={s.back}>←</Text></TouchableOpacity>
        <Text style={s.title}>{t.queueHoursTitle}</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={s.note}>{t.queueHoursNote}</Text>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {field(t.registrationOpens, reg, setReg)}
        {field(t.loadingStarts, load, setLoad)}
        {field(t.closesAt, close, setClose)}

        <TouchableOpacity style={s.saveBtn} onPress={save} disabled={saving} activeOpacity={0.85}>
          <Text style={s.saveBtnText}>{saving ? "…" : t.saveLabel}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:  { flex:1, backgroundColor:Colors.bg },
  header:     { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:16, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  back:       { fontSize:20, color:Colors.t2, width:24 },
  title:      { fontSize:17, fontWeight:"700", color:Colors.t1 },
  note:       { fontSize:12, color:Colors.t3, padding:16, lineHeight:18 },
  center:     { flex:1, alignItems:"center", justifyContent:"center", padding:32 },
  denyTitle:  { fontSize:18, fontWeight:"700", color:Colors.t1, marginBottom:8 },
  denyText:   { fontSize:13, color:Colors.t3, textAlign:"center" },
  row:        { flexDirection:"row", alignItems:"center", justifyContent:"space-between", gap:10, backgroundColor:Colors.card, borderRadius:12, padding:14, marginBottom:8, borderWidth:0.5, borderColor:Colors.border },
  fieldLabel: { fontSize:14, fontWeight:"600", color:Colors.t1, flex:1 },
  input:      { width:72, backgroundColor:Colors.bg, borderColor:Colors.border, borderWidth:1, borderRadius:10, color:Colors.t1, paddingVertical:10, fontSize:20, fontWeight:"800", textAlign:"center" },
  saveBtn:    { marginTop:18, backgroundColor:Colors.accent, borderRadius:12, padding:15, alignItems:"center" },
  saveBtnText:{ color:Colors.accentText, fontWeight:"800", fontSize:16 },
});
