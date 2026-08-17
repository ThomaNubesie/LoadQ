// Feeder run map: the driver's live position + numbered pickup stops along the
// Google-optimized route. Read-only (pointerEvents none), region fitted to all points.
import { View, Text, StyleSheet, Platform } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from "react-native-maps";
import { Navigation } from "lucide-react-native";
import { Colors } from "../constants/colors";

type Stop = { lat: number | null; lng: number | null; seq: number; picked_up: boolean };

export default function FeederRunMap({
  stops, driver, height = 200,
}: {
  stops: Stop[];
  driver?: { lat: number; lng: number } | null;
  height?: number;
}) {
  const pts = stops.filter((s) => s.lat != null && s.lng != null) as
    { lat: number; lng: number; seq: number; picked_up: boolean }[];
  const all = [...(driver ? [{ lat: driver.lat, lng: driver.lng }] : []), ...pts.map((p) => ({ lat: p.lat, lng: p.lng }))];
  if (!all.length) return null;

  const lats = all.map((p) => p.lat), lngs = all.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2, midLng = (minLng + maxLng) / 2;
  const latDelta = Math.max((maxLat - minLat) * 1.6, 0.01);
  const lngDelta = Math.max((maxLng - minLng) * 1.6, 0.01);
  const route = [...(driver ? [{ latitude: driver.lat, longitude: driver.lng }] : []),
    ...pts.filter((p) => !p.picked_up).map((p) => ({ latitude: p.lat, longitude: p.lng }))];

  return (
    <View style={[s.wrap, { height }]}>
      <MapView
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        region={{ latitude: midLat, longitude: midLng, latitudeDelta: latDelta, longitudeDelta: lngDelta }}
        pointerEvents="none"
      >
        {route.length > 1 && (
          <Polyline coordinates={route} strokeColor={Colors.accent} strokeWidth={3} lineDashPattern={[2, 8]} />
        )}
        {pts.map((p) => (
          <Marker key={p.seq} coordinate={{ latitude: p.lat, longitude: p.lng }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={[s.stopPin, p.picked_up && s.stopDone]}>
              <Text style={s.stopTxt}>{p.picked_up ? "✓" : p.seq}</Text>
            </View>
          </Marker>
        ))}
        {driver && (
          <Marker coordinate={{ latitude: driver.lat, longitude: driver.lng }} anchor={{ x: 0.5, y: 0.5 }} flat>
            <View style={s.carPin}><Navigation size={14} color={Colors.accentText} /></View>
          </Marker>
        )}
      </MapView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:     { width: "100%", overflow: "hidden", borderRadius: 14 },
  stopPin:  { minWidth: 26, height: 26, paddingHorizontal: 4, borderRadius: 13, backgroundColor: Colors.accentWarm, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  stopDone: { backgroundColor: Colors.green },
  stopTxt:  { color: "#fff", fontWeight: "900", fontSize: 12 },
  carPin:   { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.accent, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
});
