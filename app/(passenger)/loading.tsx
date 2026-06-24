import { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, RefreshControl, Alert, Modal, Linking, Platform, Share, ActivityIndicator } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusAndForeground } from "../../hooks/useFocusAndForeground";
import { QueueAPI } from "../../services/queue";
import { ClaimsAPI, SeatClaim } from "../../services/claims";
import { MessagesAPI } from "../../services/messages";
import { MessageEvents } from "../../services/messageEvents";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { QueueEntry } from "../../constants/types";
import { useZones } from "../../hooks/useZones";
import { getDistanceKm } from "../../constants/zones";
import { getPricePerSeat, getDestinationsFrom, getRegionName } from "../../constants/pricing";
import { useDestinations } from "../../hooks/useDestinations";
import { loadingState, formatRemaining } from "../../utils/loadingTimer";
import { useNow } from "../../hooks/useNow";
import { tryGetUserLocation } from "../../utils/gpsTimeout";
import { getVehicleImageUrl } from "../../utils/vehicleImage";
import SeatSvg from "../../components/SeatSvg";
import VerifiedBadge from "../../components/VerifiedBadge";
import UserActionMenu from "../../components/UserActionMenu";
import PassengerBottomNav from "../../components/PassengerBottomNav";

// Sort priority within a destination group: the loader first, then waiting,
// then standby/penalised — mirrors the driver board in app/(app)/queue.tsx.
const STATUS_RANK: Record<string, number> = { loading: 0, called_back: 1, waiting: 2, standby: 2, penalised: 3 };

export default function PassengerLoadingScreen() {
  const router = useRouter();
  const { t, lang } = useStrings();
  const { zones } = useZones();
  const { activeCodes: activeDestCodes } = useDestinations();
  // Navigation context from Board tab: zoneId pins the loading view to the
  // zone the user was looking at, dest pre-applies the destination filter.
  const { dest: destParam, zoneId: zoneIdParam } = useLocalSearchParams<{ dest?: string; zoneId?: string }>();

  const [entries,    setEntries]    = useState<QueueEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeZone, setActiveZone] = useState(zones[0] || null);
  const [destFilter, setDestFilter] = useState<string | null>(destParam ?? null);
  const [userCoords, setUserCoords] = useState<{lat:number,lon:number}|null>(null);
  const [openClaims, setOpenClaims] = useState<Record<string, string>>({}); // entryId -> claimId
  // entryIds where the passenger's claim is CONFIRMED (not just pending).
  // Drives the Call / Message buttons in the driver row — both sides can
  // contact each other only after the driver has accepted the reservation.
  const [confirmedEntries, setConfirmedEntries] = useState<Set<string>>(new Set());
  // Confirmed claims per entry, ordered by confirmation time — drives the
  // boarded-passenger avatars overlaid on each filled seat (same mapping the
  // driver's my-loading screen uses: claim index N → seat index N).
  const [seatClaims, setSeatClaims] = useState<Record<string, SeatClaim[]>>({});
  const [claiming,   setClaiming]   = useState<string | null>(null);
  // Which driver row is expanded into its inline detail panel (seat map etc).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showDestPicker, setShowDestPicker] = useState(false);
  // Per-driver unread message count. Drives the badge on each card's 💬 button.
  const [unreadByDriver, setUnreadByDriver] = useState<Map<string, number>>(new Map());

  // True once the first load() completes — lets focus/foreground re-detects
  // refresh silently instead of flashing the full-screen spinner.
  const loadedOnceRef = useRef(false);

  // `silent` re-detects in the background without blanking the list — used by
  // the focus/foreground re-detect so reopening the app doesn't flash the
  // spinner over content. The first load always shows the spinner.
  const load = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) setRefreshing(true);
    else if (!silent || !loadedOnceRef.current) setLoading(true);
    let zone = activeZone;
    // If the Board tab handed us a zoneId, pin to it instead of GPS-detecting.
    // Keeps the loading view consistent with what the passenger saw on Board.
    if (zoneIdParam) {
      const pinned = zones.find(z => z.id === zoneIdParam);
      if (pinned) { zone = pinned; setActiveZone(pinned); }
    }
    // GPS read races against an 8s top-level timeout that covers BOTH the
    // permission request AND the position read — Android can hang on
    // either when the system is in a weird state, and we never want this
    // screen to freeze on "chargement".
    const loc = await tryGetUserLocation(8000);
    if (loc) {
      const { latitude, longitude } = loc.coords;
      setUserCoords({ lat: latitude, lon: longitude });
      // Only auto-localize when no zone was pinned via param — otherwise
      // honour the caller's choice.
      if (!zoneIdParam && zones.length > 0) {
        const nearest = zones
          .map(z => ({ z, d: getDistanceKm(latitude, longitude, z.latitude, z.longitude) }))
          .sort((a, b) => a.d - b.d)[0]?.z;
        if (nearest) { zone = nearest; setActiveZone(nearest); }
      }
    }
    if (zone) {
      // Full day's board: every active driver of the zone, not just the
      // one currently loading. getZoneQueue already excludes ended rows.
      const dayEntries = await QueueAPI.getZoneQueue(zone.id);
      setEntries(dayEntries);
      // Check each entry to see if we already have a claim on it, and pull
      // its confirmed claims so we can overlay boarded-passenger avatars on
      // the seat map. Track confirmed claims separately so we know whether
      // to show contact buttons (call / message) on that driver's card.
      const openMap: Record<string, string> = {};
      const confirmedSet = new Set<string>();
      const claimsMap: Record<string, SeatClaim[]> = {};
      await Promise.all(dayEntries.map(async e => {
        const [mine, confirmed] = await Promise.all([
          ClaimsAPI.findOpenClaim(e.id),
          ClaimsAPI.listConfirmedFor(e.id),
        ]);
        if (mine) {
          openMap[e.id] = mine.id;
          if (mine.status === "confirmed") confirmedSet.add(e.id);
        }
        claimsMap[e.id] = confirmed;
      }));
      setOpenClaims(openMap);
      setConfirmedEntries(confirmedSet);
      setSeatClaims(claimsMap);
    }
    // Unread DMs per driver — drives the badge on each card's chat icon.
    setUnreadByDriver(await MessagesAPI.unreadBySender());
    loadedOnceRef.current = true;
    setLoading(false); setRefreshing(false);
  }, [activeZone?.id, zones, zoneIdParam]);

  const inGeo = !!(activeZone && userCoords &&
    getDistanceKm(userCoords.lat, userCoords.lon, activeZone.latitude, activeZone.longitude) * 1000 <= activeZone.radius_meters);

  // Driver details (name, vehicle, plate) are now always visible — the
  // earlier 300m privacy gate was lifted per UX feedback. Only the Call /
  // Message buttons need a proximity check, gated at 500m. Confirmed
  // reservations also unlock contact regardless of distance (passenger
  // may be walking around mid-board).
  const distanceM = (activeZone && userCoords)
    ? Math.round(getDistanceKm(userCoords.lat, userCoords.lon, activeZone.latitude, activeZone.longitude) * 1000)
    : null;
  const within500m = distanceM !== null && distanceM <= 500;

  const handleClaim = async (entry: QueueEntry) => {
    if (!inGeo) {
      Alert.alert(t.outOfRangeTitle, t.outOfRange);
      return;
    }
    setClaiming(entry.id);
    const { data, error } = await ClaimsAPI.claim(entry.id);
    setClaiming(null);
    if (error) { Alert.alert(t.error, error); return; }
    if (data) setOpenClaims(prev => ({ ...prev, [entry.id]: data.id }));
  };

  // Re-run GPS + nearest-zone detection on every focus AND every time the
  // app returns from background, so the passenger lands on their current
  // zone whenever they reopen the app, even if they last viewed another.
  // Debounced (8s) + silent so the focus+foreground double-fire doesn't
  // re-run GPS several times or blank the list on every reopen.
  const refocusDetect = useCallback(() => { load(false, true); }, [load]);
  useFocusAndForeground(refocusDetect, 8000);

  // Live unread badge: bump the per-driver counter whenever a new message
  // arrives from one of the loading drivers, without waiting for a poll.
  useEffect(() => {
    const off = MessageEvents.on(msg => {
      setUnreadByDriver(prev => {
        const next = new Map(prev);
        next.set(msg.sender_id, (next.get(msg.sender_id) ?? 0) + 1);
        return next;
      });
    });
    return off;
  }, []);

  useEffect(() => {
    if (!activeZone) return;
    const sub = QueueAPI.subscribeToZone(activeZone.id, () => {
      QueueAPI.getZoneQueue(activeZone.id).then(q => setEntries(q));
    });
    return () => { sub.unsubscribe(); };
  }, [activeZone?.id]);

  const filtered = destFilter
    ? entries.filter(e => e.destination_region === destFilter)
    : entries;

  // Tick every second while at least one driver is actually loading (live
  // countdown), once a minute otherwise.
  const anyLoading = filtered.some(e => e.status === "loading");
  const now = useNow(anyLoading ? 1000 : 30_000, true);
  const reachable  = activeZone ? new Set(getDestinationsFrom(activeZone.region, activeDestCodes) as string[]) : new Set<string>();
  const allRegions = activeZone ? getDestinationsFrom(activeZone.region, activeDestCodes) : [];

  // Group the day's entries by destination region, then sort each group by
  // status priority (loader first) then queue position. Mirrors the driver
  // board so passenger + driver see the same ordering.
  const entriesByDest = filtered.reduce<Record<string, QueueEntry[]>>((acc, e) => {
    const key = e.destination_region || "_unknown";
    (acc[key] ??= []).push(e);
    return acc;
  }, {});
  Object.values(entriesByDest).forEach(list => list.sort((a, b) => {
    const sa = STATUS_RANK[a.status] ?? 9;
    const sb = STATUS_RANK[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return a.position - b.position;
  }));
  const sortedDestKeys = Object.keys(entriesByDest).sort((a, b) =>
    getRegionName(a).localeCompare(getRegionName(b))
  );

  const todayLabel = new Date().toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { weekday: "long", month: "long", day: "numeric" });

  const handleAddressTap = () => {
    if (!activeZone) return;
    const addr = activeZone.address || activeZone.name;
    Alert.alert(activeZone.name, addr, [
      { text: t.getDirections, onPress: () => {
        const q = encodeURIComponent(addr);
        const url = Platform.OS === "ios"
          ? `http://maps.apple.com/?daddr=${q}`
          : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
        Linking.openURL(url);
      }},
      { text: t.copyAddress, onPress: async () => {
        try { await Clipboard.setStringAsync(addr); } catch {}
      }},
      { text: t.shareAddress, onPress: async () => {
        try { await Share.share({ message: `${activeZone.name}\n${addr}` }); } catch {}
      }},
      { text: t.cancel, style: "cancel" },
    ]);
  };

  const statusTag = (status: string): { label: string; color: string } => {
    if (status === "loading")     return { label: t.loadingNowTag, color: "#22C55E" };
    if (status === "called_back") return { label: t.returning,     color: Colors.yellow };
    if (status === "penalised")   return { label: t.penalised,     color: Colors.red };
    if (status === "standby")     return { label: t.standbyTag,    color: Colors.t3 };
    return { label: t.waitingTag, color: Colors.t3 };
  };

  // Renders one driver row + (when expanded) the inline detail panel with the
  // seat map and boarded-passenger avatars.
  const renderEntry = (entry: QueueEntry) => {
    const vehicle = entry.vehicle;
    const totalSeats = vehicle?.seats || 4;
    const seats = Math.max(totalSeats - 1, 1);
    const boarded = entry.seats_boarded || 0;
    const isLoading = entry.status === "loading";
    const lstate = isLoading ? loadingState(entry.load_start_at, seats, now, entry.load_deadline) : null;
    const required = lstate?.effectiveRequired ?? seats;
    const remaining = required - boarded;
    const price = getPricePerSeat(activeZone?.region, entry.destination_region);
    const timerColor = lstate?.phase === "warning" || lstate?.phase === "expired"
      ? Colors.red
      : lstate?.phase === "reduced3" ? Colors.yellow : Colors.accent;
    const tag = statusTag(entry.status);
    const isExpanded = expandedId === entry.id;
    const confirmed = seatClaims[entry.id] || [];

    // Driver details are ALWAYS visible. Call / Message remain gated at 500m
    // proximity OR an existing confirmed reservation.
    const isMyReservation = confirmedEntries.has(entry.id);
    const canContact      = within500m || isMyReservation;
    const unreadFromThis  = entry.driver_id ? (unreadByDriver.get(entry.driver_id) ?? 0) : 0;

    const myClaimState = openClaims[entry.id]
      ? (isMyReservation ? "confirmed" : "requested")
      : null;

    return (
      <View key={entry.id} style={[s.card, isLoading && s.cardLoading]}>
        <TouchableOpacity
          style={s.cardHead}
          activeOpacity={0.85}
          onPress={() => setExpandedId(isExpanded ? null : entry.id)}
        >
          {entry.driver?.avatar_url ? (
            <Image source={{ uri: entry.driver.avatar_url }} style={s.avatar} />
          ) : (
            <View style={s.avatarFallback}><Text style={{ fontSize: 22 }}>👤</Text></View>
          )}
          <View style={{ flex: 1 }}>
            <View style={s.driverNameRow}>
              <Text style={s.driverName}>{entry.driver?.full_name || t.driverLabel}</Text>
              {entry.driver?.verified && <VerifiedBadge size={15} />}
              {entry.driver_id && (
                <UserActionMenu
                  userId={entry.driver_id}
                  userName={entry.driver?.full_name || t.driverLabel}
                />
              )}
            </View>
            <Text style={s.routeText}>
              {getRegionName(activeZone?.region)} → {getRegionName(entry.destination_region)}
            </Text>
            <View style={s.tagRow}>
              <View style={[s.tagPill, { backgroundColor: tag.color + "22", borderColor: tag.color }]}>
                <Text style={[s.tagText, { color: tag.color }]}>{tag.label}</Text>
              </View>
              <Text style={s.tagMeta}>
                {boarded}/{required}
                {isLoading && lstate ? `  ·  ⏱ ${formatRemaining(lstate.remainingMs)}` : ""}
              </Text>
            </View>
          </View>
          {price !== null && (
            <View style={s.priceBox}>
              <Text style={s.priceText}>C${price}</Text>
              <Text style={s.priceSub}>/ seat</Text>
            </View>
          )}
          <Text style={s.chevron}>{isExpanded ? "▾" : "▸"}</Text>
        </TouchableOpacity>

        {isExpanded && (
          <View style={[s.expandPanel, { borderLeftColor: isLoading ? timerColor : Colors.border }]}>
            {vehicle && (
              <Image
                source={{ uri: getVehicleImageUrl(vehicle.make, vehicle.model, vehicle.year, "side", vehicle.color || undefined) }}
                style={s.vehicleImg}
                resizeMode="contain"
              />
            )}
            {isMyReservation && !within500m && (
              <View style={s.yourTripBanner}>
                <Text style={s.yourTripText}>
                  {t("yourReservation", { distance: distanceM !== null ? t("metersFromZone", { m: String(distanceM) }) : t.outsideZone })}
                </Text>
              </View>
            )}

            {vehicle && (
              <Text style={s.vehicleInfoText}>
                {vehicle.year} {vehicle.make} {vehicle.model}
                {vehicle.color ? `  ·  ${vehicle.color}` : ""}
                {vehicle.plate ? `  ·  ${vehicle.plate}` : ""}
              </Text>
            )}

            <View style={s.expandRow}>
              <Text style={s.expandKey}>{t.destinationLabel}</Text>
              <Text style={s.expandVal}>{getRegionName(entry.destination_region)}</Text>
            </View>
            {price !== null && (
              <View style={s.expandRow}>
                <Text style={s.expandKey}>{t.priceLabel}</Text>
                <Text style={[s.expandVal, { color: Colors.accent, fontWeight: "700" }]}>C${price} / seat</Text>
              </View>
            )}
            {isLoading && lstate && (
              <View style={s.expandRow}>
                <Text style={s.expandKey}>{t.timeLeftCol}</Text>
                <Text style={[s.expandVal, { color: timerColor }]}>{formatRemaining(lstate.remainingMs)}</Text>
              </View>
            )}
            <View style={s.expandRow}>
              <Text style={s.expandKey}>{t.onBoardLabel}</Text>
              <Text style={s.expandVal}>{boarded} / {required} {isLoading && required !== seats ? `(was ${seats})` : ""}</Text>
            </View>

            {/* Seat map with boarded-passenger avatars. Confirmed claims map
                to locked seats in confirmation order; open seats are tappable
                to request a seat (only while the driver is loading). */}
            <View style={s.seatGrid}>
              {Array.from({ length: seats }).map((_, i) => {
                const isFilled  = i < boarded;
                const isLocked  = i < (entry.seats_locked || 0);
                const isExpired = i >= required; // shrunk by timer
                // Map confirmed claims to locked seats in order. Filled-but-
                // unlocked seats are driver-tapped boards with no claimant.
                const claim = isLocked ? confirmed[i] : null;
                const passenger = claim?.passenger;
                const initials = passenger?.full_name
                  ? passenger.full_name.split(/\s+/).slice(0, 2).map(p => p.charAt(0).toUpperCase()).join("")
                  : null;
                const openSeatTappable = isLoading && !isFilled && !isExpired && !myClaimState;
                return (
                  <View key={i} style={s.seatSlot}>
                    <SeatSvg
                      size="full"
                      filled={isFilled}
                      locked={isLocked}
                      color={isLoading ? Colors.accent : Colors.t3}
                      disabled={!openSeatTappable}
                      onPress={openSeatTappable ? () => handleClaim(entry) : undefined}
                    />
                    {passenger && (
                      <View style={s.seatAvatarWrap} pointerEvents="none">
                        {passenger.avatar_url ? (
                          <Image source={{ uri: passenger.avatar_url }} style={s.seatAvatar} />
                        ) : (
                          <View style={[s.seatAvatar, s.seatAvatarFallback]}>
                            <Text style={s.seatInitials}>{initials || "?"}</Text>
                          </View>
                        )}
                      </View>
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

            {lstate?.showWarning && (
              <View style={s.warnBanner}>
                <Text style={s.warnText}>⚠ {t.windowClosingSoon}</Text>
              </View>
            )}

            {entry.driver && (
              <View style={s.passengerContactRow}>
                {entry.driver.phone && (
                  <TouchableOpacity
                    style={[s.passengerContactBtn, !canContact && s.passengerContactBtnLocked]}
                    onPress={() => {
                      if (!canContact) {
                        Alert.alert(t.moveCloserToCall, t("moveCloserBody", { zone: activeZone?.name || "" }));
                        return;
                      }
                      Linking.openURL(`tel:${entry.driver!.phone}`);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={s.passengerContactEmoji}>{canContact ? "📞" : "🔒"}</Text>
                    <Text style={s.passengerContactLabel}>{t.callDriver}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[s.passengerContactBtn, s.passengerContactBtnPrimary, !canContact && s.passengerContactBtnLocked]}
                  onPress={() => {
                    if (!canContact) {
                      Alert.alert(t.moveCloserToMessage, t("moveCloserBody", { zone: activeZone?.name || "" }));
                      return;
                    }
                    if (entry.driver_id) {
                      setUnreadByDriver(prev => {
                        if (!prev.has(entry.driver_id!)) return prev;
                        const next = new Map(prev);
                        next.delete(entry.driver_id!);
                        return next;
                      });
                    }
                    router.push({
                      pathname: "/(app)/thread" as any,
                      params: {
                        id:    entry.driver_id,
                        name:  entry.driver?.full_name || t.driverLabel,
                        phone: entry.driver?.phone || "",
                      },
                    });
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={s.passengerContactEmoji}>{canContact ? "💬" : "🔒"}</Text>
                  <Text style={[s.passengerContactLabel, { color: Colors.accentText }]}>{t.messageLabel}</Text>
                  {unreadFromThis > 0 && (
                    <View style={s.passengerContactBadge}>
                      <Text style={s.passengerContactBadgeText}>
                        {unreadFromThis > 9 ? "9+" : unreadFromThis}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {isLoading ? (
              <TouchableOpacity
                style={[
                  s.claimBtn,
                  myClaimState === "confirmed" && s.claimBtnClaimed,
                  myClaimState === "requested" && s.claimBtnRequested,
                  !myClaimState && !inGeo && s.claimBtnDisabled,
                  claiming === entry.id && s.claimBtnDisabled,
                ]}
                onPress={() => handleClaim(entry)}
                disabled={!!myClaimState || !inGeo || claiming === entry.id}
                activeOpacity={0.85}
              >
                <Text style={s.claimBtnText}>
                  {myClaimState === "confirmed"
                    ? t.claimedLabel
                    : myClaimState === "requested"
                      ? t.requestedLabel
                      : claiming === entry.id
                        ? t.loading
                        : !inGeo
                          ? t.outOfRange
                          : t.requestSeat}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={s.boardingClosed}>
                <Text style={s.boardingClosedText}>{t.boardingClosed}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>🚌 {t.todaysDrivers}</Text>
        <View style={{ flex: 1 }} />
        <Text style={s.subtitle}>{activeZone?.name}</Text>
      </View>

      <Text style={s.dateLabel}>{todayLabel}</Text>

      {activeZone && (
        <TouchableOpacity style={s.addressBar} onPress={handleAddressTap} activeOpacity={0.7}>
          <Text style={s.addressIcon}>📍</Text>
          <Text style={s.addressText} numberOfLines={2}>{activeZone.address || activeZone.name}</Text>
          <Text style={s.addressArrow}>›</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={s.destDropdown} onPress={() => setShowDestPicker(true)} activeOpacity={0.85}>
        <Text style={s.destDropdownLabel}>
          {destFilter === null ? t.allDestinations : `→ ${getRegionName(destFilter)}`}
        </Text>
        <Text style={s.destDropdownArrow}>▾</Text>
      </TouchableOpacity>

      <ScrollView
        style={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.accent} />}
      >
        {loading ? (
          <View style={s.loadingBlock}>
            <ActivityIndicator color={Colors.accent} size="large" />
            <Text style={s.loadingText}>{t.loading}</Text>
          </View>
        ) : sortedDestKeys.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>⏸</Text>
            <Text style={s.emptyText}>{t.noDriversToday}</Text>
          </View>
        ) : (
          sortedDestKeys.map(destKey => (
            <View key={destKey} style={s.destGroup}>
              <Text style={s.destGroupTitle}>
                → {getRegionName(destKey)}
                <Text style={s.destGroupCount}>  ·  {entriesByDest[destKey].length}</Text>
              </Text>
              {entriesByDest[destKey].map(renderEntry)}
            </View>
          ))
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      <PassengerBottomNav />

      <Modal visible={showDestPicker} transparent animationType="slide" onRequestClose={() => setShowDestPicker(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowDestPicker(false)}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>{t.allDestinations}</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              <TouchableOpacity
                style={[s.destPickRow, destFilter === null && s.destPickRowActive]}
                onPress={() => { setDestFilter(null); setShowDestPicker(false); }}
              >
                <Text style={[s.destPickName, destFilter === null && { color: Colors.accent }]}>{t.allDestinations}</Text>
              </TouchableOpacity>
              {allRegions.map(dest => {
                const price = getPricePerSeat(activeZone?.region, dest);
                const isReachable = reachable.has(dest);
                return (
                  <TouchableOpacity
                    key={dest}
                    style={[s.destPickRow, destFilter === dest && s.destPickRowActive, !isReachable && { opacity: 0.45 }]}
                    onPress={() => { setDestFilter(dest); setShowDestPicker(false); }}
                    disabled={!isReachable}
                  >
                    <Text style={[s.destPickName, destFilter === dest && { color: Colors.accent }]}>→ {getRegionName(dest)}</Text>
                    {price !== null
                      ? <Text style={s.destPickPrice}>C${price} / seat</Text>
                      : <Text style={s.destPickPriceMuted}>No service</Text>}
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
  header:      { flexDirection:"row", alignItems:"center", paddingHorizontal:16, paddingTop:16, paddingBottom:4 },
  title:       { fontSize:18, fontWeight:"800", color:Colors.t1 },
  subtitle:    { fontSize:12, color:Colors.t3, fontWeight:"600" },
  dateLabel:   { fontSize:12.5, color:Colors.t2, fontWeight:"700", paddingHorizontal:16, paddingBottom:8, textTransform:"capitalize" },
  addressBar:  { flexDirection:"row", alignItems:"center", marginHorizontal:16, marginBottom:10, padding:12, backgroundColor:Colors.card, borderRadius:10, borderWidth:0.5, borderColor:Colors.border, gap:8 },
  addressIcon: { fontSize:16 },
  addressText: { flex:1, color:Colors.t2, fontSize:13, fontWeight:"500" },
  addressArrow:{ color:Colors.t3, fontSize:20, fontWeight:"300" },
  destDropdown:      { flexDirection:"row", alignItems:"center", justifyContent:"space-between", backgroundColor:Colors.card, marginHorizontal:16, marginVertical:8, paddingVertical:12, paddingHorizontal:14, borderRadius:12, borderWidth:1, borderColor:Colors.border },
  destDropdownLabel: { fontSize:14, fontWeight:"700", color:Colors.t1 },
  destDropdownArrow: { fontSize:14, color:Colors.accent, fontWeight:"700" },
  modalOverlay:      { flex:1, backgroundColor:"rgba(0,0,0,0.6)", justifyContent:"flex-end" },
  modalSheet:        { backgroundColor:Colors.card, borderTopLeftRadius:20, borderTopRightRadius:20, paddingTop:12, paddingBottom:24 },
  modalHandle:       { width:36, height:4, borderRadius:2, backgroundColor:Colors.border, alignSelf:"center", marginBottom:16 },
  modalTitle:        { fontSize:16, fontWeight:"700", color:Colors.t1, paddingHorizontal:16, marginBottom:8 },
  destPickRow:       { flexDirection:"row", justifyContent:"space-between", alignItems:"center", paddingVertical:14, paddingHorizontal:16, borderBottomWidth:0.5, borderBottomColor:Colors.border },
  destPickRowActive: { backgroundColor:Colors.accent+"10" },
  destPickName:      { fontSize:14, fontWeight:"600", color:Colors.t1 },
  destPickPrice:     { fontSize:12, color:Colors.accent, fontWeight:"700" },
  destPickPriceMuted:{ fontSize:11, color:Colors.t3, fontStyle:"italic" },
  scroll:      { flex:1, paddingHorizontal:16, paddingTop:8 },
  destGroup:       { marginBottom:14 },
  destGroupTitle:  { fontSize:13, fontWeight:"800", color:Colors.t2, marginBottom:8, letterSpacing:0.3 },
  destGroupCount:  { fontSize:12, fontWeight:"700", color:Colors.t3 },
  card:        { backgroundColor:Colors.card, borderRadius:16, borderWidth:0.5, borderColor:Colors.border, marginBottom:10, overflow:"hidden" },
  cardLoading: { borderWidth:1.5, borderColor:"#22C55E" },
  cardHead:    { flexDirection:"row", alignItems:"center", gap:10, padding:12 },
  vehicleImg:  { width:"100%", height:130, backgroundColor:Colors.cardAlt, borderRadius:10, marginBottom:8 },
  yourTripBanner: { paddingVertical:8, paddingHorizontal:12, backgroundColor:Colors.accent+"22", borderRadius:8, marginBottom:8, alignItems:"center" },
  yourTripText:   { color:Colors.accent, fontSize:11, fontWeight:"800", letterSpacing:1 },
  avatar:      { width:44, height:44, borderRadius:22, backgroundColor:Colors.cardAlt },
  avatarFallback: { width:44, height:44, borderRadius:22, backgroundColor:Colors.bg, alignItems:"center", justifyContent:"center", borderWidth:0.5, borderColor:Colors.border },
  driverNameRow:{ flexDirection:"row", alignItems:"center", gap:6 },
  driverName:  { fontSize:14, fontWeight:"700", color:Colors.t1 },
  routeText:   { fontSize:12, color:Colors.t2, marginTop:2 },
  tagRow:      { flexDirection:"row", alignItems:"center", gap:8, marginTop:5 },
  tagPill:     { paddingHorizontal:8, paddingVertical:2, borderRadius:999, borderWidth:1 },
  tagText:     { fontSize:10, fontWeight:"800", letterSpacing:0.5 },
  tagMeta:     { fontSize:11, color:Colors.t3, fontWeight:"600" },
  vehicleInfoText: { fontSize:11, color:Colors.t3, marginBottom:8, fontWeight:"500" },
  priceBox:    { alignItems:"flex-end" },
  priceText:   { fontSize:18, fontWeight:"800", color:Colors.accent },
  priceSub:    { fontSize:10, color:Colors.t3 },
  chevron:     { fontSize:16, color:Colors.t3, fontWeight:"800", marginLeft:2 },
  expandPanel: { borderTopWidth:0.5, borderTopColor:Colors.border, borderLeftWidth:3, padding:12, backgroundColor:Colors.bg },
  expandRow:   { flexDirection:"row", justifyContent:"space-between", alignItems:"center", paddingVertical:5 },
  expandKey:   { fontSize:12, color:Colors.t3, fontWeight:"600" },
  expandVal:   { fontSize:13, color:Colors.t1, fontWeight:"600" },
  seatGrid:    { flexDirection:"row", flexWrap:"wrap", justifyContent:"center", gap:8, paddingVertical:14 },
  seatSlot:    { position:"relative" },
  seatAvatarWrap:    { position:"absolute", top:5, left:0, right:0, alignItems:"center" },
  seatAvatar:        { width:26, height:26, borderRadius:13, borderWidth:1.5, borderColor:Colors.bg, backgroundColor:Colors.cardAlt },
  seatAvatarFallback:{ alignItems:"center", justifyContent:"center" },
  seatInitials:      { color:Colors.bg, fontSize:11, fontWeight:"900", letterSpacing:0.5 },
  seatExpiredX:      { position:"absolute", top:0, left:0, right:0, bottom:0, alignItems:"center", justifyContent:"center" },
  seatExpiredText:   { color:Colors.red, fontSize:30, fontWeight:"900", opacity:0.85 },
  passengerContactRow:        { flexDirection:"row", gap:8, paddingVertical:10 },
  passengerContactBtn:        { flex:1, flexDirection:"row", alignItems:"center", justifyContent:"center", gap:6, paddingVertical:10, borderRadius:10, backgroundColor:Colors.cardAlt, borderWidth:0.5, borderColor:Colors.border },
  passengerContactBtnPrimary: { backgroundColor:Colors.accent, borderColor:Colors.accent },
  passengerContactBtnLocked:  { opacity:0.5 },
  passengerContactEmoji:      { fontSize:14 },
  passengerContactLabel:      { color:Colors.t1, fontSize:13, fontWeight:"700" },
  passengerContactBadge:      { position:"absolute", top:-4, right:-4, minWidth:18, height:18, borderRadius:9, backgroundColor:Colors.red, paddingHorizontal:4, alignItems:"center", justifyContent:"center" },
  passengerContactBadgeText:  { color:"#fff", fontSize:10, fontWeight:"800" },
  warnBanner:  { backgroundColor:Colors.red+"15", borderWidth:0.5, borderColor:Colors.red+"40", borderRadius:8, padding:8, marginTop:4 },
  warnText:    { color:Colors.red, fontSize:11, textAlign:"center", fontWeight:"600" },
  claimBtn:    { backgroundColor:"#22C55E", padding:14, alignItems:"center", borderRadius:10, marginTop:6 },
  claimBtnText:{ color:"#fff", fontSize:14, fontWeight:"800" },
  claimBtnClaimed:  { backgroundColor:Colors.accent },
  claimBtnRequested:{ backgroundColor:Colors.yellow },
  claimBtnDisabled: { backgroundColor:Colors.card, opacity:0.7 },
  boardingClosed:   { backgroundColor:Colors.cardAlt, borderRadius:10, padding:12, marginTop:6, alignItems:"center" },
  boardingClosedText:{ color:Colors.t3, fontSize:12, fontWeight:"600", textAlign:"center" },
  loadingBlock: { alignItems:"center", marginTop:60, gap:12 },
  loadingText: { color:Colors.t2, textAlign:"center" },
  empty:       { alignItems:"center", marginTop:80, paddingHorizontal:24 },
  emptyEmoji:  { fontSize:48, marginBottom:12 },
  emptyText:   { fontSize:15, color:Colors.t2, textAlign:"center", lineHeight:22 },
});
