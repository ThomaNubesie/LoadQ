// loadq-raffle-push — the two morning nudges for the UG raffle.
//
//   POST { phase: "open" }      at 05:00 — check-in is open, be at the lot
//   POST { phase: "reminder" }  at 05:45 — only to drivers who have NOT checked in yet
//
// Called by pg_cron with the vault's edge_service_key. send-push is no use here: it
// takes one recipient and a user JWT, and only lets a user push to themselves or a
// thread peer. This reads the eligible drivers itself and hands Expo one batch.
//
// It nudges — it proves nothing. Presence is still the geofence plus the code typed
// at the lot. A driver with notifications off simply gets no reminder.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZONE = "ottawa-universal-grocery";
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

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
    .select("enabled, checkin_opens_local, checkin_closes_local, draw_opens_local, draw_at_local, timezone")
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

  if (phase === "reminder") {
    const { data: already } = await admin.from("loadq_raffle_entry").select("driver_id").eq("round_id", round.id);
    const inAlready = new Set((already ?? []).map((e: any) => e.driver_id));
    targets = targets.filter((d: any) => !inAlready.has(d.id));
  }
  if (!targets.length) return json({ ok: true, sent: 0, phase });

  const hhmm = (t: string | null) => (t ?? "").slice(0, 5);
  const copy = phase === "open"
    ? { title: "LoadQ — tirage du matin",
        body: `Enregistrement ouvert jusqu'à ${hhmm(cfg.checkin_closes_local)} : soyez au stationnement et entrez le code. Tirage ${hhmm(cfg.draw_opens_local)}–${hhmm(cfg.draw_at_local)}. / Check-in is open — be at the lot and enter the code.` }
    : { title: "LoadQ — il reste quelques minutes",
        body: `L'enregistrement ferme à ${hhmm(cfg.checkin_closes_local)}. Entrez le code au stationnement pour participer au tirage. / Check-in closes soon — enter the code at the lot to be in the draw.` };

  const sent = await expoSend(targets.map((d: any) => ({
    to: d.push_token, sound: "default", title: copy.title, body: copy.body,
    data: { screen: "raffle", phase },
  })));

  return json({ ok: true, phase, targeted: targets.length, sent });
});
