// Blocked accounts.
//
// The wall the app puts up is the polite half of this; the database refuses a blocked driver
// a place in any line regardless of what the app shows (see queue_entries_require_eligible).
// This exists so a blocked person is told, clearly and in both languages, rather than tapping
// a button that quietly fails.
//
// Two kinds, and the difference matters:
//   · 'conduct'        — a safety block. The screen offers no way to make contact. Handing
//                        someone who threatened you a sanctioned route back is not a kindness.
//   · 'administrative' — documents, payment, anything fixable. Same wall, but a way through it.
//
// Fail-safe is OPEN: a network error leaves the driver unblocked. Locking someone out of their
// livelihood because the request timed out on a parking lot is the worse failure of the two,
// and the database is the thing actually holding the door.
import { supabase } from "./supabase";

export type Block = {
  blocked: boolean;
  kind?: "conduct" | "administrative";
  since?: string | null;
  reference?: string;
};

export const NOT_BLOCKED: Block = { blocked: false };

export const BlockAPI = {
  async check(): Promise<Block> {
    try {
      const { data, error } = await supabase.rpc("loadq_my_block");
      if (error || !data) return NOT_BLOCKED;
      return data as Block;
    } catch { return NOT_BLOCKED; }
  },

  // Realtime watch on this driver's own row, so a block applied mid-shift takes effect while
  // the app is open rather than at the next cold start. Returns an unsubscribe fn.
  subscribe(userId: string, onChange: () => void): () => void {
    let cancelled = false;
    const ch = supabase
      .channel(`block:${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "drivers", filter: `id=eq.${userId}` },
        () => { if (!cancelled) onChange(); },
      )
      .subscribe();
    return () => { cancelled = true; try { supabase.removeChannel(ch); } catch { /* noop */ } };
  },
};
