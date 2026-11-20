// loadq-sms-status — delivery status of Twilio messages sent by loadq-send-sms.
// POST { sids: ["MM…", "SM…"] } -> [{ sid, to, status, error_code, error_message }]
// Service-role Bearer only (verify_jwt + role check). Read-only.
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
function role(req: Request): string | null {
  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  try { return JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role ?? null; } catch { return null; }
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (role(req) !== "service_role") return json({ error: "unauthorized" }, 401);
  const SID = Deno.env.get("KOLIS_TWILIO_SID"), TOKEN = Deno.env.get("KOLIS_TWILIO_TOKEN");
  if (!SID || !TOKEN) return json({ error: "twilio_not_configured" }, 500);
  const { sids } = await req.json().catch(() => ({}));
  if (!Array.isArray(sids)) return json({ error: "sids[] required" }, 400);
  const out = await Promise.all(sids.slice(0, 50).map(async (m: string) => {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages/${encodeURIComponent(m)}.json`,
      { headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`) } });
    const j = await r.json().catch(() => ({}));
    return { sid: m, to: j.to, status: j.status, error_code: j.error_code, error_message: j.error_message, num_media: j.num_media };
  }));
  return json(out);
});
