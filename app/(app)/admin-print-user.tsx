import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Alert, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { supabase } from "../../services/supabase";
import { Colors } from "../../constants/colors";
import { ReferralAPI } from "../../services/referral";
import VerifiedBadge from "../../components/VerifiedBadge";

type Role = "driver" | "passenger";

interface PrintData {
  id:         string;
  full_name:  string | null;
  email:      string | null;
  phone:      string | null;
  avatar_url: string | null;
  dob:        string | null;
  sex:        string | null;
  verified?:  boolean;
  created_at: string;
  vehicle?:   { make: string; model: string; year: number; plate: string; color: string | null; seats: number } | null;
}

function shortId(uuid: string) {
  return uuid.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return "—"; }
}

export default function AdminPrintUserScreen() {
  const router = useRouter();
  const { id, role } = useLocalSearchParams<{ id: string; role: Role }>();
  const isDriver = role === "driver";

  const [data, setData] = useState<PrintData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!id) { setLoading(false); return; }
      if (isDriver) {
        const { data: drv } = await supabase.from("drivers")
          .select("id, full_name, email, phone, avatar_url, dob, sex, verified, created_at")
          .eq("id", id).maybeSingle();
        const { data: veh } = await supabase.from("vehicles")
          .select("make, model, year, plate, color, seats")
          .eq("driver_id", id).eq("is_active", true).maybeSingle();
        if (drv) setData({ ...drv, vehicle: veh ?? null } as PrintData);
      } else {
        const { data: pas } = await supabase.from("passengers")
          .select("id, full_name, email, phone, avatar_url, dob, sex, created_at")
          .eq("id", id).maybeSingle();
        if (pas) setData(pas as PrintData);
      }
      setLoading(false);
    })();
  }, [id, isDriver]);

  const onShare = async () => {
    if (!data) return;
    const driverNum = shortId(data.id);
    const text = isDriver
      ? `LoadQ Driver Card

Driver #: ${driverNum}
Name: ${data.full_name || "—"}
Phone: ${data.phone || "—"}
Email: ${data.email || "—"}
Verified: ${data.verified ? "yes" : "no"}
${data.vehicle ? `Vehicle: ${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}
Plate: ${data.vehicle.plate}
Seats: ${data.vehicle.seats}` : ""}
Joined: ${fmtDate(data.created_at)}

Driver link: ${ReferralAPI.link(data.id)}`
      : `LoadQ Passenger Card

Passenger #: ${driverNum}
Name: ${data.full_name || "—"}
Phone: ${data.phone || "—"}
Email: ${data.email || "—"}
Joined: ${fmtDate(data.created_at)}`;
    try {
      await Share.share({ message: text });
    } catch (e: any) {
      Alert.alert("Could not share", e?.message || "");
    }
  };

  if (loading || !data) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>←</Text></TouchableOpacity>
          <Text style={s.title}>Print</Text><View style={{ width: 24 }} />
        </View>
        <Text style={s.empty}>{loading ? "Loading…" : "User not found"}</Text>
      </SafeAreaView>
    );
  }

  const driverNum = shortId(data.id);
  const qrUrl     = ReferralAPI.link(data.id);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>←</Text></TouchableOpacity>
        <Text style={s.title}>Print</Text>
        <TouchableOpacity onPress={onShare}><Text style={s.share}>Share</Text></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View style={s.card}>
          <Text style={s.brand}>LoadQ</Text>
          <Text style={s.cardKind}>{isDriver ? "DRIVER CARD" : "PASSENGER CARD"}</Text>

          <View style={s.row}>
            {data.avatar_url
              ? <Image source={{ uri: data.avatar_url }} style={s.avatar} />
              : <View style={[s.avatar, s.avatarPh]}><Text style={{ fontSize: 28 }}>👤</Text></View>}
            <View style={{ flex: 1, marginLeft: 16 }}>
              <View style={s.nameRow}>
                <Text style={s.name}>{data.full_name || "(no name)"}</Text>
                {isDriver && data.verified && <VerifiedBadge size={16} />}
              </View>
              <Text style={s.num}>#{driverNum}</Text>
            </View>
          </View>

          <View style={s.divider} />

          <PrintField k="Phone"  v={data.phone || "—"} />
          <PrintField k="Email"  v={data.email || "—"} />
          <PrintField k="DOB"    v={fmtDate(data.dob)} />
          <PrintField k="Sex"    v={data.sex || "—"} />
          <PrintField k="Joined" v={fmtDate(data.created_at)} />

          {isDriver && data.vehicle && (
            <>
              <View style={s.divider} />
              <Text style={s.section}>VEHICLE</Text>
              <PrintField k="Make/Model" v={`${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}`} />
              <PrintField k="Plate"  v={data.vehicle.plate || "—"} />
              <PrintField k="Color"  v={data.vehicle.color || "—"} />
              <PrintField k="Seats"  v={String(data.vehicle.seats)} />
            </>
          )}

          {isDriver && (
            <>
              <View style={s.divider} />
              <View style={s.qrBox}>
                <View style={s.qr}>
                  <QRCode value={qrUrl} size={170} color="#000" backgroundColor="#fff" />
                </View>
                <Text style={s.qrLabel}>Scan to view driver</Text>
                <Text style={s.qrLink} numberOfLines={1}>{qrUrl}</Text>
              </View>
            </>
          )}

          <View style={s.divider} />
          <Text style={s.footer}>loadq.ca · {fmtDate(new Date().toISOString())}</Text>
        </View>

        <Text style={s.hint}>
          Tap "Share" above to send this card as text, or screenshot the card and print/save it.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function PrintField({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldK}>{k}</Text>
      <Text style={s.fieldV} numberOfLines={1}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.bg },
  header:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  back:       { fontSize: 20, color: Colors.t2, width: 50 },
  share:      { fontSize: 14, color: Colors.accent, width: 50, textAlign: "right", fontWeight: "700" },
  title:      { fontSize: 17, fontWeight: "700", color: Colors.t1 },
  empty:      { color: Colors.t3, textAlign: "center", marginTop: 40 },
  card:       { backgroundColor: "#fff", borderRadius: 12, padding: 24, borderWidth: 1, borderColor: Colors.border },
  brand:      { fontSize: 24, fontWeight: "900", color: "#F7931A", letterSpacing: -0.5 },
  cardKind:   { fontSize: 11, fontWeight: "800", color: "#555", letterSpacing: 1.5, marginTop: 2, marginBottom: 18 },
  row:        { flexDirection: "row", alignItems: "center" },
  avatar:     { width: 72, height: 72, borderRadius: 36, backgroundColor: "#eee" },
  avatarPh:   { alignItems: "center", justifyContent: "center" },
  nameRow:    { flexDirection: "row", alignItems: "center", gap: 6 },
  name:       { fontSize: 19, fontWeight: "800", color: "#111" },
  num:        { fontSize: 12, fontWeight: "700", color: "#666", marginTop: 4, letterSpacing: 1.2 },
  divider:    { height: 1, backgroundColor: "#ddd", marginVertical: 14 },
  section:    { fontSize: 10, fontWeight: "800", color: "#555", letterSpacing: 1.5, marginBottom: 8 },
  field:      { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  fieldK:     { fontSize: 12, color: "#666", fontWeight: "600" },
  fieldV:     { fontSize: 12, color: "#111", fontWeight: "500", maxWidth: "65%", textAlign: "right" },
  qrBox:      { alignItems: "center" },
  qr:         { padding: 10, backgroundColor: "#fff" },
  qrLabel:    { fontSize: 11, color: "#555", marginTop: 8, fontWeight: "600" },
  qrLink:     { fontSize: 10, color: "#888", marginTop: 2, maxWidth: "100%" },
  footer:     { fontSize: 10, color: "#999", textAlign: "center" },
  hint:       { color: Colors.t3, fontSize: 11, textAlign: "center", marginTop: 16, paddingHorizontal: 20 },
});
