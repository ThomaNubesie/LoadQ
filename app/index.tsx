import { useEffect } from "react";
import { useRouter } from "expo-router";
import { View, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../services/supabase";
import { resolveHome } from "../services/authRoute";
import { Colors } from "../constants/colors";
import Wordmark from "../components/Wordmark";

// Startup must be near-instant and never trap users on the LOADQ splash.
// A returning user is sent to their LAST KNOWN home immediately (no network wait),
// then we verify/correct in the background. Only a first launch / signed-out user
// pays the (time-boxed) resolve cost.
const LAST_HOME = "loadq.lastHome";
const timeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export default function Index() {
  const router = useRouter();
  useEffect(() => {
    let done = false;
    const go = (r: string) => { if (!done) { done = true; try { router.replace(r as never); } catch { /* ignore */ } } };

    (async () => {
      const cached = await AsyncStorage.getItem(LAST_HOME).catch(() => null);

      // FAST PATH: returning user → go to their cached home NOW, correct in the
      // background. This is what removes the multi-second "stuck on LOADQ" wait.
      if (cached) {
        go(cached);
        (async () => {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) { await AsyncStorage.removeItem(LAST_HOME).catch(() => {}); router.replace("/(auth)/language" as never); return; }
            const home = await resolveHome();
            AsyncStorage.setItem(LAST_HOME, home).catch(() => {});
            if (home !== cached) router.replace(home as never); // gentle correction if their home changed
          } catch { /* keep them where they are */ }
        })();
        return;
      }

      // NO CACHE (first launch / signed out): resolve, each step time-boxed so we
      // can't hang on the splash.
      let session: any = "unknown";
      try { session = (await timeout(supabase.auth.getSession(), 3500)).data.session; } catch { /* unknown */ }
      if (session === null || session === "unknown") return go("/(auth)/language");
      try {
        const home = await timeout(resolveHome(), 6000);
        AsyncStorage.setItem(LAST_HOME, home).catch(() => {});
        go(home);
      } catch { go("/(app)/zone-select"); }
    })().catch(() => go("/(auth)/language"));

    const hard = setTimeout(() => go("/(auth)/language"), 8000); // absolute last resort
    return () => clearTimeout(hard);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" }}>
      <Wordmark style={{ fontSize: 32 }} />
    </View>
  );
}
