import { supabase } from "./supabase";
import { DriversAPI } from "./drivers";
import { PassengersAPI } from "./passengers";

export type HomeRoute =
  | "/(auth)/welcome"
  | "/(auth)/profile-setup"
  | "/(auth)/passenger-setup"
  | "/(auth)/subscribe"
  | "/(app)/zone-select"
  | "/(passenger)/queue";

// Single source of truth for "where does this signed-in user belong?".
// Used on cold launch (app/index.tsx) and after OTP verification so a
// returning user always lands in the right place regardless of which
// role button they happened to tap.
export async function resolveHome(): Promise<HomeRoute> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "/(auth)/welcome";

  const [driver, passenger] = await Promise.all([
    DriversAPI.getMe(),
    PassengersAPI.getMe(),
  ]);

  if (driver) {
    if (!driver.full_name) return "/(auth)/profile-setup";
    const hasSub = await DriversAPI.hasActiveSubscription();
    return hasSub ? "/(app)/zone-select" : "/(auth)/subscribe";
  }

  if (passenger) {
    if (!passenger.full_name) return "/(auth)/passenger-setup";
    return "/(passenger)/queue";
  }

  // Authenticated but no profile row yet (sign-up never finished) →
  // send them back to pick a role and complete it.
  return "/(auth)/welcome";
}
