import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "./supabase";

// Expo push notifications. The token is stored on the signed-in user's row
// (drivers AND/OR passengers — one update is a harmless no-op) so the
// queue-close-watchdog Edge Function can push "return to the zone" / slot /
// timer alerts server-side.

let _handlerSet = false;

async function ensureHandler() {
  if (_handlerSet) return;
  const Notifications = await import("expo-notifications");
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "LoadQ",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  _handlerSet = true;
}

export const PushAPI = {
  // Request permission, get the Expo push token, and persist it on the
  // current user. Safe to call on every app start / auth change — it no-ops
  // when permission is denied or no user is signed in.
  async register(): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await ensureHandler();
      const Notifications = await import("expo-notifications");

      const { status: existing } = await Notifications.getPermissionsAsync();
      let status = existing;
      if (status !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        status = req.status;
      }
      if (status !== "granted") return;

      const projectId =
        (Constants.expoConfig?.extra as any)?.eas?.projectId ??
        (Constants as any)?.easConfig?.projectId;
      const tokenResp = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );
      const token = tokenResp.data;
      if (!token) return;

      // Write to whichever profile row this user has. The non-matching one
      // updates zero rows — harmless.
      await supabase.from("drivers").update({ push_token: token }).eq("id", user.id);
      await supabase.from("passengers").update({ push_token: token }).eq("id", user.id);
    } catch {
      // Push is best-effort; never block the app on it.
    }
  },
};
