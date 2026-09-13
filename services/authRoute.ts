import { supabase } from "./supabase";
import { DriversAPI } from "./drivers";
import { PassengersAPI } from "./passengers";
import { UndertakingAPI } from "./undertaking";

export type HomeRoute =
  | "/(auth)/welcome"
  | "/(auth)/profile-setup"
  | "/(auth)/passenger-setup"
  | "/(auth)/engagement"
  | "/(auth)/subscribe"
  | "/(app)/zone-select"
  | "/(passenger)/board";

// Single source of truth for "where does this signed-in user belong?".
// Used on cold launch (app/index.tsx) and after OTP verification so a
// returning user always lands in the right place regardless of which
// role button they happened to tap.
export async function resolveHome(): Promise<HomeRoute> {
  // Use the local session (not getUser, which hits the network and can hang on a
  // flaky connection during cold launch).
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return "/(auth)/welcome";

  const [driver, passenger] = await Promise.all([
    DriversAPI.getMe(),
    PassengersAPI.getMe(),
  ]);

  if (driver) {
    if (!driver.full_name) return "/(auth)/profile-setup";
    // The engagement comes before the money: you accept the rules, then pay the
    // contribution those rules describe. Only drivers who joined on or after
    // loadq_settings.undertaking_required_from are asked — everyone already on the
    // platform signed on paper, and `required` is false for them.
    const u = await UndertakingAPI.get();
    if (u?.required && !u.signed) return "/(auth)/engagement";
    const hasSub = await DriversAPI.hasActiveSubscription();
    return hasSub ? "/(app)/zone-select" : "/(auth)/subscribe";
  }

  if (passenger) {
    if (!passenger.full_name) return "/(auth)/passenger-setup";
    return "/(passenger)/board";
  }

  // Authenticated but no profile row yet (sign-up never finished) →
  // send them back to pick a role and complete it.
  return "/(auth)/welcome";
}
