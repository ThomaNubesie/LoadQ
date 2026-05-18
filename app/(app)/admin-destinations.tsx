import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { DestinationsAPI, DestinationRow } from "../../services/destinations";
import { useDestinations } from "../../hooks/useDestinations";
import { Colors } from "../../constants/colors";

export default function AdminDestinationsScreen() {
  const router = useRouter();
  const { refresh } = useDestinations();

  const [rows,    setRows]    = useState<DestinationRow[]>([]);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setRows(await DestinationsAPI.list(true)); // include inactive
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      let admin = false;
      if (user) {
        const { data } = await supabase.from("drivers").select("is_admin").eq("id", user.id).maybeSingle();
        admin = !!data?.is_admin;
      }
      setAllowed(admin);
      if (admin) await reload();
      setLoading(false);
    })();
  }, []);

  const toggle = async (d: DestinationRow) => {
    const activeCount = rows.filter(r => r.is_active).length;
    if (d.is_active && activeCount <= 1) {
      Alert.alert("Can't disable", "At least one destination must stay active.");
      return;
    }
    const { error } = await DestinationsAPI.setActive(d.code, !d.is_active);
    if (error) { Alert.alert("Error", error); return; }
    await reload();
    await refresh(); // update the cached active list app-wide
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
          <Text style={s.title}>Admin · Destinations</Text>
          <View style={{ width: 24 }} />
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
        <Text style={s.title}>Admin · Destinations</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={s.note}>
        Toggle a destination off to remove it from every zone's queue and all pickers.
        Existing queue entries are unaffected.
      </Text>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {rows.map(d => (
          <View key={d.code} style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={[s.name, !d.is_active && { color: Colors.t3 }]}>{d.name}</Text>
              <Text style={s.code}>{d.code}{d.is_active ? "" : " · removed"}</Text>
            </View>
            <Switch
              value={d.is_active}
              onValueChange={() => toggle(d)}
              trackColor={{ false: Colors.border, true: Colors.accent }}
              thumbColor="#fff"
            />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:Colors.bg },
  header:    { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:16, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  back:      { fontSize:20, color:Colors.t2, width:24 },
  title:     { fontSize:17, fontWeight:"700", color:Colors.t1 },
  note:      { fontSize:12, color:Colors.t3, padding:16, lineHeight:18 },
  center:    { flex:1, alignItems:"center", justifyContent:"center", padding:32 },
  denyTitle: { fontSize:18, fontWeight:"700", color:Colors.t1, marginBottom:8 },
  denyText:  { fontSize:13, color:Colors.t3, textAlign:"center" },
  row:       { flexDirection:"row", alignItems:"center", gap:10, backgroundColor:Colors.card, borderRadius:12, padding:14, marginBottom:8, borderWidth:0.5, borderColor:Colors.border },
  name:      { fontSize:14, fontWeight:"600", color:Colors.t1 },
  code:      { fontSize:11, color:Colors.t3, marginTop:2 },
});
