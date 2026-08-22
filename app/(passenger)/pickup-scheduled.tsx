import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, TextInput, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { ArrowLeft, Navigation, Copy, Check } from "lucide-react-native";
import { Colors } from "../../constants/colors";
import { useStrings } from "../../hooks/useStrings";
import { NETWORK_CITIES, networkCityLabel } from "../../constants/cities";
import { ScheduledAPI, ScheduledQuote, TIME_BLOCKS } from "../../services/scheduled";
import { PassengersAPI } from "../../services/passengers";
import AddressAutocomplete from "../../components/AddressAutocomplete";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const DAYS = Array.from({ length: 30 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });

export default function PickupScheduledScreen() {
  const router = useRouter();
  const { t, lang } = useStrings();
  const fr = lang === "fr";
  const [home, setHome] = useState("");
  const [homePostal, setHomePostal] = useState<string | null>(null);
  const [dropoff, setDropoff] = useState("");
  const [dropPostal, setDropPostal] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [cityOpen, setCityOpen] = useState(false);
  const [citySearch, setCitySearch] = useState("");
  const [day, setDay] = useState<Date>(DAYS[1]); // default tomorrow
  const [block, setBlock] = useState<string | null>(null);
  const [pickupTime, setPickupTime] = useState("");
  const [rideType, setRideType] = useState<"share" | "whole">("share");
  const [seats, setSeats] = useState(1);
  const [me, setMe] = useState<{ full_name?: string; phone?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<ScheduledQuote | null>(null);

  useEffect(() => { PassengersAPI.getMe().then(p => setMe(p ? { full_name: p.full_name, phone: p.phone } : null)); }, []);

  async function getQuote() {
    if (!home.trim() || !dropoff.trim() || !dest) { Alert.alert(t("schedTitle"), fr ? "Renseignez le domicile, la destination et la ville." : "Enter your home, drop-off and city."); return; }
    if (!homePostal || !dropPostal) { Alert.alert(t("schedTitle"), fr ? "Sélectionnez des adresses complètes (avec code postal) dans les suggestions." : "Pick full addresses (with postal code) from the suggestions."); return; }
    if (!block) { Alert.alert(t("schedTitle"), fr ? "Choisissez une plage horaire." : "Choose a time block."); return; }
    setBusy(true);
    const res = await ScheduledAPI.quote(home.trim(), dropoff.trim(), dest, isoDate(day), seats, block, { rideType, pickupTime: pickupTime.trim() || null, name: me?.full_name, phone: me?.phone });
    setBusy(false);
    if ("error" in res) { Alert.alert(t("schedTitle"), res.error); return; }
    setQuote(res);
  }

  async function copy(v: string) { await Clipboard.setStringAsync(v); Alert.alert(t("copied")); }
  const dayLabel = (d: Date) => d.toLocaleDateString(fr ? "fr-CA" : "en-CA", { weekday: "short", month: "short", day: "numeric" });

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => (quote ? setQuote(null) : router.back())} hitSlop={10}><ArrowLeft size={22} color={Colors.t1} /></TouchableOpacity>
        <Text style={s.title}>{fr ? "Ramassage porte-à-porte" : "Door-to-door pickup"}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {!quote ? (
          <>
            <Text style={s.lead}>{fr ? "Réservez jusqu'à 30 jours à l'avance. Un seul chauffeur vous conduit du domicile jusqu'à votre adresse en ville." : "Book up to 30 days ahead. One driver takes you from home to your city drop-off address."}</Text>

            <Text style={s.label}>{fr ? "Départ (domicile)" : "Pick-up (your home)"}</Text>
            <AddressAutocomplete value={home} onChangeText={(v) => { setHome(v); setHomePostal(null); }} onResolved={(d) => setHomePostal(d.postal_code)} placeholder={fr ? "Adresse du domicile" : "Home address"} accent={Colors.accentP} />
            {!!home.trim() && (homePostal ? <Text style={s.postalOk}>✓ {fr ? "Code postal" : "Postal code"} {homePostal}</Text> : <Text style={s.postalWarn}>⚠ {fr ? "Choisissez une adresse dans les suggestions" : "Pick an address from the suggestions"}</Text>)}

            <Text style={s.label}>{fr ? "Arrivée (adresse en ville)" : "Drop-off (city address)"}</Text>
            <AddressAutocomplete value={dropoff} onChangeText={(v) => { setDropoff(v); setDropPostal(null); }} onResolved={(d) => setDropPostal(d.postal_code)} placeholder={fr ? "Adresse de destination" : "Destination address"} accent={Colors.accentP} />
            {!!dropoff.trim() && (dropPostal ? <Text style={s.postalOk}>✓ {fr ? "Code postal" : "Postal code"} {dropPostal}</Text> : <Text style={s.postalWarn}>⚠ {fr ? "Choisissez une adresse dans les suggestions" : "Pick an address from the suggestions"}</Text>)}

            <Text style={s.label}>{fr ? "Ville de destination" : "Destination city"}</Text>
            <TouchableOpacity style={s.field} onPress={() => setCityOpen(true)} activeOpacity={0.8}>
              <Text style={[{ flex: 1, fontSize: 15, fontWeight: "700" }, dest ? { color: Colors.t1 } : { color: Colors.t3 }]}>
                {dest ? networkCityLabel(dest) : (fr ? "Choisir une ville" : "Choose a city")}
              </Text>
              <Text style={{ color: Colors.accentP, fontWeight: "800" }}>▾</Text>
            </TouchableOpacity>

            <Text style={s.label}>{fr ? "Quel jour ?" : "Which day?"}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
              {DAYS.map((d, i) => {
                const on = isoDate(d) === isoDate(day);
                return (
                  <TouchableOpacity key={i} style={[s.day, on && s.dayOn]} onPress={() => setDay(d)} activeOpacity={0.85}>
                    <Text style={[s.dow, on && s.dowOn]}>{i === 0 ? (fr ? "AUJ" : "TODAY") : d.toLocaleDateString(fr ? "fr-CA" : "en-CA", { weekday: "short" }).toUpperCase()}</Text>
                    <Text style={[s.dn, on && s.dnOn]}>{d.getDate()}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={s.label}>{fr ? "Plage horaire" : "Time block"}</Text>
            <View style={s.blocks}>
              {TIME_BLOCKS.map((b) => {
                const on = block === b.value;
                return (
                  <TouchableOpacity key={b.value} style={[s.block, on && s.blockOn]} onPress={() => setBlock(b.value)} activeOpacity={0.85}>
                    <Text style={[s.blockTxt, on && s.blockTxtOn]}>{fr ? b.fr : b.en}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={s.label}>{fr ? "Heure préférée (dans la plage)" : "Preferred time (within block)"}</Text>
            <View style={s.field}>
              <TextInput value={pickupTime} onChangeText={setPickupTime} placeholder={fr ? "ex. 9:30" : "e.g. 9:30"} placeholderTextColor={Colors.t3} style={{ flex: 1, color: Colors.t1, fontSize: 15, fontWeight: "700" }} />
              <Text style={{ color: Colors.t3, fontSize: 11 }}>{fr ? "indicatif" : "preferred"}</Text>
            </View>

            <Text style={s.label}>{fr ? "Type de course" : "Ride type"}</Text>
            <View style={s.rideRow}>
              <TouchableOpacity style={[s.ride, rideType === "share" && s.rideOn]} onPress={() => setRideType("share")} activeOpacity={0.85}>
                <Text style={[s.rideT, rideType === "share" && s.rideTOn]}>{fr ? "Partagée" : "Share"}</Text>
                <Text style={s.rideD}>{fr ? "Par place ; d'autres peuvent se joindre" : "Per seat; others may join"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.ride, rideType === "whole" && s.rideOn]} onPress={() => setRideType("whole")} activeOpacity={0.85}>
                <Text style={[s.rideT, rideType === "whole" && s.rideTOn]}>{fr ? "Voiture entière" : "Whole car"}</Text>
                <Text style={s.rideD}>{fr ? "Privée — toute la voiture" : "Private — the whole car"}</Text>
              </TouchableOpacity>
            </View>

            {rideType === "share" && (
              <>
                <Text style={s.label}>{fr ? "Combien de places ?" : "How many seats?"}</Text>
                <View style={s.stepper}>
                  <Text style={s.stepName}>{fr ? "Places" : "Seats"}</Text>
                  <View style={s.stepCtrl}>
                    <TouchableOpacity style={s.rnd} onPress={() => setSeats((n) => Math.max(1, n - 1))} disabled={seats <= 1} activeOpacity={0.8}><Text style={[s.rndTxt, seats <= 1 && { color: Colors.t3 }]}>−</Text></TouchableOpacity>
                    <Text style={s.cnt}>{seats}</Text>
                    <TouchableOpacity style={s.rnd} onPress={() => setSeats((n) => Math.min(6, n + 1))} disabled={seats >= 6} activeOpacity={0.8}><Text style={[s.rndTxt, seats >= 6 && { color: Colors.t3 }]}>+</Text></TouchableOpacity>
                  </View>
                </View>
              </>
            )}

            <TouchableOpacity style={[s.cta, busy && { opacity: 0.6 }]} onPress={getQuote} disabled={busy} activeOpacity={0.85}>
              {busy ? <ActivityIndicator color={Colors.accentPText} /> : <Text style={s.ctaTxt}>{fr ? "Voir le prix" : "See price"}</Text>}
            </TouchableOpacity>
            <Text style={s.fine}>{fr ? "Payé à la réservation. Annulation 24 h+ = remboursement complet, sinon partiel." : "Paid at booking. Cancel 24h+ = full refund, otherwise partial."}</Text>
          </>
        ) : (
          <>
            <Text style={s.schedFor}>{fr ? "Prévu le" : "Scheduled for"} {dayLabel(day)}{quote.time_block ? ` · ${(TIME_BLOCKS.find(b => b.value === quote.time_block) || {} as any)[fr ? "fr" : "en"] ?? ""}` : ""} · {quote.seats} {fr ? "place(s)" : "seat(s)"}</Text>
            <View style={s.price}>
              <Row k={fr ? "Frais de service" : "Service fee"} v={money(quote.service_cents)} />
              <Row k={quote.ride_type === "whole" ? (fr ? "Voiture entière" : "Whole car") : (fr ? "Trajet vers la ville" : "Trip to city")} v={money(quote.fare_to_city_cents)} sub={`${money(quote.fare_per_seat_cents)} × ${quote.seats} ${fr ? "place(s)" : "seat(s)"}${quote.ride_type === "whole" ? (fr ? " · privée" : " · private") : ""}`} />
              <Row k={fr ? "Distance domicile" : "Home distance"} v={money(quote.home_distance_cents)} sub={`${quote.home_distance_km} km`} />
              <Row k={fr ? "Sous-total" : "Subtotal"} v={money(quote.subtotal_cents)} />
              <Row k={`${fr ? "Taxe" : "Tax"} (${Math.round(quote.tax_rate * 10000) / 100}%)`} v={money(quote.tax_cents)} />
              <View style={s.totRow}><Text style={s.totK}>{fr ? "Total" : "Total"}</Text><Text style={s.totV}>{money(quote.total_cents)}</Text></View>
            </View>

            <View style={s.interac}>
              <Text style={s.interacLbl}>{fr ? "Payer par Interac" : "Pay by Interac"}</Text>
              <TouchableOpacity style={s.interacRow} onPress={() => copy(quote.interac_to)} activeOpacity={0.7}>
                <Text style={s.interacVal}>{quote.interac_to}</Text><Copy size={15} color={Colors.t3} />
              </TouchableOpacity>
              <TouchableOpacity style={s.interacRow} onPress={() => copy(quote.pay_ref)} activeOpacity={0.7}>
                <Text style={s.interacVal}>{fr ? "Réf. : " : "Ref: "}{quote.pay_ref}</Text><Copy size={15} color={Colors.t3} />
              </TouchableOpacity>
              <Text style={s.interacSub}>{fr ? "Mettez la référence dans le message du virement. Votre trajet apparaît dans « Mes trajets » une fois le paiement reçu." : "Put the reference in the e-Transfer message. Your trip appears in My Trips once payment clears."}</Text>
            </View>

            <TouchableOpacity style={s.cta} onPress={() => router.replace("/(passenger)/my-trip" as any)} activeOpacity={0.85}>
              <Check size={17} color={Colors.accentPText} /><Text style={s.ctaTxt}>  {fr ? "Terminé" : "Done"}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal visible={cityOpen} animationType="slide" transparent onRequestClose={() => setCityOpen(false)}>
        <View style={s.cityBackdrop}>
          <SafeAreaView style={s.citySheet} edges={["bottom"]}>
            <View style={s.cityHead}>
              <Text style={s.cityTitle}>{fr ? "Ville de destination" : "Destination city"}</Text>
              <TouchableOpacity onPress={() => setCityOpen(false)} hitSlop={10}><Text style={{ color: Colors.t2, fontSize: 20 }}>✕</Text></TouchableOpacity>
            </View>
            <View style={s.field}>
              <TextInput value={citySearch} onChangeText={setCitySearch} placeholder={fr ? "Rechercher…" : "Search…"} placeholderTextColor={Colors.t3} autoFocus style={{ flex: 1, color: Colors.t1, fontSize: 15, paddingVertical: 10 }} />
            </View>
            <ScrollView style={{ maxHeight: 380, marginTop: 8 }} keyboardShouldPersistTaps="handled">
              {NETWORK_CITIES.filter(c => c.label.toLowerCase().includes(citySearch.trim().toLowerCase())).map(c => (
                <TouchableOpacity key={c.code} style={s.cityRow} onPress={() => { setDest(c.code); setCityOpen(false); setCitySearch(""); }} activeOpacity={0.8}>
                  <Text style={[s.cityRowTxt, dest === c.code && { color: Colors.accentP, fontWeight: "800" }]}>{c.label}</Text>
                  {dest === c.code && <Text style={{ color: Colors.accentP, fontWeight: "800" }}>✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Row({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}><Text style={s.rk}>{k}</Text>{!!sub && <Text style={s.rsub}>{sub}</Text>}</View>
      <Text style={s.rv}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  title: { color: Colors.t1, fontSize: 18, fontWeight: "800" },
  lead: { color: Colors.t2, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  label: { color: Colors.t2, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 7 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 15, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: Colors.border },
  pillOn: { backgroundColor: Colors.accentP, borderColor: Colors.accentP },
  pillTxt: { color: Colors.t2, fontWeight: "700", fontSize: 13 },
  pillTxtOn: { color: Colors.accentPText },
  day: { width: 58, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingVertical: 10, alignItems: "center", backgroundColor: Colors.card },
  dayOn: { backgroundColor: Colors.accentP, borderColor: Colors.accentP },
  dow: { color: Colors.t3, fontSize: 9, fontWeight: "800" },
  dowOn: { color: Colors.accentPText },
  dn: { color: Colors.t1, fontSize: 17, fontWeight: "900", marginTop: 2 },
  dnOn: { color: Colors.accentPText },
  field: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12 },
  cityBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  citySheet: { backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 14 },
  cityHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  cityTitle: { color: Colors.t1, fontSize: 17, fontWeight: "800" },
  cityRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: Colors.border },
  cityRowTxt: { color: Colors.t1, fontSize: 15, fontWeight: "600" },
  postalOk: { color: Colors.green, fontSize: 11, fontWeight: "800", marginTop: 5, marginLeft: 2 },
  postalWarn: { color: Colors.accentWarmText, fontSize: 11, fontWeight: "700", marginTop: 5, marginLeft: 2 },
  rideRow: { flexDirection: "row", gap: 8 },
  ride: { flex: 1, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12, padding: 11, backgroundColor: Colors.card },
  rideOn: { borderColor: Colors.accentP, backgroundColor: "rgba(47,111,224,0.06)" },
  rideT: { color: Colors.t1, fontWeight: "800", fontSize: 13 },
  rideTOn: { color: Colors.accentP },
  rideD: { color: Colors.t3, fontSize: 10.5, marginTop: 3, lineHeight: 14 },
  blocks: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  block: { flexGrow: 1, flexBasis: "45%", borderWidth: 1, borderColor: Colors.border, borderRadius: 11, paddingVertical: 12, alignItems: "center", backgroundColor: Colors.card },
  blockOn: { backgroundColor: Colors.accentP, borderColor: Colors.accentP },
  blockTxt: { color: Colors.t1, fontWeight: "800", fontSize: 13 },
  blockTxtOn: { color: Colors.accentPText },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  stepName: { color: Colors.t1, fontWeight: "800", fontSize: 14 },
  stepCtrl: { flexDirection: "row", alignItems: "center", gap: 18 },
  rnd: { width: 34, height: 34, borderRadius: 9, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center" },
  rndTxt: { color: Colors.accentP, fontSize: 22, fontWeight: "800" },
  cnt: { color: Colors.t1, fontSize: 17, fontWeight: "900", minWidth: 18, textAlign: "center" },
  cta: { flexDirection: "row", justifyContent: "center", alignItems: "center", backgroundColor: Colors.accentP, borderRadius: 13, paddingVertical: 15, marginTop: 22 },
  ctaTxt: { color: Colors.accentPText, fontWeight: "900", fontSize: 16 },
  fine: { color: Colors.t3, fontSize: 11, textAlign: "center", marginTop: 12, lineHeight: 16 },
  schedFor: { color: Colors.accentWarmText, fontWeight: "800", fontSize: 13, marginBottom: 12 },
  price: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  rk: { color: Colors.t2, fontSize: 13 },
  rsub: { color: Colors.t3, fontSize: 11, marginTop: 1 },
  rv: { color: Colors.t1, fontWeight: "800", fontSize: 14 },
  totRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: Colors.border, borderStyle: "dashed", marginTop: 6, paddingTop: 9 },
  totK: { color: Colors.t1, fontSize: 15, fontWeight: "900" },
  totV: { color: Colors.accentP, fontSize: 15, fontWeight: "900" },
  interac: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.accentWarm, borderRadius: 14, padding: 14, marginTop: 16 },
  interacLbl: { color: Colors.accentWarmText, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  interacRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginTop: 8 },
  interacVal: { color: Colors.t1, fontSize: 14, fontWeight: "700" },
  interacSub: { color: Colors.t2, fontSize: 11.5, marginTop: 10, lineHeight: 16 },
});
