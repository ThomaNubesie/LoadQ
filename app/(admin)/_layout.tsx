import { Stack } from "expo-router";
import { Colors } from "../../constants/colors";

export default function AdminLayout() {
  return (
    <Stack screenOptions={{ headerShown:false, contentStyle:{ backgroundColor:Colors.bg } }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="zone-settings" />
    </Stack>
  );
}
