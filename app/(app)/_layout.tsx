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
      <Stack.Screen name="admin-verify" />
      <Stack.Screen name="admin-user" />
      <Stack.Screen name="admin-inbox" />
      <Stack.Screen name="admin-thread" />
      <Stack.Screen name="messages" />
      <Stack.Screen name="thread" />
      <Stack.Screen name="admin-print-user" />
      <Stack.Screen name="admin-add-user" />
    </Stack>
  );
}
