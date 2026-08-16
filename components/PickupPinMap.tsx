// Pickup map with a DRAGGABLE pin so the rider can set the exact spot (GPS/geocode
// are only approximate). The pin's coordinate is the source of truth for dispatch.
import { View, StyleSheet, Platform } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from "react-native-maps";
import { MapPin } from "lucide-react-native";
import { Colors } from "../constants/colors";

export default function PickupPinMap({
  lat, lng, onMove, height = 190,
}: {
  lat: number;
  lng: number;
  onMove: (lat: number, lng: number) => void;
  height?: number;
}) {
  return (
    <View style={[s.wrap, { height }]}>
      <MapView
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        region={{ latitude: lat, longitude: lng, latitudeDelta: 0.005, longitudeDelta: 0.005 }}
      >
        <Marker
          draggable
          coordinate={{ latitude: lat, longitude: lng }}
          onDragEnd={(e) => onMove(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}
          anchor={{ x: 0.5, y: 1 }}
        >
          <View style={s.pin}><MapPin size={16} color="#fff" /></View>
        </Marker>
      </MapView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: "100%", overflow: "hidden" },
  pin:  { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.accentP, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
});
