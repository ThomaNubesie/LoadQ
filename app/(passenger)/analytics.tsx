import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image } from "react-native";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { TripsAPI, Trip, NetworkStat } from "../../services/trips";
import { getRegionName } from "../../constants/pricing";
import PassengerBottomNav from "../../components/PassengerBottomNav";

type Tab = "mine" | "network";

export default function PassengerAnalyticsScreen() {
  const { t } = useStrings();
  const [tab,         setTab]         = useState<Tab>("mine");
  const [trips,       setTrips]       = useState<Trip[]>([]);
  const [networkData, setNetworkData] = useState<NetworkStat[]>([]);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      if (tab === "mine") {
        setTrips(await TripsAPI.listMine());
      } else {
        setNetworkData(await TripsAPI.listNetwork());
      }
      setLoading(false);
    })();
  }, [tab]);

  const mineTotal = trips.reduce((sum, t) => sum + Number(t.price_paid || 0), 0);
  const mineCount = trips.length;

  // Aggregate network stats per route for the past 7d.
  const networkByRoute = networkData.reduce<Record<string, { count: number; gross: number }>>((acc, n) => {
    const key = `${n.zone_id}::${n.destination_region}`;
    (acc[key] ??= { count: 0, gross: 0 });
    acc[key].count += Number(n.trip_count || 0);
    acc[key].gross += Number(n.gross || 0);
    return acc;
  }, {});
  const networkRows = Object.entries(networkByRoute)
    .map(([key, v]) => {
      const [zone_id, dest] = key.split("::");
      return { zone_id, dest, ...v };
    })
    .sort((a, b) => b.count - a.count);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>📊 {t.analytics}</Text>
        <Text style={s.subtitle}>{t.pastWeek}</Text>
      </View>

      <View style={s.tabBar}>
        <TouchableOpacity
          style={[s.tab, tab === "mine" && s.tabActive]}
          onPress={() => setTab("mine")}
        >
          <Text style={[s.tabText, tab === "mine" && s.tabTextActive]}>{t.myTrips}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, tab === "network" && s.tabActive]}
          onPress={() => setTab("network")}
        >
          <Text style={[s.tabText, tab === "network" && s.tabTextActive]}>{t.network}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {loading ? (
          <Text style={s.loadingText}>{t.loading}</Text>
        ) : tab === "mine" ? (
          <>
            <View style={s.statsCard}>
              <View style={s.statBox}>
                <Text style={s.statVal}>{mineCount}</Text>
                <Text style={s.statKey}>{t.tripsLabel}</Text>
              </View>
              <View style={s.statBox}>
                <Text style={s.statVal}>C${mineTotal.toFixed(0)}</Text>
                <Text style={s.statKey}>{t.spentLabel}</Text>
              </View>
            </View>

            {trips.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyEmoji}>🛤</Text>
                <Text style={s.emptyText}>{t.noTrips}</Text>
              </View>
            ) : (
              trips.map(trip => (
                <View key={trip.id} style={s.tripRow}>
                  {trip.driver?.avatar_url ? (
                    <Image source={{ uri: trip.driver.avatar_url }} style={s.avatar} />
                  ) : (
                    <View style={s.avatarFallback}><Text>👤</Text></View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={s.tripDriver}>{trip.driver?.full_name || "Driver"}</Text>
                    <Text style={s.tripRoute}>
                      {trip.zone_id} → {getRegionName(trip.destination_region)}
                    </Text>
                    <Text style={s.tripDate}>
                      {new Date(trip.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  </View>
                  <Text style={s.tripPrice}>C${Number(trip.price_paid).toFixed(0)}</Text>
                </View>
              ))
            )}
          </>
        ) : (
          // Network tab
          <>
            <View style={s.statsCard}>
              <View style={s.statBox}>
                <Text style={s.statVal}>
                  {networkData.reduce((sum, n) => sum + Number(n.trip_count || 0), 0)}
                </Text>
                <Text style={s.statKey}>{t.tripsTotal}</Text>
              </View>
              <View style={s.statBox}>
                <Text style={s.statVal}>{networkRows.length}</Text>
                <Text style={s.statKey}>{t.activeRoutes}</Text>
              </View>
            </View>

            {networkRows.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyEmoji}>📊</Text>
                <Text style={s.emptyText}>{t.noNetwork}</Text>
              </View>
            ) : (
              networkRows.map(row => (
                <View key={`${row.zone_id}-${row.dest}`} style={s.netRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.netRoute}>
                      {row.zone_id} → {getRegionName(row.dest)}
                    </Text>
                    <Text style={s.netSub}>{row.count} trips · C${row.gross.toFixed(0)} gross</Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      <PassengerBottomNav />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:    { flex:1, backgroundColor:Colors.bg },
  header:       { flexDirection:"row", justifyContent:"space-between", alignItems:"flex-end", paddingHorizontal:16, paddingTop:16, paddingBottom:8 },
  title:        { fontSize:20, fontWeight:"800", color:Colors.t1 },
  subtitle:     { fontSize:11, color:Colors.t3, fontWeight:"600" },
  tabBar:       { flexDirection:"row", paddingHorizontal:16, paddingBottom:8, gap:8, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  tab:          { flex:1, paddingVertical:10, borderRadius:10, borderWidth:1, borderColor:Colors.border, backgroundColor:Colors.card, alignItems:"center" },
  tabActive:    { borderColor:Colors.accent, backgroundColor:Colors.accent+"12" },
  tabText:      { color:Colors.t2, fontSize:13, fontWeight:"700" },
  tabTextActive:{ color:Colors.accent },
  scroll:       { flex:1 },
  statsCard:    { flexDirection:"row", backgroundColor:Colors.card, borderRadius:14, padding:14, marginBottom:16, borderWidth:0.5, borderColor:Colors.border },
  statBox:      { flex:1, alignItems:"center" },
  statVal:      { fontSize:24, fontWeight:"900", color:Colors.accent },
  statKey:      { fontSize:11, color:Colors.t3, marginTop:2 },
  tripRow:      { flexDirection:"row", alignItems:"center", gap:10, padding:12, backgroundColor:Colors.card, borderRadius:12, marginBottom:8, borderWidth:0.5, borderColor:Colors.border },
  avatar:       { width:40, height:40, borderRadius:20, backgroundColor:Colors.cardAlt },
  avatarFallback:{ width:40, height:40, borderRadius:20, backgroundColor:Colors.bg, alignItems:"center", justifyContent:"center", borderWidth:0.5, borderColor:Colors.border },
  tripDriver:   { fontSize:13, fontWeight:"700", color:Colors.t1 },
  tripRoute:    { fontSize:11, color:Colors.t2, marginTop:2 },
  tripDate:     { fontSize:10, color:Colors.t3, marginTop:3 },
  tripPrice:    { fontSize:15, fontWeight:"800", color:Colors.accent },
  netRow:       { flexDirection:"row", padding:12, backgroundColor:Colors.card, borderRadius:12, marginBottom:8, borderWidth:0.5, borderColor:Colors.border },
  netRoute:     { fontSize:13, fontWeight:"700", color:Colors.t1 },
  netSub:       { fontSize:11, color:Colors.t3, marginTop:3 },
  loadingText:  { color:Colors.t2, textAlign:"center", marginTop:40 },
  empty:        { alignItems:"center", marginTop:60, paddingHorizontal:24 },
  emptyEmoji:   { fontSize:48, marginBottom:12 },
  emptyText:    { fontSize:14, color:Colors.t2, textAlign:"center" },
});
