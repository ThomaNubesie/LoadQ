import { Stack } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BrandHeader from "../../components/BrandHeader";
import { Colors } from "../../constants/colors";
import { useDeliveryTracking } from "../../hooks/useDeliveryTracking";

export default function AppLayout() {
  const insets = useSafeAreaInsets();
  // Runs background location while the driver holds a queue spot or is carrying
  // a parcel; stops when fully idle. Single source of truth for the bg task.
  useDeliveryTracking();
  return (
    <View style={{ flex: 1 }}>
      <BrandHeader />
      {/* Every one of the 52 screens below renders its own <SafeAreaView>, which is a
          NATIVE view: it reads the notch inset from the platform and ignores React
          context, so it cannot be told the header already consumed it. Pulling the stack
          up by exactly that inset cancels the duplicate padding. Safe precisely because
          it is 52 of 52 — no screen is left without its own top padding to cancel. */}
      <View style={{ flex: 1, marginTop: -insets.top }}>
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
      <Stack.Screen name="scheduled-trip" />
      <Stack.Screen name="admin-payments" />
    </Stack>
      </View>
      </View>
  );
}
