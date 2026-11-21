// loadq-line-card — after the 07:00 raffle close, every driver who drew gets an MMS of
// the day's line with THEIR row highlighted (the card the MacBook used to send by hand).
//
// POST { round_id }                          → render one card per drawn driver, upload to
//                                              marketing/loadq/line-<round>-<driver>.png, MMS it.
//                                              Claims loadq_raffle_round.line_cards_at first, so a
//                                              round is never sent twice. Skips test-mode lots.
// POST { preview: true, round_id, driver_id } → render that driver's card only, upload as
//                                              line-preview.png, send nothing.
// Called by pg_cron loadq-line-card (07:01–07:30). Service-role Bearer only.
import React from "https://esm.sh/react@18.2.0";
import { ImageResponse } from "https://deno.land/x/og_edge@0.0.6/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const REF = "kzjptcpjpwlxfofzhyku";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
function role(req: Request): string | null {
  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  try { return JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role ?? null; } catch { return null; }
}

const NAVY = "#0A101C", CARD2 = "#17223A", INK = "#ECF2FA", MUT = "#96A4BA", SUB = "#6E7E96", LINE = "#283854",
      BRAND = "#FF8A1A", BLUE = "#3B82F6", GREEN = "#26C878", WHITE = "#FFFFFF";
const MF = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const DEST: Record<string, string> = { montreal: "Montréal", ottawa: "Ottawa", quebec: "Québec", toronto: "Toronto", gatineau: "Gatineau" };
const first = (n?: string | null) => (n ?? "").trim().split(/\s+/)[0] || "—";
const cap = (s?: string | null) => (s ?? "").trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

let fonts: any[] | null = null;
async function loadFonts() {
  if (fonts) return fonts;
  const get = (w: number) => fetch(`https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-${w}-normal.woff`).then((r) => r.arrayBuffer());
  const [a, b, c] = await Promise.all([get(400), get(700), get(900)]);
  fonts = [{ name: "Inter", data: a, weight: 400, style: "normal" }, { name: "Inter", data: b, weight: 700, style: "normal" },
           { name: "Inter", data: c, weight: 900, style: "normal" }];
  return fonts;
}

// Real LOADQ logo: all caps, Q orange, orange block rounded on the LEFT only.
const Logo = ({ size }: { size: number }) => (
  <div style={{ display: "flex", alignItems: "center" }}>
    <div style={{ display: "flex", fontSize: size, fontWeight: 700, letterSpacing: 0.5, color: WHITE }}>LOAD<span style={{ color: BRAND }}>Q</span></div>
    <div style={{ display: "flex", width: size * 0.52, height: size * 0.82, marginLeft: size * 0.3, backgroundColor: BRAND,
      borderTopLeftRadius: size * 0.11, borderBottomLeftRadius: size * 0.11 }} />
  </div>
);
const Arrow = () => (
  <svg width="18" height="12" viewBox="0 0 22 14" style={{ margin: "0 8px" }}>
    <path d="M1 7h18M13 1l6 6-6 6" stroke={MUT} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type Row = { pos: number; driver_id: string; name: string; car: string; seats: number; loading: boolean };

function Card({ rows, me, dateFr, lot, dest, height }: { rows: Row[]; me: string; dateFr: string; lot: string; dest: string; height: number }) {
  const seats = rows.reduce((s, r) => s + (r.seats || 0), 0);
  const loader = rows.find((r) => r.loading);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 750, height, backgroundColor: NAVY, fontFamily: "Inter", padding: "40px 34px 30px" }}>
      <Logo size={34} />
      <div style={{ display: "flex", fontSize: 19, fontWeight: 700, color: WHITE, marginTop: 14 }}>{`File du ${dateFr}`}</div>
      <div style={{ display: "flex", alignItems: "center", fontSize: 14, color: MUT, marginTop: 8 }}>{lot}<Arrow />{dest}</div>
      <div style={{ display: "flex", fontSize: 12.5, color: MUT, marginTop: 8 }}>{`${rows.length} voiture${rows.length > 1 ? "s" : ""} · ${seats} places`}</div>
      <div style={{ display: "flex", width: 124, height: 4, borderRadius: 2, backgroundColor: BRAND, marginTop: 14, marginBottom: 34 }} />
      {rows.map((r) => {
        const mine = r.driver_id === me;
        const boxBg = mine ? BLUE : r.loading ? BRAND : NAVY;
        return (
          <div key={r.driver_id} style={{ display: "flex", alignItems: "center", backgroundColor: CARD2, borderRadius: 10, marginBottom: 10,
            border: mine ? `2px solid ${BRAND}` : `1px solid ${LINE}`, padding: "13px 14px" }}>
            <div style={{ display: "flex", width: 40, height: 40, borderRadius: 7, backgroundColor: boxBg, border: `1px solid ${LINE}`,
              alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 900, color: WHITE }}>{String(r.pos)}</div>
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 16, flexGrow: 1 }}>
              <div style={{ display: "flex", fontSize: 18, fontWeight: 700, color: mine ? BRAND : WHITE }}>{mine ? `${r.name}  (VOUS)` : r.name}</div>
              <div style={{ display: "flex", fontSize: 13, color: MUT, marginTop: 5 }}>{`${r.car}  ·  ${r.seats} places`}</div>
            </div>
            {r.loading || mine ? (
              <div style={{ display: "flex", fontSize: 10.5, fontWeight: 800, color: BRAND, border: `1.5px solid ${BRAND}`, borderRadius: 999,
                padding: "6px 10px", backgroundColor: "rgba(255,138,26,0.10)" }}>{r.loading ? "EN CHARGEMENT" : "VOTRE VOITURE"}</div>
            ) : null}
          </div>
        );
      })}
      {loader ? <div style={{ display: "flex", fontSize: 13.5, fontWeight: 700, color: GREEN, marginTop: 14 }}>{`Chargement en cours : ${loader.name}`}</div> : null}
      <div style={{ display: "flex", fontSize: 11, color: SUB, marginTop: 8 }}>{`LOADQ · Concord Express Co Inc. · covoiturage ${lot} - ${dest}`}</div>
    </div>
  );
}

async function render(rows: Row[], me: string, dateFr: string, lot: string, dest: string) {
  const height = 290 + rows.length * 77;
  const img = new ImageResponse(<Card rows={rows} me={me} dateFr={dateFr} lot={lot} dest={dest} height={height} />, { width: 750, height, fonts: await loadFonts() });
  return new Uint8Array(await img.arrayBuffer());
}
async function upload(name: string, png: Uint8Array) {
  const { error } = await admin.storage.from("marketing").upload(`loadq/${name}`, png, { contentType: "image/png", upsert: true, cacheControl: "60" });
  if (error) throw new Error(error.message);
  return `https://${REF}.supabase.co/storage/v1/object/public/marketing/loadq/${name}`;
}
async function mms(phone: string, body: string, media: string) {
  const SID = Deno.env.get("KOLIS_TWILIO_SID"), TOKEN = Deno.env.get("KOLIS_TWILIO_TOKEN"), FROM = Deno.env.get("KOLIS_TWILIO_FROM");
  if (!SID || !TOKEN || !FROM) return false;
  let to = phone.replace(/[^\d+]/g, ""); if (!to.startsWith("+")) to = to.length === 10 ? "+1" + to : "+" + to;
  const f = new URLSearchParams({ To: to, Body: body });
  FROM.startsWith("MG") ? f.set("MessagingServiceSid", FROM) : f.set("From", FROM);
  f.append("MediaUrl", media);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: "POST", headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString() });
  if (!r.ok) console.error("[line-card] mms", to.slice(-4), r.status, (await r.text()).slice(0, 200));
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (role(req) !== "service_role") return json({ error: "unauthorized" }, 401);
  const b = await req.json().catch(() => ({}));
  if (!b.round_id) return json({ error: "round_id required" }, 400);
  try {
    const { data: r } = await admin.from("loadq_raffle_round").select("id, zone_id, service_date, destination_region, status").eq("id", b.round_id).maybeSingle();
    if (!r) return json({ error: "no_round" }, 404);
    const { data: c } = await admin.from("loadq_raffle_config").select("test_mode").eq("zone_id", r.zone_id).maybeSingle();
    const { data: z } = await admin.from("zones").select("name").eq("id", r.zone_id).maybeSingle();
    const lot = (z?.name ?? r.zone_id).split(" - ")[0].trim();
    const dest = DEST[r.destination_region ?? ""] ?? (r.destination_region ?? "");
    const d = new Date(r.service_date + "T12:00:00Z");
    const dateFr = `${d.getUTCDate()} ${MF[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

    // The line as it stands (raffle numbers = positions; #1 loading from 07:00).
    const { data: q } = await admin.from("queue_entries")
      .select("position, status, driver_id, drivers(full_name), vehicles(color, make, model, seats)")
      .eq("zone_id", r.zone_id).eq("destination_region", r.destination_region)
      .in("status", ["loading", "waiting", "standby", "paused"]).order("position", { ascending: true });
    const rows: Row[] = (q ?? []).map((e: any) => ({
      pos: e.position, driver_id: e.driver_id, name: first(e.drivers?.full_name),
      car: [cap(e.vehicles?.color), cap(e.vehicles?.make), e.vehicles?.model].filter(Boolean).join(" "),
      seats: e.vehicles?.seats ?? 0, loading: e.status === "loading" }));

    if (b.preview) {
      const url = await upload("line-preview.png", await render(rows, b.driver_id ?? "", dateFr, lot, dest));
      return json({ ok: true, preview: url, rows: rows.length });
    }
    if (c?.test_mode) return json({ ok: true, skipped: "test_mode" });
    if (r.status !== "drawn") return json({ ok: true, skipped: "not_closed" });

    // Claim the round so a retry never double-sends.
    const { data: claimed } = await admin.from("loadq_raffle_round").update({ line_cards_at: new Date().toISOString() })
      .eq("id", r.id).is("line_cards_at", null).select("id");
    if (!claimed?.length) return json({ ok: true, skipped: "already_sent" });

    const { data: drawn } = await admin.from("loadq_raffle_entry")
      .select("driver_id, assigned_number, drivers(phone)").eq("round_id", r.id).not("assigned_number", "is", null);
    let sent = 0;
    for (const e of (drawn ?? []) as any[]) {
      const phone = e.drivers?.phone; if (!phone) continue;
      const url = await upload(`line-${r.id}-${e.driver_id}.png`, await render(rows, e.driver_id, dateFr, lot, dest));
      // Same wording as the MacBook's loadq_send_line_mms.py (approved), legal name in the sign-off.
      const fn = rows.find((x) => x.driver_id === e.driver_id)?.name ?? "";
      const body = `LoadQ - File du ${dateFr}. Bonjour ${fn}, voici votre position d'aujourd'hui ` +
        `dans la file (${lot} -> ${dest}). Votre voiture est surlignee en orange. Bon voyage ! - Concord Express Co Inc.`;
      if (await mms(phone, body, url)) sent++;
    }
    return json({ ok: true, round_id: r.id, rows: rows.length, recipients: (drawn ?? []).length, sent });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
