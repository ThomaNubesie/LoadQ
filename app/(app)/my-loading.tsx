import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { QueueAPI } from "../../services/queue";
import { DriversAPI } from "../../services/drivers";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { QueueEntry, SeatStatus } from "../../constants/types";
import SeatSvg from "../../components/SeatSvg";

const DEMO_ZONE_ID = "00000000-0000-0000-0000-000000000001";

export default function MyLoadingScreen() {
  const router = useRouter();
  const { t }  = useStrings();
  const [entry,   setEntry]   = useState<QueueEntry|null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const driver = await DriversAPI.getMe();
      if (!driver) return;
      const queue = await QueueAPI.getZoneQueue(DEMO_ZONE_ID);
      const mine  = queue.find(e => e.driver_id === driver.id);
      setEntry(mine || null);
      setLoading(false);
    };
    load();
  }, []);

  const handleSeatTap = async (idx: number) => {
    if (!entry) return;
    const states = [...((entry.seat_states as SeatStatus[]) || Array(entry.vehicle?.seats || 4).fill("empty"))];
    if (states[idx] === "locked") return;
    states[idx] = states[idx] === "boarded" ? "empty" : "boarded";
    const boarded = states.filter(s => s === "boarded" || s === "locked").length;
    await QueueAPI.updateSeatStates(entry.id, states, boarded);
    setEntry({ ...entry, seat_states: states, seats_boarded: boarded });
  };

  const seats   = entry?.vehicle?.seats || 4;
  const states  = (entry?.seat_states as SeatStatus[]) || Array(seats).fill("empty");
  const boarded = states.filter(s => s === "boarded" || s === "locked").length;
  const locked  = entry?.seats_locked || 0;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t.myLoading}</Text>
        <View style={{ width:24 }} />
      </View>

      <ScrollView contentContainerStyle={s.inner}>
        {loading ? (
          <Text style={s.loadingText}>{t.loading}</Text>
        ) : !entry ? (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>🚗</Text>
            <Text style={s.emptyText}>You are not in a queue</Text>
          </View>
        ) : (
          <>
            <View style={s.carCard}>
              <Text style={s.carName}>{entry.vehicle?.make} {entry.vehicle?.model}</Text>
              <Text style={s.carSub}>{entry.vehicle?.plate} · Slot #{entry.position}</Text>
            </View>

            <View style={s.countRow}>
              <Text style={s.countMain}>{boarded} / {seats}</Text>
              <Text style={s.countLabel}>{t.boarded}</Text>
            </View>

            <Text style={s.hint}>{t.tapToBoard}</Text>

            <View style={s.seatGrid}>
              {Array.from({ length: seats }).map((_, i) => (
                <SeatSvg
                  key={i}
                  filled={states[i] === "boarded" || states[i] === "locked"}
                  locked={states[i] === "locked"}
                  color={Colors.accent}
                  size="full"
                  onPress={() => handleSeatTap(i)}
                  disabled={states[i] === "locked"}
                />
              ))}
            </View>

            <View style={s.legend}>
              <View style={s.legendItem}>
                <SeatSvg filled size="mini" color={Colors.accent} />
                <Text style={s.legendText}>{t.boarded}</Text>
              </View>
              <View style={s.legendItem}>
                <SeatSvg filled={false} size="mini" />
                <Text style={s.legendText}>{t.emptyTap}</Text>
              </View>
              {locked > 0 && (
                <View style={s.legendItem}>
                  <SeatSvg filled locked size="mini" color={Colors.yellow} />
                  <Text style={s.legendText}>{locked} {t.seatLocked}</Text>
                </View>
              )}
            </View>

            {locked > 0 && (
              <View style={s.lockedBar}>
                <Text style={s.lockedText}>🔒 {locked} {t.seatLocked}</Text>
              </View>
            )}
            {boarded - locked > 0 && (
              <View style={s.pendingBar}>
                <Text style={s.pendingText}>⏱ {boarded - locked} {t.seatPending}</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex:1, backgroundColor:Colors.bg },
  header:      { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:16 },
  back:        { fontSize:20, color:Colors.t2 },
  title:       { fontSize:17, fontWeight:"700", color:Colors.t1 },
  inner:       { padding:20, paddingBottom:60 },
  loadingText: { color:Colors.t2, textAlign:"center", marginTop:40 },
  empty:       { alignItems:"center", marginTop:80 },
  emptyEmoji:  { fontSize:48, marginBottom:12 },
  emptyText:   { fontSize:16, color:Colors.t2 },
  carCard:     { backgroundColor:Colors.card, borderRadius:12, padding:14, borderWidth:0.5, borderColor:Colors.border, marginBottom:20 },
  carName:     { fontSize:16, fontWeight:"600", color:Colors.t1 },
  carSub:      { fontSize:12, color:Colors.t3, marginTop:3 },
  countRow:    { alignItems:"center", marginBottom:8 },
  countMain:   { fontSize:36, fontWeight:"900", color:Colors.accent },
  countLabel:  { fontSize:13, color:Colors.t2, marginTop:2 },
  hint:        { color:Colors.t3, fontSize:12, textAlign:"center", marginBottom:20 },
  seatGrid:    { flexDirection:"row", flexWrap:"wrap", gap:10, justifyContent:"center", marginBottom:24 },
  legend:      { flexDirection:"row", gap:16, justifyContent:"center", marginBottom:20 },
  legendItem:  { flexDirection:"row", alignItems:"center", gap:6 },
  legendText:  { color:Colors.t3, fontSize:11 },
  lockedBar:   { backgroundColor:Colors.accent+"12", borderRadius:8, padding:10, marginBottom:8, borderWidth:0.5, borderColor:Colors.accent+"30" },
  lockedText:  { color:Colors.accent, fontSize:12, textAlign:"center" },
  pendingBar:  { backgroundColor:Colors.yellow+"12", borderRadius:8, padding:10, borderWidth:0.5, borderColor:Colors.yellow+"30" },
  pendingText: { color:Colors.yellow, fontSize:12, textAlign:"center" },
});
