import { useEffect, useState } from "react";
import { Stack, router } from "expo-router";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { View, Text } from "react-native";
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

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Failsafe: the app must NEVER stay on the splash. Reveal the UI as soon as
    // language is loaded, but force it after 4s no matter what (a hung native
    // init must not trap users on the load screen).
    let settled = false;
    const finish = () => { if (!settled) { settled = true; setReady(true); } };
    const splashTimer = setTimeout(finish, 4000);
    initLang().then(finish).catch(finish);

    // None of the below may block startup — wrap everything defensively.
    try {
      BillingAPI.configure();
      supabase.auth.getUser().then(({ data }) => {
        if (data.user) { BillingAPI.identify(data.user.id); PushAPI.register(); LocationAPI.start(); MessageEvents.start(); }
      }).catch(() => {});
    } catch { /* never trap the splash */ }

    let sub: { subscription: { unsubscribe: () => void } } | null = null;
    try {
      sub = supabase.auth.onAuthStateChange((_e, session) => {
        if (session?.user) { BillingAPI.identify(session.user.id); PushAPI.register(); LocationAPI.start(); MessageEvents.start(); }
        else { LocationAPI.stop(); MessageEvents.stop(); stopBackgroundTracking(); }
      }).data;
    } catch { /* ignore */ }
    return () => { clearTimeout(splashTimer); sub?.subscription.unsubscribe(); LocationAPI.stop(); MessageEvents.stop(); };
  }, []);

  // Tapping a push opens Alerts (or the route in its data payload). The app had
  // no response handler before, so taps never navigated anywhere.
  useEffect(() => {
    const go = (resp: Notifications.NotificationResponse | null) => {
      if (!resp) return;
      const data = resp.notification.request.content.data as { route?: string; alertRef?: string } | undefined;
      const pathname = data?.route ?? "/(app)/alerts";
      try {
        router.push((data?.alertRef ? { pathname, params: { focus: String(data.alertRef) } } : pathname) as never);
      } catch { /* not signed in / bad route */ }
    };
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    Notifications.getLastNotificationResponseAsync().then(go);
    return () => sub.remove();
  }, []);

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
