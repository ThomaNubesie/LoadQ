import { useEffect } from "react";
import { useRouter } from "expo-router";
import { View, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../services/supabase";
import { resolveHome } from "../services/authRoute";
import { Colors } from "../constants/colors";

// Cold launch used to await resolveHome() (getUser + getMe + subscription — all
// network) with NO timeout, so a driver on a flaky connection got trapped on the
// LOADQ screen forever. This guarantees we always leave the splash: the session
// check and the home resolution are each time-boxed, with the last known route as
// an offline fallback so returning users still land in the right place.
const LAST_HOME = "loadq.lastHome";
const timeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export default function Index() {
  const router = useRouter();
  useEffect(() => {
    let done = false;
    const go = (r: string) => { if (!done) { done = true; try { router.replace(r as never); } catch { /* ignore */ } } };

    (async () => {
      // 1) Session check — local, but an expired-token refresh can hit the network,
      //    so cap it. Timed out → "unknown" (probably signed in, treat optimistically).
      let session: any = "unknown";
      try { session = (await timeout(supabase.auth.getSession(), 3500)).data.session; } catch { /* unknown */ }
      if (session === null) return go("/(auth)/language"); // definitely signed out

      const cached = await AsyncStorage.getItem(LAST_HOME).catch(() => null);
      if (session === "unknown") return go(cached || "/(auth)/language");

      // 2) Signed in — resolve where they belong, but never hang on the splash.
      try {
        const home = await timeout(resolveHome(), 6000);
        AsyncStorage.setItem(LAST_HOME, home).catch(() => {});
        go(home);
      } catch {
        go(cached || "/(app)/zone-select"); // signed in but offline/slow
      }
    })().catch(() => go("/(auth)/language"));

    const hard = setTimeout(() => go("/(auth)/language"), 10000); // absolute last resort
    return () => clearTimeout(hard);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 32, fontWeight: "900", color: Colors.accent, letterSpacing: 4 }}>LOADQ</Text>
    </View>
  );
}
