import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Colors } from "../../constants/colors";
import MessageThreadView from "../../components/MessageThreadView";
import UserActionMenu from "../../components/UserActionMenu";
import { useStrings } from "../../hooks/useStrings";

export default function ThreadScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const { id, name, phone } = useLocalSearchParams<{ id: string; name?: string; phone?: string }>();
  const displayName = name || t("driver");

  if (!id) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>←</Text></TouchableOpacity>
          <Text style={s.title}>{t("messages")}</Text>
          <View style={{ width: 24 }} />
        </View>
        <Text style={s.empty}>{t("missingUserId")}</Text>
      </SafeAreaView>
    );
  }

  const call = () => {
    if (!phone) {
      Alert.alert(t("noPhoneNumber"), t("noPhoneNumberDesc"));
      return;
    }
    Linking.openURL(`tel:${phone}`);
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>←</Text></TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{displayName}</Text>
        <View style={s.headerActions}>
          {phone && (
            <TouchableOpacity onPress={call} style={s.callBtn} activeOpacity={0.7}>
              <Text style={s.callBtnText}>📞</Text>
            </TouchableOpacity>
          )}
          <UserActionMenu userId={id} userName={displayName} />
        </View>
      </View>
      <MessageThreadView otherId={id} otherName={displayName} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: Colors.bg },
  header:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  back:           { fontSize: 20, color: Colors.t2, width: 24 },
  title:          { fontSize: 17, fontWeight: "700", color: Colors.t1, flex: 1, textAlign: "center" },
  headerActions:  { flexDirection: "row", alignItems: "center", gap: 12 },
  callBtn:        { paddingHorizontal: 4, paddingVertical: 4 },
  callBtnText:    { fontSize: 18 },
  empty:          { color: Colors.t3, textAlign: "center", marginTop: 40 },
});
