// Foreground message events.
//
// Push notifications already cover the BACKGROUNDED-app case (Expo APNs/FCM).
// But when the user is actively in the app (queue page, my-loading, etc.) the
// OS suppresses the push banner / sound. This service fills that gap:
//
//   1. Subscribes to the messages table where recipient = signed-in user.
//   2. On an incoming insert, fires a local Notifications.schedule call
//      (sound:"default", trigger:null) so the system chime plays IMMEDIATELY
//      even while foregrounded.
//   3. Emits to in-app listeners so UI (queue cards) can flash + bump badges.
//
// Started once after sign-in (see app/_layout.tsx) and stopped on sign-out.

import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface IncomingMessage {
  id:           string;
  sender_id:    string;
  recipient_id: string;
  body:         string;
  created_at:   string;
}

type Listener = (m: IncomingMessage) => void;

let channel: RealtimeChannel | null = null;
let currentUserId: string | null = null;
const listeners = new Set<Listener>();

// Play the system chime via a zero-trigger local notification. We don't show
// a visible banner here — recipients are IN the app, the UI already gives
// them the flash + badge. Sound only.
async function playChime(senderName: string, body: string) {
  try {
    const Notifications = await import("expo-notifications");
    await Notifications.scheduleNotificationAsync({
      content: {
        title: senderName,
        body:  body.length > 80 ? body.slice(0, 77) + "…" : body,
        sound: "default",
      },
      trigger: null, // fire immediately
    });
  } catch {
    // Best-effort: if expo-notifications can't fire (perms revoked,
    // simulator without notifications), the UI flash still happens.
  }
}

async function lookupSenderName(senderId: string): Promise<string> {
  // Try drivers first, then passengers. One non-matching lookup is harmless.
  const [{ data: d }, { data: p }] = await Promise.all([
    supabase.from("drivers").select("full_name").eq("id", senderId).maybeSingle(),
    supabase.from("passengers").select("full_name").eq("id", senderId).maybeSingle(),
  ]);
  return (d?.full_name ?? p?.full_name ?? "LoadQ") as string;
}

export const MessageEvents = {
  // Begin listening for inbound messages for the currently signed-in user.
  // Idempotent — calling again with the same user is a no-op.
  async start() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (channel && currentUserId === user.id) return;
    if (channel) await this.stop();

    currentUserId = user.id;
    channel = supabase
      .channel(`msg-inbox-${user.id}`)
      .on(
        "postgres_changes",
        {
          event:  "INSERT",
          schema: "public",
          table:  "messages",
          filter: `recipient_id=eq.${user.id}`,
        },
        async (payload) => {
          const m = payload.new as IncomingMessage;
          // Don't chime / signal if the user is the sender (race: realtime
          // can echo your own insert). Defensive — filter above should
          // prevent it, but cheap to double-check.
          if (m.sender_id === user.id) return;
          const senderName = await lookupSenderName(m.sender_id);
          await playChime(senderName, m.body);
          for (const l of listeners) {
            try { l(m); } catch { /* one buggy listener shouldn't break others */ }
          }
        },
      )
      .subscribe();
  },

  async stop() {
    if (channel) {
      await supabase.removeChannel(channel);
      channel = null;
    }
    currentUserId = null;
    listeners.clear();
  },

  // Subscribe a UI component (queue card list, etc.) to inbound messages.
  // Returns an unsubscribe function — call it in cleanup.
  on(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
