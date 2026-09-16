import { useEffect, useRef, useState } from "react";
import { Stack, router } from "expo-router";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { View, Text, AppState } from "react-native";
import { SessionAPI } from "../services/session";
import { StripeProvider } from "@stripe/stripe-react-native";
import { initLang } from "../hooks/useStrings";
import { loadTheme } from "../services/theme";
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
import Wordmark from "../components/Wordmark";
import Blocked from "../components/Blocked";
import { BlockAPI, NOT_BLOCKED, type Block } from "../services/block";

const safe = (fn: () => void) => { try { fn(); } catch { /* never trap the splash */ } };

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [block, setBlock] = useState<Block>(NOT_BLOCKED);

  // 1) SPLASH CONTROL ONLY. Nothing native/heavy runs here, so the UI always
  // reveals — as soon as language loads, and forced after 4s no matter what.
  useEffect(() => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; setReady(true); } };
    const splashTimer = setTimeout(finish, 4000);
    Promise.all([initLang(), loadTheme()]).then(finish).catch(finish);
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

  // 2c) BLOCKED ACCOUNTS. Checked on sign-in, on every foreground, and by realtime on the
  // driver's own row so a block applied mid-shift lands while the app is open rather than at
  // the next cold start.
  //
  // Fail-safe is OPEN — a failed check leaves the driver unblocked. The database refuses a
  // blocked driver a place in any line whatever the app believes, so the cost of this being
  // wrong is a wasted tap; the cost of the opposite is locking someone out of their evening's
  // work because a request timed out in a parking lot.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let unsub: (() => void) | null = null;

    const refresh = () => {
      BlockAPI.check().then((b) => { if (!cancelled) setBlock(b); });
    };

    const watch = (userId: string | null) => {
      unsub?.(); unsub = null;
      if (!userId) { setBlock(NOT_BLOCKED); return; }
      refresh();
      unsub = BlockAPI.subscribe(userId, refresh);
    };

    supabase.auth.getUser()
      .then(({ data }) => { if (!cancelled) watch(data.user?.id ?? null); })
      .catch(() => {});
    const { data: authSub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!cancelled) watch(session?.user?.id ?? null);
    });
    const appStateSub = AppState.addEventListener("change", (st) => {
      if (st === "active") refresh();
    });

    return () => {
      cancelled = true; unsub?.();
      authSub.subscription.unsubscribe(); appStateSub.remove();
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
        // A1: a driver submitting a document notifies admins → open the review queue.
        if (data?.type === "doc_submitted") { router.push("/(app)/admin-docs" as never); return; }
        // A1: approve/reject/expiry notifies the driver → open their Verification screen.
        if (data?.type === "doc_review" || data?.type === "doc_expired") { router.push("/(app)/verification" as never); return; }
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
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex:1, backgroundColor:Colors.bg, alignItems:"center", justifyContent:"center" }}>
        <Wordmark style={{ fontSize: 32 }} />
      </SafeAreaView>
    </SafeAreaProvider>
  );

  // The navigator is not merely covered — it is not mounted. Nothing to swipe back to, no
  // tab bar, no deep link or notification tap that lands anywhere else.
  if (block.blocked) return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Blocked block={block} />
    </SafeAreaProvider>
  );

  return (
    <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""} merchantIdentifier="merchant.ca.loadq">
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown:false, contentStyle:{ backgroundColor:Colors.bg } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
          <Stack.Screen name="(admin)" />
          <Stack.Screen name="ref/[id]" />
        </Stack>
        <WhatsNew />
      </SafeAreaProvider>
    </StripeProvider>
  );
}
