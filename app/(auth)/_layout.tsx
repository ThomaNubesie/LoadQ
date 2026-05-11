import { Stack } from "expo-router";
import { Colors } from "../../constants/colors";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }}>
      <Stack.Screen name="language" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="otp" />
      <Stack.Screen name="profile-setup" />
      <Stack.Screen name="vehicle-setup" />
      <Stack.Screen name="email-setup" />
      <Stack.Screen name="subscribe" />
      <Stack.Screen name="payment" />
    </Stack>
  );
}
