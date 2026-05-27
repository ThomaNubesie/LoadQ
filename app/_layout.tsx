import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { View, Text } from "react-native";
import { initLang } from "../hooks/useStrings";
import { BillingAPI } from "../services/billing";
import { PushAPI } from "../services/push";
import { LocationAPI } from "../services/location";
import { supabase } from "../services/supabase";
import { Colors } from "../constants/colors";

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    initLang().then(() => setReady(true));
    // Init RevenueCat, then tie purchases to the signed-in user if any.
    BillingAPI.configure();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) { BillingAPI.identify(data.user.id); PushAPI.register(); LocationAPI.start(); }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) { BillingAPI.identify(session.user.id); PushAPI.register(); LocationAPI.start(); }
      else { LocationAPI.stop(); }
    });
    return () => { sub.subscription.unsubscribe(); LocationAPI.stop(); };
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
    </SafeAreaProvider>
  );
}
