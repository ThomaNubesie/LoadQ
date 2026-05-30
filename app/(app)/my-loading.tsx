import { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Image, Modal } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { QueueAPI } from "../../services/queue";
import { ClaimsAPI, SeatClaim } from "../../services/claims";
import { MessagesAPI } from "../../services/messages";
import UserActionMenu from "../../components/UserActionMenu";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { QueueEntry, SeatStatus } from "../../constants/types";
import SeatSvg from "../../components/SeatSvg";
import BottomNav from "../../components/BottomNav";
import PassengerProfileModal from "../../components/PassengerProfileModal";
import { loadingState, formatRemaining } from "../../utils/loadingTimer";
import { useNow } from "../../hooks/useNow";
import { supabase } from "../../services/supabase";
import { useZones } from "../../hooks/useZones";
import { getPricePerSeat, getDestinationsFrom, getRegionName } from "../../constants/pricing";
import { useDestinations } from "../../hooks/useDestinations";

// seat_states can come back from the DB as a JSON string, null, an array of
// the wrong length, or with junk values. Always normalize to a clean array
// of exactly `count` valid SeatStatus values.
function normalizeSeatStates(raw: unknown, count: number): SeatStatus[] {
  let arr: any[];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === "string") {
    try { const p = JSON.parse(raw); arr = Array.isArray(p) ? p : []; }
    catch { arr = []; }
  } else {
    arr = [];
  }
  const valid = (v: any): SeatStatus =>
    v === "boarded" || v === "locked" || v === "disputed" ? v : "empty";
  return Array.from({ length: count }, (_, i) => valid(arr[i]));
}

function seatCountFor(entry: QueueEntry | null): number {
  return Math.max((entry?.vehicle?.seats || 4) - 1, 1); // exclude driver
}

export default function MyLoadingScreen() {
  const router     = useRouter();
  const { t }  = useStrings();
  const [entry,         setEntry]         = useState<QueueEntry|null>(null);
  const [loading,       setLoading]       = useState(true);
  const [pendingClaims, setPendingClaims] = useState<SeatClaim[]>([]);
  // Confirmed (locked-seat) claims, ordered by confirmation time. Index N
  // corresponds to seat N on the car — used to overlay each filled seat with
  // the passenger's initials so the driver knows who reserved which seat.
  const [confirmedClaims, setConfirmedClaims] = useState<SeatClaim[]>([]);
  const [showDestPicker, setShowDestPicker] = useState(false);
  // Which passenger's profile is currently open in the popup, if any.
  // Set by tapping a locked seat's avatar.
  const [openPassengerId, setOpenPassengerId] = useState<string | null>(null);

  const refreshAll = async () => {
    const mine = await QueueAPI.getMyEntry();
    setEntry(mine || null);
    if (mine) {
      const [pend, conf] = await Promise.all([
        ClaimsAPI.listPending(mine.id),
        ClaimsAPI.listConfirmedFor(mine.id),
      ]);
      setPendingClaims(pend);
      setConfirmedClaims(conf);
    } else {
      setPendingClaims([]);
      setConfirmedClaims([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    refreshAll();
    // Poll pending claims every 8s so the driver sees new claims promptly.
    const id = setInterval(refreshAll, 8000);
    return () => clearInterval(id);
  }, []);

  const handleConfirmClaim = async (claim: SeatClaim) => {
    if (!entry) return;
    const price = getPricePerSeat(zone?.region, entry.destination_region) ?? 0;
    const { error } = await ClaimsAPI.confirm(
      claim,
      entry.zone_id,
      entry.destination_region || "",
      price,
    );
    if (error) { Alert.alert(t.error, error); return; }
    await refreshAll();
  };

  const handleRejectClaim = async (claim: SeatClaim) => {
    Alert.alert(
      "Reject passenger?",
      `Reject ${claim.passenger?.full_name || "this passenger"}'s claim. They can try again or claim with another driver.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: t.rejectClaim,
          style: "destructive",
          onPress: async () => {
            const { error } = await ClaimsAPI.reject(claim.id);
            if (error) { Alert.alert(t.error, error); return; }
            await refreshAll();
          },
        },
      ]
    );
  };

  const isLoadingState = entry?.status === "loading";
  const now            = useNow(1000, isLoadingState);

  // When my own 2h timer expires, immediately trigger the watchdog and bounce
  // back to the queue — don't sit on an expired loading screen.
  const expiredFired = useRef(false);
  useEffect(() => {
    if (!entry || entry.status !== "loading" || !entry.load_start_at) return;
    const elapsed = now - new Date(entry.load_start_at).getTime();
    if (elapsed >= 3 * 60 * 60 * 1000 && !expiredFired.current) {
      expiredFired.current = true;
      QueueAPI.triggerWatchdog();
      Alert.alert("Time's up", "Your 3-hour loading window has ended. You've been moved to the back of the queue.");
      setTimeout(() => router.replace("/(app)/queue"), 1500);
    }
  }, [now, entry?.id, entry?.status, entry?.load_start_at]);

  const handleSeatTap = async (idx: number) => {
    if (!entry || entry.status === "ended") return;
    const states = normalizeSeatStates(entry.seat_states, seatCountFor(entry));
    // Tap only ADDS a passenger; removing is a long-press (see handleSeatLongPress).
    if (states[idx] !== "empty") return; // already boarded/locked — long-press to remove
    states[idx] = "boarded";
    const boarded = states.filter(s => s === "boarded" || s === "locked").length;
    await QueueAPI.updateSeatStates(entry.id, states, boarded);
    setEntry({ ...entry, seat_states: states, seats_boarded: boarded });
  };

  const handleSeatLongPress = (idx: number) => {
    if (!entry || entry.status === "ended") return;
    const states = normalizeSeatStates(entry.seat_states, seatCountFor(entry));
    const wasLocked = states[idx] === "locked";
    if (states[idx] === "empty") return;
    Alert.alert(
      wasLocked ? "Remove confirmed passenger?" : "Remove passenger?",
      wasLocked
        ? "This seat is locked (passenger confirmed). Removing them will reopen the seat."
        : "This passenger will be removed and the seat will reopen.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const newStates = [...states];
            newStates[idx] = "empty";
            const boarded     = newStates.filter(s => s === "boarded" || s === "locked").length;
            const seatsLocked = newStates.filter(s => s === "locked").length;
            await QueueAPI.updateSeatStates(entry.id, newStates, boarded);
            // Also update locked count if we just unlocked a seat
            if (wasLocked) {
              await supabase.from("queue_entries").update({ seats_locked: seatsLocked }).eq("id", entry.id);
            }
            setEntry({ ...entry, seat_states: newStates, seats_boarded: boarded, seats_locked: seatsLocked });
          },
        },
      ]
    );
  };

  const elapsedMs   = entry?.load_start_at ? Date.now() - new Date(entry.load_start_at).getTime() : 0;
  const canChangeDest = !!entry
    && (entry.seats_boarded ?? 0) === 0
    && elapsedMs <= 60 * 60 * 1000;

  const handleChangeDestination = async (newDest: string) => {
    if (!entry) return;
    setShowDestPicker(false);
    const { error } = await QueueAPI.changeDestination(entry, newDest);
    if (error) { Alert.alert(t.error, error); return; }
    await refreshAll();
  };

  const handleDepart = () => {
    if (!entry) return;
    Alert.alert(
      "Depart now?",
      `You're leaving with ${boarded} of ${seats} seats filled. The next driver in your queue will be promoted to loading.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Depart",
          style: "destructive",
          onPress: async () => {
            const { error } = await QueueAPI.depart(entry.id);
            if (error) { Alert.alert("Error", error); return; }
            router.replace("/(app)/queue");
          },
        },
      ]
    );
  };

  const totalSeats     = entry?.vehicle?.seats || 4;
  const seats          = seatCountFor(entry); // exclude driver
  const states  = normalizeSeatStates(entry?.seat_states, seats);
  const boarded = states.filter(s => s === "boarded" || s === "locked").length;
  const locked  = entry?.seats_locked || 0;

  const lstate   = isLoadingState ? loadingState(entry?.load_start_at, seats, now) : null;
  const required = lstate ? lstate.effectiveRequired : seats;

  const { zones } = useZones();
  const { activeCodes: activeDestCodes } = useDestinations();
  const zone        = zones.find(z => z.id === entry?.zone_id);
  const zoneAddress = zone ? `${zone.name}${zone.address ? ` — ${zone.address}` : ""}` : "—";
  const startedDate = entry?.load_start_at
    ? new Date(entry.load_start_at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
    : "—";
  const startedTime = entry?.load_start_at
    ? new Date(entry.load_start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  const [unread, setUnread] = useState(0);
  useFocusEffect(useCallback(() => {
    MessagesAPI.unreadCount().then(setUnread);
  }, []));

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)/zone-select")}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>{t.myLoading}</Text>
        <TouchableOpacity
          onPress={() => router.push("/(app)/messages" as any)}
          style={s.msgBtn}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <Text style={s.msgBtnText}>💬</Text>
          {unread > 0 && (
            <View style={s.msgBadge}>
              <Text style={s.msgBadgeText}>{unread > 9 ? "9+" : unread}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.inner}>
        {loading ? (
          <Text style={s.loadingText}>{t.loading}</Text>
        ) : !entry ? (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>🚗</Text>
            <Text style={s.emptyText}>You are not in a queue</Text>
          </View>
        ) : entry.status === "ended" ? (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>👋</Text>
            <Text style={s.emptyText}>
              You left this queue ({entry.end_reason || "ended"})
            </Text>
            <Text style={[s.emptyText, { fontSize: 12, color: Colors.t3, marginTop: 8 }]}>
              Rejoin from the queue screen when you're ready.
            </Text>
            <TouchableOpacity style={s.openLoadingBtn} onPress={() => router.replace("/(app)/queue")}>
              <Text style={s.openLoadingBtnText}>Back to queue</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={s.carCard}>
              <Text style={s.carName}>{entry.vehicle?.make} {entry.vehicle?.model}</Text>
              <Text style={s.carSub}>{entry.vehicle?.plate} · Slot #{entry.position}</Text>
              {entry.load_start_at && (
                <Text style={s.carDate}>
                  Loading: {new Date(entry.load_start_at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                  {"  ·  "}
                  {new Date(entry.load_start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Text>
              )}
            </View>

            {pendingClaims.length > 0 && (
              <View style={s.claimsCard}>
                <Text style={s.claimsTitle}>🛎 {t.pendingClaims} · {pendingClaims.length}</Text>
                {pendingClaims.map(claim => (
                  <View key={claim.id} style={s.claimRow}>
                    {claim.passenger?.avatar_url ? (
                      <Image source={{ uri: claim.passenger.avatar_url }} style={s.claimAvatar} />
                    ) : (
                      <View style={s.claimAvatarFallback}><Text style={{ fontSize: 18 }}>👤</Text></View>
                    )}
                    <Text style={s.claimName} numberOfLines={1}>
                      {claim.passenger?.full_name || "Passenger"}
                    </Text>
                    {claim.passenger_id && (
                      <UserActionMenu
                        userId={claim.passenger_id}
                        userName={claim.passenger?.full_name || "Passenger"}
                      />
                    )}
                    <TouchableOpacity style={s.rejectBtn} onPress={() => handleRejectClaim(claim)}>
                      <Text style={s.rejectBtnText}>{t.rejectClaim}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.confirmBtn} onPress={() => handleConfirmClaim(claim)}>
                      <Text style={s.confirmBtnText}>{t.confirmClaim}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {entry.load_start_at && (
              <View style={s.metaCard}>
                <View style={s.metaRow}>
                  <Text style={s.metaKey}>📍 Address</Text>
                  <Text style={s.metaVal} numberOfLines={2}>{zoneAddress}</Text>
                </View>
                <View style={s.metaRow}>
                  <Text style={s.metaKey}>📅 Date</Text>
                  <Text style={s.metaVal}>{startedDate}</Text>
                </View>
                <View style={[s.metaRow, { borderBottomWidth: 0 }]}>
                  <Text style={s.metaKey}>🕒 Started</Text>
                  <Text style={s.metaVal}>{startedTime}</Text>
                </View>
              </View>
            )}

            {lstate && (
              <View style={[
                s.timerRow,
                lstate.phase === "warning" || lstate.phase === "expired" ? s.timerRowDanger
                  : lstate.phase === "reduced3" ? s.timerRowWarn
                  : null,
              ]}>
                <Text style={s.timerLabel}>⏱ {t.timeLeft}</Text>
                <Text style={[
                  s.timerVal,
                  lstate.phase === "warning" || lstate.phase === "expired" ? { color:Colors.red }
                    : lstate.phase === "reduced3" ? { color:Colors.yellow }
                    : null,
                ]}>{formatRemaining(lstate.remainingMs)}</Text>
              </View>
            )}
            {lstate?.showWarning && (
              <View style={s.warnBanner}>
                <Text style={s.warnText}>⚠ {t.twoHourWarning}</Text>
              </View>
            )}
            {lstate && required !== seats && (
              <View style={s.reduceBanner}>
                <Text style={s.reduceText}>
                  {t.requiredReduced.replace("{from}", String(seats)).replace("{to}", String(required))}
                </Text>
              </View>
            )}
            <View style={s.countRow}>
              <Text style={s.countMain}>{boarded} / {required}</Text>
              <Text style={s.countLabel}>passenger seats (driver excluded)</Text>
              <Text style={s.countLabel}>{t.boarded}</Text>
            </View>

            <Text style={s.hint}>{t.tapToBoard}</Text>

            <View style={s.seatGrid}>
              {Array.from({ length: seats }).map((_, i) => {
                const isFilled = states[i] === "boarded" || states[i] === "locked";
                const isLocked = states[i] === "locked";
                // Per-seat passenger: confirmed claims are mapped to locked
                // seats in confirmation order. Avatar overlays the SeatSvg
                // only on locked seats. Driver-tapped 'boarded' seats have
                // no passenger row, so no avatar.
                const lockedIndexSoFar = states
                  .slice(0, i)
                  .filter(st => st === "locked").length;
                const claim = isLocked ? confirmedClaims[lockedIndexSoFar] : null;
                const passenger = claim?.passenger;
                const initials = passenger?.full_name
                  ? passenger.full_name
                      .split(/\s+/).slice(0, 2).map(p => p.charAt(0).toUpperCase()).join("")
                  : null;
                // Seats beyond `required` are timer-expired (loading window
                // shrank). X out visually but keep clickable so the driver
                // can still re-offer the seat if a passenger walks up.
                const isExpired = i >= required;
                return (
                  <View key={i} style={s.seatSlot}>
                    <SeatSvg
                      filled={isFilled}
                      locked={isLocked}
                      color={Colors.accent}
                      size="full"
                      onPress={() => handleSeatTap(i)}
                      onLongPress={() => handleSeatLongPress(i)}
                    />
                    {passenger && (
                      <TouchableOpacity
                        style={s.seatAvatarWrap}
                        activeOpacity={0.7}
                        onPress={() => setOpenPassengerId(passenger.id)}
                        hitSlop={6}
                      >
                        {passenger.avatar_url ? (
                          <Image source={{ uri: passenger.avatar_url }} style={s.seatAvatar} />
                        ) : (
                          <View style={[s.seatAvatar, s.seatAvatarFallback]}>
                            <Text style={s.seatInitials}>{initials || "?"}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    )}
                    {isExpired && !isFilled && (
                      <View pointerEvents="none" style={s.seatExpiredX}>
                        <Text style={s.seatExpiredText}>✕</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            <PassengerProfileModal
              passengerId={openPassengerId}
              confirmed={true}
              onClose={() => setOpenPassengerId(null)}
            />

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

            <Text style={s.tip}>Tap a seat to add a passenger · Long-press to remove</Text>

            <View style={s.destRow}>
              <Text style={s.destLabel}>Destination: {getRegionName(entry.destination_region) || "—"}</Text>
              <TouchableOpacity
                style={[s.changeDestBtn, !canChangeDest && s.changeDestBtnOff]}
                onPress={() => canChangeDest && setShowDestPicker(true)}
                disabled={!canChangeDest}
              >
                <Text style={s.changeDestText}>Change</Text>
              </TouchableOpacity>
            </View>
            {!canChangeDest && (
              <Text style={s.destHint}>
                Destination locked — {(entry.seats_boarded ?? 0) > 0
                  ? "passengers have boarded"
                  : "more than 1 hour since loading started"}
              </Text>
            )}

            <TouchableOpacity style={s.departBtn} onPress={handleDepart} activeOpacity={0.85}>
              <Text style={s.departBtnText}>🚌 Depart now ({boarded}/{seats})</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      <BottomNav />

      <Modal visible={showDestPicker} transparent animationType="slide" onRequestClose={() => setShowDestPicker(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowDestPicker(false)}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Change destination</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {(zone ? getDestinationsFrom(zone.region, activeDestCodes) : []).map(dest => {
                const price = getPricePerSeat(zone?.region, dest);
                return (
                  <TouchableOpacity
                    key={dest}
                    style={[s.destPickRow, entry?.destination_region === dest && s.destPickActive]}
                    onPress={() => handleChangeDestination(dest)}
                  >
                    <Text style={[s.destPickName, entry?.destination_region === dest && { color: Colors.accent }]}>
                      → {getRegionName(dest)}
                    </Text>
                    <Text style={s.destPickPrice}>
                      {price !== null ? `C$${price} / seat` : "Set on board"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex:1, backgroundColor:Colors.bg },
  header:      { flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:16 },
  back:        { fontSize:20, color:Colors.t2 },
  title:       { fontSize:17, fontWeight:"700", color:Colors.t1 },
  msgBtn:      { width:32, height:32, alignItems:"center", justifyContent:"center" },
  msgBtnText:  { fontSize:18 },
  msgBadge:    { position:"absolute", top:-2, right:-4, minWidth:18, height:18, borderRadius:9, backgroundColor:Colors.red, paddingHorizontal:4, alignItems:"center", justifyContent:"center" },
  msgBadgeText:{ color:"#fff", fontSize:10, fontWeight:"800" },
  inner:       { padding:20, paddingBottom:60 },
  loadingText: { color:Colors.t2, textAlign:"center", marginTop:40 },
  empty:       { alignItems:"center", marginTop:80 },
  emptyEmoji:  { fontSize:48, marginBottom:12 },
  emptyText:   { fontSize:16, color:Colors.t2 },
  openLoadingBtn:     { marginTop:20, paddingHorizontal:24, paddingVertical:12, backgroundColor:Colors.accent, borderRadius:10 },
  openLoadingBtnText: { color:Colors.accentText, fontSize:14, fontWeight:"800" },
  carCard:     { backgroundColor:Colors.card, borderRadius:12, padding:14, borderWidth:0.5, borderColor:Colors.border, marginBottom:16 },
  carName:     { fontSize:16, fontWeight:"600", color:Colors.t1 },
  carSub:      { fontSize:12, color:Colors.t3, marginTop:3 },
  carDate:     { fontSize:11, color:Colors.t3, marginTop:6, fontWeight:"600" },
  metaCard:    { backgroundColor:Colors.card, borderRadius:12, padding:4, borderWidth:0.5, borderColor:Colors.border, marginBottom:20 },
  metaRow:     { flexDirection:"row", alignItems:"flex-start", justifyContent:"space-between", paddingVertical:10, paddingHorizontal:10, gap:10, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  metaKey:     { color:Colors.t3, fontSize:11, fontWeight:"600" },
  metaVal:     { color:Colors.t1, fontSize:12, fontWeight:"500", textAlign:"right", flex:1, marginLeft:8 },
  countRow:    { alignItems:"center", marginBottom:8 },
  countMain:   { fontSize:36, fontWeight:"900", color:Colors.accent },
  countLabel:  { fontSize:13, color:Colors.t2, marginTop:2 },
  hint:        { color:Colors.t3, fontSize:12, textAlign:"center", marginBottom:20 },
  seatGrid:    { flexDirection:"row", flexWrap:"wrap", gap:10, justifyContent:"center", marginBottom:24 },
  seatSlot:    { position:"relative" },
  // Avatar floats over the centre of the SeatSvg. The TouchableOpacity is
  // the only thing here that takes touch — the SeatSvg underneath stays
  // long-pressable around it.
  seatAvatarWrap:    { position:"absolute", top:5, left:0, right:0, alignItems:"center" },
  seatAvatar:        { width:26, height:26, borderRadius:13, borderWidth:1.5, borderColor:Colors.bg, backgroundColor:Colors.cardAlt },
  seatAvatarFallback:{ alignItems:"center", justifyContent:"center" },
  seatInitials:      { color:Colors.bg, fontSize:11, fontWeight:"900", letterSpacing:0.5 },
  seatExpiredX:      { position:"absolute", top:0, left:0, right:0, bottom:0, alignItems:"center", justifyContent:"center" },
  seatExpiredText:   { color:Colors.red, fontSize:32, fontWeight:"900", opacity:0.85 },
  legend:      { flexDirection:"row", gap:16, justifyContent:"center", marginBottom:20 },
  legendItem:  { flexDirection:"row", alignItems:"center", gap:6 },
  legendText:  { color:Colors.t3, fontSize:11 },
  timerRow:    { flexDirection:"row", alignItems:"center", justifyContent:"space-between", backgroundColor:Colors.card, borderRadius:8, padding:10, marginBottom:12, borderWidth:0.5, borderColor:Colors.border },
  timerRowWarn:  { borderColor:Colors.yellow+"60", backgroundColor:Colors.yellow+"10" },
  timerRowDanger:{ borderColor:Colors.red+"60",    backgroundColor:Colors.red+"10" },
  timerLabel:  { color:Colors.t2, fontSize:12 },
  timerVal:    { color:Colors.accent, fontSize:14, fontWeight:"700" },
  warnBanner:  { backgroundColor:Colors.red+"15", borderRadius:8, padding:10, marginBottom:8, borderWidth:0.5, borderColor:Colors.red+"40" },
  warnText:    { color:Colors.red, fontSize:12, textAlign:"center", fontWeight:"600" },
  reduceBanner:{ backgroundColor:Colors.yellow+"12", borderRadius:8, padding:10, marginBottom:12, borderWidth:0.5, borderColor:Colors.yellow+"30" },
  reduceText:  { color:Colors.yellow, fontSize:12, textAlign:"center", fontWeight:"600" },
  lockedBar:   { backgroundColor:Colors.accent+"12", borderRadius:8, padding:10, marginBottom:8, borderWidth:0.5, borderColor:Colors.accent+"30" },
  lockedText:  { color:Colors.accent, fontSize:12, textAlign:"center" },
  pendingBar:  { backgroundColor:Colors.yellow+"12", borderRadius:8, padding:10, borderWidth:0.5, borderColor:Colors.yellow+"30" },
  pendingText: { color:Colors.yellow, fontSize:12, textAlign:"center" },
  tip:         { color:Colors.t3, fontSize:11, textAlign:"center", marginTop:14, marginBottom:8, fontStyle:"italic" },
  departBtn:   { marginTop:8, backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center", marginBottom:24 },
  departBtnText:{ color:Colors.accentText, fontSize:15, fontWeight:"800" },
  destRow:     { flexDirection:"row", alignItems:"center", justifyContent:"space-between", marginTop:14, backgroundColor:Colors.card, borderRadius:12, padding:14, borderWidth:0.5, borderColor:Colors.border },
  destLabel:   { color:Colors.t1, fontSize:13, fontWeight:"600", flex:1 },
  changeDestBtn:{ backgroundColor:Colors.accent+"20", borderRadius:8, paddingHorizontal:12, paddingVertical:6, borderWidth:0.5, borderColor:Colors.accent+"50" },
  changeDestBtnOff:{ opacity:0.35 },
  changeDestText:{ color:Colors.accent, fontSize:12, fontWeight:"700" },
  destHint:    { color:Colors.t3, fontSize:11, marginTop:6, fontStyle:"italic", textAlign:"center" },
  modalOverlay:{ flex:1, backgroundColor:"rgba(0,0,0,0.6)", justifyContent:"flex-end" },
  modalSheet:  { backgroundColor:Colors.card, borderTopLeftRadius:20, borderTopRightRadius:20, paddingTop:12, paddingBottom:24 },
  modalHandle: { width:36, height:4, borderRadius:2, backgroundColor:Colors.border, alignSelf:"center", marginBottom:16 },
  modalTitle:  { fontSize:16, fontWeight:"700", color:Colors.t1, paddingHorizontal:16, marginBottom:8 },
  destPickRow: { flexDirection:"row", justifyContent:"space-between", alignItems:"center", paddingVertical:14, paddingHorizontal:16, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  destPickActive:{ backgroundColor:Colors.accent+"10" },
  destPickName:{ fontSize:14, fontWeight:"600", color:Colors.t1 },
  destPickPrice:{ fontSize:12, color:Colors.accent, fontWeight:"700" },
  claimsCard:  { backgroundColor:Colors.yellow+"12", borderRadius:14, padding:12, marginBottom:16, borderWidth:1, borderColor:Colors.yellow+"40" },
  claimsTitle: { color:Colors.yellow, fontSize:13, fontWeight:"800", marginBottom:10 },
  claimRow:    { flexDirection:"row", alignItems:"center", gap:8, paddingVertical:6 },
  claimAvatar: { width:32, height:32, borderRadius:16, backgroundColor:Colors.cardAlt },
  claimAvatarFallback: { width:32, height:32, borderRadius:16, backgroundColor:Colors.bg, alignItems:"center", justifyContent:"center", borderWidth:0.5, borderColor:Colors.border },
  claimName:   { flex:1, color:Colors.t1, fontSize:13, fontWeight:"600" },
  rejectBtn:   { backgroundColor:Colors.red+"18", paddingHorizontal:10, paddingVertical:6, borderRadius:8, borderWidth:0.5, borderColor:Colors.red+"50" },
  rejectBtnText:{ color:Colors.red, fontSize:11, fontWeight:"700" },
  confirmBtn:  { backgroundColor:"#22C55E", paddingHorizontal:10, paddingVertical:6, borderRadius:8 },
  confirmBtnText:{ color:"#fff", fontSize:11, fontWeight:"700" },
});
