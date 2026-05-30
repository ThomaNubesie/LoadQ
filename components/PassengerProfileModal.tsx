import { useEffect, useState } from "react";
import { View, Text, Modal, TouchableOpacity, StyleSheet, Image, Linking, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { PassengersAPI, PassengerStats } from "../services/passengers";
import { Colors } from "../constants/colors";

type Props = {
  passengerId: string | null;
  // Whether the driver has CONFIRMED the passenger's seat claim. Phone + chat
  // are gated on this — pending claims show profile only, no contact.
  confirmed:   boolean;
  onClose:     () => void;
};

const TIER_LABELS = {
  new:      { label: "New rider",  color: "#9CA3AF" },
  verified: { label: "Verified",   color: "#2ECC8F" },
  trusted:  { label: "Trusted",    color: "#F7931A" },
};

function formatMemberSince(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString([], { year: "numeric", month: "short" });
}

export default function PassengerProfileModal({ passengerId, confirmed, onClose }: Props) {
  const router = useRouter();
  const [stats, setStats] = useState<PassengerStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!passengerId) { setStats(null); return; }
    setLoading(true);
    PassengersAPI.getStats(passengerId)
      .then(setStats)
      .finally(() => setLoading(false));
  }, [passengerId]);

  const passenger = stats?.passenger;
  const tier = stats ? TIER_LABELS[stats.trust_tier] : null;

  const onCall = () => {
    if (!passenger?.phone) return;
    Linking.openURL(`tel:${passenger.phone}`);
  };
  const onChat = () => {
    if (!passenger) return;
    onClose();
    router.push({
      pathname: "/(app)/thread" as any,
      params: {
        id:    passenger.id,
        name:  passenger.full_name || "Passenger",
        phone: passenger.phone || "",
      },
    });
  };

  return (
    <Modal visible={!!passengerId} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation?.()} style={s.card}>
          {loading || !stats ? (
            <ActivityIndicator size="large" color={Colors.accent} style={{ paddingVertical: 24 }} />
          ) : !passenger ? (
            <Text style={s.empty}>Passenger not found.</Text>
          ) : (
            <>
              {passenger.avatar_url ? (
                <Image source={{ uri: passenger.avatar_url }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, s.avatarFallback]}>
                  <Text style={{ fontSize: 32 }}>👤</Text>
                </View>
              )}
              <Text style={s.name}>{passenger.full_name || "Passenger"}</Text>
              {tier && (
                <View style={[s.tierPill, { borderColor: tier.color, backgroundColor: tier.color + "20" }]}>
                  <Text style={[s.tierText, { color: tier.color }]}>{tier.label}</Text>
                </View>
              )}

              <View style={s.statsRow}>
                <View style={s.statBox}>
                  <Text style={s.statVal}>{stats.trips_count}</Text>
                  <Text style={s.statKey}>Trips</Text>
                </View>
                <View style={s.statBox}>
                  <Text style={s.statVal}>—</Text>
                  <Text style={s.statKey}>Rating</Text>
                </View>
                <View style={s.statBox}>
                  <Text style={s.statVal}>{formatMemberSince(stats.member_since)}</Text>
                  <Text style={s.statKey}>Member since</Text>
                </View>
              </View>

              {confirmed ? (
                <View style={s.contactRow}>
                  {passenger.phone && (
                    <TouchableOpacity style={s.contactBtn} onPress={onCall} activeOpacity={0.85}>
                      <Text style={s.contactBtnEmoji}>📞</Text>
                      <Text style={s.contactBtnLabel}>Call</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[s.contactBtn, s.contactBtnPrimary]} onPress={onChat} activeOpacity={0.85}>
                    <Text style={s.contactBtnEmoji}>💬</Text>
                    <Text style={[s.contactBtnLabel, { color: Colors.accentText }]}>Message</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={s.gateHint}>
                  Approve this passenger's seat reservation to call or message them.
                </Text>
              )}

              <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.7}>
                <Text style={s.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", padding: 24 },
  card:       { backgroundColor: Colors.card, borderRadius: 20, padding: 24, alignItems: "center", borderWidth: 1, borderColor: Colors.border, width: "100%", maxWidth: 360 },
  empty:      { color: Colors.t3, textAlign: "center", paddingVertical: 24 },
  avatar:     { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.cardAlt, marginBottom: 12 },
  avatarFallback: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.border },
  name:       { fontSize: 18, fontWeight: "800", color: Colors.t1, marginBottom: 8 },
  tierPill:   { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 16 },
  tierText:   { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  statsRow:   { flexDirection: "row", width: "100%", justifyContent: "space-around", paddingVertical: 14, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: Colors.border, marginBottom: 16 },
  statBox:    { alignItems: "center", flex: 1 },
  statVal:    { color: Colors.t1, fontSize: 16, fontWeight: "800" },
  statKey:    { color: Colors.t3, fontSize: 10, fontWeight: "700", letterSpacing: 1, marginTop: 3, textAlign: "center" },
  contactRow: { flexDirection: "row", gap: 10, width: "100%", marginBottom: 12 },
  contactBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.cardAlt, borderWidth: 0.5, borderColor: Colors.border },
  contactBtnPrimary: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  contactBtnEmoji:   { fontSize: 16 },
  contactBtnLabel:   { color: Colors.t1, fontSize: 13, fontWeight: "700" },
  gateHint:   { color: Colors.t3, fontSize: 12, textAlign: "center", paddingHorizontal: 8, marginBottom: 12, lineHeight: 17 },
  closeBtn:   { paddingVertical: 10, paddingHorizontal: 24 },
  closeBtnText: { color: Colors.t3, fontSize: 13, fontWeight: "700" },
});
