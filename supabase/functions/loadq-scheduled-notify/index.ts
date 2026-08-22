// loadq-scheduled-notify — rider comms for a door-to-door scheduled trip.
// POST { request_id, event }  event ∈ paid|assigned|en_route|arrived|picked_up|completed
// SMS (Twilio) + push (Expo) on every event; branded email (Resend) on assigned + completed.
// Runs server-side so it fires even if the rider's app is closed. Gated by x-kolis-secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SECRET = "kolis_notify_9f3a2c7b1e6d4084";
const TW_SID = Deno.env.get("KOLIS_TWILIO_SID"), TW_TOKEN = Deno.env.get("KOLIS_TWILIO_TOKEN"), TW_FROM = Deno.env.get("KOLIS_TWILIO_FROM");
const RESEND = Deno.env.get("RESEND_API_KEY");
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const money = (c: number | null) => `$${(((c ?? 0)) / 100).toFixed(2)}`;
const cap = (s: string) => (s || "").replace(/^\w/, (c) => c.toUpperCase());

async function sms(to: string, body: string) {
  try {
    if (!TW_SID || !TW_TOKEN || !TW_FROM || !to) return;
    let n = String(to).replace(/[^\d+]/g, ""); if (!n.startsWith("+")) n = n.length === 10 ? "+1" + n : "+" + n;
    const f = new URLSearchParams({ To: n, Body: body }); TW_FROM.startsWith("MG") ? f.set("MessagingServiceSid", TW_FROM) : f.set("From", TW_FROM);
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString() }).catch(() => {});
  } catch { /* best-effort */ }
}
async function push(token: string | null, title: string, body: string) {
  try {
    if (!token) return;
    await fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ to: token, title, body, sound: "default", data: { route: "/(passenger)/my-trip" } }) }).catch(() => {});
  } catch { /* best-effort */ }
}
async function email(to: string, subject: string, html: string) {
  try {
    if (!RESEND || !to) return;
    await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "LoadQ <noreply@loadq.ca>", to, subject, html }) }).catch(() => {});
  } catch { /* best-effort */ }
}

function brandedEmail(title: string, intro: string, rows: [string, string][], cta = true): string {
  const trs = rows.map(([k, v]) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span style="color:#98A0AE">${k}</span><b style="color:#1C2130">${v}</b></div>`).join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #ECE5D9">
    <div style="background:#FF8A1A;padding:14px 16px"><span style="background:#20140A;color:#fff;font-weight:900;font-size:13px;padding:4px 9px;border-radius:6px">LoadQ</span></div>
    <div style="padding:18px 16px;color:#1C2130">
      <div style="font-size:18px;font-weight:900">${title}</div>
      <div style="font-size:13px;color:#5A6273;margin-top:8px;line-height:1.5">${intro}</div>
      <div style="background:#F5F0E7;border-radius:10px;padding:13px;margin-top:14px">${trs}</div>
      ${cta ? `<div style="background:#2F6FE0;color:#fff;text-align:center;font-weight:800;font-size:14px;padding:12px;border-radius:10px;margin-top:16px">Open LoadQ to track</div>` : ""}
      <div style="color:#98A0AE;font-size:10.5px;text-align:center;margin-top:14px;line-height:1.5">LoadQ — operated by Concord Express Co Inc. · Ottawa · loadq.ca</div>
    </div></div>`;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-kolis-secret") !== SECRET) return json({ error: "forbidden" }, 403);
  try {
    const { request_id, event } = await req.json().catch(() => ({}));
    if (!request_id || !event) return json({ error: "request_id and event required" }, 400);

    const { data: r } = await admin.from("loadq_ride_requests").select("*").eq("id", request_id).maybeSingle();
    if (!r) return json({ error: "not_found" }, 404);

    // rider contact
    const { data: p } = await admin.from("passengers").select("full_name, phone, push_token").eq("id", r.passenger_id).maybeSingle();
    let rEmail: string | null = null;
    try { const { data: u } = await admin.auth.admin.getUserById(r.passenger_id); rEmail = u?.user?.email ?? null; } catch { /* ignore */ }
    const phone = p?.phone ?? null;
    const first = (p?.full_name ?? "").split(" ")[0] || "there";

    // driver + vehicle (for assigned/completed)
    let drvName = "", car = "", plate = "";
    if (r.driver_id) {
      const { data: d } = await admin.from("drivers").select("full_name").eq("id", r.driver_id).maybeSingle();
      drvName = d?.full_name ?? "";
      const { data: v } = await admin.from("vehicles").select("make,model,color,plate").eq("driver_id", r.driver_id).order("is_active", { ascending: false }).limit(1).maybeSingle();
      if (v) { car = [v.color, v.make, v.model].filter(Boolean).join(" "); plate = v.plate ?? ""; }
    }
    const when = `${r.scheduled_date}${r.time_block ? " · " + r.time_block.replace("-", "–") + "h" : ""}`;

    const S: Record<string, string> = {
      paid:      `LoadQ: booking confirmed for ${when}. Ref ${r.pay_ref}. We'll text you when a driver is assigned.`,
      assigned:  `LoadQ: driver assigned — ${drvName}${car ? " (" + car + (plate ? " · " + plate : "") + ")" : ""}. Open LoadQ to track.`,
      en_route:  `LoadQ: ${drvName || "your driver"} is on the way to ${r.origin_address}. Open LoadQ to track live.`,
      arrived:   `LoadQ: your driver has arrived at ${r.origin_address}.`,
      picked_up: `LoadQ: you're on board — en route to ${r.dest_address}.`,
      completed: `LoadQ: trip complete. Thanks for riding! Total ${money(r.fare_cents)} paid by Interac.`,
    };
    const P: Record<string, [string, string]> = {
      paid:      ["Booking confirmed", "We'll notify you when a driver is assigned."],
      assigned:  ["Driver assigned", `${drvName}${car ? " · " + car : ""}`],
      en_route:  ["Your driver is on the way", "Tap to track live."],
      arrived:   ["Your driver has arrived", "Your driver is outside."],
      picked_up: ["You're on board", "En route to your drop-off."],
      completed: ["Trip complete", "Thanks for riding with LoadQ!"],
    };

    if (S[event]) await sms(phone!, S[event]);
    if (P[event] && p?.push_token) await push(p.push_token, P[event][0], P[event][1]);

    if (event === "assigned" && rEmail) {
      await email(rEmail, "Your LoadQ driver is assigned", brandedEmail(
        "Your driver is assigned 🚗", `Hi ${first} — your door-to-door trip is confirmed and your driver is set.`,
        [["Driver", drvName || "—"], ["Vehicle", (car || "—") + (plate ? " · " + plate : "")],
         ["Pickup", r.origin_address || "—"], ["Drop-off", r.dest_address || "—"],
         ["When", when], ["Total paid", money(r.fare_cents) + " (Interac)"]], true));
    }
    if (event === "completed" && rEmail) {
      await email(rEmail, `LoadQ receipt — ${r.pay_ref}`, brandedEmail(
        "Trip complete — thank you!", `Hi ${first} — here's your receipt.`,
        [["From", r.origin_address || "—"], ["To", r.dest_address || "—"],
         ["Date", r.scheduled_date || "—"], ["Driver", drvName || "—"],
         ["Total", money(r.fare_cents)], ["Paid by", "Interac"]], false));
    }

    return json({ ok: true, event, smsed: !!phone, emailed: (event === "assigned" || event === "completed") && !!rEmail });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
