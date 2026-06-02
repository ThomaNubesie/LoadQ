import { Platform, Linking } from "react-native";
import Purchases, { PurchasesOffering, PurchasesPackage, CustomerInfo } from "react-native-purchases";

// Where the Stripe Checkout page is hosted. Public site, no secrets here.
// The page reads ?driver_id=X and ?plan=monthly|annual from the query
// string, creates a Stripe Checkout Session via a Netlify function, and
// redirects to Stripe. Stripe's success_url deep-links back to the app via
// loadq://subscribe/done so we can refresh the driver row immediately.
const WEB_CHECKOUT_URL = "https://loadq.ca/subscribe";

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

// External web-checkout API. Used for the Apple-compliant 3.1.5(a)
// real-world service flow: the app opens Safari to the public checkout
// page on loadq.ca, the page creates a Stripe Checkout Session via a
// Netlify function (which holds the Stripe secret), and Stripe handles
// the card form. The webhook (Supabase Edge Function stripe-webhook)
// flips drivers.subscription_status to 'active' when payment completes.
//
// Keep StripeWebCheckoutAPI separate from BillingAPI so RevenueCat code
// can be removed in a future cleanup without touching the web flow.
export const StripeWebCheckoutAPI = {
  // Build the URL Safari opens. plan is 'monthly' or 'annual' — the web
  // page maps that to the configured Stripe Price.
  buildCheckoutUrl(driverId: string, plan: "monthly" | "annual" = "monthly"): string {
    const u = new URL(WEB_CHECKOUT_URL);
    u.searchParams.set("driver_id", driverId);
    u.searchParams.set("plan", plan);
    return u.toString();
  },

  // Open the URL in the system browser. Apple flags in-app browsers
  // (WebViews, SFSafariViewController) for payment processing — only
  // the system Safari counts as truly "external" under 3.1.5(a).
  async openCheckout(driverId: string, plan: "monthly" | "annual" = "monthly"): Promise<void> {
    const url = StripeWebCheckoutAPI.buildCheckoutUrl(driverId, plan);
    await Linking.openURL(url);
  },
};
