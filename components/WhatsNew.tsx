// Shows a bilingual "What's new" sheet the first time a user opens the app after
// an update (version changed since last open). Stored per-version so it shows once.
import { useEffect, useState } from "react";
import { Modal, View, Text, Pressable, ScrollView } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Colors } from "../constants/colors";
import { getCurrentLang } from "../hooks/useStrings";
import { openStoreListing } from "../utils/appStore";

const KEY = "whatsNewSeenVersion";
const MAG = "#E11D6B";

// Highlights for the current release. Update this list each version.
const NOTES: Record<"en" | "fr", string[]> = {
  en: [
    "Cancelling now removes you from the queue completely.",
    "Kolis parcels: pickup code + tap-to-navigate, delivery address, and call recipient.",
    "Senders see your pickup ETA; recipients get their delivery code up front.",
    "Bilingual notifications and a new “How to use” guide in your profile.",
  ],
  fr: [
    "Annuler vous retire complètement de la file.",
    "Colis Kolis : code de ramassage + itinéraire, adresse de livraison et appel au destinataire.",
    "L’expéditeur voit votre heure d’arrivée; le destinataire reçoit son code de livraison.",
    "Notifications bilingues et un nouveau guide « Comment utiliser » dans votre profil.",
  ],
};

export default function WhatsNew() {
  const [show, setShow] = useState(false);
  const version = Constants.expoConfig?.version ?? "";
  const fr = getCurrentLang() === "fr";

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const seen = await AsyncStorage.getItem(KEY);
      // Delay so the app has already navigated to a real screen. Otherwise the
      // modal pops over the black loading screen and reads as a stuck splash.
      if (!cancelled && seen !== version && version) {
        timer = setTimeout(() => { if (!cancelled) setShow(true); }, 3500);
      }
    })();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [version]);

  const close = async () => { await AsyncStorage.setItem(KEY, version); setShow(false); };
  const notes = fr ? NOTES.fr : NOTES.en;

  return (
    <Modal visible={show} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 }}>
        <View style={{ backgroundColor: Colors.card, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: MAG }}>
          <Text style={{ fontSize: 12, fontWeight: "800", color: MAG, letterSpacing: 1, textTransform: "uppercase" }}>
            {fr ? "Nouveauté" : "What's new"} · v{version}
          </Text>
          <Text style={{ fontSize: 21, fontWeight: "900", color: Colors.t1, marginTop: 4, marginBottom: 14 }}>
            {fr ? "Mise à jour de LoadQ" : "LoadQ just updated"}
          </Text>
          <ScrollView style={{ maxHeight: 300 }}>
            {notes.map((n, i) => (
              <View key={i} style={{ flexDirection: "row", marginBottom: 12 }}>
                <Text style={{ color: MAG, fontSize: 15, marginRight: 9, fontWeight: "800" }}>•</Text>
                <Text style={{ color: Colors.t2, fontSize: 14.5, lineHeight: 20, flex: 1 }}>{n}</Text>
              </View>
            ))}
          </ScrollView>
          <Pressable onPress={() => openStoreListing()} style={{ borderWidth: 1.5, borderColor: MAG, borderRadius: 13, padding: 14, alignItems: "center", marginTop: 8 }}>
            <Text style={{ color: MAG, fontWeight: "800", fontSize: 14.5 }}>{fr ? "Voir la mise à jour dans la boutique" : "Get the latest update in the store"}</Text>
          </Pressable>
          <Pressable onPress={close} style={{ backgroundColor: MAG, borderRadius: 13, padding: 15, alignItems: "center", marginTop: 10 }}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{fr ? "Compris" : "Got it"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
