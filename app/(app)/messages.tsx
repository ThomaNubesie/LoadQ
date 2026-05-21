import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Colors } from "../../constants/colors";
import { MessagesAPI } from "../../services/messages";
import MessageThreadView from "../../components/MessageThreadView";
import UserActionMenu from "../../components/UserActionMenu";

export default function DriverMessagesScreen() {
  const router = useRouter();
  const [adminId, setAdminId] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    (async () => {
      const id = await MessagesAPI.getAdminId();
      setAdminId(id);
      setResolved(true);
    })();
  }, []);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/profile")}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>Messages</Text>
        <View style={{ width: 24, alignItems: "flex-end" }}>
          {adminId && <UserActionMenu userId={adminId} userName="LoadQ Support" />}
        </View>
      </View>

      {!resolved
        ? <Text style={s.empty}>Loading…</Text>
        : !adminId
          ? <Text style={s.empty}>Support is unavailable right now.</Text>
          : <MessageThreadView otherId={adminId} otherName="LoadQ Support" />}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  back:      { fontSize: 20, color: Colors.t2, width: 24 },
  title:     { fontSize: 17, fontWeight: "700", color: Colors.t1 },
  empty:     { color: Colors.t3, textAlign: "center", marginTop: 40 },
});
