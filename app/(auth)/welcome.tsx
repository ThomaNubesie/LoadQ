import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useStrings } from "../../hooks/useStrings";
import { Colors } from "../../constants/colors";

export default function WelcomeScreen() {
  const router = useRouter();
  const { t }  = useStrings();

  const pick = (role: "driver" | "passenger") => {
    router.push({ pathname: "/(auth)/sign-in", params: { role } });
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.inner}>
        <TouchableOpacity onPress={() => router.replace("/(auth)/language")} style={s.backBtn}>
          <Text style={s.backText}>← {t.back}</Text>
        </TouchableOpacity>

        <Text style={s.logo}>LOADQ</Text>
        <Text style={s.title}>{t.iAm}</Text>
        <Text style={s.sub}>{t.pickRoleSub}</Text>

        <TouchableOpacity style={[s.card, s.cardDriver]} onPress={() => pick("driver")} activeOpacity={0.85}>
          <Text style={s.cardEmoji}>🚐</Text>
          <Text style={s.cardTitle}>{t.iAmDriver}</Text>
          <Text style={s.cardSub}>{t.driverDesc}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[s.card, s.cardPassenger]} onPress={() => pick("passenger")} activeOpacity={0.85}>
          <Text style={s.cardEmoji}>🧍</Text>
          <Text style={s.cardTitle}>{t.iAmPassenger}</Text>
          <Text style={s.cardSub}>{t.passengerDesc}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:  { flex:1, backgroundColor:Colors.bg },
  inner:      { flex:1, padding:24, justifyContent:"center" },
  backBtn:    { position:"absolute", top:60, left:24 },
  backText:   { color:Colors.t2, fontSize:14 },
  logo:       { fontSize:28, fontWeight:"900", color:Colors.accent, letterSpacing:3, marginBottom:24, textAlign:"center" },
  title:      { fontSize:24, fontWeight:"700", color:Colors.t1, textAlign:"center", marginBottom:8 },
  sub:        { fontSize:14, color:Colors.t2, textAlign:"center", marginBottom:32, lineHeight:20 },
  card:       { borderRadius:16, padding:20, borderWidth:1.5, alignItems:"center", marginBottom:16 },
  cardDriver: { borderColor:Colors.accent, backgroundColor:Colors.accent+"12" },
  cardPassenger:{ borderColor:Colors.blue, backgroundColor:Colors.blue+"12" },
  cardEmoji:  { fontSize:42, marginBottom:8 },
  cardTitle:  { fontSize:18, fontWeight:"800", color:Colors.t1, marginBottom:4 },
  cardSub:    { fontSize:12, color:Colors.t3, textAlign:"center", lineHeight:18 },
});
