// Bilingual "How to use" walkthrough, opened from the profile. Role-aware:
// drivers and passengers see the steps relevant to them.
import { Modal, View, Text, Pressable, ScrollView } from "react-native";
import { ReactNode } from "react";
import { Colors } from "../constants/colors";
import { getCurrentLang } from "../hooks/useStrings";
import { MapPin, Clock, CarFront, Package, X, Building2, Armchair, Phone, RefreshCw } from "lucide-react-native";

type Step = { icon: ReactNode; en: string; fr: string };

const DRIVER: Step[] = [
  { icon: <MapPin size={24} color={Colors.t1} strokeWidth={2} />, en: "Open the Queue tab and join your loading zone — pick where you're heading.", fr: "Ouvrez l'onglet File et rejoignez votre zone de chargement — choisissez votre destination." },
  { icon: <Clock size={24} color={Colors.t1} strokeWidth={2} />, en: "Loading runs 5 AM–11 PM. Watch your position; you load when you reach the front.", fr: "Le chargement va de 5 h à 23 h. Surveillez votre position; vous chargez arrivé en tête." },
  { icon: <CarFront size={24} color={Colors.t1} strokeWidth={2} />, en: "When it's your turn, board passengers up to your seat count, then tap Depart.", fr: "À votre tour, embarquez les passagers selon vos places, puis touchez Partir." },
  { icon: <Package size={24} color={Colors.t1} strokeWidth={2} />, en: "Kolis parcels for your route appear on the queue — accept, pick up with the sender's code, deliver with the recipient's code.", fr: "Les colis Kolis de votre trajet s'affichent — acceptez, ramassez avec le code de l'expéditeur, livrez avec le code du destinataire." },
  { icon: <X size={24} color={Colors.t1} strokeWidth={2} />, en: "Need to leave? Tap the ✕ or Cancel — you'll be removed from the queue.", fr: "Besoin de partir? Touchez ✕ ou Annuler — vous serez retiré de la file." },
];

const PASSENGER: Step[] = [
  { icon: <Building2 size={24} color={Colors.t1} strokeWidth={2} />, en: "The board shows live cars leaving your zone, grouped by destination.", fr: "Le tableau montre les voitures en direct qui quittent votre zone, par destination." },
  { icon: <Armchair size={22} color={Colors.t1} strokeWidth={2} />, en: "Tap a route to see cars and seats. Reserve a seat when you're within 50 km of the zone.", fr: "Touchez un trajet pour voir voitures et places. Réservez à moins de 50 km de la zone." },
  { icon: <Phone size={22} color={Colors.t1} strokeWidth={2} />, en: "Once within 50 km (or after a confirmed reservation) you can call or text the driver.", fr: "À moins de 50 km (ou après une réservation confirmée), vous pouvez appeler ou texter le chauffeur." },
  { icon: <RefreshCw size={22} color={Colors.t1} strokeWidth={2} />, en: "Use 📍 to jump to the nearest zone, or Change to pick another.", fr: "Utilisez 📍 pour la zone la plus proche, ou Changer pour en choisir une autre." },
];

export default function HowToUse({ visible, onClose, role }: { visible: boolean; onClose: () => void; role: "driver" | "passenger" }) {
  const fr = getCurrentLang() === "fr";
  const steps = role === "driver" ? DRIVER : PASSENGER;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, paddingBottom: 34, maxHeight: "85%" }}>
          <Text style={{ fontSize: 22, fontWeight: "900", color: Colors.t1, marginBottom: 4 }}>{fr ? "Comment utiliser LoadQ" : "How to use LoadQ"}</Text>
          <Text style={{ fontSize: 13, color: Colors.t3, marginBottom: 18 }}>{fr ? (role === "driver" ? "Côté chauffeur" : "Côté passager") : (role === "driver" ? "Driver side" : "Passenger side")}</Text>
          <ScrollView style={{ marginBottom: 14 }}>
            {steps.map((st, i) => (
              <View key={i} style={{ flexDirection: "row", marginBottom: 16, alignItems: "flex-start" }}>
                <View style={{ marginRight: 12 }}>{st.icon}</View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: Colors.t1, fontSize: 14.5, lineHeight: 20, fontWeight: "600" }}>{fr ? st.fr : st.en}</Text>
                  <Text style={{ color: Colors.t3, fontSize: 12.5, lineHeight: 18, marginTop: 3 }}>{fr ? st.en : st.fr}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <Pressable onPress={onClose} style={{ backgroundColor: Colors.accent, borderRadius: 13, padding: 15, alignItems: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{fr ? "Compris" : "Got it"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
