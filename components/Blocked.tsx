// The wall a blocked account meets.
//
// Rendered at the root INSTEAD of the navigator, not on top of it — so there is no screen
// behind this one, nothing to swipe back to and no tab bar to reach. The check runs before
// the queue, the map or the session load, so there is never a moment where the app is usable.
//
// Deliberately dark whatever the theme. This is not part of the ordinary interface and should
// not look like it is.
//
// Bilingual on one screen rather than by locale: this is the message most likely to be read
// by someone who is upset, and it should not also depend on their language setting being right.
import { View, Text, StyleSheet, Linking, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ban } from "lucide-react-native";
import Wordmark from "./Wordmark";
import type { Block } from "../services/block";

const BG = "#0B0C0F";
const RED = "#E5484D";
const AZURE = "#4C82F0";
const LINE = "#232833";

export default function Blocked({ block }: { block: Block }) {
  // Anything that is not explicitly a conduct block gets a way through. A wrong
  // 'administrative' merely lets someone email support; a wrong 'conduct' tells a driver with
  // a fixable problem that the decision is final, and they simply leave.
  const conduct = block.kind === "conduct";

  return (
    <SafeAreaView style={s.wrap}>
      <View style={s.glow} pointerEvents="none" />

      <Wordmark on={BG} style={s.mark} />

      <View style={s.badge}>
        <Ban size={52} color={RED} strokeWidth={2} />
      </View>

      <Text style={s.h1}>Vous êtes bloqué</Text>
      <Text style={s.h1en}>You are blocked</Text>

      {conduct ? (
        <>
          <Text style={s.say}>
            Votre compte a été bloqué et vous ne pouvez plus utiliser LoadQ.
          </Text>
          <Text style={s.sayEn}>
            Your account has been blocked. You can no longer use LoadQ.
          </Text>
          <Text style={s.final}>Cette décision est définitive. · This decision is final.</Text>
        </>
      ) : (
        <>
          <Text style={s.say}>
            Votre compte est bloqué. Vous ne pouvez pas rejoindre une file tant que ce
            n&apos;est pas réglé.
          </Text>
          <Text style={s.sayEn}>
            Your account is blocked. You cannot join a line until this is resolved.
          </Text>
          <Pressable
            style={s.cta}
            onPress={() => Linking.openURL("mailto:support@concordexpress.ca?subject=" +
              encodeURIComponent(`Compte bloqué · ${block.reference ?? ""}`))}>
            <Text style={s.ctaText}>Contacter le soutien · Contact support</Text>
          </Pressable>
        </>
      )}

      <View style={s.spacer} />

      <View style={s.ref}>
        {!!block.reference && (
          <Text style={s.refLine}>
            <Text style={s.refKey}>Référence · Reference </Text>{block.reference}
          </Text>
        )}
        {!!block.since && (
          <Text style={s.refLine}>
            <Text style={s.refKey}>Depuis · Since </Text>
            {new Date(block.since).toLocaleDateString("fr-CA",
              { year: "numeric", month: "long", day: "numeric" })}
          </Text>
        )}
      </View>
      <Text style={s.foot}>Concord Express Co Inc. · LoadQ</Text>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG, alignItems: "center", paddingHorizontal: 28 },
  glow: {
    position: "absolute", top: -90, alignSelf: "center",
    width: 330, height: 330, borderRadius: 165, backgroundColor: RED, opacity: 0.11,
  },
  mark: { fontSize: 19, marginTop: 26, opacity: 0.5 },
  badge: {
    marginTop: 44, width: 104, height: 104, borderRadius: 52,
    backgroundColor: "rgba(229,72,77,0.10)", borderWidth: 2, borderColor: RED,
    alignItems: "center", justifyContent: "center",
  },
  h1: { fontSize: 25, fontWeight: "800", color: RED, marginTop: 24, letterSpacing: -0.4, textAlign: "center" },
  h1en: { fontSize: 17, fontWeight: "700", color: "#FFFFFF", opacity: 0.92, marginTop: 5, textAlign: "center" },
  say: { fontSize: 14, lineHeight: 22, color: "#C6CBD4", marginTop: 17, textAlign: "center" },
  sayEn: { fontSize: 13, lineHeight: 20, color: "#8A909C", marginTop: 7, textAlign: "center" },
  final: { fontSize: 13, fontWeight: "700", color: RED, marginTop: 15, textAlign: "center" },
  cta: {
    marginTop: 20, alignSelf: "stretch", borderRadius: 12, paddingVertical: 14,
    backgroundColor: "rgba(76,130,240,0.10)", borderWidth: 1, borderColor: AZURE,
  },
  ctaText: { color: AZURE, fontWeight: "700", fontSize: 14.5, textAlign: "center" },
  spacer: { flex: 1 },
  ref: { alignSelf: "stretch", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 15 },
  refLine: { fontSize: 11.5, lineHeight: 20, color: "#5B6270", textAlign: "center" },
  refKey: { color: "#8A909C", fontWeight: "600" },
  foot: { fontSize: 11, color: "#3E4553", paddingTop: 8, paddingBottom: 22 },
});
