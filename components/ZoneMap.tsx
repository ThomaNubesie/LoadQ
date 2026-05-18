import { View, StyleSheet, Platform } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from "react-native-maps";
import { Colors } from "../constants/colors";

interface Props {
  latitude:  number;
  longitude: number;
  label:     string;
  height?:   number;
}

export default function ZoneMap({ latitude, longitude, label, height = 160 }: Props) {
  return (
    <View style={[s.wrap, { height }]}>
      <MapView
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        style={s.map}
        initialRegion={{
          latitude,
          longitude,
          latitudeDelta:  0.004,  // ~400m
          longitudeDelta: 0.004,
        }}
        // Re-centre when the active zone changes.
        region={{
          latitude,
          longitude,
          latitudeDelta:  0.004,
          longitudeDelta: 0.004,
        }}
        pitchEnabled={false}
        rotateEnabled={false}
        scrollEnabled={true}
        zoomEnabled={true}
      >
        <Marker
          coordinate={{ latitude, longitude }}
          title={label}
          pinColor={Colors.accent}
        />
      </MapView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { borderTopWidth: 0.5, borderTopColor: Colors.border, borderBottomWidth: 0.5, borderBottomColor: Colors.border, overflow: "hidden" },
  map:  { flex: 1 },
});
