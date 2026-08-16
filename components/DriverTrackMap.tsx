// Live driver-tracking map: shows the assigned driver approaching the pickup,
// Uber-style. Two markers (driver + pickup) + a dashed line, region fitted to both.
import { View, StyleSheet, Platform } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from "react-native-maps";
import { Navigation, MapPin } from "lucide-react-native";
import { Colors } from "../constants/colors";

export default function DriverTrackMap({
  driver, pickup, height = 220,
}: {
  driver: { lat: number; lng: number };
  pickup: { lat: number; lng: number };
  height?: number;
}) {
  const midLat = (driver.lat + pickup.lat) / 2;
  const midLng = (driver.lng + pickup.lng) / 2;
  const latDelta = Math.max(Math.abs(driver.lat - pickup.lat) * 2.4, 0.008);
  const lngDelta = Math.max(Math.abs(driver.lng - pickup.lng) * 2.4, 0.008);

  return (
    <View style={[s.wrap, { height }]}>
      <MapView
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        region={{ latitude: midLat, longitude: midLng, latitudeDelta: latDelta, longitudeDelta: lngDelta }}
        pointerEvents="none"
      >
        <Polyline
          coordinates={[{ latitude: driver.lat, longitude: driver.lng }, { latitude: pickup.lat, longitude: pickup.lng }]}
          strokeColor={Colors.accentP}
          strokeWidth={3}
          lineDashPattern={[2, 8]}
        />
        <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} anchor={{ x: 0.5, y: 1 }}>
          <View style={s.pickupPin}><MapPin size={15} color="#fff" /></View>
        </Marker>
        <Marker coordinate={{ latitude: driver.lat, longitude: driver.lng }} anchor={{ x: 0.5, y: 0.5 }} flat>
          <View style={s.carPin}><Navigation size={15} color={Colors.accentPText} /></View>
        </Marker>
      </MapView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:      { width: "100%", overflow: "hidden", borderRadius: 14 },
  pickupPin: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.accentP, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  carPin:    { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.accentP, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
});
