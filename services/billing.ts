import { Platform } from "react-native";
import Purchases, { PurchasesOffering, PurchasesPackage, CustomerInfo } from "react-native-purchases";

// RevenueCat public API keys (safe to ship in the client).
// Fill these from RevenueCat dashboard → Project → API keys.
// Set via EXPO_PUBLIC_* env so they're not hard-coded.
const RC_IOS_KEY     = process.env.EXPO_PUBLIC_RC_IOS_KEY     ?? "";
const RC_ANDROID_KEY = process.env.EXPO_PUBLIC_RC_ANDROID_KEY ?? "";

// The entitlement identifier configured in RevenueCat. Must match the
// identifier in the RC dashboard EXACTLY (including spaces/caps). Active
// during the store-side free trial AND while the paid subscription is current.
export const ENTITLEMENT_ID = "LoadQ Pro";

let _configured = false;

export const BillingAPI = {
  // Call once on app start, then identify the user so purchases are tied to
  // the LoadQ account (not just the device).
  configure(appUserId?: string) {
    if (_configured) return;
    const apiKey = Platform.OS === "ios" ? RC_IOS_KEY : RC_ANDROID_KEY;
    if (!apiKey) return; // keys not set yet — billing simply inert in dev
    Purchases.configure({ apiKey, appUserID: appUserId });
    _configured = true;
  },

  async identify(appUserId: string) {
    if (!_configured) return;
    try { await Purchases.logIn(appUserId); } catch { /* ignore */ }
  },

  async getCurrentOffering(): Promise<PurchasesOffering | null> {
    if (!_configured) return null;
    try {
      const offerings = await Purchases.getOfferings();
      return offerings.current ?? null;
    } catch {
      return null;
    }
  },

  async purchase(pkg: PurchasesPackage): Promise<{ ok: boolean; error?: string }> {
    if (!_configured) return { ok: false, error: "Billing not configured" };
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      return { ok: !!customerInfo.entitlements.active[ENTITLEMENT_ID] };
    } catch (e: any) {
      if (e?.userCancelled) return { ok: false, error: "cancelled" };
      return { ok: false, error: e?.message ?? "Purchase failed" };
    }
  },

  async restore(): Promise<{ ok: boolean; error?: string }> {
    if (!_configured) return { ok: false, error: "Billing not configured" };
    try {
      const info = await Purchases.restorePurchases();
      return { ok: !!info.entitlements.active[ENTITLEMENT_ID] };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Restore failed" };
    }
  },

  // True if the user currently has access (trial or paid). When billing isn't
  // configured (dev / keys missing) we return null so callers can fall back.
  async isEntitled(): Promise<boolean | null> {
    if (!_configured) return null;
    try {
      const info: CustomerInfo = await Purchases.getCustomerInfo();
      return !!info.entitlements.active[ENTITLEMENT_ID];
    } catch {
      return null;
    }
  },
};
