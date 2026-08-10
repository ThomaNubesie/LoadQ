import { useEffect, useRef, useState } from "react";
import { Stack, router } from "expo-router";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { View, Text, AppState } from "react-native";
import { SessionAPI } from "../services/session";
import { initLang } from "../hooks/useStrings";
import { BillingAPI } from "../services/billing";
import { PushAPI } from "../services/push";
import { LocationAPI } from "../services/location";
// Import registers the background-location TaskManager task at startup (incl.
// OS background relaunch). stopBackgroundTracking() is called on sign-out.
import { stopBackgroundTracking } from "../services/backgroundLocation";
import { MessageEvents } from "../services/messageEvents";
import { supabase } from "../services/supabase";
import { Colors } from "../constants/colors";
import WhatsNew from "../components/WhatsNew";

const safe = (fn: () => void) => { try { fn(); } catch { /* never trap the splash */ } };

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  // 1) SPLASH CONTROL ONLY. Nothing native/heavy runs here, so the UI always
  // reveals — as soon as language loads, and forced after 4s no matter what.
  useEffect(() => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; setReady(true); } };
    const splashTimer = setTimeout(finish, 4000);
    initLang().then(finish).catch(finish);
    return () => clearTimeout(splashTimer);
  }, []);

  // 2) NATIVE SERVICES — started only AFTER the first frame paints (gated on
  // `ready` + a short delay), individually guarded. This keeps crashy native
  // inits (RevenueCat / FCM / location on old Google Play Services) entirely off
  // the launch path, so they can never trap or kill the splash on old devices.
  // (A true native-load crash isn't JS-catchable, so deferring is the real
  // mitigation here, not the try/catch.)
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const startFor = (userId?: string) => {
      safe(() => BillingAPI.configure());
      if (userId) safe(() => BillingAPI.identify(userId));
      safe(() => PushAPI.register());
      safe(() => LocationAPI.start());
      safe(() => MessageEvents.start());
    };

    const t = setTimeout(() => {
      if (cancelled) return;
      supabase.auth.getUser()
        .then(({ data }) => { if (!cancelled && data.user) startFor(data.user.id); })
        .catch(() => {});
    }, 600);

    let sub: { subscription: { unsubscribe: () => void } } | null = null;
    safe(() => {
      sub = supabase.auth.onAuthStateChange((_e, session) => {
        if (cancelled) return;
        if (session?.user) startFor(session.user.id);
        else safe(() => { LocationAPI.stop(); MessageEvents.stop(); stopBackgroundTracking(); });
      }).data;
    });

    return () => {
      cancelled = true; clearTimeout(t);
      sub?.subscription.unsubscribe();
      safe(() => { LocationAPI.stop(); MessageEvents.stop(); });
    };
  }, [ready]);

  // 2b) SINGLE-ACTIVE-SESSION enforcement. The ON/OFF switch lives in the DB
  // (app_flags.single_session_enforce) so it toggles with NO rebuild. While the
  // flag is off this is fully inert — nobody is kicked. When the flag flips on
  // (initial fetch, realtime, or foreground refresh): watch active_sessions and
  // re-check on foreground; if another device has claimed the seat, sign this
  // device out and bounce to sign-in.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let userId: string | null = null;
    let unsubSession: (() => void) | null = null;

    const stopWatch = () => { unsubSession?.(); unsubSession = null; };

    const kick = async () => {
      if (cancelled) return;
      stopWatch();
      await SessionAPI.clearLocal();
      safe(() => { LocationAPI.stop(); MessageEvents.stop(); stopBackgroundTracking(); });
      await supabase.auth.signOut().catch(() => {});
      try { router.replace("/(auth)/sign-in" as never); } catch { /* noop */ }
    };

    // Reconcile desired state: watch only when (signed-in AND flag on).
    const sync = () => {
      if (cancelled) return;
      if (userId && SessionAPI.isEnforcing()) {
        if (!unsubSession) unsubSession = SessionAPI.subscribe(userId, kick);
        SessionAPI.isCurrent(userId).then((ok) => { if (!ok) kick(); });
      } else {
        stopWatch();
      }
    };

    // Who's signed in.
    supabase.auth.getUser().then(({ data }) => { if (!cancelled) { userId = data.user?.id ?? null; sync(); } }).catch(() => {});
    const { data: authSub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled) return; userId = session?.user?.id ?? null; sync();
    });

    // The remote flag: initial fetch, realtime flips, and foreground refresh.
    SessionAPI.refreshEnforcement().then(() => sync());
    const unsubFlag = SessionAPI.subscribeFlag(() => sync());
    const appStateSub = AppState.addEventListener("change", (st) => {
      if (st === "active") SessionAPI.refreshEnforcement().then(() => sync());
    });

    return () => {
      cancelled = true; stopWatch();
      authSub.subscription.unsubscribe(); unsubFlag(); appStateSub.remove();
    };
  }, [ready]);

  // 3) Push-tap routing — also gated on `ready` + guarded, since touching
  // expo-notifications at cold mount can crash on old FCM / Play Services.
  useEffect(() => {
    if (!ready) return;
    let sub: { remove: () => void } | null = null;
    const go = (resp: Notifications.NotificationResponse | null) => {
      if (!resp) return;
      const data = resp.notification.request.content.data as { route?: string; alertRef?: string; type?: string; offer_id?: string } | undefined;
      try {
        // A7 dispatch: a ride offer opens the accept/decline screen directly.
        if (data?.type === "ride_offer") {
          router.push({ pathname: "/(app)/ride-offer", params: data.offer_id ? { offer_id: String(data.offer_id) } : {} } as never);
          return;
        }
        const pathname = data?.route ?? "/(app)/alerts";
        router.push((data?.alertRef ? { pathname, params: { focus: String(data.alertRef) } } : pathname) as never);
      } catch { /* not signed in / bad route */ }
    };
    safe(() => {
      sub = Notifications.addNotificationResponseReceivedListener(go);
      Notifications.getLastNotificationResponseAsync().then(go).catch(() => {});
    });
    return () => sub?.remove();
  }, [ready]);

  if (!ready) return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex:1, backgroundColor:Colors.bg, alignItems:"center", justifyContent:"center" }}>
        <Text style={{ fontSize:32, fontWeight:"900", color:Colors.accent, letterSpacing:4 }}>LOADQ</Text>
      </SafeAreaView>
    </SafeAreaProvider>
  );

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown:false, contentStyle:{ backgroundColor:Colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="(admin)" />
        <Stack.Screen name="ref/[id]" />
      </Stack>
      <WhatsNew />
    </SafeAreaProvider>
  );
}
