import { Stack } from "expo-router";
import { View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import BrandHeader from "../../components/BrandHeader";
import { Colors } from "../../constants/colors";

export default function PassengerLayout() {
  return (
    <View style={{ flex: 1 }}>
      <BrandHeader />
      <SafeAreaInsetsContext.Consumer>
        {(insets) => (
          <SafeAreaInsetsContext.Provider value={{ ...(insets ?? { top: 0, bottom: 0, left: 0, right: 0 }), top: 0 }}>
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
            </SafeAreaInsetsContext.Provider>
          )}
        </SafeAreaInsetsContext.Consumer>
      </View>
  );
}
