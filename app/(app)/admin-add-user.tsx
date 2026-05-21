import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../../services/supabase";
import { Colors } from "../../constants/colors";

type Role = "driver" | "passenger";

export default function AdminAddUserScreen() {
  const router = useRouter();
  const [role, setRole]         = useState<Role>("driver");
  const [fullName, setFullName] = useState("");
  const [email, setEmail]       = useState("");
  const [phone, setPhone]       = useState("");
  const [busy, setBusy]         = useState(false);

  const create = async () => {
    if (!fullName.trim()) { Alert.alert("Name required"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_create_user", {
      p_table:     role === "driver" ? "drivers" : "passengers",
      p_full_name: fullName,
      p_email:     email,
      p_phone:     phone,
    });
    setBusy(false);
    if (error) { Alert.alert("Could not create", error.message); return; }
    Alert.alert(
      "User created",
      `Profile saved. When ${email || "the user"} signs in with this email, their account will be linked.`,
      [{ text: "View", onPress: () => router.replace({ pathname: "/(app)/admin-user" as any, params: { id: data as string, role } }) },
       { text: "Add another", onPress: () => { setFullName(""); setEmail(""); setPhone(""); } }],
    );
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>←</Text></TouchableOpacity>
        <Text style={s.title}>Add user</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={s.label}>Role</Text>
        <View style={s.roleRow}>
          <TouchableOpacity
            style={[s.roleBtn, role === "driver" && s.roleBtnActive]}
            onPress={() => setRole("driver")}
            activeOpacity={0.85}
          >
            <Text style={[s.roleBtnText, role === "driver" && s.roleBtnTextActive]}>🚗  Driver</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.roleBtn, role === "passenger" && s.roleBtnActive]}
            onPress={() => setRole("passenger")}
            activeOpacity={0.85}
          >
            <Text style={[s.roleBtnText, role === "passenger" && s.roleBtnTextActive]}>🎒  Passenger</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.label}>Full name *</Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          style={s.input}
          placeholder="John Doe"
          placeholderTextColor={Colors.t3}
        />

        <Text style={s.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          style={s.input}
          placeholder="user@example.com"
          placeholderTextColor={Colors.t3}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={s.label}>Phone</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          style={s.input}
          placeholder="613-555-0123"
          placeholderTextColor={Colors.t3}
          keyboardType="phone-pad"
        />

        <Text style={s.hint}>
          A profile row is created now. When this user signs in with the same email later, their auth account will be linked to this profile.
        </Text>

        <TouchableOpacity style={[s.submit, busy && { opacity: 0.6 }]} disabled={busy} onPress={create} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color={Colors.accentText} /> : <Text style={s.submitText}>Create profile</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: Colors.bg },
  header:           { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  back:             { fontSize: 20, color: Colors.t2, width: 24 },
  title:            { fontSize: 17, fontWeight: "700", color: Colors.t1 },
  label:            { color: Colors.t3, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, marginTop: 16, marginBottom: 6 },
  roleRow:          { flexDirection: "row", gap: 8 },
  roleBtn:          { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: "center" },
  roleBtnActive:    { borderColor: Colors.accent, backgroundColor: Colors.accent + "18" },
  roleBtnText:      { color: Colors.t1, fontSize: 14, fontWeight: "700" },
  roleBtnTextActive:{ color: Colors.accent },
  input:            { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, color: Colors.t1, backgroundColor: Colors.card, fontSize: 15 },
  hint:             { color: Colors.t3, fontSize: 11, marginTop: 16, lineHeight: 16 },
  submit:           { backgroundColor: Colors.accent, padding: 14, borderRadius: 10, alignItems: "center", marginTop: 24 },
  submitText:       { color: Colors.accentText, fontSize: 15, fontWeight: "800" },
});
