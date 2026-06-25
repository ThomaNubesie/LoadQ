import { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Image, Modal, Alert, Linking, ActivityIndicator, TextInput } from "react-native";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { QueueAPI } from "../../services/queue";
import { MessagesAPI } from "../../services/messages";
import { MessageEvents } from "../../services/messageEvents";
import * as Location from "expo-location";
import { DriversAPI } from "../../services/drivers";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { QueueEntry, Vehicle } from "../../constants/types";
import SeatSvg from "../../components/SeatSvg";
import BottomNav from "../../components/BottomNav";
import KolisParcels from "../../components/KolisParcels";
import ZoneMap from "../../components/ZoneMap";
import { loadingState, formatRemaining, isWithinHours, nextRegistrationOpen } from "../../utils/loadingTimer";
import { getCurrentLocationWithTimeout, tryGetUserLocation } from "../../utils/gpsTimeout";
import { useNow } from "../../hooks/useNow";
import {
  REGIONS, detectUserRegion, getDistanceKm,
  ZoneLocation, RegionCode, getZonesByRegion
} from "../../constants/zones";
import { useZones, getZoneTimezone } from "../../hooks/useZones";
import { useDestinations } from "../../hooks/useDestinations";
import { useFocusAndForeground } from "../../hooks/useFocusAndForeground";
import { getVehicleImageUrl } from "../../utils/vehicleImage";
import { getPricePerSeat, getDestinationsFrom, getRegionName } from "../../constants/pricing";

export default function QueueScreen() {
  const router = useRouter();
  const { zoneId: paramZoneId, zoneName: paramZoneName } = useLocalSearchParams<{ zoneId?: string; zoneName?: string }>();
  const { t, lang } = useStrings();

  const { zones } = useZones();
  const { activeCodes: activeDestCodes } = useDestinations();

  const [entries,      setEntries]      = useState<QueueEntry[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [myId,         setMyId]         = useState<string|null>(null);
  const [myVehicle,    setMyVehicle]    = useState<Vehicle|null>(null);
  const [previewEntry, setPreviewEntry] = useState<QueueEntry|null>(null);
  const [userRegion,   setUserRegion]   = useState<RegionCode|null>(null);
  const [activeZone,   setActiveZone]   = useState<ZoneLocation|null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  // Sticky loading location: once a zone is chosen (auto-detected on first load,
  // or manually picked) it does NOT change on refresh/refocus — only via the
  // zone picker. manualPickRef hard-locks it to the user's explicit choice.
  const activeZoneRef = useRef<ZoneLocation | null>(null);
  useEffect(() => { activeZoneRef.current = activeZone; }, [activeZone]);
  const manualPickRef = useRef(false);
  // Admin queue controls — only rendered for drivers.is_admin; enforced server-side.
  type VerifiedDriver = { id: string; full_name: string | null; phone: string | null; verified: boolean; vehicle: { make: string; model: string; seats: number } | null };
  const [isAdmin, setIsAdmin] = useState(false);
  // Add flow is two-step: mode "add" = pick a verified driver, then "config" =
  // choose zone/destination/position/loading-time before inserting.
  const [adminModal, setAdminModal] = useState<{ mode: "add" | "config" | "move"; entry?: QueueEntry; dest?: string | null; driver?: VerifiedDriver } | null>(null);
  const [adminInput, setAdminInput] = useState("");
  const [driverResults, setDriverResults] = useState<VerifiedDriver[]>([]);
  const [adminBusy, setAdminBusy] = useState(false);
  // Config-panel state (step B of the add flow).
  const [addZoneId,  setAddZoneId]  = useState<string | null>(null);
  const [addDest,    setAddDest]    = useState<string | null>(null);
  const [addPos,     setAddPos]     = useState("");
  const [addMinutes, setAddMinutes] = useState<number | null>(null);
  const [addCustomMin, setAddCustomMin] = useState("");
  useEffect(() => { QueueAPI.isAdmin().then(setIsAdmin); }, []);
  // Remote Join-window config (public.queue_window) — drives the open/close
  // hours instead of the hardcoded 0/20. Falls back to {0,5,23} on failure.
  const [queueWindow, setQueueWindow] = useState<{ register_open_hour: number; load_open_hour: number; close_hour: number }>({ register_open_hour: 0, load_open_hour: 5, close_hour: 23 });
  useEffect(() => { QueueAPI.getQueueWindow().then(setQueueWindow); }, []);
  useEffect(() => {
    if (adminModal?.mode !== "add") return;
    let cancelled = false;
    QueueAPI.searchVerifiedDrivers(adminInput).then(r => { if (!cancelled) setDriverResults(r); });
    return () => { cancelled = true; };
  }, [adminModal?.mode, adminInput]);
  const reloadBoard = () => { const zid = activeZoneRef.current?.id; if (zid) QueueAPI.getZoneQueue(zid).then(setEntries); };
  const openAdminAdd    = (dest: string | null) => { setAdminInput(""); setDriverResults([]); setAdminModal({ mode: "add", dest }); };
  const openAdminMove   = (entry: QueueEntry)   => { setAdminInput(String(entry.position)); setAdminModal({ mode: "move", entry }); };
  // Step A → Step B: seed the config panel from the row that was tapped + the
  // current loading zone, and default the position to the end of that line.
  const pickAdminDriver = (driver: VerifiedDriver) => {
    const dest = adminModal?.dest === "_unknown" ? null : (adminModal?.dest ?? null);
    const zid  = activeZone?.id ?? null;
    const lineLen = entries.filter(e =>
      e.zone_id === zid && (e.destination_region ?? null) === dest &&
      e.status !== "ended"
    ).length;
    setAddZoneId(zid);
    setAddDest(dest);
    setAddPos(String(lineLen + 1));
    setAddMinutes(null);
    setAddCustomMin("");
    setAdminModal({ mode: "config", driver, dest });
  };
  const doAdminAdd = async () => {
    if (!adminModal?.driver || !addZoneId || adminBusy) return;
    const pos = parseInt(addPos, 10);
    const minutes = addMinutes === -1
      ? (parseInt(addCustomMin, 10) || null)
      : addMinutes;
    setAdminBusy(true);
    const { error } = await QueueAPI.adminAddToQueue(
      addZoneId, addDest, adminModal.driver.id,
      Number.isFinite(pos) && pos >= 1 ? pos : null,
      minutes,
    );
    setAdminBusy(false);
    if (error) { Alert.alert("Couldn't add", error); return; }
    setAdminModal(null); reloadBoard();
  };
  const doAdminMove = async () => {
    if (!adminModal?.entry || adminBusy) return;
    const n = parseInt(adminInput, 10);
    if (!Number.isFinite(n) || n < 1) { Alert.alert("Enter a queue number (1 or higher)"); return; }
    setAdminBusy(true);
    const { error } = await QueueAPI.adminMove(adminModal.entry.id, n);
    setAdminBusy(false);
    if (error) { Alert.alert("Couldn't move", error); return; }
    setAdminModal(null); reloadBoard();
  };
  // One-tap depart: confirm, then mark departed (0 seats) and refresh.
  const confirmAdminDepart = (entry: QueueEntry) => {
    Alert.alert(
      t("departConfirmTitle", { name: entry.driver?.full_name || t.driverLabel }),
      undefined,
      [
        { text: t.cancel, style: "cancel" },
        {
          text: t.depart, style: "destructive",
          onPress: async () => {
            const { error } = await QueueAPI.adminDepart(entry.id, 0);
            if (error) { Alert.alert("Couldn't depart", error); return; }
            reloadBoard();
          },
        },
      ],
    );
  };
  const [dropRegion,   setDropRegion]   = useState<RegionCode>("ottawa");
  const [userCoords,   setUserCoords]   = useState<{lat:number,lon:number}|null>(null);
  const [joining,      setJoining]      = useState(false);
  const [joinError,    setJoinError]    = useState("");
  const [myEntry,      setMyEntry]      = useState<QueueEntry|null>(null);
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [expandedId,     setExpandedId]     = useState<string | null>(null);
  const [unread,         setUnread]         = useState(0);
  // Per-sender unread count (sender_id → count). Drives the red dot badge
  // on each driver card's 💬 chat icon.
  const [unreadBySender, setUnreadBySender] = useState<Map<string, number>>(new Map());
  // Set of driver_ids whose card is currently flashing orange in response
  // to an incoming message. We add on receipt and remove ~2s later.
  const [flashIds,       setFlashIds]       = useState<Set<string>>(new Set());
  // True once the first load() completes — lets focus/foreground re-detects
  // refresh silently instead of flashing the full-screen spinner.
  const loadedOnceRef = useRef(false);

  useFocusEffect(useCallback(() => {
    MessagesAPI.unreadCount().then(setUnread);
    MessagesAPI.unreadBySender().then(setUnreadBySender);
  }, []));

  // Subscribe to inbound messages globally. On every new message we:
  //   1. Flash the sender's card for 2s (set add + timeout remove)
  //   2. Bump the per-sender unread count + the header total
  // This works even when the chat is closed — the chime fires from the
  // global MessageEvents service, the UI here just reacts.
  useEffect(() => {
    const off = MessageEvents.on((m) => {
      setFlashIds(prev => {
        const next = new Set(prev);
        next.add(m.sender_id);
        return next;
      });
      setUnreadBySender(prev => {
        const next = new Map(prev);
        next.set(m.sender_id, (next.get(m.sender_id) ?? 0) + 1);
        return next;
      });
      setUnread(u => u + 1);
      setTimeout(() => {
        setFlashIds(prev => {
          if (!prev.has(m.sender_id)) return prev;
          const next = new Set(prev);
          next.delete(m.sender_id);
          return next;
        });
      }, 2000);
    });
    return off;
  }, []);

  // Resolve active zone from params or GPS
  const resolveZone = (lat: number, lon: number): ZoneLocation | null => {
    if (zones.length === 0) return null;
    if (paramZoneId) {
      const z = zones.find(z => z.id === paramZoneId);
      if (z) return z;
    }
    const sorted = zones
      .map(z => ({ ...z, dist: getDistanceKm(lat, lon, z.latitude, z.longitude) }))
      .sort((a: any, b: any) => a.dist - b.dist);
    return sorted[0] || zones[0];
  };

  // `silent` re-detects in the background without flashing the full-screen
  // spinner — used by the focus/foreground re-detect so reopening the app
  // doesn't blank the queue. The first load always shows the spinner.
  const load = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) setRefreshing(true);
    else if (!silent || !loadedOnceRef.current) setLoading(true);
    // Single top-level timeout covers permission + location read so
    // neither call can hang this screen on weird Android states.
    const loc = await tryGetUserLocation(8000);
    if (loc) {
      const lat = loc.coords.latitude;
      const lon = loc.coords.longitude;
      setUserCoords({ lat, lon });
      const region = detectUserRegion(lat, lon);
      setUserRegion(region);
      if (region) setDropRegion(region);
      // Sticky: auto-pick the zone only on the FIRST load (none chosen yet).
      // After that the loading location changes only by manual selection.
      if (!activeZoneRef.current && !manualPickRef.current) setActiveZone(resolveZone(lat, lon));
    } else if (!activeZoneRef.current && !manualPickRef.current) {
      // GPS denied or timed out — use param or fall back to first zone.
      const z = paramZoneId ? zones.find(z => z.id === paramZoneId) : null;
      setActiveZone(prev => prev ?? z ?? zones[0] ?? null);
    }

    const [driver, vehicles] = await Promise.all([
      DriversAPI.getMe(),
      DriversAPI.getVehicles(),
    ]);
    setMyId(driver?.id || null);
    setMyVehicle(vehicles.find(v => v.is_active) || vehicles[0] || null);
    // Refresh the board for the (sticky) active zone.
    const zid = activeZoneRef.current?.id;
    if (zid) QueueAPI.getZoneQueue(zid).then(setEntries);
    loadedOnceRef.current = true;
    setLoading(false);
    setRefreshing(false);
  }, [paramZoneId, zones]);

  // Re-detect zone every time the screen focuses AND every time the app
  // returns from background. load() does GPS lookup and resolves to the
  // nearest zone — so a driver who drove from Ottawa to Montréal will land
  // in the Montréal queue the moment they reopen the app, no manual picker
  // tap needed. Debounced (8s) + silent so the focus+foreground double-fire
  // doesn't re-run GPS several times or blank the screen on every reopen.
  const refocusDetect = useCallback(() => { load(false, true); }, [load]);
  useFocusAndForeground(refocusDetect, 8000);

  // Track the driver's live position so the Join button flips green the
  // moment they walk into the zone radius. A single watchPositionAsync
  // subscription (scoped to focus) emits only on ~25m movement — far cheaper
  // and safer on Android than the old 5s setInterval, which stacked
  // overlapping one-shot getCurrentPositionAsync reads and could ANR/crash.
  useFocusEffect(useCallback(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 10000 },
          loc => setUserCoords({ lat: loc.coords.latitude, lon: loc.coords.longitude }),
        );
        if (cancelled) { sub.remove(); sub = null; }
      } catch { /* ignore transient GPS errors */ }
    })();
    return () => { cancelled = true; if (sub) sub.remove(); };
  }, []));

  // Keep our location fresh in the DB while we hold a queue spot, so the
  // watchdog can see us "present" and promote/reinsert us. Previously ONLY the
  // loading screen reported location, so waiting/standby drivers went stale and
  // were never reinserted. Foreground-only (scoped to focus, like the watch).
  const coordsRef = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => { coordsRef.current = userCoords; }, [userCoords]);
  const entryRef = useRef<QueueEntry | null>(null);
  useEffect(() => { entryRef.current = myEntry; }, [myEntry]);
  useFocusEffect(useCallback(() => {
    const push = () => {
      const c = coordsRef.current;
      if (c && entryRef.current) QueueAPI.reportLocation(c.lat, c.lon).catch(() => {});
    };
    push();
    const iv = setInterval(push, 60_000);
    return () => clearInterval(iv);
  }, []));

  // Pre-flight checks: window open, geo-fence, not already in queue.
  // Returns null on success, or an error message string.
  const validateJoin = (): string | null => {
    if (!activeZone || !myVehicle) return t.missingZoneOrVehicle;
    if (!isWithinHours(new Date(), getZoneTimezone(activeZone.id), queueWindow.register_open_hour, queueWindow.close_hour)) {
      return `${t.queueClosed} — ${t.queueClosedSub}`;
    }
    if (myEntry) return t.alreadyInQueue;
    if (!userCoords) return t.locationRequiredJoin;
    const dist = getDistanceKm(userCoords.lat, userCoords.lon, activeZone.latitude, activeZone.longitude);
    const allowedRadius = activeZone.radius_meters / 1000;
    if (dist > allowedRadius) {
      return `You must be within ${activeZone.radius_meters}m of this zone to join. Drive to ${activeZone.name} first.`;
    }
    return null;
  };

  const openJoinFlow = () => {
    setJoinError("");
    const err = validateJoin();
    if (err) { setJoinError(err); return; }
    setShowDestPicker(true);
  };

  const handleLeaveQueue = () => {
    if (!myEntry) return;
    Alert.alert(
      t.leaveQueueTitle,
      t.leaveQueueBody,
      [
        { text: t.stayInQueue, style: "cancel" },
        {
          text: t.leaveQueue,
          style: "destructive",
          onPress: async () => {
            const { error } = await QueueAPI.leaveQueue(myEntry.id);
            if (error) { setJoinError(error); return; }
            setMyEntry(null);
            if (activeZone) {
              QueueAPI.getZoneQueue(activeZone.id).then(setEntries);
            }
          },
        },
      ]
    );
  };

  const handleJoinWithDestination = async (destinationRegion: string) => {
    if (!activeZone || !myVehicle) return;
    setShowDestPicker(false);
    setJoining(true);
    const { error } = await QueueAPI.joinQueue(activeZone.id, myVehicle.id, destinationRegion);
    setJoining(false);
    if (error) { setJoinError(error); return; }
    QueueAPI.getZoneQueue(activeZone.id).then(q => {
      setEntries(q);
      const me = q.find(e => e.driver_id === myId);
      setMyEntry(me || null);
    });
  };

  // Load queue when activeZone changes
  useEffect(() => {
    if (!activeZone) return;
    QueueAPI.getZoneQueue(activeZone.id).then(q => {
      setEntries(q);
    });
    const sub = QueueAPI.subscribeToZone(activeZone.id, () => {
      QueueAPI.getZoneQueue(activeZone.id).then(q => {
        setEntries(q);
      });
    });
    return () => { sub.unsubscribe(); };
  }, [activeZone?.id]);

  // Track my entry
  useEffect(() => {
    if (myId && entries.length > 0) {
      setMyEntry(entries.find(e => e.driver_id === myId) || null);
    }
  }, [entries, myId]);

  const statusColor = (status: string) => {
    if (status === "loading")     return Colors.accent;
    if (status === "called_back") return Colors.yellow;
    if (status === "penalised")   return Colors.red;
    return Colors.t3;
  };

  const statusLabel = (status: string) => {
    if (status === "loading")     return t.loadingNow;
    if (status === "called_back") return t.returning;
    if (status === "penalised")   return t.penalised;
    return t.standby;
  };

  const loadingCount = entries.filter(e => e.status === "loading").length;

  // Group entries by destination_region, sort each group by status priority + position.
  const STATUS_RANK: Record<string, number> = { loading: 0, called_back: 1, waiting: 2, penalised: 3 };
  const entriesByDest = entries.reduce<Record<string, QueueEntry[]>>((acc, e) => {
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

  // Tick every second when any driver is loading; once a minute otherwise so the
  // window-open/closed banner flips at the boundary.
  const now           = useNow(loadingCount > 0 ? 1000 : 30_000, true);

  // The instant any loading entry hits the 3h cap (timer reads 0:00 on
  // every driver's card), ping the watchdog so the expired driver is
  // moved to the back AND the next driver is promoted to loading right
  // away — don't wait up to 60s for the server cron tick. Then refetch
  // twice so both the eviction and the promotion show up reliably.
  const firedExpiry = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const e of entries) {
      if (e.status !== "loading" || !e.load_start_at) continue;
      const deadlineMs = e.load_deadline
        ? new Date(e.load_deadline).getTime()
        : new Date(e.load_start_at).getTime() + 3 * 60 * 60 * 1000;
      if (now >= deadlineMs && !firedExpiry.current.has(e.id)) {
        firedExpiry.current.add(e.id);
        QueueAPI.triggerWatchdog();
        // Re-pull the queue twice — first to catch the eviction, second
        // to catch the next driver being promoted to loading.
        setTimeout(() => {
          if (activeZone) QueueAPI.getZoneQueue(activeZone.id).then(setEntries);
        }, 1500);
        setTimeout(() => {
          if (activeZone) QueueAPI.getZoneQueue(activeZone.id).then(setEntries);
        }, 4000);
      }
    }
  }, [now, entries, activeZone?.id]);
  const zoneTz        = getZoneTimezone(activeZone?.id);
  const windowOpen    = isWithinHours(new Date(now), zoneTz, queueWindow.register_open_hour, queueWindow.close_hour);
  const nextOpen      = windowOpen ? null : nextRegistrationOpen(new Date(now), zoneTz);

  // Are we physically inside the loading zone? Used to flip the Join button
  // styling so the driver gets visual confirmation they're allowed to join.
  const distanceMeters = activeZone && userCoords
    ? Math.round(getDistanceKm(userCoords.lat, userCoords.lon, activeZone.latitude, activeZone.longitude) * 1000)
    : null;
  const inGeo = distanceMeters !== null && activeZone !== null && distanceMeters <= activeZone.radius_meters;

  const isMyRegion = !activeZone || activeZone.region === userRegion || userRegion === null;

  const renderEntry = (entry: QueueEntry, idx: number) => {
    const vehicle  = entry.vehicle;
    const totalSeats = vehicle?.seats || 4;
    const seats      = Math.max(totalSeats - 1, 1); // exclude driver
    const boarded  = entry.seats_boarded || 0;
    const isMe     = entry.driver_id === myId;
    const sc       = statusColor(entry.status);

    const lstate = entry.status === "loading"
      ? loadingState(entry.load_start_at, seats, now, entry.load_deadline)
      : null;
    const required = lstate ? lstate.effectiveRequired : seats;
    const timerColor = lstate?.phase === "warning" || lstate?.phase === "expired"
      ? Colors.red
      : lstate?.phase === "reduced3"
        ? Colors.yellow
        : sc;
    const isExpandable = entry.status === "loading";
    const isExpanded   = isExpandable && expandedId === entry.id;
    const price = getPricePerSeat(activeZone?.region, entry.destination_region);
    const loadStartedAt = entry.load_start_at
      ? new Date(entry.load_start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null;
    const loadStartedDate = entry.load_start_at
      ? new Date(entry.load_start_at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
      : null;
    const zoneAddr = activeZone ? `${activeZone.name}${activeZone.address ? " — " + activeZone.address : ""}` : null;

    const isEnded = entry.status === "ended";
    const endLabel: Record<string, string> = {
      departed: t.endReasonDeparted, cancelled: t.endReasonCancelled, expired: t.endReasonExpired,
      removed_by_admin: t.endReasonRemoved, eod_close: t.endReasonClosed, window_closed: t.endReasonWindowClosed,
      released: t.endReasonExpired,
    };

    const unreadFromThis = unreadBySender.get(entry.driver_id) ?? 0;
    const isFlashing     = flashIds.has(entry.driver_id);

    return (
      <View key={entry.id}>
        <TouchableOpacity
          style={[s.row, isMe && s.rowMe, entry.status === "loading" && s.rowLoading, isEnded && s.rowEnded, isFlashing && s.rowFlash]}
          onPress={() => {
            if (isEnded) return;
            if (isExpandable) {
              setExpandedId(isExpanded ? null : entry.id);
            } else if (isMe) {
              router.replace("/(app)/my-loading");
            }
          }}
          activeOpacity={isExpandable || isMe ? 0.8 : 1}
        >
          <View style={[s.pos, {
            backgroundColor: idx === 0 ? Colors.yellow : idx === 1 ? "#6B7280" : idx === 2 ? "#92400E" : Colors.card
          }]}>
            <Text style={[s.posText, { color: idx < 3 ? "#000" : Colors.t2 }]}>{entry.position}</Text>
          </View>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation?.(); setPreviewEntry(entry); }}
            activeOpacity={0.7}
          >
            {entry.driver?.avatar_url ? (
              <Image source={{ uri: entry.driver.avatar_url }} style={s.rowAvatar} />
            ) : (
              <View style={[s.rowAvatar, s.rowAvatarFallback, { borderColor: sc+"40" }]}>
                <Text style={{ fontSize:18 }}>👤</Text>
              </View>
            )}
          </TouchableOpacity>
          <View style={s.info}>
            <Text style={s.name}>{entry.driver?.full_name || t.driverLabel}{isMe ? ` ${t.youSuffix}` : ""}</Text>
            <Text style={s.vehicleName}>{vehicle ? `${vehicle.make} ${vehicle.model}` : t.vehicleFallback}</Text>
            {!isEnded && (
              <>
                <View style={s.miniSeats}>
                  {Array.from({ length: seats }).map((_, i) => (
                    <SeatSvg key={i} size="mini" filled={i < boarded} color={sc} disabled />
                  ))}
                </View>
                <Text style={[s.statusText, { color: sc }]}>
                  {boarded}/{required} · {statusLabel(entry.status)}
                  {entry.seats_locked ? ` · ${entry.seats_locked} 🔒` : ""}
                  {lstate && required !== seats ? `  (was ${seats})` : ""}
                </Text>
                {lstate && (
                  <Text style={[s.timerText, { color: timerColor }]}>
                    ⏱ {formatRemaining(lstate.remainingMs)}
                    {lstate.showWarning ? "  ⚠ 3-hour close approaching" : ""}
                  </Text>
                )}
              </>
            )}
          </View>
          {isEnded && (
            <Text style={s.endedBadge}>{endLabel[entry.end_reason || ""] || t.endReasonGeneric}</Text>
          )}
          {!isMe && !isEnded && entry.driver && (
            <View style={s.contactRow}>
              {entry.driver.phone && (
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation?.(); Linking.openURL(`tel:${entry.driver!.phone}`); }}
                  style={s.contactBtn}
                  activeOpacity={0.7}
                  hitSlop={8}
                >
                  <Text style={s.contactBtnText}>📞</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation?.();
                  // Opening the thread will mark messages read; clear locally
                  // so the badge disappears immediately instead of waiting
                  // for the next focus tick.
                  setUnreadBySender(prev => {
                    if (!prev.has(entry.driver_id)) return prev;
                    const next = new Map(prev);
                    next.delete(entry.driver_id);
                    return next;
                  });
                  setUnread(u => Math.max(0, u - unreadFromThis));
                  router.push({
                    pathname: "/(app)/thread" as any,
                    params: {
                      id: entry.driver_id,
                      name: entry.driver!.full_name || t("driver"),
                      phone: entry.driver!.phone || "",
                    },
                  });
                }}
                style={s.contactBtn}
                activeOpacity={0.7}
                hitSlop={8}
              >
                <Text style={s.contactBtnText}>💬</Text>
                {unreadFromThis > 0 && (
                  <View style={s.contactBtnBadge}>
                    <Text style={s.contactBtnBadgeText}>
                      {unreadFromThis > 9 ? "9+" : unreadFromThis}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          )}
          {isExpandable && <Text style={s.expandChevron}>{isExpanded ? "▾" : "▸"}</Text>}
          {entry.status === "called_back" && <Text style={{ fontSize:16 }}>⏱</Text>}
        </TouchableOpacity>

        {isExpanded && lstate && (
          <View style={[s.expandPanel, { borderLeftColor: timerColor }]}>
            {vehicle && (
              <Image
                source={{ uri: getVehicleImageUrl(vehicle.make, vehicle.model, vehicle.year, "side", vehicle.color || undefined) }}
                style={s.expandVehicle}
                resizeMode="contain"
              />
            )}
            <View style={s.expandRow}>
              <Text style={s.expandKey}>Address</Text>
              <Text style={[s.expandVal, { textAlign: "right", flex: 1, marginLeft: 8 }]} numberOfLines={2}>{zoneAddr ?? "—"}</Text>
            </View>
            <View style={s.expandRow}>
              <Text style={s.expandKey}>Date</Text>
              <Text style={s.expandVal}>{loadStartedDate ?? "—"}</Text>
            </View>
            <View style={s.expandRow}>
              <Text style={s.expandKey}>Started at</Text>
              <Text style={s.expandVal}>{loadStartedAt ?? "—"}</Text>
            </View>
            <View style={s.expandRow}>
              <Text style={s.expandKey}>Time left</Text>
              <Text style={[s.expandVal, { color: timerColor }]}>{formatRemaining(lstate.remainingMs)}</Text>
            </View>
            <View style={s.expandRow}>
              <Text style={s.expandKey}>Seats</Text>
              <Text style={s.expandVal}>{boarded} of {required} {required !== seats ? `(was ${seats})` : ""}</Text>
            </View>
            <View style={s.expandSeats}>
              {Array.from({ length: seats }).map((_, i) => (
                <SeatSvg key={i} size="mini" filled={i < boarded} locked={i < (entry.seats_locked || 0)} color={timerColor} disabled />
              ))}
            </View>
            <View style={s.expandRow}>
              <Text style={s.expandKey}>Destination</Text>
              <Text style={s.expandVal}>{getRegionName(entry.destination_region)}</Text>
            </View>
            {price !== null && (
              <View style={s.expandRow}>
                <Text style={s.expandKey}>Price</Text>
                <Text style={[s.expandVal, { color: Colors.accent, fontWeight: "700" }]}>C${price} / seat  ·  C${price * required} full van</Text>
              </View>
            )}
            {isMe && (
              <>
                <TouchableOpacity style={s.openLoadingBtn} onPress={() => router.replace("/(app)/my-loading")}>
                  <Text style={s.openLoadingBtnText}>Open loading screen →</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.leaveBtn} onPress={handleLeaveQueue}>
                  <Text style={s.leaveBtnText}>Leave queue</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
        {isAdmin && !isEnded && (
          <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 10, marginTop: -2 }}>
            <TouchableOpacity onPress={() => openAdminMove(entry)} style={{ backgroundColor: Colors.cardAlt, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: Colors.t1, fontWeight: "700", fontSize: 12 }}>#{entry.position} ✎ Move</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => confirmAdminDepart(entry)} style={{ backgroundColor: Colors.cardAlt, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: Colors.t1, fontWeight: "700", fontSize: 12 }}>🚪 {t.depart}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const dropZones = getZonesByRegion(zones, dropRegion);

  return (
    <SafeAreaView style={s.container}>

      {/* ── Header ── */}
      <View style={s.header}>
        <View style={{ flex:1 }}>
          {/* Zone picker */}
          <TouchableOpacity style={s.zonePicker} onPress={() => setShowDropdown(true)} activeOpacity={0.8}>
            <Text style={s.zonePickerName}>{activeZone?.name || t.selectZone}</Text>
            <Text style={s.zonePickerRegion}>{activeZone ? REGIONS.find(r => r.code === activeZone.region)?.name : ""} ▾</Text>
          </TouchableOpacity>
          {activeZone && (
            <View style={s.liveRow}>
              <View style={s.liveDot} />
              <Text style={s.liveText}>Live · {entries.filter(e => e.status !== "ended").length} in queue</Text>
              {userCoords && !isMyRegion && <Text style={s.watchTag}> · Watching only</Text>}
              {!userCoords && <Text style={s.watchTag}> · Locating…</Text>}
            </View>
          )}
          {activeZone && (
            <Text style={{ color: Colors.t2, fontSize: 11.5, fontWeight: "700", marginTop: 3 }}>
              {new Date().toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { weekday: "long", month: "long", day: "numeric" })}
            </Text>
          )}
        </View>
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

      {/* ── My vehicle card ── */}
      {myVehicle && (
        <View style={s.vehicleBanner}>
          <Image
            source={{ uri: getVehicleImageUrl(myVehicle.make, myVehicle.model, myVehicle.year, "side", myVehicle.color || undefined) }}
            style={s.vehicleBannerImg}
            resizeMode="contain"
          />
          <View style={s.vehicleBannerInfo}>
            <Text style={s.vehicleBannerName}>{myVehicle.year} {myVehicle.make} {myVehicle.model}</Text>
            <Text style={s.vehicleBannerSub}>{myVehicle.plate} · {myVehicle.seats} seats</Text>
          </View>
          {isMyRegion && (
            myEntry ? (
              <View style={{ flexDirection:"row", alignItems:"center", gap:6 }}>
                <TouchableOpacity style={s.joinBtn} onPress={() => router.replace("/(app)/my-loading")} activeOpacity={0.85}>
                  <Text style={s.joinBtnText}>
                    #{myEntry.position} · {myEntry.status === "loading" ? t.loadingNow : getRegionName(myEntry.destination_region)} →
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.leaveChip} onPress={handleLeaveQueue} activeOpacity={0.7}>
                  <Text style={s.leaveChipText}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[
                  s.joinBtn,
                  s.joinBtnPrimary,
                  !windowOpen && s.joinBtnOff,
                  inGeo && windowOpen && s.joinBtnInGeo,
                ]}
                onPress={openJoinFlow}
                disabled={joining || !windowOpen}
                activeOpacity={0.85}
              >
                <Text style={[s.joinBtnText, { color: Colors.accentText }]}>
                  {!windowOpen
                    ? t.queueClosedShort
                    : joining
                      ? t.joining
                      : inGeo
                        ? `✓ ${t.joinQueue}`
                        : distanceMeters !== null
                          ? t("joinDistance", { d: String(distanceMeters) })
                          : t.joinQueue}
                </Text>
              </TouchableOpacity>
            )
          )}
        </View>
      )}

      {activeZone && (
        <ZoneMap
          latitude={activeZone.latitude}
          longitude={activeZone.longitude}
          label={activeZone.name}
          height={160}
        />
      )}

      {!windowOpen && (
        <View style={s.closedBanner}>
          <Text style={s.closedTitle}>🌙 {t.queueClosed}</Text>
          <Text style={s.closedSub}>
            {t.queueClosedSub}{nextOpen ? `  ·  ${nextOpen.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}` : ""}
          </Text>
        </View>
      )}

      {/* Join error */}
      {!!joinError && (
        <View style={s.geoError}>
          <Text style={s.geoErrorText}>📍 {joinError}</Text>
          <TouchableOpacity onPress={() => setJoinError("")}>
            <Text style={{ color:Colors.t3, fontSize:16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Queue list ── */}
      <ScrollView
        style={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.accent} />}
      >
        {/* Kolis: parcel offers for queued drivers (self-hides if none) */}
        <KolisParcels />
        {loading ? (
          <View style={s.loadingBlock}>
            <ActivityIndicator color={Colors.accent} size="large" />
            <Text style={s.loadingText}>{t.loading}</Text>
          </View>
        ) : entries.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>🚗</Text>
            <Text style={s.emptyText}>Queue is empty</Text>
            <Text style={s.emptySub}>Be the first to join</Text>
          </View>
        ) : (
          sortedDestKeys.map(destKey => {
            const list  = entriesByDest[destKey];
            const price = getPricePerSeat(activeZone?.region, destKey);
            return (
              <View key={destKey} style={{ marginTop:14 }}>
                <View style={s.destHeader}>
                  <Text style={s.destHeaderName}>
                    → {destKey === "_unknown" ? t.destinationNotSet : getRegionName(destKey)}
                  </Text>
                  <View style={{ flexDirection:"row", alignItems:"center", gap:8 }}>
                    <Text style={s.destHeaderCount}>{list.length}</Text>
                    {price !== null && (
                      <View style={s.priceBadge}>
                        <Text style={s.priceBadgeText}>C${price} / seat</Text>
                      </View>
                    )}
                    {isAdmin && (
                      <TouchableOpacity onPress={() => openAdminAdd(destKey)} style={{ backgroundColor: Colors.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                        <Text style={{ color: Colors.accentText, fontWeight: "800", fontSize: 12 }}>+ Add</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                {list.map((e, i) => renderEntry(e, i))}
              </View>
            );
          })
        )}
        <View style={{ height:100 }} />
      </ScrollView>

      <BottomNav />

      {/* ── Zone selector dropdown modal ── */}
      {/* Driver profile preview — opens on row avatar tap */}
      <Modal visible={!!previewEntry} transparent animationType="fade" onRequestClose={() => setPreviewEntry(null)}>
        <TouchableOpacity style={s.previewOverlay} activeOpacity={1} onPress={() => setPreviewEntry(null)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation?.()} style={s.previewCard}>
            <View style={s.previewAvatarBox}>
              {previewEntry?.driver?.avatar_url ? (
                <Image source={{ uri: previewEntry.driver.avatar_url }} style={s.previewAvatar} />
              ) : (
                <View style={s.previewAvatarFallback}><Text style={{ fontSize: 48 }}>👤</Text></View>
              )}
            </View>
            <Text style={s.previewName}>{previewEntry?.driver?.full_name || "Driver"}</Text>
            {previewEntry?.driver?.trust_score !== undefined && (
              <Text style={s.previewTrust}>⭐ Trust score: {previewEntry.driver.trust_score}</Text>
            )}
            <Text style={s.previewId}>#{previewEntry?.driver?.id?.slice(0, 8).toUpperCase()}</Text>

            {previewEntry?.vehicle && (
              <View style={s.previewVehicleBox}>
                <Image
                  source={{ uri: getVehicleImageUrl(
                    previewEntry.vehicle.make,
                    previewEntry.vehicle.model,
                    previewEntry.vehicle.year,
                    "side",
                    previewEntry.vehicle.color || undefined
                  ) }}
                  style={s.previewVehicle}
                  resizeMode="contain"
                />
                <Text style={s.previewVehicleName}>
                  {previewEntry.vehicle.year} {previewEntry.vehicle.make} {previewEntry.vehicle.model}
                  {previewEntry.vehicle.color ? `  ·  ${previewEntry.vehicle.color}` : ""}
                </Text>
                <Text style={s.previewPlate}>{previewEntry.vehicle.plate}</Text>
              </View>
            )}

            {previewEntry && previewEntry.driver_id !== myId && (
              <View style={s.previewActions}>
                {previewEntry.driver?.phone && (
                  <TouchableOpacity
                    style={[s.previewActBtn, s.previewActCall]}
                    onPress={() => { Linking.openURL(`tel:${previewEntry.driver!.phone}`); }}
                    activeOpacity={0.85}
                  >
                    <Text style={s.previewActText}>📞  Call</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[s.previewActBtn, s.previewActMsg]}
                  onPress={() => {
                    const id   = previewEntry.driver_id;
                    const name = previewEntry.driver?.full_name || t("driver");
                    const phone = previewEntry.driver?.phone || "";
                    setPreviewEntry(null);
                    router.push({ pathname: "/(app)/thread" as any, params: { id, name, phone } });
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={s.previewActText}>💬  Message</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity style={s.previewClose} onPress={() => setPreviewEntry(null)}>
              <Text style={s.previewCloseText}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Destination picker — opens on Join queue tap */}
      <Modal visible={showDestPicker} transparent animationType="slide" onRequestClose={() => setShowDestPicker(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowDestPicker(false)}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Where are you going?</Text>
            <Text style={s.destSub}>
              From {activeZone ? getRegionName(activeZone.region) : "—"}. Your queue position is per destination.
            </Text>
            <View style={s.destList}>
              {(activeZone ? getDestinationsFrom(activeZone.region, activeDestCodes) : []).map(dest => {
                const price = getPricePerSeat(activeZone?.region, dest);
                return (
                  <TouchableOpacity
                    key={dest}
                    style={s.destOption}
                    onPress={() => handleJoinWithDestination(dest)}
                    activeOpacity={0.85}
                  >
                    <Text style={s.destOptionName}>→ {getRegionName(dest)}</Text>
                    <Text style={s.destOptionPrice}>C${price} / seat</Text>
                  </TouchableOpacity>
                );
              })}
              {activeZone && getDestinationsFrom(activeZone.region, activeDestCodes).length === 0 && (
                <Text style={s.destEmpty}>No destinations configured from this region yet.</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => setShowDestPicker(false)} style={s.destCancel}>
              <Text style={s.destCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showDropdown} transparent animationType="slide" onRequestClose={() => setShowDropdown(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowDropdown(false)}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Select loading zone</Text>

            {/* City tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:12 }} contentContainerStyle={{ gap:8, paddingHorizontal:16 }}>
              {REGIONS.map(r => (
                <TouchableOpacity
                  key={r.code}
                  style={[s.cityTab, dropRegion === r.code && s.cityTabActive]}
                  onPress={() => setDropRegion(r.code)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.cityTabText, dropRegion === r.code && { color:Colors.accent }]}>{r.name}</Text>
                  {r.code === userRegion && <View style={s.cityTabDot} />}
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Zone list for selected city */}
            <ScrollView contentContainerStyle={{ paddingHorizontal:16, paddingBottom:40 }}>
              {dropZones.map(zone => {
                const isActive = activeZone?.id === zone.id;
                const dist = userCoords
                  ? getDistanceKm(userCoords.lat, userCoords.lon, zone.latitude, zone.longitude)
                  : null;
                const canJoin = zone.region === userRegion || userRegion === null;
                return (
                  <TouchableOpacity
                    key={zone.id}
                    style={[s.zoneRow, isActive && s.zoneRowActive]}
                    onPress={() => { manualPickRef.current = true; setActiveZone(zone); setShowDropdown(false); }}
                    activeOpacity={0.8}
                  >
                    <View style={{ flex:1 }}>
                      <Text style={s.zoneRowName}>{zone.name}</Text>
                      <Text style={s.zoneRowAddr}>{zone.address}</Text>
                      {dist !== null && (
                        <Text style={s.zoneRowDist}>
                          {dist < 1 ? `${Math.round(dist*1000)}m away` : `${dist.toFixed(1)}km away`}
                        </Text>
                      )}
                    </View>
                    <View style={{ alignItems:"flex-end", gap:4 }}>
                      {isActive && <Text style={s.activeTag}>✓ Active</Text>}
                      {!canJoin && <Text style={s.watchOnlyTag}>Watch only</Text>}
                      <View style={s.liveDot} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Admin queue controls ── */}
      <Modal visible={!!adminModal} transparent animationType="slide" onRequestClose={() => setAdminModal(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setAdminModal(null)}>
          <View style={s.modalSheet}>
            <View style={{ alignItems: "center", paddingTop: 6 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
            </View>
            {adminModal?.mode === "add" && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
                <Text style={s.modalTitle}>{t.addDriverToLine}</Text>
                <TextInput
                  value={adminInput} onChangeText={setAdminInput} autoFocus
                  placeholder={t.searchNameOrPhone} placeholderTextColor={Colors.t3}
                  style={{ backgroundColor: Colors.bg, borderColor: Colors.border, borderWidth: 1, borderRadius: 10, color: Colors.t1, padding: 12, fontSize: 16, marginBottom: 10 }}
                />
                <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
                  {driverResults.map(d => {
                    const initials = (d.full_name || "?").trim().split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase();
                    return (
                      <TouchableOpacity key={d.id} disabled={adminBusy} onPress={() => pickAdminDriver(d)}
                        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomColor: Colors.border, borderBottomWidth: 1 }}>
                        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.accent + "22", alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ color: Colors.accent, fontWeight: "800", fontSize: 14 }}>{initials || "?"}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={{ color: Colors.t1, fontWeight: "700", fontSize: 15 }} numberOfLines={1}>{d.full_name || "(no name)"}</Text>
                            <Text style={{ color: Colors.green, fontSize: 11, fontWeight: "700" }}>{t.verifiedBadge}</Text>
                          </View>
                          <Text style={{ color: Colors.t3, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                            {d.vehicle ? `${d.vehicle.make} ${d.vehicle.model} · ${d.vehicle.seats} seats` : (d.phone || "")}
                          </Text>
                        </View>
                        <Text style={{ color: Colors.t3, fontSize: 16 }}>›</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {driverResults.length === 0 && <Text style={{ color: Colors.t3, paddingVertical: 16 }}>{t.noDriversFound}</Text>}
                </ScrollView>
              </View>
            )}
            {adminModal?.mode === "config" && adminModal.driver && (
              <ScrollView style={{ maxHeight: "100%" }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
                <Text style={s.modalTitle}>{adminModal.driver.full_name || "(no name)"}</Text>

                {/* Loading location (zone picker) */}
                <Text style={s.adminFieldLabel}>{t.loadingLocation}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                  {zones.map(z => (
                    <TouchableOpacity key={z.id} onPress={() => setAddZoneId(z.id)}
                      style={[s.adminChip, addZoneId === z.id && s.adminChipActive]}>
                      <Text style={[s.adminChipText, addZoneId === z.id && { color: Colors.accent }]}>{z.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Destination (region picker for the chosen zone's region) */}
                <Text style={s.adminFieldLabel}>{t.destinationLabel}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                  {(() => {
                    const z = zones.find(z => z.id === addZoneId);
                    const dests = z ? getDestinationsFrom(z.region, activeDestCodes) : [];
                    return dests.map(dest => (
                      <TouchableOpacity key={dest} onPress={() => setAddDest(dest)}
                        style={[s.adminChip, addDest === dest && s.adminChipActive]}>
                        <Text style={[s.adminChipText, addDest === dest && { color: Colors.accent }]}>→ {getRegionName(dest)}</Text>
                      </TouchableOpacity>
                    ));
                  })()}
                </ScrollView>

                {/* Position */}
                <Text style={s.adminFieldLabel}>{t.positionLabel}</Text>
                <TextInput
                  value={addPos} onChangeText={setAddPos} keyboardType="number-pad"
                  style={{ backgroundColor: Colors.bg, borderColor: Colors.border, borderWidth: 1, borderRadius: 10, color: Colors.t1, padding: 12, fontSize: 18, fontWeight: "800", textAlign: "center" }}
                />

                {/* Loading time */}
                <Text style={s.adminFieldLabel}>{t.loadingTimeLabel}</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {[120, 180, 240].map(m => (
                    <TouchableOpacity key={m} onPress={() => { setAddMinutes(m); setAddCustomMin(""); }}
                      style={[s.adminChip, addMinutes === m && s.adminChipActive]}>
                      <Text style={[s.adminChipText, addMinutes === m && { color: Colors.accent }]}>{m / 60}h</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity onPress={() => setAddMinutes(-1)}
                    style={[s.adminChip, addMinutes === -1 && s.adminChipActive]}>
                    <Text style={[s.adminChipText, addMinutes === -1 && { color: Colors.accent }]}>{t.customMinutes}</Text>
                  </TouchableOpacity>
                </View>
                {addMinutes === -1 && (
                  <TextInput
                    value={addCustomMin} onChangeText={setAddCustomMin} keyboardType="number-pad"
                    placeholder={t.minutesShort} placeholderTextColor={Colors.t3}
                    style={{ marginTop: 10, backgroundColor: Colors.bg, borderColor: Colors.border, borderWidth: 1, borderRadius: 10, color: Colors.t1, padding: 12, fontSize: 16, textAlign: "center" }}
                  />
                )}

                <TouchableOpacity onPress={doAdminAdd} disabled={adminBusy || !addZoneId}
                  style={{ marginTop: 18, backgroundColor: Colors.accent, borderRadius: 12, padding: 15, alignItems: "center", opacity: !addZoneId ? 0.4 : 1 }}>
                  <Text style={{ color: Colors.accentText, fontWeight: "800", fontSize: 16 }}>
                    {adminBusy ? "…" : t("addDriverAt", { name: adminModal.driver.full_name || "", pos: addPos || "—" })}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            )}
            {adminModal?.mode === "move" && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 28 }}>
                <Text style={s.modalTitle}>Change queue number</Text>
                <TextInput
                  value={adminInput} onChangeText={setAdminInput} keyboardType="number-pad" autoFocus
                  style={{ backgroundColor: Colors.bg, borderColor: Colors.border, borderWidth: 1, borderRadius: 10, color: Colors.t1, padding: 14, fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 14 }}
                />
                <TouchableOpacity onPress={doAdminMove} disabled={adminBusy}
                  style={{ backgroundColor: Colors.accent, borderRadius: 12, padding: 15, alignItems: "center" }}>
                  <Text style={{ color: Colors.accentText, fontWeight: "800", fontSize: 16 }}>{adminBusy ? "…" : "Move"}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:          { flex:1, backgroundColor:Colors.bg },
  header:             { flexDirection:"row", alignItems:"center", paddingHorizontal:16, paddingTop:8, paddingBottom:10, gap:10 },
  msgBtn:             { width:36, height:36, alignItems:"center", justifyContent:"center" },
  msgBtnText:         { fontSize:20 },
  msgBadge:           { position:"absolute", top:-2, right:-4, minWidth:18, height:18, borderRadius:9, backgroundColor:Colors.red, paddingHorizontal:4, alignItems:"center", justifyContent:"center" },
  msgBadgeText:       { color:"#fff", fontSize:10, fontWeight:"800" },
  zonePicker:         { flexDirection:"row", alignItems:"center", gap:8 },
  zonePickerName:     { fontSize:16, fontWeight:"700", color:Colors.t1 },
  zonePickerRegion:   { fontSize:13, color:Colors.accent, fontWeight:"600" },
  liveRow:            { flexDirection:"row", alignItems:"center", gap:5, marginTop:3 },
  liveDot:            { width:7, height:7, borderRadius:4, backgroundColor:Colors.accent },
  liveText:           { fontSize:11, color:Colors.t2 },
  watchTag:           { fontSize:11, color:Colors.yellow },
  vehicleBanner:      { flexDirection:"row", alignItems:"center", backgroundColor:Colors.card, borderBottomWidth:0.5, borderBottomColor:Colors.border, paddingHorizontal:14, paddingVertical:10, gap:10 },
  vehicleBannerImg:   { width:80, height:50, borderRadius:8 },
  vehicleBannerInfo:  { flex:1 },
  vehicleBannerName:  { fontSize:12, fontWeight:"600", color:Colors.t1 },
  vehicleBannerSub:   { fontSize:11, color:Colors.t3, marginTop:2 },
  joinBtn:            { backgroundColor:Colors.accent+"20", borderRadius:8, paddingHorizontal:10, paddingVertical:6, borderWidth:0.5, borderColor:Colors.accent+"50" },
  joinBtnText:        { color:Colors.accent, fontSize:11, fontWeight:"700" },
  scroll:             { flex:1, paddingHorizontal:16 },
  groupLabel:         { fontSize:10, fontWeight:"700", color:Colors.t3, letterSpacing:0.7, textTransform:"uppercase", marginBottom:8, marginTop:12 },
  destHeader:         { flexDirection:"row", alignItems:"center", justifyContent:"space-between", marginBottom:8, marginTop:4 },
  destHeaderName:     { fontSize:13, fontWeight:"700", color:Colors.t1 },
  destHeaderCount:    { fontSize:11, color:Colors.t3 },
  priceBadge:         { backgroundColor:Colors.accent+"22", borderRadius:6, paddingHorizontal:7, paddingVertical:2, borderWidth:0.5, borderColor:Colors.accent+"44" },
  priceBadgeText:     { color:Colors.accent, fontSize:10, fontWeight:"700" },
  row:                { flexDirection:"row", alignItems:"center", gap:10, backgroundColor:Colors.card, borderRadius:12, padding:10, marginBottom:6, borderWidth:0.5, borderColor:Colors.border },
  rowMe:              { borderColor:Colors.accent+"60", backgroundColor:Colors.accent+"08" },
  rowLoading:         { borderColor:Colors.accent+"40" },
  rowEnded:           { opacity:0.45 },
  rowFlash:           { borderColor:Colors.accent, backgroundColor:Colors.accent+"22", borderWidth:1.5 },
  endedBadge:         { color:Colors.t3, fontSize:10, fontWeight:"800", letterSpacing:0.8, paddingHorizontal:6, paddingVertical:3, borderRadius:5, borderWidth:0.5, borderColor:Colors.border },
  pos:                { width:26, height:26, borderRadius:13, alignItems:"center", justifyContent:"center", flexShrink:0 },
  posText:            { fontSize:11, fontWeight:"700" },
  carIcon:            { width:34, height:34, borderRadius:8, alignItems:"center", justifyContent:"center", borderWidth:0.5, flexShrink:0 },
  rowAvatar:          { width:34, height:34, borderRadius:17, backgroundColor:Colors.cardAlt },
  rowAvatarFallback:  { alignItems:"center", justifyContent:"center", borderWidth:1 },
  info:               { flex:1, minWidth:0 },
  name:               { fontSize:12, fontWeight:"600", color:Colors.t1 },
  vehicleName:        { fontSize:10, color:Colors.t3, marginTop:1 },
  miniSeats:          { flexDirection:"row", flexWrap:"wrap", gap:2, marginTop:4 },
  statusText:         { fontSize:10, marginTop:3 },
  timerText:          { fontSize:10, marginTop:2, fontWeight:"700" },
  expandChevron:      { color:Colors.t3, fontSize:12, fontWeight:"700", paddingHorizontal:4 },
  contactRow:         { flexDirection:"row", alignItems:"center", gap:6, marginRight:4 },
  contactBtn:         { width:32, height:32, alignItems:"center", justifyContent:"center", borderRadius:16, backgroundColor:Colors.card },
  contactBtnText:     { fontSize:14 },
  contactBtnBadge:    { position:"absolute", top:-3, right:-3, minWidth:16, height:16, paddingHorizontal:3, borderRadius:8, backgroundColor:Colors.red, alignItems:"center", justifyContent:"center" },
  contactBtnBadgeText:{ color:"#fff", fontSize:9, fontWeight:"800" },
  expandPanel:        { backgroundColor:Colors.card, borderLeftWidth:3, borderRadius:12, padding:12, marginBottom:8, marginTop:-6, marginLeft:8 },
  expandVehicle:      { width:"100%", height:90, marginBottom:10, backgroundColor:Colors.cardAlt, borderRadius:8 },
  expandRow:          { flexDirection:"row", justifyContent:"space-between", alignItems:"center", paddingVertical:6, borderBottomWidth:0.3, borderBottomColor:Colors.border },
  expandKey:          { color:Colors.t3, fontSize:11, fontWeight:"600" },
  expandVal:          { color:Colors.t1, fontSize:12, fontWeight:"500" },
  expandSeats:        { flexDirection:"row", flexWrap:"wrap", gap:3, paddingVertical:8 },
  openLoadingBtn:     { marginTop:10, backgroundColor:Colors.accent+"22", borderRadius:8, padding:10, alignItems:"center", borderWidth:0.5, borderColor:Colors.accent+"55" },
  openLoadingBtnText: { color:Colors.accent, fontSize:12, fontWeight:"700" },
  leaveBtn:           { marginTop:8, backgroundColor:Colors.red+"15", borderRadius:8, padding:10, alignItems:"center", borderWidth:0.5, borderColor:Colors.red+"40" },
  leaveBtnText:       { color:Colors.red, fontSize:12, fontWeight:"700" },
  leaveChip:          { width:28, height:28, borderRadius:14, alignItems:"center", justifyContent:"center", backgroundColor:Colors.red+"18", borderWidth:0.5, borderColor:Colors.red+"40" },
  leaveChipText:      { color:Colors.red, fontSize:12, fontWeight:"800" },
  loadingText:        { color:Colors.t2, textAlign:"center" },
  loadingBlock:       { alignItems:"center", marginTop:60, gap:12 },
  empty:              { alignItems:"center", marginTop:80 },
  emptyEmoji:         { fontSize:48, marginBottom:12 },
  emptyText:          { fontSize:18, fontWeight:"700", color:Colors.t1 },
  emptySub:           { fontSize:13, color:Colors.t3, marginTop:4 },
  // Modal
  destSub:            { color:Colors.t3, fontSize:12, paddingHorizontal:16, marginBottom:14, lineHeight:18 },
  destList:           { paddingHorizontal:16, gap:8, paddingBottom:8 },
  destOption:         { flexDirection:"row", justifyContent:"space-between", alignItems:"center", backgroundColor:Colors.bg, borderRadius:12, padding:14, borderWidth:1, borderColor:Colors.border },
  destOptionName:     { color:Colors.t1, fontSize:14, fontWeight:"600" },
  destOptionPrice:    { color:Colors.accent, fontSize:13, fontWeight:"700" },
  destEmpty:          { color:Colors.t3, fontSize:13, textAlign:"center", padding:20 },
  destCancel:         { padding:14, alignItems:"center" },
  destCancelText:     { color:Colors.t2, fontSize:14, fontWeight:"600" },
  previewOverlay:     { flex:1, backgroundColor:"rgba(0,0,0,0.75)", justifyContent:"center", alignItems:"center", padding:24 },
  previewCard:        { backgroundColor:Colors.card, borderRadius:20, padding:24, alignItems:"center", borderWidth:1, borderColor:Colors.border, minWidth:260 },
  previewAvatarBox:   { marginBottom:14 },
  previewAvatar:      { width:100, height:100, borderRadius:50 },
  previewAvatarFallback: { width:100, height:100, borderRadius:50, backgroundColor:Colors.bg, alignItems:"center", justifyContent:"center", borderWidth:1, borderColor:Colors.border },
  previewName:        { fontSize:18, fontWeight:"700", color:Colors.t1, marginBottom:6 },
  previewTrust:       { fontSize:12, color:Colors.yellow, marginBottom:6 },
  previewId:          { fontSize:11, color:Colors.t3, marginBottom:16 },
  previewVehicleBox:  { alignSelf:"stretch", marginTop:16, marginBottom:12, padding:12, backgroundColor:Colors.bg, borderRadius:12, borderWidth:0.5, borderColor:Colors.border, alignItems:"center" },
  previewVehicle:     { width:240, height:120 },
  previewVehicleName: { color:Colors.t1, fontSize:14, fontWeight:"700", marginTop:6 },
  previewPlate:       { color:Colors.accent, fontSize:13, fontWeight:"800", letterSpacing:1.5, marginTop:4 },
  previewActions:     { flexDirection:"row", gap:10, alignSelf:"stretch", marginBottom:12 },
  previewActBtn:      { flex:1, paddingVertical:12, borderRadius:10, alignItems:"center", borderWidth:1 },
  previewActCall:     { backgroundColor:Colors.green+"18", borderColor:Colors.green },
  previewActMsg:      { backgroundColor:Colors.accent+"18", borderColor:Colors.accent },
  previewActText:     { color:Colors.t1, fontSize:14, fontWeight:"800" },
  previewClose:       { backgroundColor:Colors.card, borderRadius:10, paddingHorizontal:20, paddingVertical:8, borderWidth:0.5, borderColor:Colors.border },
  previewCloseText:   { color:Colors.t2, fontSize:13, fontWeight:"600" },
  modalOverlay:       { flex:1, backgroundColor:"rgba(0,0,0,0.6)", justifyContent:"flex-end" },
  modalSheet:         { backgroundColor:Colors.card, borderTopLeftRadius:20, borderTopRightRadius:20, paddingTop:12, maxHeight:"75%" },
  modalHandle:        { width:36, height:4, borderRadius:2, backgroundColor:Colors.border, alignSelf:"center", marginBottom:16 },
  modalTitle:         { fontSize:16, fontWeight:"700", color:Colors.t1, paddingHorizontal:16, marginBottom:14 },
  cityTab:            { paddingHorizontal:14, paddingVertical:8, borderRadius:20, borderWidth:1, borderColor:Colors.border, backgroundColor:Colors.cardAlt, position:"relative" },
  cityTabActive:      { borderColor:Colors.accent, backgroundColor:Colors.accent+"15" },
  cityTabText:        { color:Colors.t2, fontSize:13, fontWeight:"500" },
  cityTabDot:         { position:"absolute", top:3, right:3, width:6, height:6, borderRadius:3, backgroundColor:Colors.accent },
  zoneRow:            { flexDirection:"row", alignItems:"center", padding:14, borderRadius:12, marginBottom:8, backgroundColor:Colors.bg, borderWidth:0.5, borderColor:Colors.border },
  zoneRowActive:      { borderColor:Colors.accent, backgroundColor:Colors.accent+"08" },
  zoneRowName:        { fontSize:14, fontWeight:"600", color:Colors.t1, marginBottom:2 },
  zoneRowAddr:        { fontSize:11, color:Colors.t3 },
  zoneRowDist:        { fontSize:11, color:Colors.accent, marginTop:3 },
  activeTag:          { fontSize:10, color:Colors.accent, fontWeight:"700" },
  watchOnlyTag:       { fontSize:10, color:Colors.yellow },
  joinBtnPrimary:     { backgroundColor:Colors.accent, borderColor:Colors.accent },
  joinBtnInGeo:       { backgroundColor:"#22C55E", borderColor:"#22C55E" },
  joinBtnOff:         { opacity:0.4 },
  closedBanner:       { backgroundColor:Colors.yellow+"15", borderLeftWidth:3, borderLeftColor:Colors.yellow, marginHorizontal:16, marginBottom:8, padding:12, borderRadius:8 },
  closedTitle:        { color:Colors.yellow, fontSize:13, fontWeight:"700" },
  closedSub:          { color:Colors.t2, fontSize:11, marginTop:3, lineHeight:16 },
  geoError:           { flexDirection:"row", alignItems:"center", justifyContent:"space-between", backgroundColor:Colors.red+"15", borderLeftWidth:3, borderLeftColor:Colors.red, marginHorizontal:16, marginBottom:8, padding:12, borderRadius:8 },
  geoErrorText:       { flex:1, color:Colors.red, fontSize:12, lineHeight:18 },
  adminFieldLabel:    { color:Colors.t2, fontSize:12, fontWeight:"700", marginTop:16, marginBottom:8, letterSpacing:0.3 },
  adminChip:          { paddingHorizontal:14, paddingVertical:8, borderRadius:20, borderWidth:1, borderColor:Colors.border, backgroundColor:Colors.cardAlt },
  adminChipActive:    { borderColor:Colors.accent, backgroundColor:Colors.accent+"15" },
  adminChipText:      { color:Colors.t2, fontSize:13, fontWeight:"600" },
});
