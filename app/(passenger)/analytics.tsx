import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, StyleSheet, ScrollView, Image } from "react-native";
import { Colors } from "../../constants/colors";
import { TripsAPI, Trip } from "../../services/trips";
import { getRegionName } from "../../constants/pricing";
import PassengerBottomNav from "../../components/PassengerBottomNav";

export default function PassengerAlertsScreen() {
  const [trips, setTrips]     = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all = await TripsAPI.listMine();
      setTrips(all);
      setLoading(false);
    })();
  }, []);

  // Stats
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekTrips = trips.filter(t => new Date(t.created_at).getTime() >= oneWeekAgo);
  const weekTotal = weekTrips.reduce((sum, t) => sum + Number(t.price_paid || 0), 0);
  const allTimeTotal = trips.reduce((sum, t) => sum + Number(t.price_paid || 0), 0);
  // Naive savings model: assume bus would have been $20 per route
  const weekSaved = weekTrips.length * 20 - weekTotal;
  const allSaved  = trips.length * 20 - allTimeTotal;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>ACTIVITY</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
        <Section label="THIS WEEK">
          <StatLine k="Trips taken"   v={String(weekTrips.length)} />
          <StatLine k="Cars boarded"  v={String(weekTrips.length)} />
          <StatLine k="Money spent"   v={`C$${weekTotal.toFixed(0)}`} />
          <StatLine k="Saved vs bus"  v={`C$${Math.max(0, weekSaved).toFixed(0)}`} last />
        </Section>

        <Section label="RECENT TRIPS">
          {loading ? (
            <Text style={s.empty}>Loading…</Text>
          ) : trips.length === 0 ? (
            <Text style={s.empty}>No trips yet.</Text>
          ) : (
            trips.slice(0, 8).map(trip => (
              <View key={trip.id} style={s.tripCard}>
                {trip.driver?.avatar_url ? (
                  <Image source={{ uri: trip.driver.avatar_url }} style={s.avatar} />
                ) : (
                  <View style={s.avatarFallback}><Text style={{ fontSize: 20 }}>👤</Text></View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.tripRoute}>{trip.zone_id} → {getRegionName(trip.destination_region)}</Text>
                  <Text style={s.tripMeta}>
                    {new Date(trip.created_at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                    {"  ·  "}with {trip.driver?.full_name ?? "driver"}
                  </Text>
                </View>
                <Text style={s.tripPrice}>C${Number(trip.price_paid).toFixed(0)}</Text>
              </View>
            ))
          )}
        </Section>

        <Section label="ALL TIME">
          <StatLine k="Total trips"     v={String(trips.length)} />
          <StatLine k="Total spent"     v={`C$${allTimeTotal.toFixed(0)}`} />
          <StatLine k="Saved vs bus"    v={`C$${Math.max(0, allSaved).toFixed(0)}`} last />
        </Section>
      </ScrollView>

      <PassengerBottomNav />
    </SafeAreaView>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionLabel}>{label}</Text>
      <View style={s.sectionBody}>{children}</View>
    </View>
  );
}

function StatLine({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <View style={[s.statLine, last && { borderBottomWidth: 0 }]}>
      <Text style={s.statKey}>{k}</Text>
      <View style={s.statDash} />
      <Text style={s.statVal}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg },
  header:      { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14 },
  title:       { fontSize: 13, fontWeight: "800", color: Colors.t1, letterSpacing: 2 },
  section:     { marginHorizontal: 16, marginBottom: 22 },
  sectionLabel:{ fontSize: 11, fontWeight: "800", color: Colors.t3, letterSpacing: 2, marginBottom: 10, paddingHorizontal: 4 },
  sectionBody: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 0.5, borderColor: Colors.border, paddingHorizontal: 14 },
  statLine:    { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  statKey:     { color: Colors.t1, fontSize: 13, fontWeight: "500" },
  statDash:    { flex: 1, marginHorizontal: 8, height: 1, borderBottomWidth: 1, borderBottomColor: Colors.border, borderStyle: "dashed" },
  statVal:     { color: Colors.accent, fontSize: 14, fontWeight: "800" },

  tripCard:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  avatar:      { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.cardAlt },
  avatarFallback: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: Colors.border },
  tripRoute:   { color: Colors.t1, fontSize: 13, fontWeight: "700" },
  tripMeta:    { color: Colors.t3, fontSize: 11, marginTop: 3 },
  tripPrice:   { color: Colors.accent, fontSize: 14, fontWeight: "800" },

  empty:       { color: Colors.t3, textAlign: "center", paddingVertical: 18, fontSize: 12 },
});
