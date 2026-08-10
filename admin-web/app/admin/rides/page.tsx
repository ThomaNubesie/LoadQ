"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg, type RideRow } from "@/lib/supabase";
import { getRegionName } from "@/lib/data";
import { useLang } from "@/lib/i18n";
import { Car, RefreshCw } from "lucide-react";

const FILTERS: [string, string, string][] = [
  ["", "All", "Toutes"],
  ["awaiting_payment", "Awaiting payment", "En attente"],
  ["assigned", "Assigned", "Assignées"],
  ["completed", "Completed", "Terminées"],
  ["cancelled", "Cancelled", "Annulées"],
];

const STATUS_COLOR: Record<string, string> = {
  awaiting_payment: "#b45309", paid: "#2563eb", assigned: "#16A34A", en_route: "#16A34A",
  picked_up: "#16A34A", completed: "#178a5e", cancelled: "#DC2626", expired: "#9CA3AF",
};

export default function RidesPage() {
  const { t, lang } = useLang();
  const [rows, setRows] = useState<RideRow[] | null>(null);
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback((flt = filter) => {
    api.rides(flt || null).then((d) => { setErr(""); setRows(d); }).catch((e) => setErr(errMsg(e)));
  }, [filter]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const markPaid = async (r: RideRow) => {
    setBusy(r.id);
    try { await api.rideMarkPaid(r.id); load(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };

  const fare = (r: RideRow) => r.fare_cents != null ? `$${(r.fare_cents / 100).toFixed(2).replace(/\.00$/, "")}` : "—";
  const kindLabel = (k: string) => k === "route_pickup" ? t("ridesKindRoute") : t("ridesKindOnDemand");

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="h1" style={{ display: "flex", alignItems: "center", gap: 8 }}><Car size={20} strokeWidth={2.2} /> {t("ridesTitle")}</h1>
          <div className="sub">{t("ridesSub")}</div>
        </div>
        <button className="btn" onClick={() => load()}><RefreshCw size={15} /> {t("refresh")}</button>
      </div>

      {err && <div className="banner err" style={{ background: "#3a1720", color: "#ff9db0", padding: "9px 13px", borderRadius: 9, marginBottom: 12 }}>{err}</div>}

      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {FILTERS.map(([v, en, fr]) => (
          <button key={v} className={"chip" + (filter === v ? " on" : "")} onClick={() => setFilter(v)}>{lang === "fr" ? fr : en}</button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr style={{ textAlign: "left", color: "#6B6675", fontSize: 12 }}>
            <th style={{ padding: "10px 12px" }}>{t("ridesColRoute")}</th>
            <th>{t("ridesColKind")}</th><th>{t("ridesColStatus")}</th><th>{t("ridesColPay")}</th>
            <th>{t("ridesColFare")}</th><th>{t("ridesColDriver")}</th><th></th>
          </tr></thead>
          <tbody>
            {rows === null ? <tr><td colSpan={7} className="muted" style={{ padding: 20, textAlign: "center" }}>{t("loading")}</td></tr>
            : rows.length === 0 ? <tr><td colSpan={7} className="muted" style={{ padding: 20, textAlign: "center" }}>{t("ridesNone")}</td></tr>
            : rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #ECECF2" }}>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: 700 }}>{r.pickup_label || "—"}</div>
                  <div className="muted" style={{ fontSize: 12 }}>→ {r.dest_region ? getRegionName(r.dest_region) : "—"}</div>
                </td>
                <td style={{ fontSize: 12.5 }}>{kindLabel(r.kind)}</td>
                <td style={{ fontWeight: 700, color: STATUS_COLOR[r.status] || "#334155", fontSize: 12.5 }}>
                  {r.status}{r.live_offers > 0 && <div className="muted" style={{ fontSize: 11, fontWeight: 500 }}>{t("ridesOffersOut").replace("{n}", String(r.live_offers))}</div>}
                </td>
                <td style={{ fontSize: 12.5, color: r.payment_status === "paid" ? "#178a5e" : "#b45309" }}>{r.payment_status}<div className="muted" style={{ fontSize: 11 }}>{r.payment_method}</div></td>
                <td style={{ fontWeight: 800 }}>{fare(r)}</td>
                <td style={{ fontSize: 12.5 }}>{r.driver_name || <span className="muted">—</span>}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap", padding: "0 12px" }}>
                  {r.payment_method === "interac" && r.payment_status !== "paid" && !["cancelled", "expired", "completed"].includes(r.status) && (
                    <button className="chip" style={{ borderColor: "#16A34A", color: "#16A34A" }} disabled={busy === r.id} onClick={() => markPaid(r)}>
                      {busy === r.id ? "…" : "✓ " + t("ridesMarkPaid")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
