import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, Alert, Linking, Platform, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useZones } from "../../hooks/useZones";
import { useStrings } from "../../hooks/useStrings";
import { REGIONS, RegionCode, ZoneLocation } from "../../constants/zones";
import { Colors } from "../../constants/colors";
import PassengerBottomNav from "../../components/PassengerBottomNav";

const REGION_ORDER: RegionCode[] = ["ottawa", "gatineau", "montreal", "quebec", "toronto"];

export default function PassengerZonesScreen() {
  const router = useRouter();
  const { t } = useStrings();
  const { zones } = useZones();
  const [selected, setSelected] = useState<ZoneLocation | null>(null);

  // Group zones by region
  const byRegion: Record<string, ZoneLocation[]> = {};
  for (const z of zones) {
    if (!byRegion[z.region]) byRegion[z.region] = [];
    byRegion[z.region].push(z);
  }
  // Sort zones inside each region alphabetically by name
  for (const r of Object.keys(byRegion)) {
    byRegion[r].sort((a, b) => a.name.localeCompare(b.name));
  }

  const onGetDirections = (z: ZoneLocation) => {
    const q = encodeURIComponent(z.address || z.name);
    const url = Platform.OS === "ios"
      ? `http://maps.apple.com/?daddr=${q}`
      : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
    Linking.openURL(url);
  };

  const onCopy = async (z: ZoneLocation) => {
    try { await Clipboard.setStringAsync(z.address || z.name); } catch {}
    Alert.alert(t.copied, t.addressCopied);
  };

  const onShare = async (z: ZoneLocation) => {
    try { await Share.share({ message: `${z.name}\n${z.address || ""}` }); } catch {}
  };

  const onViewBoard = (z: ZoneLocation) => {
    setSelected(null);
    router.replace({ pathname: "/(passenger)/queue", params: { zoneId: z.id } });
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>{t.loadingZones}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
        {REGION_ORDER.map(rc => {
          const list = byRegion[rc] ?? [];
          if (list.length === 0) return null;
          const regionName = REGIONS.find(r => r.code === rc)?.name ?? rc;
          return (
            <View key={rc} style={s.regionBlock}>
              <Text style={s.regionLabel}>{regionName.toUpperCase()}</Text>
              {list.map(z => (
                <TouchableOpacity
                  key={z.id}
                  style={s.zoneCard}
                  onPress={() => setSelected(z)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.zoneName}>{z.name}</Text>
                    <Text style={s.zoneAddr} numberOfLines={1}>{z.address}</Text>
                  </View>
                  <Text style={s.chevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          );
        })}
        {zones.length === 0 && (
          <Text style={s.empty}>{t.noZones}</Text>
        )}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setSelected(null)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation?.()} style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{selected?.name}</Text>
              <TouchableOpacity onPress={() => setSelected(null)}>
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.modalSub}>
              {selected ? REGIONS.find(r => r.code === selected.region)?.name : ""} region
            </Text>

            <View style={s.modalAddrBlock}>
              <Text style={s.modalAddrIcon}>📍</Text>
              <Text style={s.modalAddr}>{selected?.address || selected?.name}</Text>
            </View>

            {selected?.radius_meters && (
              <Text style={s.modalMeta}>{t("geofenceRadius", { m: String(selected.radius_meters) })}</Text>
            )}

            <TouchableOpacity style={s.modalAction} onPress={() => selected && onGetDirections(selected)} activeOpacity={0.85}>
              <Text style={s.modalActionText}>{t.getDirections}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.modalAction} onPress={() => selected && onCopy(selected)} activeOpacity={0.85}>
              <Text style={s.modalActionText}>{t.copyAddress}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.modalAction} onPress={() => selected && onShare(selected)} activeOpacity={0.85}>
              <Text style={s.modalActionText}>{t.share}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.modalViewBoard} onPress={() => selected && onViewBoard(selected)} activeOpacity={0.85}>
              <Text style={s.modalViewBoardText}>{t.viewBoardForZone}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <PassengerBottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.bg },
  header:       { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12 },
  title:        { fontSize: 13, fontWeight: "800", color: Colors.t1, letterSpacing: 2 },
  scroll:       { paddingHorizontal: 16, paddingBottom: 24 },
  regionBlock:  { marginBottom: 22 },
  regionLabel:  { fontSize: 11, fontWeight: "800", color: Colors.t3, letterSpacing: 2, marginBottom: 10, paddingHorizontal: 4 },
  zoneCard:     { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.border, marginBottom: 8 },
  zoneName:     { fontSize: 14, fontWeight: "700", color: Colors.t1 },
  zoneAddr:     { fontSize: 12, color: Colors.t3, marginTop: 3 },
  chevron:      { color: Colors.t3, fontSize: 22, fontWeight: "300", paddingLeft: 8 },
  empty:        { color: Colors.t3, textAlign: "center", marginTop: 40 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard:    { width: "100%", maxWidth: 380, backgroundColor: Colors.card, borderRadius: 16, padding: 20, borderWidth: 0.5, borderColor: Colors.border },
  modalHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle:   { fontSize: 18, fontWeight: "800", color: Colors.t1, flex: 1 },
  modalClose:   { fontSize: 20, color: Colors.t3, paddingHorizontal: 4 },
  modalSub:     { fontSize: 11, color: Colors.t3, fontWeight: "700", letterSpacing: 1.2, marginTop: 4, marginBottom: 16 },
  modalAddrBlock: { flexDirection: "row", padding: 12, backgroundColor: Colors.bg, borderRadius: 10, borderWidth: 0.5, borderColor: Colors.border, marginBottom: 8, gap: 8 },
  modalAddrIcon:{ fontSize: 16 },
  modalAddr:    { flex: 1, fontSize: 13, color: Colors.t1, fontWeight: "500" },
  modalMeta:    { fontSize: 11, color: Colors.t3, marginBottom: 14, paddingHorizontal: 4 },
  modalAction:  { padding: 14, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: "center", marginBottom: 8 },
  modalActionText: { fontSize: 14, fontWeight: "700", color: Colors.t1 },
  modalViewBoard: { marginTop: 8, padding: 14, borderRadius: 10, backgroundColor: Colors.accent, alignItems: "center" },
  modalViewBoardText: { fontSize: 14, fontWeight: "800", color: Colors.accentText },
});
