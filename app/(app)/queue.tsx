import { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Image, Modal, Alert, Linking } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { QueueAPI } from "../../services/queue";
import * as Location from "expo-location";
import { DriversAPI } from "../../services/drivers";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";
import { QueueEntry, Vehicle } from "../../constants/types";
import SeatSvg from "../../components/SeatSvg";
import BottomNav from "../../components/BottomNav";
import ZoneMap from "../../components/ZoneMap";
import { loadingState, formatRemaining, isWithinLoadingWindow, nextWindowOpen } from "../../utils/loadingTimer";
import { useNow } from "../../hooks/useNow";
import {
  REGIONS, detectUserRegion, getDistanceKm,
  ZoneLocation, RegionCode, getZonesByRegion
} from "../../constants/zones";
import { useZones, getZoneTimezone } from "../../hooks/useZones";
import { useDestinations } from "../../hooks/useDestinations";
import { getVehicleImageUrl } from "../../utils/vehicleImage";
import { getPricePerSeat, getDestinationsFrom, getRegionName } from "../../constants/pricing";

export default function QueueScreen() {
  const router = useRouter();
  const { zoneId: paramZoneId, zoneName: paramZoneName } = useLocalSearchParams<{ zoneId?: string; zoneName?: string }>();
  const { t } = useStrings();

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
  const [dropRegion,   setDropRegion]   = useState<RegionCode>("ottawa");
  const [userCoords,   setUserCoords]   = useState<{lat:number,lon:number}|null>(null);
  const [joining,      setJoining]      = useState(false);
  const [joinError,    setJoinError]    = useState("");
  const [myEntry,      setMyEntry]      = useState<QueueEntry|null>(null);
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [expandedId,     setExpandedId]     = useState<string | null>(null);

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

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const lat = loc.coords.latitude;
        const lon = loc.coords.longitude;
        setUserCoords({ lat, lon });
        const region = detectUserRegion(lat, lon);
        setUserRegion(region);
        if (region) setDropRegion(region);
        const zone = resolveZone(lat, lon);
        setActiveZone(zone);
      } else {
        // No GPS — use param or first zone
        const z = paramZoneId ? zones.find(z => z.id === paramZoneId) : zones[0];
        setActiveZone(z || zones[0] || null);
      }
    } catch {
      setActiveZone(zones[0] || null);
    }

    const [driver, vehicles] = await Promise.all([
      DriversAPI.getMe(),
      DriversAPI.getVehicles(),
    ]);
    setMyId(driver?.id || null);
    setMyVehicle(vehicles.find(v => v.is_active) || vehicles[0] || null);
    setLoading(false);
    setRefreshing(false);
  }, [paramZoneId, zones]);

  useEffect(() => { load(); }, []);

  // Poll GPS every 5s so the Join button flips green the moment the driver
  // walks into the zone radius (without needing a manual refresh).
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) setUserCoords({ lat: loc.coords.latitude, lon: loc.coords.longitude });
      } catch { /* ignore transient GPS errors */ }
    };
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Pre-flight checks: window open, geo-fence, not already in queue.
  // Returns null on success, or an error message string.
  const validateJoin = (): string | null => {
    if (!activeZone || !myVehicle) return "Missing zone or vehicle";
    if (!isWithinLoadingWindow(new Date(), getZoneTimezone(activeZone.id))) {
      return `${t.queueClosed} — ${t.queueClosedSub}`;
    }
    if (myEntry) return "You are already in this queue";
    if (!userCoords) return "Location required to join. Please enable GPS.";
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
      "Leave the queue?",
      "Are you sure you want to remove yourself from the queue? You'll lose your position and have to rejoin at the back.",
      [
        { text: "Stay in queue", style: "cancel" },
        {
          text: "Leave queue",
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

  // The instant any loading entry crosses the 2h mark, ping the watchdog so
  // the driver is moved out immediately (don't wait up to 60s for cron).
  const firedExpiry = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const e of entries) {
      if (e.status !== "loading" || !e.load_start_at) continue;
      const elapsed = now - new Date(e.load_start_at).getTime();
      if (elapsed >= 2 * 60 * 60 * 1000 && !firedExpiry.current.has(e.id)) {
        firedExpiry.current.add(e.id);
        QueueAPI.triggerWatchdog();
        // Re-pull the queue shortly after so the UI reflects the removal.
        setTimeout(() => {
          if (activeZone) QueueAPI.getZoneQueue(activeZone.id).then(setEntries);
        }, 2500);
      }
    }
  }, [now, entries, activeZone?.id]);
  const zoneTz        = getZoneTimezone(activeZone?.id);
  const windowOpen    = isWithinLoadingWindow(new Date(now), zoneTz);
  const nextOpen      = windowOpen ? null : nextWindowOpen(new Date(now), zoneTz);

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
      ? loadingState(entry.load_start_at, seats, now)
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

    return (
      <View key={entry.id}>
        <TouchableOpacity
          style={[s.row, isMe && s.rowMe, entry.status === "loading" && s.rowLoading]}
          onPress={() => {
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
            <Text style={s.name}>{entry.driver?.full_name || "Driver"}{isMe ? " (you)" : ""}</Text>
            <Text style={s.vehicleName}>{vehicle ? `${vehicle.make} ${vehicle.model}` : "Vehicle"}</Text>
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
                {lstate.showWarning ? "  ⚠ 2-hour close approaching" : ""}
              </Text>
            )}
          </View>
          {!isMe && entry.driver && (
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
            <Text style={s.zonePickerName}>{activeZone?.name || "Select zone"}</Text>
            <Text style={s.zonePickerRegion}>{activeZone ? REGIONS.find(r => r.code === activeZone.region)?.name : ""} ▾</Text>
          </TouchableOpacity>
          {activeZone && (
            <View style={s.liveRow}>
              <View style={s.liveDot} />
              <Text style={s.liveText}>Live · {entries.length} in queue</Text>
              {userCoords && !isMyRegion && <Text style={s.watchTag}> · Watching only</Text>}
              {!userCoords && <Text style={s.watchTag}> · Locating…</Text>}
            </View>
          )}
        </View>
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
                    #{myEntry.position} · {myEntry.status === "loading" ? "Loading" : getRegionName(myEntry.destination_region)} →
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
                    ? "Closed"
                    : joining
                      ? "Joining..."
                      : inGeo
                        ? "✓ Join queue"
                        : distanceMeters !== null
                          ? `Join (${distanceMeters}m away)`
                          : "Join queue"}
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
        {loading ? (
          <Text style={s.loadingText}>{t.loading}</Text>
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
                    → {destKey === "_unknown" ? "Destination not set" : getRegionName(destKey)}
                  </Text>
                  <View style={{ flexDirection:"row", alignItems:"center", gap:8 }}>
                    <Text style={s.destHeaderCount}>{list.length}</Text>
                    {price !== null && (
                      <View style={s.priceBadge}>
                        <Text style={s.priceBadgeText}>C${price} / seat</Text>
                      </View>
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
                    onPress={() => { setActiveZone(zone); setShowDropdown(false); }}
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

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:          { flex:1, backgroundColor:Colors.bg },
  header:             { flexDirection:"row", alignItems:"center", paddingHorizontal:16, paddingTop:8, paddingBottom:10, gap:10 },
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
  loadingText:        { color:Colors.t2, textAlign:"center", marginTop:40 },
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
});
