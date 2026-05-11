import { View, Text, StyleSheet, SafeAreaView, ScrollView } from "react-native";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

export default function AlertsScreen() {
  const { t } = useStrings();
  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>{t.notifications}</Text>
      </View>
      <ScrollView contentContainerStyle={s.inner}>
        <View style={s.empty}>
          <Text style={s.emptyEmoji}>🔔</Text>
          <Text style={s.emptyText}>No alerts yet</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:Colors.bg },
  header:    { padding:16 },
  title:     { fontSize:20, fontWeight:"700", color:Colors.t1 },
  inner:     { padding:20 },
  empty:     { alignItems:"center", marginTop:80 },
  emptyEmoji:{ fontSize:48, marginBottom:12 },
  emptyText: { fontSize:16, color:Colors.t2 },
});
