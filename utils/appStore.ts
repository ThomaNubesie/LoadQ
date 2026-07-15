// Opens the LoadQ store listing so the user can update. Prefers the native store
// app (market:// / itms-apps://) and falls back to the web listing.
import { Platform, Linking } from "react-native";

const IOS_APP_ID = "6770652996";
const ANDROID_PKG = "ca.loadq.app";

export const STORE_WEB_URL = Platform.OS === "ios"
  ? `https://apps.apple.com/ca/app/loadq/id${IOS_APP_ID}`
  : `https://play.google.com/store/apps/details?id=${ANDROID_PKG}`;

export async function openStoreListing(): Promise<void> {
  const native = Platform.OS === "ios"
    ? `itms-apps://apps.apple.com/ca/app/id${IOS_APP_ID}`
    : `market://details?id=${ANDROID_PKG}`;
  try {
    if (await Linking.canOpenURL(native)) { await Linking.openURL(native); return; }
  } catch { /* fall through to web */ }
  try { await Linking.openURL(STORE_WEB_URL); } catch { /* nothing else to do */ }
}
