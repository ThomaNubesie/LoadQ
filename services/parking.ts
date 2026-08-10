import { supabase } from "./supabase";

// A6 · "Pay for parking" — deep-link hand-off to third-party parking apps for
// drivers parking on-street while they wait. LoadQ never processes the payment.
export interface ParkingLink {
  id: string;
  provider: string;
  label: string;
  web_url: string | null;
  ios_url: string | null;
  android_url: string | null;
  deeplink_template: string | null;
  note: string | null;
  region: string | null;
  active: boolean;
  sort: number | null;
}

export const ParkingAPI = {
  // Active providers, admin-ordered. Empty when parking is turned off.
  async list(): Promise<ParkingLink[]> {
    const { data, error } = await supabase.rpc("loadq_parking_links_list");
    if (error) return [];
    return (data as ParkingLink[]) ?? [];
  },
  // Help card: { card_url, auto_show }. auto_show is true only until the driver
  // has seen it once (or after an admin reset).
  async help(): Promise<{ card_url: string | null; auto_show: boolean }> {
    const { data } = await supabase.rpc("loadq_parking_help");
    const d = (data as { card_url?: string | null; auto_show?: boolean } | null) || {};
    return { card_url: d.card_url ?? null, auto_show: !!d.auto_show };
  },
  async markHelpSeen(): Promise<void> {
    try { await supabase.rpc("loadq_mark_parking_help_seen"); } catch { /* noop */ }
  },
};
