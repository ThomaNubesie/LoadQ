import { supabase } from "./supabase";

export interface Message {
  id:           string;
  sender_id:    string;
  recipient_id: string;
  body:         string;
  created_at:   string;
  read_at:      string | null;
}

export interface ConversationSummary {
  other_id:     string;
  other_name:   string;
  other_avatar: string | null;
  other_role:   "driver" | "passenger";
  last_body:    string;
  last_at:      string;
  unread:       number;
}

export const MessagesAPI = {
  // The single admin user this app talks to. Returns the first driver row with
  // is_admin = true. For the soft launch with one admin this is fine.
  async getAdminId(): Promise<string | null> {
    const { data } = await supabase
      .from("drivers").select("id").eq("is_admin", true).limit(1).maybeSingle();
    return data?.id ?? null;
  },

  async getThreadWith(otherId: string): Promise<Message[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase
      .from("messages")
      .select("*")
      .or(`and(sender_id.eq.${user.id},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${user.id})`)
      .order("created_at", { ascending: true });
    return (data ?? []) as Message[];
  },

  async send(recipientId: string, body: string): Promise<{ data?: Message; error?: string }> {
    const trimmed = body.trim();
    if (!trimmed) return { error: "Empty message" };
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    const { data, error } = await supabase
      .from("messages")
      .insert({ sender_id: user.id, recipient_id: recipientId, body: trimmed })
      .select().single();

    // Best-effort push notification to the recipient. Don't fail the send
    // if the push call fails (network glitch, no token, etc).
    if (!error && data) {
      try {
        // Get sender's display name for the push title
        const { data: senderDrv } = await supabase
          .from("drivers").select("full_name").eq("id", user.id).maybeSingle();
        const senderName = senderDrv?.full_name || "LoadQ";
        await supabase.functions.invoke("send-push", {
          body: {
            recipient_id: recipientId,
            title:        senderName,
            body:         trimmed.length > 80 ? trimmed.slice(0, 77) + "…" : trimmed,
            data:         { kind: "message", sender_id: user.id },
          },
        });
      } catch { /* swallow */ }
    }

    return { data: data as Message | undefined, error: error?.message };
  },

  async markRead(otherId: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", user.id)
      .eq("sender_id", otherId)
      .is("read_at", null);
  },

  async unreadCount(): Promise<number> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;
    const { count } = await supabase
      .from("messages").select("id", { count: "exact", head: true })
      .eq("recipient_id", user.id).is("read_at", null);
    return count ?? 0;
  },

  // Unread count grouped by sender_id. Used by the queue page to show a per-
  // driver red dot badge over each card's chat icon.
  async unreadBySender(): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return out;
    const { data } = await supabase
      .from("messages").select("sender_id")
      .eq("recipient_id", user.id).is("read_at", null);
    for (const row of (data ?? []) as { sender_id: string }[]) {
      out.set(row.sender_id, (out.get(row.sender_id) ?? 0) + 1);
    }
    return out;
  },

  // Admin-only: every conversation the admin has had, newest first. The admin
  // is always one side of every message, so each "other_id" identifies the
  // user on the far end. We fetch all messages where admin is sender or
  // recipient, then collapse into per-user summaries client-side.
  async listConversationsForAdmin(): Promise<ConversationSummary[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data: msgs } = await supabase
      .from("messages")
      .select("id, sender_id, recipient_id, body, created_at, read_at")
      .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .order("created_at", { ascending: false });
    if (!msgs?.length) return [];

    const byOther = new Map<string, { last: Message; unread: number }>();
    for (const m of msgs as Message[]) {
      const otherId = m.sender_id === user.id ? m.recipient_id : m.sender_id;
      const slot = byOther.get(otherId);
      if (!slot) {
        byOther.set(otherId, {
          last: m,
          unread: m.recipient_id === user.id && !m.read_at ? 1 : 0,
        });
      } else {
        if (m.recipient_id === user.id && !m.read_at) slot.unread += 1;
      }
    }

    const otherIds = Array.from(byOther.keys());
    const [{ data: drivers }, { data: passengers }] = await Promise.all([
      supabase.from("drivers").select("id, full_name, avatar_url").in("id", otherIds),
      supabase.from("passengers").select("id, full_name, avatar_url").in("id", otherIds),
    ]);
    const driverMap    = new Map((drivers    ?? []).map((d: any) => [d.id, d]));
    const passengerMap = new Map((passengers ?? []).map((p: any) => [p.id, p]));

    const summaries: ConversationSummary[] = [];
    for (const [otherId, slot] of byOther) {
      const d = driverMap.get(otherId);
      const p = passengerMap.get(otherId);
      if (!d && !p) continue;
      summaries.push({
        other_id:     otherId,
        other_name:   (d?.full_name ?? p?.full_name ?? "Unknown") as string,
        other_avatar: (d?.avatar_url ?? p?.avatar_url ?? null) as string | null,
        other_role:   d ? "driver" : "passenger",
        last_body:    slot.last.body,
        last_at:      slot.last.created_at,
        unread:       slot.unread,
      });
    }
    summaries.sort((a, b) => a.last_at < b.last_at ? 1 : -1);
    return summaries;
  },

  subscribeToThread(otherId: string, callback: (m: Message) => void) {
    const channel = supabase
      .channel(`msg-${otherId}-${Date.now()}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new as Message;
          if (m.sender_id === otherId || m.recipient_id === otherId) callback(m);
        })
      .subscribe();
    return { unsubscribe: () => supabase.removeChannel(channel) };
  },
};
