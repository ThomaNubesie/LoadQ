import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import {
  REGIONS, ZoneLocation, RegionCode,
  detectUserRegion, getZonesByRegion, getDistanceKm
} from "../../constants/zones";
import { useZones } from "../../hooks/useZones";
import { ArrowLeft, MapPin, Lock, ArrowRight } from "lucide-react-native";
import Wordmark from "../../components/Wordmark";

export default function ZoneSelectScreen() {
  const router     = useRouter();
  const { t }  = useStrings();

  const { zones } = useZones();

  const [userLat,    setUserLat]    = useState<number|null>(null);
  const [userLon,    setUserLon]    = useState<number|null>(null);
  const [userRegion, setUserRegion] = useState<RegionCode|null>(null);
  const [activeTab,  setActiveTab]  = useState<RegionCode>("ottawa");
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    const getLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const lat = loc.coords.latitude;
          const lon = loc.coords.longitude;
          setUserLat(lat);
          setUserLon(lon);
          const region = detectUserRegion(lat, lon);
          setUserRegion(region);
          if (region) setActiveTab(region);
        }
      } catch (e) {
        console.log("Location error:", e);
      }
      setLoading(false);
    };
    getLocation();
  }, []);

  const zonesInTab  = getZonesByRegion(zones, activeTab);

  const getDistance = (zone: ZoneLocation): string => {
    if (userLat === null || userLon === null) return "";
    const km = getDistanceKm(userLat, userLon, zone.latitude, zone.longitude);
    if (km < 1) return `${Math.round(km * 1000)}m away`;
    return `${km.toFixed(1)}km away`;
  };

  // Hard zone lock: driver can only Join a zone they're physically inside
  // (within the zone's geofence radius). Lets drivers still WATCH any zone
  // they want, but Join is gated by GPS so remote queue-jumping is blocked
  // even before queue.tsx runs its own validateJoin check.
  const isInsideZone = (zone: ZoneLocation): boolean => {
    if (userLat === null || userLon === null) return false;
    const dist = getDistanceKm(userLat, userLon, zone.latitude, zone.longitude) * 1000;
    return dist <= zone.radius_meters;
  };

  const handleJoin = (zone: ZoneLocation) => {
    router.push({
      pathname: "/(app)/queue",
      params: { zoneId: zone.id, zoneName: zone.name }
    });
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/queue")} style={{ padding:4 }}>
          <ArrowLeft size={16} color={Colors.t2} strokeWidth={2} />
        </TouchableOpacity>
        <Wordmark style={s.logo} />
        {loading ? (
          <ActivityIndicator color={Colors.accent} size="small" />
        ) : userRegion ? (
          <View style={[s.locationBadge, { flexDirection:"row", alignItems:"center", gap:6 }]}>
            <MapPin size={12} color={Colors.accent} strokeWidth={2} />
            <Text style={s.locationText}>{REGIONS.find(r => r.code === userRegion)?.name}</Text>
          </View>
        ) : (
          <View style={{ flexDirection:"row", alignItems:"center", gap:6 }}>
            <MapPin size={12} color={Colors.t3} strokeWidth={2} />
            <Text style={s.noLocation}>Location unavailable</Text>
          </View>
        )}
      </View>

      {/* Region tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabScroll} contentContainerStyle={s.tabRow}>
        {REGIONS.map(region => (
          <TouchableOpacity
            key={region.code}
            style={[s.tab, activeTab === region.code && s.tabActive]}
            onPress={() => setActiveTab(region.code)}
            activeOpacity={0.8}
          >
            <Text style={[s.tabText, activeTab === region.code && s.tabTextActive]}>
              {region.name}
            </Text>
            {region.code === userRegion && <View style={s.tabDot} />}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollInner}>
        <View style={[s.watchingBanner, { flexDirection:"row", alignItems:"center", gap:6 }]}>
          <Lock size={12} color={Colors.yellow} strokeWidth={2} />
          <Text style={[s.watchingText, { flex:1 }]}>
            You can only Join zones you're physically inside. Watch any zone to see its board.
          </Text>
        </View>

        {zonesInTab.length === 0 ? (
          <View style={s.empty}>
            <MapPin size={40} color={Colors.t2} strokeWidth={2} style={s.emptyEmoji} />
            <Text style={s.emptyText}>No zones in this region yet</Text>
          </View>
        ) : (
          zonesInTab.map(zone => {
            const dist     = getDistance(zone);
            const inside   = isInsideZone(zone);
            return (
              <View key={zone.id} style={s.zoneCard}>
                <View style={s.zoneInfo}>
                  <Text style={s.zoneName}>{zone.name}</Text>
                  <Text style={s.zoneAddr}>{zone.address}</Text>
                  {dist ? (
                    <View style={{ flexDirection:"row", alignItems:"center", gap:6, marginTop:4 }}>
                      <MapPin size={11} color={inside ? Colors.accent : Colors.t3} strokeWidth={2} />
                      <Text style={[s.zoneDist, { marginTop:0 }, !inside && { color: Colors.t3 }]}>
                        {dist}{inside ? "  ·  Inside zone" : ""}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={s.zoneRight}>
                  <View style={s.liveDot} />
                  <Text style={s.liveText}>Live</Text>
                  {inside ? (
                    <TouchableOpacity style={[s.joinBtn, { flexDirection:"row", alignItems:"center", gap:4 }]} onPress={() => handleJoin(zone)} activeOpacity={0.85}>
                      <Text style={s.joinBtnText}>Join</Text>
                      <ArrowRight size={12} color={Colors.accentText} strokeWidth={2} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={s.watchBtn} onPress={() => handleJoin(zone)} activeOpacity={0.85}>
                      <Text style={s.watchBtnText}>Watch</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:      { flex:1, backgroundColor:Colors.bg },
  header:         { flexDirection:"row", alignItems:"center", justifyContent:"space-between", paddingHorizontal:20, paddingTop:8, paddingBottom:12 },
  logo:           { fontSize:22, fontWeight:"900", color:Colors.accent, letterSpacing:3 },
  locationBadge:  { backgroundColor:Colors.accent+"20", borderRadius:8, paddingHorizontal:10, paddingVertical:4 },
  locationText:   { color:Colors.accent, fontSize:12, fontWeight:"600" },
  noLocation:     { color:Colors.t3, fontSize:12 },
  tabScroll:      { flexGrow:0, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  tabRow:         { paddingHorizontal:16, gap:8, paddingBottom:8 },
  tab:            { paddingHorizontal:14, paddingVertical:8, borderRadius:20, borderWidth:1, borderColor:Colors.border, backgroundColor:Colors.card, position:"relative" },
  tabActive:      { borderColor:Colors.accent, backgroundColor:Colors.accent+"15" },
  tabText:        { color:Colors.t2, fontSize:13, fontWeight:"500" },
  tabTextActive:  { color:Colors.accent, fontWeight:"700" },
  tabDot:         { position:"absolute", top:4, right:4, width:6, height:6, borderRadius:3, backgroundColor:Colors.accent },
  scroll:         { flex:1 },
  scrollInner:    { padding:16 },
  watchingBanner: { backgroundColor:Colors.yellow+"15", borderRadius:10, padding:12, marginBottom:12, borderWidth:0.5, borderColor:Colors.yellow+"40" },
  watchingText:   { color:Colors.yellow, fontSize:12, lineHeight:18 },
  empty:          { alignItems:"center", marginTop:60 },
  emptyEmoji:     { fontSize:40, marginBottom:12 },
  emptyText:      { color:Colors.t2, fontSize:15 },
  zoneCard:       { backgroundColor:Colors.card, borderRadius:14, padding:14, marginBottom:10, borderWidth:0.5, borderColor:Colors.border, flexDirection:"row", alignItems:"center", justifyContent:"space-between" },
  zoneInfo:       { flex:1, marginRight:12 },
  zoneName:       { fontSize:14, fontWeight:"600", color:Colors.t1, marginBottom:3 },
  zoneAddr:       { fontSize:11, color:Colors.t3, lineHeight:16 },
  zoneDist:       { fontSize:11, color:Colors.accent, marginTop:4 },
  zoneRight:      { alignItems:"center", gap:6 },
  liveDot:        { width:8, height:8, borderRadius:4, backgroundColor:Colors.accent },
  liveText:       { color:Colors.accent, fontSize:10, fontWeight:"600" },
  joinBtn:        { backgroundColor:Colors.accent, borderRadius:8, paddingHorizontal:14, paddingVertical:8 },
  joinBtnText:    { color:Colors.accentText, fontSize:12, fontWeight:"700" },
  watchBtn:       { backgroundColor:Colors.card, borderRadius:8, paddingHorizontal:14, paddingVertical:8, borderWidth:0.5, borderColor:Colors.border },
  watchBtnText:   { color:Colors.t2, fontSize:12, fontWeight:"600" },
});
