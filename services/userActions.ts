import { supabase } from "./supabase";

export const UserActions = {
  async report(reportedId: string, reason?: string): Promise<{ error?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    if (user.id === reportedId) return { error: "You can't report yourself" };
    const { error } = await supabase.from("user_reports").insert({
      reporter_id: user.id,
      reported_id: reportedId,
      reason: reason ?? null,
    });
    return { error: error?.message };
  },

  async block(blockedId: string): Promise<{ error?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    if (user.id === blockedId) return { error: "You can't block yourself" };
    const { error } = await supabase.from("user_blocks").insert({
      blocker_id: user.id,
      blocked_id: blockedId,
    });
    if (error && error.code === "23505") return {};
    return { error: error?.message };
  },

  async unblock(blockedId: string): Promise<{ error?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    const { error } = await supabase.from("user_blocks").delete()
      .eq("blocker_id", user.id).eq("blocked_id", blockedId);
    return { error: error?.message };
  },

  async getMyBlockedIds(): Promise<Set<string>> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Set();
    const { data } = await supabase.from("user_blocks")
      .select("blocked_id").eq("blocker_id", user.id);
    return new Set((data ?? []).map((r: any) => r.blocked_id));
  },

  async isBlocked(targetId: string): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { count } = await supabase.from("user_blocks")
      .select("id", { count: "exact", head: true })
      .eq("blocker_id", user.id).eq("blocked_id", targetId);
    return (count ?? 0) > 0;
  },
};
