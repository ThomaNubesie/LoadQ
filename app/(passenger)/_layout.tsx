import { Stack } from "expo-router";
import { Colors } from "../../constants/colors";

export default function PassengerLayout() {
  return (
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
  );
}
