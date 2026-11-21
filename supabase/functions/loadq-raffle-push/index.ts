// loadq-raffle-push — the two morning nudges for the UG raffle.
//
//   POST { phase: "open" }      at 05:00 — check-in is open, be at the lot
//   POST { phase: "reminder" }  at 05:45 — only to drivers who have NOT checked in yet
//
// Each phase goes out twice: an app notification (drivers with a push token) and a
// TEXT with a link, https://loadq.ca/tirage, that opens LoadQ on the raffle (or the
// store if LoadQ is missing/out of date). Texts go only to drivers active in the last
// 4 months (loadq_raffle_sms_targets), per Thomas 2026-11-21.
//
// Called by pg_cron with the vault's edge_service_key. send-push is no use here: it
// takes one recipient and a user JWT, and only lets a user push to themselves or a
// thread peer. This reads the eligible drivers itself and hands Expo one batch.
//
// It nudges — it proves nothing. Presence is still the geofence at check-in and again
// at the draw (with the code). A driver with notifications off simply gets no reminder.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZONE = "ottawa-universal-grocery";
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// Twilio, same sender as the 06:01 code texts (KOLIS_TWILIO_*). Ten at a time.
async function smsSend(phones: string[], body: string) {
  const SID = Deno.env.get("KOLIS_TWILIO_SID"), TOKEN = Deno.env.get("KOLIS_TWILIO_TOKEN"), FROM = Deno.env.get("KOLIS_TWILIO_FROM");
  if (!SID || !TOKEN || !FROM) { console.error("[raffle-push] twilio not configured"); return 0; }
  let sent = 0;
  const one = async (raw: string) => {
    let to = raw.replace(/[^\d+]/g, "");
    if (!to.startsWith("+")) to = to.length === 10 ? "+1" + to : "+" + to;
    const f = new URLSearchParams({ To: to, Body: body });
    FROM.startsWith("MG") ? f.set("MessagingServiceSid", FROM) : f.set("From", FROM);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
      body: f.toString(),
    });
    if (r.ok) sent++; else console.error("[raffle-push] sms", to.slice(-4), r.status, (await r.text()).slice(0, 200));
  };
  for (let i = 0; i < phones.length; i += 10) await Promise.all(phones.slice(i, i + 10).map(one));
  return sent;
}

async function expoSend(messages: unknown[]) {
  let sent = 0;
  // Expo takes up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const r = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(chunk),
    });
    if (r.ok) sent += chunk.length;
    else console.error("[raffle-push] expo", r.status, (await r.text()).slice(0, 300));
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { phase } = await req.json().catch(() => ({}));
  if (phase !== "open" && phase !== "reminder") return json({ error: "phase must be open|reminder" }, 400);

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // Nothing to announce if the raffle is off, or if today's round does not exist.
  const { data: cfg } = await admin.from("loadq_raffle_config")
    .select("enabled, test_mode, allowed_driver_ids, checkin_opens_local, checkin_closes_local, draw_opens_local, draw_at_local, timezone")
    .eq("zone_id", ZONE).maybeSingle();
  if (!cfg?.enabled) return json({ ok: true, skipped: "raffle_disabled" });

  const today = new Date().toLocaleDateString("en-CA", { timeZone: cfg.timezone || "America/Toronto" });
  const { data: round } = await admin.from("loadq_raffle_round")
    .select("id, status").eq("zone_id", ZONE).eq("service_date", today).maybeSingle();
  if (!round || round.status !== "open") return json({ ok: true, skipped: "no_open_round" });

  // Everyone who could actually raffle today.
  const { data: drivers } = await admin.from("drivers")
    .select("id, push_token, locale").not("push_token", "is", null).eq("verified", true).eq("blocked", false);
  let targets = drivers ?? [];
  // Test mode: only the allow-listed drivers can check in, so only they are nudged —
  // otherwise ~100 drivers would tap through to "not eligible".
  if (cfg.test_mode) {
    const allowed = new Set<string>(cfg.allowed_driver_ids ?? []);
    targets = targets.filter((d: any) => allowed.has(d.id));
  }

  // Anyone already checked in at ANY lot today is skipped by the 05:45 reminder.
  let inAlready = new Set<string>();
  if (phase === "reminder") {
    const { data: rounds } = await admin.from("loadq_raffle_round").select("id").eq("service_date", today);
    const { data: already } = await admin.from("loadq_raffle_entry").select("driver_id")
      .in("round_id", (rounds ?? []).map((r: any) => r.id));
    inAlready = new Set((already ?? []).map((e: any) => e.driver_id));
    targets = targets.filter((d: any) => !inAlready.has(d.id));
  }

  const hhmm = (t: string | null) => (t ?? "").slice(0, 5);
  // Check-in closes at 06:02:00, so the last minute a driver can tap is 06:01.
  const lastMinute = (t: string | null) => {
    const [h, m] = hhmm(t).split(":").map(Number); const x = h * 60 + m - 1;
    return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  };
  const close = lastMinute(cfg.checkin_closes_local), dOpen = hhmm(cfg.draw_opens_local), dEnd = hhmm(cfg.draw_at_local);
  // Check-in takes no code — only the draw does.
  const copy = phase === "open"
    ? { title: "LoadQ — tirage du matin",
        body: `Inscription ouverte jusqu'à ${close} : touchez « Je suis au point de départ » au stationnement. Tirage avec le code ${dOpen}–${dEnd}. / Check-in is open until ${close} — tap "I'm at the lot" when you're there. Draw with the code ${dOpen}–${dEnd}.` }
    : { title: "LoadQ — plus que 15 minutes",
        body: `L'inscription ferme à ${close}. Touchez « Je suis au point de départ » pour participer au tirage. / Check-in closes at ${close} — tap "I'm at the lot" to be in the draw.` };

  // Test mode: say so up front — the posted list still decides the real line.
  if (cfg.test_mode) {
    copy.title += " (TEST)";
    copy.body = `TEST — la vraie file reste la liste affichée. ${copy.body} / TEST — the real line is still the posted list.`;
  }

  const sent = targets.length ? await expoSend(targets.map((d: any) => ({
    to: d.push_token, sound: "default", title: copy.title, body: copy.body,
    data: { screen: "raffle", phase },
  }))) : 0;

  // The text: short, GSM-safe (no em dashes), with the link that opens the app.
  const pre = cfg.test_mode ? "TEST - " : "";
  const link = "https://loadq.ca/tirage";
  const sms = phase === "open"
    ? `${pre}LoadQ : tirage du matin. Inscription au stationnement jusqu'à ${close}, tirage avec le code ${dOpen}-${dEnd}. Ouvrir : ${link} / Morning raffle: check in at the lot until ${close}, draw with the code ${dOpen}-${dEnd}. Open: ${link}`
    : `${pre}LoadQ : l'inscription ferme à ${close}. Ouvrir : ${link} / Check-in closes at ${close}. Open: ${link}`;
  const { data: smsTargets } = await admin.rpc("loadq_raffle_sms_targets",
    { p_test: !!cfg.test_mode, p_allowed: cfg.allowed_driver_ids ?? [], p_exclude: [...inAlready] });
  const phones = [...new Set(((smsTargets ?? []) as { phone: string }[]).map((t) => t.phone))];
  const texted = phones.length ? await smsSend(phones, sms) : 0;

  return json({ ok: true, phase, targeted: targets.length, sent, sms_targeted: phones.length, texted });
});
