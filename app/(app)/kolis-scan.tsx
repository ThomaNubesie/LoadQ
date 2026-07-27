// Scan a Kolis parcel QR ("KOLIS|<id>|<pickup|delivery>|<token>") from LoadQ.
// Verifies the token + 100 m geofence via the shared `kolis-scan` function; in
// range the server reveals the pickup/delivery code, which the driver confirms
// right here (no manual typing). Ported from the Kolis app's scanner.
import { useCallback, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ScanLine, Lock, X } from "lucide-react-native";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { Colors } from "../../constants/colors";
import { KolisAPI, ScanResult } from "../../services/kolis";
import { useStrings } from "../../hooks/useStrings";

const MAG = "#E11D6B", GREEN = Colors.green, RED = "#F0503C";
type Res = ScanResult & { parcelId?: string; kind?: "pickup" | "delivery" };

export default function KolisScan() {
  const router = useRouter();
  const { lang } = useStrings();
  const fr = lang === "fr";
  const [perm, requestPerm] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res | null>(null);
  const [confirming, setConfirming] = useState(false);

  const errMsg = (e: string) => ({
    not_your_parcel: fr ? "Ce colis ne vous est pas assigné." : "This parcel isn't assigned to you.",
    bad_token: fr ? "Code QR invalide." : "Invalid QR code.",
    not_found: fr ? "Colis introuvable." : "Parcel not found.",
  } as Record<string, string>)[e] || e;

  const onScan = useCallback(async (e: { data: string }) => {
    if (busy || res) return;
    const m = String(e.data).split("|"); // KOLIS|<id>|<pickup|delivery>|<token>
    if (m[0] !== "KOLIS" || !m[1] || (m[2] !== "pickup" && m[2] !== "delivery")) return;
    setBusy(true);
    try {
      let lat: number | null = null, lng: number | null = null;
      try {
        const pm = await Location.getForegroundPermissionsAsync();
        const ok = pm.granted || (await Location.requestForegroundPermissionsAsync()).granted;
        if (ok) { const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }); lat = loc.coords.latitude; lng = loc.coords.longitude; }
      } catch { /* no GPS */ }
      const r = await KolisAPI.scan(m[1], m[2] as any, m[3] ?? "", lat, lng);
      if (r?.error) { Alert.alert("Kolis", errMsg(r.error)); setBusy(false); return; }
      setRes({ ...r, parcelId: m[1], kind: m[2] as any });
    } catch (err: any) { Alert.alert("Kolis", err?.message || "Scan failed."); }
    setBusy(false);
  }, [busy, res, fr]);

  const dial = (p?: string | null) => p && Linking.openURL(`tel:${p}`).catch(() => {});
  const nav = (a?: string | null) => a && Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a)}`).catch(() => {});

  const confirm = async () => {
    if (!res?.parcelId || !res.code) return;
    setConfirming(true);
    if (res.kind === "pickup") {
      const s = await KolisAPI.markPickedUp(res.parcelId, res.code);
      if (s !== "ok") Alert.alert("Kolis", fr ? "Impossible de confirmer le ramassage." : "Couldn't confirm pickup.");
      else { Alert.alert("Kolis", fr ? "Ramassage confirmé." : "Pickup confirmed."); router.back(); }
    } else {
      const d = await KolisAPI.deliver(res.parcelId, res.code);
      if (!d.ok) Alert.alert("Kolis", d.error === "payment_not_captured"
        ? (fr ? "Paiement non encaissé — contactez la répartition avant de livrer." : "Payment not captured — contact dispatch before delivering.")
        : (d.error || (fr ? "Impossible de confirmer la livraison." : "Couldn't confirm delivery.")));
      else { Alert.alert("Kolis", fr ? "Livré." : "Delivered."); router.back(); }
    }
    setConfirming(false);
  };

  // ── Camera permission gate ──
  if (!perm) return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  if (!perm.granted) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center", padding: 30 }}>
      <ScanLine size={40} color={Colors.t1} strokeWidth={2} />
      <Text style={{ color: Colors.t1, fontSize: 18, fontWeight: "800", marginTop: 12, textAlign: "center" }}>{fr ? "Autoriser la caméra" : "Allow the camera"}</Text>
      <Text style={{ color: Colors.t2, textAlign: "center", marginTop: 6 }}>{fr ? "Pour scanner les codes QR de colis Kolis." : "To scan Kolis parcel QR codes."}</Text>
      <Pressable onPress={requestPerm} style={{ backgroundColor: MAG, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 26, marginTop: 18 }}><Text style={{ color: "#fff", fontWeight: "800" }}>{fr ? "Autoriser" : "Allow"}</Text></Pressable>
      <Pressable onPress={() => router.back()} style={{ padding: 12, marginTop: 6 }}><Text style={{ color: Colors.t2, fontWeight: "700" }}>{fr ? "Retour" : "Back"}</Text></Pressable>
    </SafeAreaView>
  );

  // ── Result screen ──
  if (res) {
    const locked = res.in_range === false;
    const reason = res.reason;
    const dist = res.distance_m != null ? `${res.distance_m} m` : "";
    const lockTitle = reason === "location_off" ? (fr ? "Localisation désactivée" : "Location off")
      : reason === "not_geocoded" ? (fr ? "Position non vérifiable" : "Can't verify location")
      : (fr ? "Trop loin" : "Too far");
    const lockMsg = reason === "location_off"
      ? (fr ? `Activez la localisation. Le code se débloque à moins de ${res.geofence_m} m du point.` : `Turn on location. The code unlocks within ${res.geofence_m} m of the point.`)
      : reason === "not_geocoded"
      ? (fr ? "Ce colis n'a pas de position vérifiée. Contactez la répartition." : "This parcel has no verified location yet. Contact dispatch.")
      : (fr ? `Vous êtes à ${dist} du point. Le code se débloque à moins de ${res.geofence_m} m.` : `You're ${dist} away. The code unlocks within ${res.geofence_m} m.`);
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={["top", "bottom"]}>
        <View style={{ backgroundColor: locked ? "#5a2018" : MAG, padding: 16, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{locked ? lockTitle : (fr ? "À destination" : "In range")}</Text>
          <Pressable onPress={() => setRes(null)} style={{ marginLeft: "auto" }}><Text style={{ color: "#fff", fontWeight: "800" }}>{fr ? "Scanner à nouveau" : "Scan again"}</Text></Pressable>
        </View>

        <View style={{ margin: 14, borderRadius: 12, padding: 13, backgroundColor: locked ? "rgba(240,80,60,0.13)" : "rgba(34,192,131,0.13)", borderWidth: 1, borderColor: locked ? "rgba(240,80,60,0.5)" : "rgba(34,192,131,0.45)" }}>
          <Text style={{ color: locked ? "#ffb3a8" : "#7ee0b3", fontWeight: "700", fontSize: 13, lineHeight: 19 }}>
            {locked ? lockMsg : (fr ? `À ${dist}. Position enregistrée et partagée.` : `${dist} away. Location captured & shared.`)}
          </Text>
        </View>

        {(["sender", "recipient"] as const).map((who) => {
          const c = res[who]; if (!c) return null;
          return (
            <View key={who} style={{ marginHorizontal: 14, marginBottom: 12 }}>
              <Text style={{ fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", color: Colors.t3, marginBottom: 6 }}>{who === "sender" ? (fr ? "Expéditeur" : "Sender") : (fr ? "Destinataire" : "Recipient")}</Text>
              <View style={{ backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 13, padding: 13 }}>
                <Text style={{ fontSize: 15, fontWeight: "800", color: Colors.t1 }}>{c.name || "—"}</Text>
                {c.address ? <Text style={{ fontSize: 12.5, color: Colors.t2, marginTop: 2 }}>{c.address}</Text> : null}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 11 }}>
                  <Pressable onPress={() => dial(c.phone)} disabled={!c.phone} style={{ flex: 1, backgroundColor: GREEN, borderRadius: 10, padding: 11, alignItems: "center", opacity: c.phone ? 1 : 0.4 }}><Text style={{ color: "#04140D", fontWeight: "800", fontSize: 13 }}>{fr ? "Appeler" : "Call"}</Text></Pressable>
                  <Pressable onPress={() => nav(c.address)} disabled={!c.address} style={{ flex: 1, backgroundColor: Colors.cardAlt, borderRadius: 10, padding: 11, alignItems: "center", borderWidth: 1, borderColor: Colors.border, opacity: c.address ? 1 : 0.4 }}><Text style={{ color: Colors.t1, fontWeight: "800", fontSize: 13 }}>{fr ? "Itinéraire" : "Directions"}</Text></Pressable>
                </View>
              </View>
            </View>
          );
        })}

        <View style={{ marginTop: "auto", padding: 16 }}>
          {locked ? (
            <View style={{ backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderStyle: "dashed", borderRadius: 13, padding: 16, alignItems: "center" }}>
              <Lock size={22} color={Colors.t1} strokeWidth={2} />
              <Text style={{ color: Colors.t2, fontWeight: "700", fontSize: 12.5, marginTop: 6, textAlign: "center" }}>{reason === "location_off" ? (fr ? "Activez la localisation pour débloquer le code" : "Turn on location to unlock the code") : reason === "not_geocoded" ? (fr ? "Position non vérifiable — code masqué" : "Location unverifiable — code hidden") : (fr ? `Code masqué jusqu'à moins de ${res.geofence_m} m` : `Code hidden until within ${res.geofence_m} m`)}</Text>
              {reason === "location_off" ? (
                <Pressable onPress={() => Linking.openSettings().catch(() => {})} style={{ backgroundColor: MAG, borderRadius: 11, paddingVertical: 11, paddingHorizontal: 22, marginTop: 12 }}>
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>{fr ? "Ouvrir les réglages" : "Open settings"}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <>
              <View style={{ backgroundColor: "rgba(225,29,107,0.1)", borderWidth: 1, borderColor: "rgba(225,29,107,0.5)", borderRadius: 13, padding: 14, alignItems: "center" }}>
                <Text style={{ fontSize: 10.5, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", color: MAG }}>{res.kind === "pickup" ? (fr ? "Code de ramassage" : "Pickup code") : (fr ? "Code de livraison" : "Delivery code")}</Text>
                <Text style={{ fontSize: 30, fontWeight: "900", letterSpacing: 7, color: Colors.t1 }}>{res.code}</Text>
              </View>
              <Pressable onPress={confirm} disabled={confirming} style={{ backgroundColor: MAG, borderRadius: 14, padding: 16, alignItems: "center", marginTop: 12, opacity: confirming ? 0.6 : 1 }}>
                {confirming ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{res.kind === "pickup" ? (fr ? "Confirmer le ramassage" : "Confirm pickup") : (fr ? "Confirmer la livraison" : "Confirm delivery")} · {res.code}</Text>}
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ── Camera scanning ──
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScan} />
      <SafeAreaView style={{ position: "absolute", top: 0, left: 0, right: 0 }} edges={["top"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16 }}>
          <Pressable onPress={() => router.back()} hitSlop={10}><X size={22} color="#fff" strokeWidth={2} /></Pressable>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16, marginLeft: 12 }}>{fr ? "Scanner le QR du colis" : "Scan the parcel QR"}</Text>
        </View>
      </SafeAreaView>
      <View style={{ position: "absolute", top: "35%", left: "12%", width: "76%", aspectRatio: 1, borderWidth: 3, borderColor: "#fff", borderRadius: 20, opacity: 0.85 }} />
      <View style={{ position: "absolute", bottom: 60, left: 0, right: 0, alignItems: "center" }}>
        {busy ? <View style={{ flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 }}><ActivityIndicator color="#fff" /><Text style={{ color: "#fff", fontWeight: "700" }}>{fr ? "Vérification…" : "Checking…"}</Text></View>
          : <Text style={{ color: "#fff", fontWeight: "700", backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 }}>{fr ? "Placez le QR dans le cadre" : "Point at the QR code"}</Text>}
      </View>
    </View>
  );
}
