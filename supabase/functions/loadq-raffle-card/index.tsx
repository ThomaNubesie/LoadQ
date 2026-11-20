// loadq-raffle-card — draws the morning raffle's "code du jour" picture for a round
// and saves it to marketing/loadq/raffle-<round_id>.png, the URL the 06:01 MMS
// (pg_cron loadq-raffle-code-mms) attaches. Replaces the weekly MacBook script
// (~/loadq_raffle_prep.py + loadq_raffle_code_card.py variant 4): the minute job
// loadq-raffle-card calls this as soon as the day's round exists (05:00) and keeps
// retrying until loadq_raffle_round.card_at is set.
//
// POST { round_id }            → renders + uploads, stamps card_at
// POST { preview: true, code, date } → renders a sample to raffle-preview.png
// Service-role Bearer only (the round uuid in the file name is what keeps the code
// private — the bucket is public).
import React from "https://esm.sh/react@18.2.0";
import { ImageResponse } from "https://deno.land/x/og_edge@0.0.6/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function role(req: Request): string | null {
  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  try { return JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role ?? null; }
  catch { return null; }
}

// Colours match the approved card (variant 4) — brand orange per components/Wordmark.tsx.
const NAVY = "#0A101C", CARD = "#121C2E", CARD2 = "#17223A", INK = "#ECF2FA", MUT = "#96A4BA",
      SUB = "#6E7E96", LINE = "#283854", BRAND = "#FF8A1A", GREEN = "#26C878", WHITE = "#FFFFFF";
const JF = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MF = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JE = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ME = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function dates(iso: string) {
  const d = new Date(iso + "T12:00:00Z"); const w = d.getUTCDay(), n = d.getUTCDate(), m = d.getUTCMonth(), y = d.getUTCFullYear();
  const fr = JF[w]; return { fr: `${fr[0].toUpperCase()}${fr.slice(1)} ${n} ${MF[m]} ${y}`, en: `${JE[w]} ${n} ${ME[m]} ${y}` };
}
const hm = (ts: string | null, tz: string) => ts
  ? new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts)) : "";
const minus1 = (t: string) => { const [h, m] = t.split(":").map(Number); const x = h * 60 + m - 1; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };

let fonts: { name: string; data: ArrayBuffer; weight: 400 | 700 | 900; style: "normal" }[] | null = null;
async function loadFonts() {
  if (fonts) return fonts;
  const get = (w: number) => fetch(`https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-${w}-normal.woff`).then((r) => r.arrayBuffer());
  const [a, b, c] = await Promise.all([get(400), get(700), get(900)]);
  fonts = [{ name: "Inter", data: a, weight: 400, style: "normal" }, { name: "Inter", data: b, weight: 700, style: "normal" },
           { name: "Inter", data: c, weight: 900, style: "normal" }];
  return fonts;
}

// The real LOADQ logo: all-caps, Q orange, then an orange block rounded on the LEFT only.
function Logo({ size }: { size: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <div style={{ display: "flex", fontSize: size, fontWeight: 700, letterSpacing: 0.5, color: WHITE }}>
        LOAD<span style={{ color: BRAND }}>Q</span>
      </div>
      <div style={{ display: "flex", width: size * 0.52, height: size * 0.82, marginLeft: size * 0.3, backgroundColor: BRAND,
        borderTopLeftRadius: size * 0.11, borderBottomLeftRadius: size * 0.11 }} />
    </div>
  );
}

// Drawn, not typed: the Inter latin subset has no "→", and a missing glyph makes the
// renderer fetch a fallback font (which fails).
const Arrow = () => (
  <svg width="22" height="14" viewBox="0 0 22 14" style={{ margin: "0 10px" }}>
    <path d="M1 7h18M13 1l6 6-6 6" stroke={INK} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
// Lot → destination, per round (every active lot has its own raffle).
const DEST: Record<string, string> = { montreal: "Montréal", ottawa: "Ottawa", quebec: "Québec", toronto: "Toronto", gatineau: "Gatineau" };
const shortLot = (name: string) => name.split(" - ")[0].trim();
const Route = ({ lot, dest }: { lot: string; dest: string }) =>
  <div style={{ display: "flex", alignItems: "center" }}>{lot}<Arrow />{dest}</div>;

function Row({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: sub ? "flex-start" : "center",
      backgroundColor: CARD2, border: `1px solid ${LINE}`, borderRadius: 14, padding: sub ? "22px 24px" : "0 24px",
      height: sub ? 96 : 78, marginBottom: 14 }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 17, color: MUT }}>{k}</div>
        {sub ? <div style={{ display: "flex", fontSize: 13, color: SUB, marginTop: 10 }}>{sub}</div> : null}
      </div>
      <div style={{ display: "flex", fontSize: 17, fontWeight: 700, color: INK }}>{v}</div>
    </div>
  );
}

function Card({ code, iso, t, lot, dest }: { code: string; iso: string; t: { open: string; closeLast: string; draw: string; end: string }; lot: string; dest: string }) {
  const d = dates(iso);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 900, height: 1120, backgroundColor: NAVY, fontFamily: "Inter" }}>
      <div style={{ display: "flex", justifyContent: "space-between", height: 200, backgroundColor: CARD, borderBottom: `6px solid ${BRAND}`, padding: "40px 56px 0 56px" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Logo size={38} />
          <div style={{ display: "flex", fontSize: 19, fontWeight: 700, color: INK, marginTop: 20 }}>TIRAGE DU MATIN</div>
          <div style={{ display: "flex", fontSize: 19, fontWeight: 700, color: MUT, marginTop: 8 }}>MORNING RAFFLE</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: 64 }}>
          <div style={{ display: "flex", fontSize: 17, fontWeight: 700, color: INK }}>{d.fr}</div>
          <div style={{ display: "flex", fontSize: 16, color: MUT, marginTop: 12 }}>{d.en}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 44 }}>
        <div style={{ display: "flex", fontSize: 18, fontWeight: 700, color: BRAND }}>CODE DU JOUR  ·  CODE OF THE DAY</div>
        <div style={{ display: "flex", fontSize: 150, fontWeight: 900, color: WHITE, marginTop: 6, letterSpacing: 2 }}>{code}</div>
        <div style={{ display: "flex", width: 120, height: 6, borderRadius: 3, backgroundColor: BRAND, marginTop: 4 }} />
        <div style={{ display: "flex", fontSize: 18, fontWeight: 700, color: GREEN, marginTop: 34 }}>{`Code pour le tirage, de ${t.draw} à ${t.end}`}</div>
        <div style={{ display: "flex", fontSize: 17, color: MUT, marginTop: 10 }}>{`Code for the draw, ${t.draw} to ${t.end}`}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "0 56px", marginTop: 46 }}>
        <Row k="File  ·  Line" v={<Route lot={lot} dest={dest} />} />
        <Row k="Inscription  ·  Check-in" v={`${t.open} – ${t.closeLast}`} sub="sur place, sans code / at the lot, no code" />
        <Row k="Tirage  ·  Draw" v={`${t.draw} – ${t.end}`} sub="avec ce code / with this code" />
        <Row k="Résultat  ·  Result" v={t.end} sub="ordre de départ / departure order" />
      </div>
      <div style={{ display: "flex", fontSize: 13, color: SUB, padding: "0 56px", marginTop: 4 }}>LOADQ · Concord Express Co Inc.</div>
    </div>
  );
}

async function render(code: string, iso: string, t: { open: string; closeLast: string; draw: string; end: string }, lot = "Universal Grocery", dest = "Montréal") {
  const img = new ImageResponse(<Card code={code} iso={iso} t={t} lot={lot} dest={dest} />, { width: 900, height: 1120, fonts: await loadFonts() });
  return new Uint8Array(await img.arrayBuffer());
}

async function upload(name: string, png: Uint8Array) {
  const { error } = await admin.storage.from("marketing").upload(`loadq/${name}`, png,
    { contentType: "image/png", upsert: true, cacheControl: "60" });
  if (error) throw new Error(error.message);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (role(req) !== "service_role") return json({ error: "unauthorized" }, 401);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.preview) {
      const png = await render(String(b.code ?? "1234"), String(b.date ?? "2026-11-24"),
        { open: "05:00", closeLast: "06:01", draw: "06:02", end: "07:00" });
      await upload("raffle-preview.png", png);
      return json({ ok: true, preview: true });
    }
    if (!b.round_id) return json({ error: "round_id required" }, 400);
    const { data: r } = await admin.from("loadq_raffle_round")
      .select("id, zone_id, service_date, code, destination_region, checkin_opens_at, checkin_closes_at, draw_opens_at, draw_at").eq("id", b.round_id).maybeSingle();
    if (!r || !r.code) return json({ error: "round not found or no code" }, 404);
    const { data: c } = await admin.from("loadq_raffle_config").select("timezone").eq("zone_id", r.zone_id).maybeSingle();
    const tz = c?.timezone ?? "America/Toronto";
    const { data: z } = await admin.from("zones").select("name").eq("id", r.zone_id).maybeSingle();
    const lot = shortLot(z?.name ?? r.zone_id);
    const dest = DEST[r.destination_region ?? ""] ?? (r.destination_region ?? "");
    const closes = hm(r.checkin_closes_at, tz);
    const png = await render(r.code, r.service_date, {
      open: hm(r.checkin_opens_at, tz), closeLast: closes ? minus1(closes) : "",
      draw: hm(r.draw_opens_at, tz), end: hm(r.draw_at, tz) }, lot, dest);
    await upload(`raffle-${r.id}.png`, png);
    await admin.from("loadq_raffle_round").update({ card_at: new Date().toISOString() }).eq("id", r.id);
    return json({ ok: true, round_id: r.id });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
