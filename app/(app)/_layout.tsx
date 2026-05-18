import { Stack } from "expo-router";
import { Colors } from "../../constants/colors";

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown:false, contentStyle:{ backgroundColor:Colors.bg } }}>
      <Stack.Screen name="zone-select" />
      <Stack.Screen name="queue" />
      <Stack.Screen name="my-loading" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="alerts" />
      <Stack.Screen name="admin-zones" />
      <Stack.Screen name="loading-history" />
      <Stack.Screen name="edit-vehicle" />
      <Stack.Screen name="admin-destinations" />
    </Stack>
  );
}
