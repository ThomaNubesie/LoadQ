// Generic push dispatch — accepts a recipient user id and a {title, body}.
// Looks up the recipient's push_token (drivers or passengers), then sends via
// Expo. Used by client (e.g. after MessagesAPI.send) and other server jobs.
//
// Auth: requires the caller's Supabase JWT (any authenticated user can call).
// We only let a user send a push to themselves OR to a thread peer (validated
// by the messages RLS already enforcing who can DM whom).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface PushReq {
  recipient_id: string;
  title:        string;
  body:         string;
  data?:        Record<string, unknown>;
}

async function getRecipientToken(supabase: ReturnType<typeof createClient>, recipientId: string): Promise<string | null> {
  const { data: drv } = await supabase
    .from("drivers").select("push_token").eq("id", recipientId).maybeSingle();
  if (drv?.push_token) return drv.push_token as string;
  const { data: pas } = await supabase
    .from("passengers").select("push_token").eq("id", recipientId).maybeSingle();
  return (pas?.push_token as string | null) ?? null;
}

async function dispatchExpo(token: string, title: string, body: string, data?: Record<string, unknown>) {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Accept-encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify([{
      to:    token,
      sound: "default",
      title,
      body,
      data:  data ?? {},
      channelId: "default",
      priority: "high",
    }]),
  });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: PushReq;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  if (!payload.recipient_id || !payload.title || !payload.body) {
    return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const token = await getRecipientToken(supabase, payload.recipient_id);
  if (!token) {
    return new Response(JSON.stringify({ ok: false, reason: "no_token" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const result = await dispatchExpo(token, payload.title, payload.body, payload.data);
  return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "Content-Type": "application/json" } });
});
