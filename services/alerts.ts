import { supabase } from "./supabase";

export interface AlertRow {
  id: string;
  user_id: string;
  kind: "return" | "slot_open" | "moved_back" | "removed";
  title: string;
  body: string;
  ref: string;
  created_at: string;
  read_at: string | null;
}

export const AlertsAPI = {
  async list(): Promise<AlertRow[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase
      .from("alerts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    return data || [];
  },

  async unreadCount(): Promise<number> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;
    const { count } = await supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);
    return count ?? 0;
  },

  async markAllRead(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("alerts")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
  },
};
