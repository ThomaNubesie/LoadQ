import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

export default function AlertsScreen() {
  const router     = useRouter();
  const navigation = useNavigation();
  const goBack = () => { if (navigation.canGoBack()) goBack(); else router.replace("/(app)/zone-select"); };
  const { t }  = useStrings();

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBack()}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t.notifications}</Text>
        <View style={{ width:24 }} />
      </View>
      <View style={s.empty}>
        <Text style={s.emptyEmoji}>🔔</Text>
        <Text style={s.emptyText}>No alerts yet</Text>
        <Text style={s.emptySub}>You'll be notified when your slot opens or a return timer starts</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:Colors.bg },
  header:    { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:16, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  back:      { fontSize:20, color:Colors.t2, width:24 },
  title:     { fontSize:17, fontWeight:"700", color:Colors.t1 },
  empty:     { flex:1, alignItems:"center", justifyContent:"center", padding:32 },
  emptyEmoji:{ fontSize:48, marginBottom:16 },
  emptyText: { fontSize:18, fontWeight:"700", color:Colors.t1, marginBottom:8 },
  emptySub:  { fontSize:13, color:Colors.t3, textAlign:"center", lineHeight:20 },
});
