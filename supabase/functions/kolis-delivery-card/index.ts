// kolis-delivery-card — ATTENDED delivery card. After a code-confirmed handoff
// (kolis-finalize-payment already marked the parcel delivered + captured), the
// courier photographs the handoff; this stores the photo and emails/SMSes the
// pink "Delivered" card to the recipient + sender (+ admin). Card-only: it does
// NOT re-deliver or re-capture. Bilingual (parcel locale → FR).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("KOLIS_FROM_EMAIL") || "Kolis <noreply@loadq.ca>";
const ADMIN_EMAIL = Deno.env.get("KOLIS_ADMIN_EMAIL") || "support@concordexpress.ca";
const TW_SID = Deno.env.get("KOLIS_TWILIO_SID"), TW_TOKEN = Deno.env.get("KOLIS_TWILIO_TOKEN"), TW_FROM = Deno.env.get("KOLIS_TWILIO_FROM");
const PINK = "#E6127A";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sms(to: string | null | undefined, body: string) {
  if (!TW_SID || !TW_TOKEN || !TW_FROM || !to) return;
  let n = String(to).replace(/[^\d+]/g, ""); if (!n.startsWith("+")) n = n.length === 10 ? "+1" + n : "+" + n;
  const f = new URLSearchParams({ To: n, Body: body }); TW_FROM.startsWith("MG") ? f.set("MessagingServiceSid", TW_FROM) : f.set("From", TW_FROM);
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString() }).catch(() => {});
}
async function email(to: string | null | undefined, subject: string, html: string) {
  if (!RESEND || !to) return;
  await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: FROM, to, subject, html }) }).catch(() => {});
}

function card(p: any, photo: string | null, courier: string, whenStr: string, fr: boolean): string {
  const L = fr ? {
    tag: "Livraison", title: "Livré<br>en mains propres.", intro: "Votre colis a été remis et le code de livraison a été confirmé. Merci d'avoir utilisé Kolis.",
    delivered: "Livré", courierL: "Coursier", proof: "Preuve de livraison",
  } : {
    tag: "Delivery", title: "Delivered<br>to you.", intro: "Your parcel was handed over and the delivery code was confirmed. Thanks for using Kolis.",
    delivered: "Delivered", courierL: "Courier", proof: "Proof of delivery",
  };
  const photoBlock = photo ? `
    <div style="font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:2px;color:#fff;font-size:13px;font-weight:800;margin-top:24px">${L.proof}</div>
    <img src="${photo}" width="100%" style="display:block;border-radius:12px;margin-top:10px;border:2px solid #0A0A0A"/>` : "";
  return `<div style="max-width:480px;margin:0 auto;background:${PINK};color:#fff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
   <div style="padding:26px 22px 30px">
    <div style="display:inline-block;background:#0A0A0A;color:#fff;font-weight:900;font-size:14px;letter-spacing:.5px;padding:8px 14px;border-radius:10px">KOLIS</div>
    <div style="font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,.9);font-size:11px;margin-top:22px">${L.tag} &middot; ${esc(p.code)}</div>
    <div style="color:#0A0A0A;font-size:42px;font-weight:900;line-height:1.03;margin-top:6px">${L.title}</div>
    <div style="color:#fff;font-size:16px;line-height:1.45;margin-top:12px">${L.intro}</div>
    <div style="background:#0A0A0A;border-radius:14px;padding:18px;margin-top:20px">
      <div style="font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:1.4px;color:#8A978F;font-size:11px;font-weight:700">${L.delivered} &middot; ${esc(whenStr)}</div>
      <div style="margin-top:7px"><span style="color:${PINK};font-weight:900;font-size:20px">${esc(p.code)}</span> <span style="color:#fff;font-weight:800;font-size:18px">${esc(p.from_city || "")} &rarr; ${esc(p.to_city || "")}</span></div>
      <div style="color:#fff;font-size:14px;margin-top:8px;line-height:1.4">${esc(p.dropoff_addr || p.to_city || "")}</div>
      <div style="color:#fff;font-size:14px;margin-top:4px">${L.courierL}: ${esc(courier)}</div>
    </div>${photoBlock}
   </div>
   <div style="height:5px;background:linear-gradient(90deg,#2EC5E6,#22C083,#F5C842,#FF8A3D,${PINK},#8B5CF6)"></div>
   <div style="background:#0A0A0A;padding:20px 22px 20px;text-align:center">
     <div style="color:#fff;font-weight:900;font-size:16px;letter-spacing:.3px">CONCORD EXPRESS CO INC.</div>
     <div style="color:#8A978F;font-size:12px;margin-top:4px">Ottawa, Ontario, Canada &middot; kolis.ca</div>
   </div>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const { parcel_id, photo_url } = await req.json();
    if (!parcel_id) return json({ error: "bad_request" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: p } = await admin.from("kolis_parcels")
      .select("id, code, driver_id, status, from_city, to_city, org_id, sender_id, recipient_name, recipient_phone, recipient_email, dropoff_addr, external_driver_name, delivery_proof")
      .eq("id", parcel_id).maybeSingle();
    if (!p) return json({ error: "not_found" }, 404);

    // Only the assigned courier may send the card.
    let ok = p.driver_id === user.id;
    if (!ok && p.driver_id) {
      const { data: kp } = await admin.from("kolis_profiles").select("id").eq("id", p.driver_id).eq("loadq_driver_id", user.id).maybeSingle();
      ok = !!kp;
    }
    if (!ok) return json({ error: "not_your_parcel" }, 403);

    // Courier display name
    let courier = p.external_driver_name || "Your courier";
    try { const { data: prof } = await admin.from("kolis_profiles").select("full_name").eq("id", p.driver_id).maybeSingle(); if (prof?.full_name) courier = prof.full_name; } catch { /* */ }
    try { const { data: dr } = await admin.from("drivers").select("full_name").eq("id", user.id).maybeSingle(); if (dr?.full_name) courier = dr.full_name; } catch { /* */ }

    // Store the handoff photo on the parcel (don't clobber an existing unattended proof).
    if (photo_url && (p.delivery_proof == null)) {
      await admin.from("kolis_parcels").update({
        delivery_proof: { handed: true, photo_url, courier, captured_at: new Date().toISOString() },
      }).eq("id", p.id);
    }

    // Language from the destination — Québec cities → FR.
    const QC = ["montr", "québec", "quebec", "gatineau", "laval", "sherbrooke", "trois-riv", "chicoutimi", "longueuil", "lévis", "levis"];
    const dc = String(p.to_city || "").toLowerCase();
    const fr = QC.some((c) => dc.includes(c));

    // Sender contact
    let senderEmail: string | null = null, senderPhone: string | null = null;
    if (p.org_id) { const { data: o } = await admin.from("kolis_orgs").select("billing_email").eq("id", p.org_id).maybeSingle(); senderEmail = o?.billing_email ?? null; }
    if (p.sender_id) { try { const { data: au } = await admin.auth.admin.getUserById(p.sender_id as string); senderEmail = senderEmail || au?.user?.email || null; senderPhone = au?.user?.phone ?? null; } catch { /* */ } }

    const whenStr = new Date().toLocaleString(fr ? "fr-CA" : "en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const html = card(p, photo_url || null, courier, whenStr, fr);
    const subject = fr ? `Kolis ${p.code} — livré` : `Kolis ${p.code} — delivered`;
    email(p.recipient_email as string, subject, html);
    email(senderEmail, subject, html);
    email(ADMIN_EMAIL, subject, html);

    const smsBody = fr ? `Kolis ${p.code} : livré et remis en mains propres. Merci !` : `Kolis ${p.code}: delivered & handed over. Thank you!`;
    sms(p.recipient_phone as string, smsBody);
    sms(senderPhone, smsBody);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
