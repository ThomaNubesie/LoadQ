"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errMsg, type DocStatus, type DriverDocRow } from "@/lib/supabase";
import { useLang, type I18nKey } from "@/lib/i18n";
import { RefreshCw, ExternalLink } from "lucide-react";

const FILTERS: { key: DocStatus; label: I18nKey }[] = [
  { key: "pending", label: "fPending" },
  { key: "approved", label: "fApproved" },
  { key: "rejected", label: "fRejected" },
  { key: "expired", label: "fExpired" },
  { key: "all", label: "fAll" },
];

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--yellow)", approved: "var(--green)", rejected: "var(--red)", expired: "var(--red)",
};

export default function DocumentsPage() {
  const { t, lang } = useLang();
  const [status, setStatus] = useState<DocStatus>("pending");
  const [rows, setRows] = useState<DriverDocRow[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const data = await api.docsQueue(status);
      setRows(data);
      setSelId((cur) => (data.some((r) => r.doc_id === cur) ? cur : data[0]?.doc_id ?? null));
    } catch (e) { setErr(errMsg(e)); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const sel = useMemo(() => rows.find((r) => r.doc_id === selId) ?? null, [rows, selId]);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3500); };

  const docLabel = (dt: string): string => t((["drivers_license", "insurance", "registration"].includes(dt) ? dt : "navDocuments") as I18nKey);
  const statusLabel = (st: string): string => t(({ pending: "stPending", approved: "stApproved", rejected: "stRejected", expired: "stExpired" }[st] ?? "stPending") as I18nKey);
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { month: "short", day: "numeric", year: "numeric" }) : "—");
  const ago = (iso: string) => new Date(iso).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="h1">{t("docsTitle")}</h1>
          <div className="sub">{t("docsSub")}</div>
        </div>
        <button className="btn sm" onClick={load}><RefreshCw size={13} strokeWidth={2.2} />{t("refresh")}</button>
      </div>

      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      <div className="row wrap" style={{ gap: 7, margin: "14px 0" }}>
        {FILTERS.map((f) => (
          <button key={f.key} className={"chip" + (status === f.key ? " on" : "")} onClick={() => setStatus(f.key)}>
            {t(f.label)}{f.key === "pending" && rows.length && status === "pending" ? ` ${rows.length}` : ""}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 4 }}>
        <table className="tbl">
          <thead><tr>
            <th>{t("colDriver")}</th><th>{t("colDocument")}</th><th>{t("colSubmitted")}</th><th>{t("colExpiry")}</th><th>{t("colStatus")}</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="muted" style={{ padding: 20, textAlign: "center" }}>{t("loading")}</td></tr>
              : rows.length === 0 ? <tr><td colSpan={5} className="muted" style={{ padding: 20, textAlign: "center" }}>{t("emptyQueue")}</td></tr>
              : rows.map((r) => (
                <tr key={r.doc_id} className="clk" style={{ cursor: "pointer", background: r.doc_id === selId ? "rgba(255,107,0,.06)" : undefined }} onClick={() => setSelId(r.doc_id)}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{r.full_name || "(no name)"}{r.driver_verified && <span title="Verified" style={{ color: "var(--green)", marginLeft: 6, fontWeight: 800 }}>✓</span>}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{r.plate ? `${t("plate")} ${r.plate}` : (r.phone || r.email || "")}</div>
                  </td>
                  <td>{docLabel(r.doc_type)}</td>
                  <td className="muted">{ago(r.submitted_at)}</td>
                  <td className="muted">{fmt(r.expires_on)}</td>
                  <td><span style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 9px", borderRadius: 20, textTransform: "lowercase", background: (STATUS_COLOR[r.status] || "var(--t3)") + "26", color: STATUS_COLOR[r.status] || "var(--t3)" }}>{statusLabel(r.status)}</span></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {sel ? <ReviewPanel key={sel.doc_id} row={sel} onDone={() => { load(); }} flash={flash} setErr={setErr} /> : (
        <div className="card" style={{ marginTop: 16 }}><div className="muted">{t("selectHint")}</div></div>
      )}
    </div>
  );
}

function ReviewPanel({ row, onDone, flash, setErr }: { row: DriverDocRow; onDone: () => void; flash: (m: string) => void; setErr: (m: string) => void }) {
  const { t, lang } = useLang();
  const [img, setImg] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState(false);
  const [expiry, setExpiry] = useState(row.expires_on ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);

  useEffect(() => {
    let dead = false;
    setImg(null); setImgErr(false);
    api.docSignedUrl(row.storage_path).then((u) => { if (!dead) setImg(u); }).catch(() => { if (!dead) setImgErr(true); });
    return () => { dead = true; };
  }, [row.storage_path]);

  const docLabel = t((["drivers_license", "insurance", "registration"].includes(row.doc_type) ? row.doc_type : "navDocuments") as I18nKey);

  const decide = async (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !reason.trim()) { setErr(t("reasonRequired")); return; }
    setBusy(decision === "approved" ? "approve" : "reject"); setErr("");
    try {
      const res = await api.reviewDoc(row.doc_id, decision, {
        notes: decision === "rejected" ? reason.trim() : undefined,
        expiresOn: decision === "approved" ? (expiry.trim() || null) : null,
      });
      flash((decision === "approved" ? t("approvedMsg") : t("rejectedMsg")) + (res?.driver_verified ? "  " + t("nowVerified") : ""));
      onDone();
    } catch (e) { setErr(errMsg(e)); }
    finally { setBusy(null); }
  };

  const isImage = !/\.pdf$/i.test(row.storage_path);

  return (
    <div className="card" style={{ marginTop: 16, display: "flex", gap: 18, flexWrap: "wrap" }}>
      <div style={{ width: 260, flex: "none" }}>
        <div style={{ width: "100%", height: 190, borderRadius: 10, background: "var(--cardAlt,#2C313F)", border: "1px solid var(--border)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {imgErr ? <span className="muted" style={{ fontSize: 12 }}>{t("imageFailed")}</span>
            : !img ? <span className="muted" style={{ fontSize: 12 }}>{t("imageLoading")}</span>
            : isImage ? <img src={img} alt={docLabel} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            : <span className="muted" style={{ fontSize: 12 }}>PDF</span>}
        </div>
        {img && <a href={img} target="_blank" rel="noreferrer" className="row" style={{ gap: 6, marginTop: 8, color: "var(--accent)", fontSize: 12.5, fontWeight: 700 }}><ExternalLink size={13} />{t("openFull")}</a>}
      </div>

      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{row.full_name || "(no name)"} · {docLabel}</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.7 }}>
          {row.phone ? `📞 ${row.phone}` : ""}{row.email ? `  ✉️ ${row.email}` : ""}<br />
          {row.plate ? `${t("plate")} ${row.plate} · ` : ""}{t("submittedAt")} {new Date(row.submitted_at).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA")}
          {row.expires_on ? ` · ${t("currentExpiry")} ${row.expires_on}` : ""}
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="label">{t("expiryLabel")}</label>
          <input type="date" className="input" style={{ maxWidth: 220, marginBottom: 0 }} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
        <div style={{ marginTop: 10 }}>
          <label className="label">{t("reasonLabel")}</label>
          <input className="input" style={{ marginBottom: 0 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reasonPh")} />
        </div>

        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <button className="btn primary" style={{ background: "var(--green)", borderColor: "var(--green)" }} disabled={busy !== null} onClick={() => decide("approved")}>
            {busy === "approve" ? "…" : `✓ ${t("approve")}`}
          </button>
          <button className="btn danger" disabled={busy !== null} onClick={() => decide("rejected")}>
            {busy === "reject" ? "…" : `✕ ${t("reject")}`}
          </button>
        </div>
      </div>
    </div>
  );
}
