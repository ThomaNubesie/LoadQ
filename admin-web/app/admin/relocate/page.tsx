"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errMsg, type PassengerLite, type PassengerReservation } from "@/lib/supabase";
import { getRegionName, getDestinationsFrom, DESTINATION_CITIES, type ZoneRow, type QueueEntryRow } from "@/lib/data";
import { useLang } from "@/lib/i18n";
import { ArrowLeftRight, Search, User, Car } from "lucide-react";

type Mode = "driver" | "passenger";

export default function RelocatePage() {
  const { t } = useLang();
  const [mode, setMode] = useState<Mode>("driver");
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => { api.zones().then(setZones).catch((e) => setErr(errMsg(e))); }, []);
  const activeZones = useMemo(() => zones.filter((z) => z.is_active), [zones]);
  const notify = (m: string) => { setMsg(m); setErr(""); setTimeout(() => setMsg(""), 4000); };
  const fail = (e: unknown) => { setErr(errMsg(e)); setMsg(""); };

  return (
    <div>
      <div className="head">
        <div>
          <div className="title"><ArrowLeftRight size={20} strokeWidth={2.2} /> {t("relTitle")}</div>
          <div className="sub">{t("relSub")}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className={"chip" + (mode === "driver" ? " on" : "")} onClick={() => { setMode("driver"); setErr(""); setMsg(""); }}>{t("relDriverMode")}</button>
          <button className={"chip" + (mode === "passenger" ? " on" : "")} onClick={() => { setMode("passenger"); setErr(""); setMsg(""); }}>{t("relPassengerMode")}</button>
        </div>
      </div>

      {err && <div className="banner err">{err}</div>}
      {msg && <div className="banner ok">{msg}</div>}

      {mode === "driver"
        ? <DriverRelocate zones={activeZones} onOk={notify} onErr={fail} />
        : <PassengerRelocate zones={activeZones} onOk={notify} onErr={fail} />}
    </div>
  );
}

const isActive = (s: string) => s === "loading" || s === "waiting" || s === "standby";

/* ── DRIVER MODE ─────────────────────────────────────────────────────────── */
function DriverRelocate({ zones, onOk, onErr }: { zones: ZoneRow[]; onOk: (m: string) => void; onErr: (e: unknown) => void }) {
  const { t } = useLang();
  const [srcZone, setSrcZone] = useState("");
  const [entries, setEntries] = useState<QueueEntryRow[]>([]);
  const [entryId, setEntryId] = useState("");
  const [dstZone, setDstZone] = useState("");
  const [dstDest, setDstDest] = useState("");
  const [pos, setPos] = useState("");
  const [release, setRelease] = useState<"auto" | "keep" | "release">("auto");
  const [busy, setBusy] = useState(false);

  const loadSrc = useCallback(async (z: string) => {
    setSrcZone(z); setEntryId(""); setEntries([]);
    if (!z) return;
    try { setEntries((await api.zoneQueue(z)).filter((e) => isActive(e.status))); } catch (e) { onErr(e); }
  }, [onErr]);

  const entry = entries.find((e) => e.id === entryId) || null;
  const dstRegion = zones.find((z) => z.id === dstZone)?.region ?? null;
  const dests = useMemo(() => getDestinationsFrom(dstRegion), [dstRegion]);
  // Auto: release iff the destination changes vs. the driver's current one.
  const releaseVal: boolean | null =
    release === "auto" ? null : release === "release";

  const submit = async () => {
    if (!entry || !dstZone) return;
    setBusy(true);
    try {
      await api.relocateDriver(entry.id, dstZone, dstDest || null, pos ? Number(pos) : null, releaseVal);
      onOk(t("relMovedDriver"));
      await loadSrc(srcZone); setEntryId(""); setPos("");
    } catch (e) { onErr(e); } finally { setBusy(false); }
  };

  return (
    <div className="grid2">
      {/* pick a driver */}
      <div className="card">
        <div className="cardHead"><Car size={15} /> {t("relPickDriver")}</div>
        <label className="lbl">{t("relFromZone")}</label>
        <select className="input" value={srcZone} onChange={(e) => loadSrc(e.target.value)}>
          <option value="">{t("relSelectZone")}</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name} · {getRegionName(z.region)}</option>)}
        </select>
        <div className="list">
          {srcZone && entries.length === 0 && <div className="muted pad">{t("relNoDrivers")}</div>}
          {entries.map((e) => (
            <button key={e.id} className={"pickRow" + (entryId === e.id ? " on" : "")} onClick={() => setEntryId(e.id)}>
              <span className="num">{e.position}</span>
              <span className="grow">
                <b>{e.driver?.full_name || "(no name)"}</b>
                <small>{e.destination_region ? `→ ${getRegionName(e.destination_region)}` : t("relNoDest")}{e.seats_locked ? ` · ${e.seats_locked}🔒` : ""}{e.seats_boarded ? ` · ${e.seats_boarded} aboard` : ""}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* destination */}
      <div className="card">
        <div className="cardHead"><ArrowLeftRight size={15} /> {t("relMoveTo")}</div>
        <label className="lbl">{t("relToZone")}</label>
        <select className="input" value={dstZone} onChange={(e) => { setDstZone(e.target.value); setDstDest(""); }} disabled={!entry}>
          <option value="">{t("relSelectZone")}</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name} · {getRegionName(z.region)}</option>)}
        </select>

        <label className="lbl">{t("relToDest")}</label>
        <select className="input" value={dstDest} onChange={(e) => setDstDest(e.target.value)} disabled={!dstZone}>
          <option value="">{t("relKeepDest")}</option>
          {(dests.length ? dests : DESTINATION_CITIES.map((d) => d.code)).map((code) => (
            <option key={code} value={code}>{getRegionName(code)}</option>
          ))}
        </select>

        <label className="lbl">{t("relPosition")}</label>
        <input className="input" value={pos} onChange={(e) => setPos(e.target.value.replace(/[^0-9]/g, ""))} placeholder={t("relPosEnd")} disabled={!entry} />

        <label className="lbl">{t("relPassengers")}</label>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {(["auto", "keep", "release"] as const).map((r) => (
            <button key={r} className={"chip" + (release === r ? " on" : "")} onClick={() => setRelease(r)} disabled={!entry}>
              {r === "auto" ? t("relPaxAuto") : r === "keep" ? t("relPaxKeep") : t("relPaxRelease")}
            </button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t("relPaxHint")}</div>

        <button className="btn primary" style={{ marginTop: 16, width: "100%" }} disabled={!entry || !dstZone || busy} onClick={submit}>
          {busy ? "…" : t("relDoMove")}
        </button>
      </div>
      <RelocateStyles />
    </div>
  );
}

/* ── PASSENGER MODE ──────────────────────────────────────────────────────── */
function PassengerRelocate({ zones, onOk, onErr }: { zones: ZoneRow[]; onOk: (m: string) => void; onErr: (e: unknown) => void }) {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PassengerLite[]>([]);
  const [pax, setPax] = useState<PassengerLite | null>(null);
  const [resv, setResv] = useState<PassengerReservation | null>(null);
  const [dstZone, setDstZone] = useState("");
  const [entries, setEntries] = useState<QueueEntryRow[]>([]);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);

  const search = useCallback(async () => {
    try { setResults(await api.searchPassengers(q)); } catch (e) { onErr(e); }
  }, [q, onErr]);

  const pick = async (p: PassengerLite) => {
    setPax(p); setResults([]); setQ(p.full_name || ""); setResv(null);
    try { setResv(await api.passengerReservation(p.id)); } catch (e) { onErr(e); }
  };

  const loadDst = useCallback(async (z: string) => {
    setDstZone(z); setTargetId(""); setEntries([]);
    if (!z) return;
    try { setEntries((await api.zoneQueue(z)).filter((e) => isActive(e.status))); } catch (e) { onErr(e); }
  }, [onErr]);

  const submit = async () => {
    if (!pax || !targetId) return;
    setBusy(true);
    try {
      await api.relocatePassenger(pax.id, targetId, null);
      onOk(t("relMovedPassenger"));
      setResv(await api.passengerReservation(pax.id));
      setTargetId("");
    } catch (e) { onErr(e); } finally { setBusy(false); }
  };

  return (
    <div className="grid2">
      {/* find passenger */}
      <div className="card">
        <div className="cardHead"><User size={15} /> {t("relPickPassenger")}</div>
        <div className="row" style={{ gap: 6 }}>
          <input className="input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder={t("relSearchPax")} />
          <button className="btn" onClick={search}><Search size={14} /></button>
        </div>
        <div className="list">
          {results.map((p) => (
            <button key={p.id} className="pickRow" onClick={() => pick(p)}>
              <span className="grow"><b>{p.full_name || "(no name)"}</b><small>{p.phone || ""}</small></span>
            </button>
          ))}
        </div>
        {pax && (
          <div className="resv">
            <div className="lbl">{t("relCurrent")}</div>
            {resv?.entry
              ? <div><b>{resv.entry.driver?.full_name || "(driver)"}</b> · #{resv.entry.position} · {getRegionName(resv.entry.zone_id.split("-")[0])} → {resv.entry.destination_region ? getRegionName(resv.entry.destination_region) : "—"} <span className="muted">({resv.claimStatus})</span></div>
              : <div className="muted">{t("relNoReservation")}</div>}
          </div>
        )}
      </div>

      {/* target driver */}
      <div className="card">
        <div className="cardHead"><Car size={15} /> {t("relToDriver")}</div>
        <label className="lbl">{t("relToZone")}</label>
        <select className="input" value={dstZone} onChange={(e) => loadDst(e.target.value)} disabled={!pax}>
          <option value="">{t("relSelectZone")}</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name} · {getRegionName(z.region)}</option>)}
        </select>
        <div className="list">
          {dstZone && entries.length === 0 && <div className="muted pad">{t("relNoDrivers")}</div>}
          {entries.map((e) => {
            const seats = e.vehicle?.seats ?? 0;
            const taken = (e.seats_locked ?? 0) + (e.seats_boarded ?? 0);
            const full = seats > 0 && taken >= seats;
            return (
              <button key={e.id} className={"pickRow" + (targetId === e.id ? " on" : "")} onClick={() => !full && setTargetId(e.id)} disabled={full}>
                <span className="num">{e.position}</span>
                <span className="grow">
                  <b>{e.driver?.full_name || "(no name)"}</b>
                  <small>{e.destination_region ? `→ ${getRegionName(e.destination_region)}` : t("relNoDest")} · {taken}/{seats || "?"} {full ? "· FULL" : ""}</small>
                </span>
              </button>
            );
          })}
        </div>
        <button className="btn primary" style={{ marginTop: 16, width: "100%" }} disabled={!pax || !targetId || busy} onClick={submit}>
          {busy ? "…" : t("relDoMove")}
        </button>
      </div>
      <RelocateStyles />
    </div>
  );
}

function RelocateStyles() {
  return (
    <style jsx global>{`
      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
      @media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
      .cardHead { display: flex; align-items: center; gap: 7px; font-weight: 800; font-size: 14px; margin-bottom: 10px; }
      .lbl { display: block; font-size: 12px; color: var(--muted, #8a93a3); font-weight: 700; margin: 12px 0 5px; }
      .list { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; max-height: 340px; overflow: auto; }
      .pad { padding: 14px; text-align: center; }
      .pickRow { display: flex; align-items: center; gap: 10px; text-align: left; padding: 9px 11px; border: 1px solid var(--line, #232833); border-radius: 10px; background: transparent; cursor: pointer; color: inherit; }
      .pickRow:hover { border-color: #3a4250; }
      .pickRow.on { border-color: #16b364; box-shadow: 0 0 0 1px #16b364 inset; }
      .pickRow:disabled { opacity: .45; cursor: not-allowed; }
      .pickRow .num { font-weight: 800; min-width: 22px; }
      .pickRow .grow { display: flex; flex-direction: column; }
      .pickRow small { color: var(--muted, #8a93a3); font-size: 11.5px; margin-top: 1px; }
      .resv { margin-top: 12px; padding: 10px 12px; border: 1px dashed var(--line, #232833); border-radius: 10px; font-size: 13px; }
      .banner { padding: 9px 13px; border-radius: 9px; margin-bottom: 12px; font-size: 13px; font-weight: 600; }
      .banner.err { background: #3a1720; color: #ff9db0; }
      .banner.ok { background: #12331f; color: #66e39a; }
    `}</style>
  );
}
