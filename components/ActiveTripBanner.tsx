import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { TripsAPI, ActiveTrip } from "../services/trips";
import { getRegionName } from "../constants/pricing";
import { Colors } from "../constants/colors";

// Sticky banner shown above the bottom nav whenever the passenger has a
// confirmed seat on a currently-loading driver. Tap → open that loading
// screen. Disappears when the trip transitions out of 'loading' (driver
// departed) or the claim is cancelled.
export default function ActiveTripBanner() {
  const router = useRouter();
  const [trip, setTrip] = useState<ActiveTrip | null>(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    const refresh = () => TripsAPI.myActiveTrip().then(t => { if (alive) setTrip(t); });
    refresh();
    const id = setInterval(refresh, 30_000); // every 30s while focused
    return () => { alive = false; clearInterval(id); };
  }, []));

  if (!trip) return null;

  return (
    <TouchableOpacity
      style={s.banner}
      onPress={() => router.push({ pathname: "/(passenger)/loading", params: { dest: trip.destination_region ?? "" } })}
      activeOpacity={0.85}
    >
      <View style={s.dot} />
      <View style={{ flex: 1 }}>
        <Text style={s.title} numberOfLines={1}>
          Traveling with {trip.driver_name}
        </Text>
        <Text style={s.sub} numberOfLines={1}>
          → {trip.destination_region ? getRegionName(trip.destination_region) : "destination"}
        </Text>
      </View>
      <Text style={s.arrow}>›</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.accent,
  },
  dot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff", opacity: 0.9 },
  title:  { color: Colors.accentText, fontSize: 13, fontWeight: "800" },
  sub:    { color: Colors.accentText, fontSize: 11, fontWeight: "600", opacity: 0.85, marginTop: 1 },
  arrow:  { color: Colors.accentText, fontSize: 22, fontWeight: "300" },
});
