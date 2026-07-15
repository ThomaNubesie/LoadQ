// One-off: notify every active driver in a zone's queue with their position,
// destination, and when the list went live. Push (Expo) + SMS (Twilio).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TW_SID = Deno.env.get("KOLIS_TWILIO_SID");
const TW_TOKEN = Deno.env.get("KOLIS_TWILIO_TOKEN");
const TW_FROM = Deno.env.get("KOLIS_TWILIO_FROM");
const SECRET = "loadq_queue_notify_7c2f";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const REGION: Record<string, string> = { montreal: "Montréal", toronto: "Toronto", quebec: "Québec", ottawa: "Ottawa", gatineau: "Gatineau" };

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-secret") !== SECRET) return json({ error: "forbidden" }, 403);
    const { zone_id, went_live, only_driver_id } = await req.json();
    const admin = createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: zone } = await admin.from("zones").select("name").eq("id", zone_id).maybeSingle();
    const zoneName = (zone as { name?: string } | null)?.name ?? "your zone";
    let query = admin.from("queue_entries")
      .select("position, destination_region, driver:drivers(full_name, push_token, phone)")
      .eq("zone_id", zone_id).neq("status", "ended");
    if (only_driver_id) query = query.eq("driver_id", only_driver_id);
    const { data: rows } = await query.order("position");

    const pushMsgs: Record<string, unknown>[] = [];
    let pushed = 0, texted = 0, skipped = 0;
    for (const r of (rows ?? []) as any[]) {
      const d = r.driver; if (!d) { skipped++; continue; }
      const dest = REGION[r.destination_region] ?? r.destination_region ?? "";
      const en = `You're in today's LoadQ queue at ${zoneName} — position ${r.position}, heading to ${dest}. List went live ${went_live}.`;
      const fr = `Vous êtes dans la file LoadQ à ${zoneName} — position ${r.position}, vers ${dest}. Liste publiée ${went_live}.`;
      const body = `🇬🇧 ${en}\n\n🇫🇷 ${fr}`;
      if (d.push_token) { pushMsgs.push({ to: d.push_token, title: "LoadQ", body, sound: "default", data: { route: "/(app)/queue" } }); pushed++; }
      if (d.phone && TW_SID && TW_TOKEN && TW_FROM) {
        let to = String(d.phone).replace(/[^\d+]/g, ""); if (!to.startsWith("+")) to = to.length === 10 ? "+1" + to : "+" + to;
        const p = new URLSearchParams({ To: to, Body: body });
        if (TW_FROM.startsWith("MG")) p.set("MessagingServiceSid", TW_FROM); else p.set("From", TW_FROM);
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
          method: "POST", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: p.toString(),
        });
        if (res.ok) texted++;
      }
      if (!d.push_token && !d.phone) skipped++;
    }
    for (let i = 0; i < pushMsgs.length; i += 100) {
      await fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(pushMsgs.slice(i, i + 100)) });
    }
    return json({ ok: true, total: (rows ?? []).length, pushed, texted, skipped });
  } catch (e) { return json({ error: String((e as Error)?.message ?? e) }, 500); }
});
