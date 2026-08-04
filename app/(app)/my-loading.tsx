import { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Image, Modal, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Location from "expo-location";
import { QueueAPI } from "../../services/queue";
import { ClaimsAPI, SeatClaim } from "../../services/claims";
import { MessagesAPI } from "../../services/messages";
import UserActionMenu from "../../components/UserActionMenu";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { QueueEntry, SeatStatus } from "../../constants/types";
import SeatSvg from "../../components/SeatSvg";
import BottomNav from "../../components/BottomNav";
import KolisParcels from "../../components/KolisParcels";
import PassengerProfileModal from "../../components/PassengerProfileModal";
import { loadingState, formatRemaining } from "../../utils/loadingTimer";
import { useNow } from "../../hooks/useNow";
import { supabase } from "../../services/supabase";
import { useZones } from "../../hooks/useZones";
import { getPricePerSeat, getDestinationsFrom, getRegionName } from "../../constants/pricing";
import { useDestinations } from "../../hooks/useDestinations";
import { PassengerBoardAPI, CarPassenger } from "../../services/passengerBoard";
import { ArrowLeft, MessageSquare, CarFront, CircleUserRound, MapPin, Clock, Timer, X, Lock, Hand, BellRing, Calendar, AlertTriangle, Hourglass, Bus } from "lucide-react-native";

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
  const [carPax, setCarPax] = useState<CarPassenger[]>([]);
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
      setCarPax(mine.status === "loading" ? await PassengerBoardAPI.carPassengers(mine.id) : []);
    } else {
      setPendingClaims([]);
      setConfirmedClaims([]);
      setCarPax([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    refreshAll();
    // Poll pending claims every 8s so the driver sees new claims promptly.
    const id = setInterval(refreshAll, 8000);
    return () => clearInterval(id);
  }, []);

  // Board a reservation from the live passenger board (loadq_board_passenger).
  const handleBoardReserved = async (tripId: string) => {
    await PassengerBoardAPI.boardPassenger(tripId);
    await refreshAll();
  };

  const handleConfirmClaim = async (claim: SeatClaim) => {
    if (!entry) return;
    // Time-shrunk cap: never confirm past the timer's effectiveRequired,
    // even if there are still empty seat slots on the car.
    if (boarded >= required) {
      Alert.alert(
        t.seatsUnavailable,
        t("seatsUnavailableBody", { required: String(required), seats: String(seats) }),
      );
      return;
    }
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
      t.rejectPassenger,
      t("rejectPassengerBody", { name: claim.passenger?.full_name || "" }),
      [
        { text: t.cancel, style: "cancel" },
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

  // Once the loading window expires we DON'T bounce the driver away — they stay
  // here so they can still tap Depart or Cancel. The server watchdog sends the
  // gentle nudges (3, ten minutes apart) and only then releases the spot. We
  // just nudge the watchdog along (~every 60s) so escalation keeps moving while
  // the screen is open, instead of waiting on the cron tick.
  const lastWatchdog = useRef(0);
  useEffect(() => {
    if (!entry || entry.status !== "loading" || !entry.load_start_at) return;
    const deadlineMs = entry.load_deadline
      ? new Date(entry.load_deadline).getTime()
      : new Date(entry.load_start_at).getTime() + 3 * 60 * 60 * 1000;
    if (now >= deadlineMs && Date.now() - lastWatchdog.current > 60_000) {
      lastWatchdog.current = Date.now();
      QueueAPI.triggerWatchdog();
    }
  }, [now, entry?.id, entry?.status, entry?.load_start_at, entry?.load_deadline]);

  // While loading, report GPS so the server can tailor a release message
  // (near the zone vs. away). Best-effort, scoped to the loading state.
  useEffect(() => {
    if (!isLoadingState) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    const reportOnce = async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) QueueAPI.reportLocation(pos.coords.latitude, pos.coords.longitude);
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 100, timeInterval: 120000 },
          loc => QueueAPI.reportLocation(loc.coords.latitude, loc.coords.longitude),
        );
        if (cancelled && sub) { sub.remove(); sub = null; }
      } catch { /* ignore transient GPS errors */ }
    };
    reportOnce();
    return () => { cancelled = true; if (sub) sub.remove(); };
  }, [isLoadingState]);

  const handleSeatTap = async (idx: number) => {
    if (!entry || entry.status === "ended") return;
    // Time-shrunk seats are off-limits — once the loading timer cuts the
    // allocation, the driver can't fill the surplus slots even manually.
    if (idx >= required) {
      Alert.alert(
        t.seatUnavailable,
        t("seatUnavailableBody", { required: String(required), seats: String(seats) }),
      );
      return;
    }
    const states = normalizeSeatStates(entry.seat_states, seatCountFor(entry));
    // Tap only ADDS a passenger; removing is a long-press (see handleSeatLongPress).
    if (states[idx] !== "empty") return; // already boarded/locked — long-press to remove
    states[idx] = "boarded";
    const boardedNext = states.filter(s => s === "boarded" || s === "locked").length;
    await QueueAPI.updateSeatStates(entry.id, states, boardedNext);
    setEntry({ ...entry, seat_states: states, seats_boarded: boardedNext });
  };

  const handleSeatLongPress = (idx: number) => {
    if (!entry || entry.status === "ended") return;
    const states = normalizeSeatStates(entry.seat_states, seatCountFor(entry));
    const wasLocked = states[idx] === "locked";
    if (states[idx] === "empty") return;
    Alert.alert(
      wasLocked ? t.removeConfirmed : t.removePassenger,
      wasLocked ? t.removeConfirmedBody : t.removePassengerBody,
      [
        { text: t.cancel, style: "cancel" },
        {
          text: t.remove,
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
      t.departNow,
      t("departNowBody", { boarded: String(boarded), seats: String(seats) }),
      [
        { text: t.cancel, style: "cancel" },
        {
          text: t.depart,
          style: "destructive",
          onPress: async () => {
            const { error } = await QueueAPI.depart(entry.id);
            if (error) { Alert.alert(t.error, error); return; }
            router.replace("/(app)/queue");
          },
        },
      ]
    );
  };

  const handleCancel = () => {
    if (!entry) return;
    Alert.alert(
      t.leaveQueueTitle,
      t.leaveQueueBody,
      [
        { text: t.stayInQueue, style: "cancel" },
        {
          text: t.leaveQueue,
          style: "destructive",
          onPress: async () => {
            const { error } = await QueueAPI.leaveQueue(entry.id);
            if (error) { Alert.alert(t.error, error); return; }
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

  const lstate   = isLoadingState ? loadingState(entry?.load_start_at, seats, now, entry?.load_deadline) : null;
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
          <ArrowLeft size={20} color={Colors.t2} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={s.title}>{t.myLoading}</Text>
        <TouchableOpacity
          onPress={() => router.push("/(app)/messages" as any)}
          style={s.msgBtn}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <MessageSquare size={18} color={Colors.t1} strokeWidth={2} />
          {unread > 0 && (
            <View style={s.msgBadge}>
              <Text style={s.msgBadgeText}>{unread > 9 ? "9+" : unread}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.inner}>
        {loading ? (
          <View style={s.loadingBlock}>
            <ActivityIndicator color={Colors.accent} size="large" />
            <Text style={s.loadingText}>{t.loading}</Text>
          </View>
        ) : !entry ? (
          <View style={s.empty}>
            <CarFront size={48} color={Colors.t1} strokeWidth={2} />
            <Text style={s.emptyText}>{t.youAreNotInQueue}</Text>
          </View>
        ) : entry.status === "ended" ? (
          <View style={s.empty}>
            <View style={{ marginBottom:12 }}>
              <Hand size={48} color={Colors.t2} strokeWidth={2} />
            </View>
            <Text style={s.emptyText}>
              {t("youLeftQueue", { reason: entry.end_reason || "ended" })}
            </Text>
            <Text style={[s.emptyText, { fontSize: 12, color: Colors.t3, marginTop: 8 }]}>
              {t.rejoinFromQueue}
            </Text>
            <TouchableOpacity style={s.openLoadingBtn} onPress={() => router.replace("/(app)/queue")}>
              <Text style={s.openLoadingBtnText}>{t.backToQueue}</Text>
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
                <View style={{ flexDirection:"row", alignItems:"center", gap:6, marginBottom:10 }}>
                  <BellRing size={13} color={Colors.yellow} strokeWidth={2} />
                  <Text style={[s.claimsTitle, { marginBottom:0 }]}>{t.pendingClaims} · {pendingClaims.length}</Text>
                </View>
                {boarded >= required && (
                  <Text style={s.claimsCap}>
                    {t("cappedByTimer", { n: String(required) })}
                  </Text>
                )}
                {pendingClaims.map(claim => {
                  const capped = boarded >= required;
                  return (
                    <View key={claim.id} style={s.claimRow}>
                      {claim.passenger?.avatar_url ? (
                        <Image source={{ uri: claim.passenger.avatar_url }} style={s.claimAvatar} />
                      ) : (
                        <View style={s.claimAvatarFallback}><CircleUserRound size={18} color={Colors.t1} strokeWidth={2} /></View>
                      )}
                      <Text style={s.claimName} numberOfLines={1}>
                        {claim.passenger?.full_name || t.passengerLabel}
                      </Text>
                      {claim.passenger_id && (
                        <UserActionMenu
                          userId={claim.passenger_id}
                          userName={claim.passenger?.full_name || t.passengerLabel}
                        />
                      )}
                      <TouchableOpacity style={s.rejectBtn} onPress={() => handleRejectClaim(claim)}>
                        <Text style={s.rejectBtnText}>{t.rejectClaim}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.confirmBtn, capped && s.confirmBtnDisabled]}
                        onPress={() => handleConfirmClaim(claim)}
                        disabled={capped}
                      >
                        <Text style={s.confirmBtnText}>{t.confirmClaim}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            {entry.load_start_at && (
              <View style={s.metaCard}>
                <View style={s.metaRow}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <MapPin size={11} color={Colors.t3} strokeWidth={2} />
                    <Text style={s.metaKey}>Address</Text>
                  </View>
                  <Text style={s.metaVal} numberOfLines={2}>{zoneAddress}</Text>
                </View>
                <View style={s.metaRow}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Calendar size={11} color={Colors.t3} strokeWidth={2} />
                    <Text style={s.metaKey}>Date</Text>
                  </View>
                  <Text style={s.metaVal}>{startedDate}</Text>
                </View>
                <View style={[s.metaRow, { borderBottomWidth: 0 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Clock size={11} color={Colors.t3} strokeWidth={2} />
                    <Text style={s.metaKey}>Started</Text>
                  </View>
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
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Timer size={12} color={Colors.t2} strokeWidth={2} />
                  <Text style={s.timerLabel}>{t.timeLeft}</Text>
                </View>
                <Text style={[
                  s.timerVal,
                  lstate.phase === "warning" || lstate.phase === "expired" ? { color:Colors.red }
                    : lstate.phase === "reduced3" ? { color:Colors.yellow }
                    : null,
                ]}>{formatRemaining(lstate.remainingMs)}</Text>
              </View>
            )}
            {lstate?.showWarning && (
              <View style={[s.warnBanner, { flexDirection:"row", alignItems:"center", justifyContent:"center", gap:6 }]}>
                <AlertTriangle size={12} color={Colors.red} strokeWidth={2} />
                <Text style={s.warnText}>{t.twoHourWarning}</Text>
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
                // shrank). Empty + expired slots are fully disabled — the
                // driver can't fill them. Filled + expired slots stay
                // long-pressable so a passenger can still be removed.
                const isExpired = i >= required;
                const seatDisabled = isExpired && !isFilled;
                return (
                  <View key={i} style={s.seatSlot}>
                    <SeatSvg
                      filled={isFilled}
                      locked={isLocked}
                      color={Colors.accent}
                      size="full"
                      disabled={seatDisabled}
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
                        <X size={32} color={Colors.red} strokeWidth={2} />
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
              <View style={[s.lockedBar, { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }]}>
                <Lock size={12} color={Colors.accent} strokeWidth={2} />
                <Text style={s.lockedText}>{locked} {t.seatLocked}</Text>
              </View>
            )}
            {boarded - locked > 0 && (
              <View style={[s.pendingBar, { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }]}>
                <Timer size={12} color={Colors.yellow} strokeWidth={2} />
                <Text style={s.pendingText}>{boarded - locked} {t.seatPending}</Text>
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

            {lstate?.phase === "expired" && (
              <View style={s.timeUpBanner}>
                <View style={{ flexDirection:"row", alignItems:"center", gap:6, marginBottom:6 }}>
                  <Hourglass size={14} color={Colors.accent} strokeWidth={2} />
                  <Text style={[s.timeUpTitle, { marginBottom:0 }]}>{t.timesUp}</Text>
                </View>
                <Text style={s.timeUpBody}>
                  Whenever you're ready, tap Depart (with your passengers) or Cancel so the next driver can go.
                </Text>
                <Text style={s.timeUpBodyFr}>
                  Dès que vous êtes prêt, touchez Partir ou Annuler pour laisser passer le prochain chauffeur.
                </Text>
              </View>
            )}

            {/* Reserved passengers from the live board (loadq_car_passengers).
                Tap Board to confirm each rider is in (loadq_board_passenger). */}
            {isLoadingState && carPax.length > 0 && (
              <View style={{ backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 15, padding: 13, marginTop: 14 }}>
                <Text style={{ color: Colors.t3, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase", marginBottom: 4 }}>
                  {t("reservedPassengers")} · {carPax.length}
                </Text>
                {carPax.map((p) => {
                  const isNew = !p.rating_count;
                  const ini = (p.passenger_name || "?").trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
                  return (
                    <View key={p.trip_id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 0.5, borderTopColor: Colors.border }}>
                      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.cardAlt, alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ color: Colors.t1, fontWeight: "800", fontSize: 13 }}>{ini}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ color: Colors.t1, fontSize: 13.5, fontWeight: "700" }} numberOfLines={1}>{p.passenger_name}</Text>
                          {isNew
                            ? <Text style={{ color: Colors.t2, fontSize: 9, fontWeight: "800", backgroundColor: Colors.cardAlt, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 }}>{t("badgeNew")}</Text>
                            : <Text style={{ color: Colors.yellow, fontSize: 11, fontWeight: "700" }}>★ {(p.rating_avg ?? 0).toFixed(1)}</Text>}
                        </View>
                        <Text style={{ color: Colors.t3, fontSize: 10.5, marginTop: 1 }}>{t("seatsN", { n: p.seats })}</Text>
                      </View>
                      {p.status === "boarded"
                        ? <Text style={{ color: Colors.green, fontWeight: "800", fontSize: 12 }}>✓ {t("tripBoarded")}</Text>
                        : <TouchableOpacity onPress={() => handleBoardReserved(p.trip_id)} style={{ backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 }}>
                            <Text style={{ color: Colors.accentText, fontWeight: "800", fontSize: 12 }}>{t("boardPassengerBtn")}</Text>
                          </TouchableOpacity>}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Kolis parcel offers for the trip — same bilingual card as the
                Queue screen; self-hides when there are no offers. Lets a loading
                driver grab a parcel for the same run without leaving the screen. */}
            <KolisParcels />

            <View style={s.actionRow}>
              <TouchableOpacity style={s.cancelBtn} onPress={handleCancel} activeOpacity={0.85}>
                <Text style={s.cancelBtnText}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.departBtn, { flexDirection:"row", alignItems:"center", justifyContent:"center", gap:6 }]} onPress={handleDepart} activeOpacity={0.85}>
                <Bus size={15} color={Colors.accentText} strokeWidth={2} />
                <Text style={s.departBtnText}>{t.depart} ({boarded}/{seats})</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
      <BottomNav />

      <Modal visible={showDestPicker} transparent animationType="slide" onRequestClose={() => setShowDestPicker(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowDestPicker(false)}>
          <View style={s.modalSheet}>
            <TouchableOpacity
              onPress={() => setShowDestPicker(false)}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
              style={{ position: "absolute", top: 12, right: 12, zIndex: 10 }}
            >
              <X size={22} color={Colors.t2} strokeWidth={2} />
            </TouchableOpacity>
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
  loadingText: { color:Colors.t2, textAlign:"center" },
  loadingBlock:{ alignItems:"center", marginTop:60, gap:12 },
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
  actionRow:   { flexDirection:"row", gap:10, marginTop:8, marginBottom:24 },
  departBtn:   { flex:1, backgroundColor:Colors.accent, borderRadius:14, padding:16, alignItems:"center" },
  departBtnText:{ color:Colors.accentText, fontSize:15, fontWeight:"800" },
  cancelBtn:   { flex:1, backgroundColor:Colors.card, borderRadius:14, padding:16, alignItems:"center", borderWidth:1, borderColor:Colors.border },
  cancelBtnText:{ color:Colors.t2, fontSize:15, fontWeight:"800" },
  timeUpBanner:{ backgroundColor:Colors.accent+"12", borderRadius:12, padding:14, marginTop:6, marginBottom:6, borderWidth:1, borderColor:Colors.accent+"50" },
  timeUpTitle: { color:Colors.accent, fontSize:14, fontWeight:"800", marginBottom:6 },
  timeUpBody:  { color:Colors.t1, fontSize:12.5, lineHeight:18 },
  timeUpBodyFr:{ color:Colors.t3, fontSize:11.5, lineHeight:16, fontStyle:"italic", marginTop:4 },
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
  confirmBtnDisabled:{ backgroundColor:Colors.cardAlt, opacity:0.5 },
  confirmBtnText:{ color:"#fff", fontSize:11, fontWeight:"700" },
  claimsCap:   { color:Colors.red, fontSize:11, fontWeight:"700", marginBottom:8, textAlign:"center" },
});
