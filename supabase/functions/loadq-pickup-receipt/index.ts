// loadq-pickup-receipt — deliver the LoadQ-branded pickup receipt by email
// (Resend) or SMS (Twilio). LoadQ wordmark, NOT Concord letterhead. Only sends
// for a PAID request. HST/GST # + sender come from loadq_settings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const RESEND = Deno.env.get("RESEND_API_KEY");
const TW_SID = Deno.env.get("KOLIS_TWILIO_SID"), TW_TOKEN = Deno.env.get("KOLIS_TWILIO_TOKEN"), TW_FROM = Deno.env.get("KOLIS_TWILIO_FROM");
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (c: number | null) => `$${(((c ?? 0)) / 100).toFixed(2)}`;
const QC = ["montr", "québec", "quebec", "gatineau", "laval", "longueuil", "qc"];
const cap = (s: string) => (s || "").replace(/^\w/, (c) => c.toUpperCase());

async function setting(key: string, dflt: string) {
  const { data } = await admin.from("loadq_settings").select("value").eq("key", key).maybeSingle();
  return data?.value || dflt;
}

function receiptHtml(r: any, hst: string, fr: boolean): string {
  const L = fr ? { t: "Reçu de prise en charge", pickup: "Départ", dest: "Destination", svc: "Service", drv: "Conducteur", fee: "Frais de prise en charge", tax: "TVH (13 %)", total: "Total payé · Interac", svcV: "Navette" }
                : { t: "Pickup receipt", pickup: "Pickup", dest: "Destination", svc: "Service", drv: "Driver", fee: "Reserve fee", tax: "HST (13%)", total: "Total paid · Interac", svcV: "Feeder pickup" };
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:460px;margin:0 auto;background:#232733;border-radius:16px;overflow:hidden;border:1px solid #3E4453">
   <div style="padding:16px;border-bottom:1px solid #3E4453">
     <span style="display:inline-block;background:#EA6A1E;color:#20140A;font-weight:900;font-size:14px;padding:5px 11px;border-radius:8px">LoadQ</span>
     <div style="color:#fff;font-size:15px;font-weight:800;margin-top:12px">${L.t}</div>
     <div style="color:#AEB6C4;font-size:11px;margin-top:2px">${esc(r.code || "")}</div>
   </div>
   <div style="padding:14px 16px;color:#fff">
     <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0"><span style="color:#AEB6C4">${L.pickup}</span><b>${esc(r.pickup || "")}</b></div>
     <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0"><span style="color:#AEB6C4">${L.dest}</span><b>${esc(cap(r.destination || ""))}</b></div>
     <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0"><span style="color:#AEB6C4">${L.svc}</span><b>${L.svcV}</b></div>
     ${r.driver ? `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0"><span style="color:#AEB6C4">${L.drv}</span><b>${esc(r.driver)}</b></div>` : ""}
     <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0;margin-top:6px"><span style="color:#AEB6C4">${L.fee}</span><b>${money(r.fee_cents)}</b></div>
     <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0"><span style="color:#AEB6C4">${L.tax}</span><b>${money(r.tax_cents)}</b></div>
     <div style="display:flex;justify-content:space-between;font-size:15px;padding:9px 0 0;margin-top:6px;border-top:1px dashed #3E4453"><span style="color:#AEB6C4">${L.total}</span><b style="color:#EA6A1E">${money(r.total_cents)}</b></div>
   </div>
   <div style="padding:12px 16px;border-top:1px solid #3E4453;color:#7C8697;font-size:9.5px;line-height:1.5;text-align:center">
     LoadQ — operated by Concord Express Co Inc. · Ottawa · ${esc(hst)} · loadq.ca
   </div>
  </div>`;
}

// Plain-text receipt for SMS — same line items as the email, one per line.
function receiptText(r: any, fr: boolean): string {
  const L = fr ? { t: "Reçu de prise en charge", pickup: "Départ", dest: "Destination", svc: "Service", drv: "Conducteur", fee: "Frais de prise en charge", tax: "TVH (13 %)", total: "Total payé · Interac", svcV: "Navette", thanks: "Merci !" }
               : { t: "Pickup receipt", pickup: "Pickup", dest: "Destination", svc: "Service", drv: "Driver", fee: "Reserve fee", tax: "HST (13%)", total: "Total paid · Interac", svcV: "Feeder pickup", thanks: "Thank you!" };
  const rows = [`LoadQ — ${L.t}`, `${r.code || ""}`, ``,
    `${L.pickup}: ${r.pickup || ""}`, `${L.dest}: ${cap(r.destination || "")}`, `${L.svc}: ${L.svcV}`];
  if (r.driver) rows.push(`${L.drv}: ${r.driver}`);
  rows.push(`${L.fee}: ${money(r.fee_cents)}`, `${L.tax}: ${money(r.tax_cents)}`, `${L.total}: ${money(r.total_cents)}`,
    ``, `${L.thanks} — loadq.ca`);
  return rows.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({} as any));
    const { request_id, channel, to } = b;
    if (!request_id || !to || !(channel === "email" || channel === "sms")) return json({ error: "request_id, channel(email|sms), to required" }, 400);

    const { data: rc } = await admin.rpc("loadq_pickup_receipt", { p_request: request_id });
    if (!rc || rc.error) return json({ error: rc?.error || "not_found" }, 404);
    if (!rc.paid) return json({ error: "not_paid" }, 402);

    const fr = QC.some((c) => String(rc.destination || "").toLowerCase().includes(c));
    const hst = await setting("loadq_hst_number", "HST/GST # pending");

    if (channel === "email") {
      if (!RESEND) return json({ error: "email_unavailable" }, 503);
      const from = await setting("loadq_receipt_from", "LoadQ <receipts@loadq.ca>");
      const subject = fr ? `Reçu LoadQ — ${rc.code}` : `LoadQ receipt — ${rc.code}`;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject, html: receiptHtml(rc, hst, fr) }) }).catch(() => null);
      return json({ ok: !!r && r.ok });
    }

    // SMS: short confirmation with the totals + ref.
    if (!TW_SID || !TW_TOKEN || !TW_FROM) return json({ error: "sms_unavailable" }, 503);
    let n = String(to).replace(/[^\d+]/g, ""); if (!n.startsWith("+")) n = n.length === 10 ? "+1" + n : "+" + n;
    const body = receiptText(rc, fr);
    const f = new URLSearchParams({ To: n, Body: body }); TW_FROM.startsWith("MG") ? f.set("MessagingServiceSid", TW_FROM) : f.set("From", TW_FROM);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString() }).catch(() => null);
    return json({ ok: !!r && r.ok });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
