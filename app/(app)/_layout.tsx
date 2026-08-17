import { Stack } from "expo-router";
import { Colors } from "../../constants/colors";
import { useDeliveryTracking } from "../../hooks/useDeliveryTracking";

export default function AppLayout() {
  // Runs background location while the driver holds a queue spot or is carrying
  // a parcel; stops when fully idle. Single source of truth for the bg task.
  useDeliveryTracking();
  return (
    <Stack screenOptions={{ headerShown:false, contentStyle:{ backgroundColor:Colors.bg } }}>
      <Stack.Screen name="zone-select" />
      <Stack.Screen name="queue" />
      <Stack.Screen name="my-loading" />
      <Stack.Screen name="verification" />
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
      <Stack.Screen name="loading-times" />
      <Stack.Screen name="admin-docs" />
      <Stack.Screen name="feeder" />
      <Stack.Screen name="scheduled" />
    </Stack>
  );
}
