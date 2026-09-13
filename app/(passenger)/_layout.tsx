import { Stack } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BrandHeader from "../../components/BrandHeader";
import { Colors } from "../../constants/colors";

export default function PassengerLayout() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <BrandHeader />
      {/* Every one of the 52 screens below renders its own <SafeAreaView>, which is a
          NATIVE view: it reads the notch inset from the platform and ignores React
          context, so it cannot be told the header already consumed it. Pulling the stack
          up by exactly that inset cancels the duplicate padding. Safe precisely because
          it is 52 of 52 — no screen is left without its own top padding to cancel. */}
      <View style={{ flex: 1, marginTop: -insets.top }}>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }}>
      <Stack.Screen name="board" />
      <Stack.Screen name="my-trip" />
      <Stack.Screen name="alerts" />
      <Stack.Screen name="rate" />
      <Stack.Screen name="loading" />
      <Stack.Screen name="zones" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="history" />
      <Stack.Screen name="messages" />
      <Stack.Screen name="loading-times" />
      <Stack.Screen name="pickup-request" />
      <Stack.Screen name="pickup-scheduled" />
      <Stack.Screen name="pickup-options" />
      <Stack.Screen name="pickup-pay" />
      <Stack.Screen name="pickup-status" />
      <Stack.Screen name="pickup-receipt" />
    </Stack>
      </View>
      </View>
  );
}
