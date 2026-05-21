import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Colors } from "../../constants/colors";
import MessageThreadView from "../../components/MessageThreadView";
import UserActionMenu from "../../components/UserActionMenu";

export default function AdminThreadScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; role?: string; name?: string }>();
  const displayName = name || "User";

  if (!id) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>←</Text></TouchableOpacity>
          <Text style={s.title}>Thread</Text>
          <View style={{ width: 24 }} />
        </View>
        <Text style={s.empty}>Missing user id.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>←</Text></TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{displayName}</Text>
        <View style={{ width: 24, alignItems: "flex-end" }}>
          <UserActionMenu userId={id} userName={displayName} />
        </View>
      </View>
      <MessageThreadView otherId={id} otherName={displayName} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  back:      { fontSize: 20, color: Colors.t2, width: 24 },
  title:     { fontSize: 17, fontWeight: "700", color: Colors.t1, flex: 1, textAlign: "center" },
  empty:     { color: Colors.t3, textAlign: "center", marginTop: 40 },
});
