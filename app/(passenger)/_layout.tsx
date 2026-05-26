import { Stack } from "expo-router";
import { Colors } from "../../constants/colors";

export default function PassengerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }}>
      <Stack.Screen name="queue" />
      <Stack.Screen name="loading" />
      <Stack.Screen name="zones" />
      <Stack.Screen name="analytics" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="messages" />
    </Stack>
  );
}
