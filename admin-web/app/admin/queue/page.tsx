"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errMsg } from "@/lib/supabase";
import { getDestinationsFrom, getRegionName, type ZoneRow, type QueueEntryRow, type DriverLite } from "@/lib/data";
import { Plus, RefreshCw, ArrowRightLeft, LogOut as Depart, Trash2, Search, X, Clock } from "lucide-react";

export default function QueuePage() {
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [zoneId, setZoneId] = useState<string>("");
  const [entries, setEntries] = useState<QueueEntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const zone = useMemo(() => zones.find((z) => z.id === zoneId) ?? null, [zones, zoneId]);

  const loadZones = useCallback(async () => {
    try {
      const zs = await api.zones();
      setZones(zs);
      setZoneId((cur) => cur || zs.find((z) => z.is_active)?.id || zs[0]?.id || "");
    } catch (e) { setErr(errMsg(e)); }
  }, []);
  useEffect(() => { loadZones(); }, [loadZones]);

  const loadQueue = useCallback(async () => {
    if (!zoneId) return;
    setLoading(true); setErr("");
    try { setEntries(await api.zoneQueue(zoneId)); }
    catch (e) { setErr(errMsg(e)); }
    finally { setLoading(false); }
  }, [zoneId]);
  useEffect(() => { loadQueue(); }, [loadQueue]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  // ── Add-driver modal ──────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="h1">Queue</h1>
          <div className="sub">Live line for each loading zone — add drivers, renumber, depart or remove.</div>
        </div>
        <button className="btn sm" onClick={loadQueue}><RefreshCw size={13} strokeWidth={2.2} />Refresh</button>
      </div>

      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      <label className="label">Loading zone</label>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <select className="input" style={{ maxWidth: 380, marginBottom: 0 }} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name} · {z.region}{z.is_active ? "" : " (disabled)"}</option>)}
        </select>
        <button className="btn primary" onClick={() => setAddOpen(true)} disabled={!zone}><Plus size={15} strokeWidth={2.4} />Add driver</button>
      </div>

      <div className="card" style={{ padding: 4 }}>
        <table className="tbl">
          <thead><tr><th style={{ width: 40 }}>#</th><th>Driver</th><th>Destination</th><th>Status</th><th>Seats</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="muted" style={{ padding: 20, textAlign: "center" }}>Loading…</td></tr>
              : entries.length === 0 ? <tr><td colSpan={6} className="muted" style={{ padding: 20, textAlign: "center" }}>No drivers in this line.</td></tr>
              : entries.map((e) => (
                <QueueRow key={e.id} entry={e} onDone={loadQueue} flash={flash} setErr={setErr} />
              ))}
          </tbody>
        </table>
      </div>

      <QueueHoursCard setErr={setErr} flash={flash} />

      {addOpen && zone && (
        <AddDriverModal zone={zone} existingCount={entries.length} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); loadQueue(); flash("Driver added to the line."); }} setErr={setErr} />
      )}
    </div>
  );
}

function statusPill(status: string) {
  const s = status.toLowerCase();
  if (s.includes("load")) return <span className="pill orange">{status}</span>;
  if (s === "departed" || s === "done" || s.includes("complete")) return <span className="pill gray">{status}</span>;
  return <span className="pill green">{status}</span>;
}

function QueueRow({ entry, onDone, flash, setErr }: { entry: QueueEntryRow; onDone: () => void; flash: (m: string) => void; setErr: (m: string) => void }) {
  const [pos, setPos] = useState(String(entry.position));
  const [busy, setBusy] = useState<null | "move" | "depart" | "remove">(null);

  const move = async () => {
    const n = parseInt(pos, 10);
    if (Number.isNaN(n) || n < 1) { setErr("Enter a position of 1 or higher."); return; }
    if (n === entry.position) return;
    setBusy("move"); setErr("");
    try { await api.move(entry.id, n); flash("Position updated."); onDone(); }
    catch (e) { setErr(errMsg(e)); setPos(String(entry.position)); }
    finally { setBusy(null); }
  };
  const depart = async () => {
    if (!confirm(`Mark ${entry.driver?.full_name || "this driver"} as departed?`)) return;
    setBusy("depart"); setErr("");
    try { await api.depart(entry.id); flash("Marked departed."); onDone(); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    if (!confirm(`Remove ${entry.driver?.full_name || "this driver"} from the queue?`)) return;
    setBusy("remove"); setErr("");
    try { await api.removeFromQueue(entry.id); flash("Removed from queue."); onDone(); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(null); }
  };

  const veh = entry.vehicle;
  return (
    <tr>
      <td style={{ fontWeight: 800, fontSize: 15 }}>{entry.position}</td>
      <td>
        <div style={{ fontWeight: 700 }}>{entry.driver?.full_name || "(no name)"}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{veh ? `${veh.make ?? ""} ${veh.model ?? ""} · ${veh.seats ?? "?"} seats` : (entry.driver?.phone || "")}</div>
      </td>
      <td>{entry.destination_region ? getRegionName(entry.destination_region) : <span className="muted">—</span>}</td>
      <td>{statusPill(entry.status)}</td>
      <td className="muted">{(entry.seats_boarded ?? 0)}{entry.seats_locked ? ` +${entry.seats_locked}🔒` : ""}</td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <span className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
          <input value={pos} onChange={(ev) => setPos(ev.target.value)} inputMode="numeric"
            style={{ width: 46, textAlign: "center", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--t1)", padding: "6px 4px", fontWeight: 700 }} />
          <button className="btn sm" onClick={move} disabled={busy !== null} title="Change position"><ArrowRightLeft size={13} strokeWidth={2.2} />{busy === "move" ? "…" : "Move"}</button>
          <button className="btn sm" onClick={depart} disabled={busy !== null} title="Mark departed"><Depart size={13} strokeWidth={2.2} /></button>
          <button className="btn sm danger" onClick={remove} disabled={busy !== null} title="Remove"><Trash2 size={13} strokeWidth={2.2} /></button>
        </span>
      </td>
    </tr>
  );
}

function AddDriverModal({ zone, existingCount, onClose, onAdded, setErr }: {
  zone: ZoneRow; existingCount: number; onClose: () => void; onAdded: () => void; setErr: (m: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DriverLite[]>([]);
  const [picked, setPicked] = useState<DriverLite | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [pos, setPos] = useState(String(existingCount + 1));
  const [minutes, setMinutes] = useState<number>(120);
  const [customMin, setCustomMin] = useState("");
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState("");

  const dests = useMemo(() => getDestinationsFrom(zone.region), [zone.region]);

  useEffect(() => {
    let cancelled = false;
    api.verifiedDrivers(query).then((r) => { if (!cancelled) setResults(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [query]);

  const add = async () => {
    if (!picked) return;
    setLocalErr(""); setBusy(true);
    const p = parseInt(pos, 10);
    const mins = minutes === -1 ? (parseInt(customMin, 10) || null) : minutes;
    try {
      await api.addToQueue(zone.id, dest, picked.id, Number.isNaN(p) ? null : p, mins);
      onAdded();
    } catch (e) { setLocalErr(errMsg(e)); setErr(errMsg(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{picked ? picked.full_name || "(no name)" : "Add driver"}</div>
          <button className="nav" style={{ width: "auto", padding: 4 }} onClick={onClose}><X size={18} /></button>
        </div>
        <div className="muted" style={{ fontSize: 12.5, margin: "2px 0 14px" }}>{zone.name} · {zone.region}</div>

        {!picked ? (
          <>
            <div className="row" style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "0 10px", marginBottom: 10 }}>
              <Search size={15} color="var(--t3)" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="Search verified driver by name or phone"
                style={{ flex: 1, background: "transparent", border: "none", color: "var(--t1)", padding: "11px 8px", outline: "none", fontSize: 14 }} />
            </div>
            <div style={{ maxHeight: 340, overflow: "auto" }}>
              {results.map((d) => (
                <button key={d.id} className="nav" style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)", borderRadius: 0 }} onClick={() => setPicked(d)}>
                  <div style={{ width: 34, height: 34, borderRadius: 17, background: "rgba(255,107,0,.15)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flex: "none" }}>
                    {(d.full_name || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div style={{ color: "var(--t1)", fontWeight: 700 }}>{d.full_name || "(no name)"} <span style={{ color: "var(--green)", fontSize: 11, fontWeight: 700 }}>✓</span></div>
                    <div className="muted" style={{ fontSize: 12 }}>{d.vehicle ? `${d.vehicle.make} ${d.vehicle.model} · ${d.vehicle.seats} seats` : (d.phone || "")}</div>
                  </div>
                </button>
              ))}
              {results.length === 0 && <div className="muted" style={{ padding: 16 }}>No verified drivers match.</div>}
            </div>
          </>
        ) : (
          <>
            <label className="label">Destination</label>
            <div className="row wrap" style={{ marginBottom: 12 }}>
              {dests.map((d) => (
                <button key={d} className={"chip" + (dest === d ? " on" : "")} onClick={() => setDest(d)}>{getRegionName(d)}</button>
              ))}
            </div>

            <label className="label">Position</label>
            <input className="input" value={pos} onChange={(e) => setPos(e.target.value)} inputMode="numeric" style={{ textAlign: "center", fontWeight: 800, fontSize: 17 }} />

            <label className="label">Loading time</label>
            <div className="row wrap" style={{ marginBottom: 12 }}>
              {[120, 180, 240].map((m) => (
                <button key={m} className={"chip" + (minutes === m ? " on" : "")} onClick={() => { setMinutes(m); setCustomMin(""); }}>{m / 60}h</button>
              ))}
              <button className={"chip" + (minutes === -1 ? " on" : "")} onClick={() => setMinutes(-1)}>Custom</button>
              {minutes === -1 && <input className="input" style={{ width: 90, marginBottom: 0, textAlign: "center" }} value={customMin} onChange={(e) => setCustomMin(e.target.value)} placeholder="min" inputMode="numeric" />}
            </div>

            {localErr && <div className="err">{localErr}</div>}
            <div className="row">
              <button className="btn primary" onClick={add} disabled={busy}>{busy ? "Adding…" : `Add at #${pos || "—"}`}</button>
              <button className="btn" onClick={() => setPicked(null)} disabled={busy}>← Back</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function QueueHoursCard({ setErr, flash }: { setErr: (m: string) => void; flash: (m: string) => void }) {
  const [reg, setReg] = useState(0);
  const [load, setLoad] = useState(5);
  const [close, setClose] = useState(23);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.queueWindow().then((w) => { setReg(w.register_open_hour); setLoad(w.load_open_hour); setClose(w.close_hour); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  const save = async () => {
    setBusy(true); setErr("");
    try { await api.setQueueWindow(reg, load, close); flash("Queue hours saved."); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  };

  const HourSelect = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => (
    <select className="input" style={{ marginBottom: 0, maxWidth: 120 }} value={value} onChange={(e) => onChange(parseInt(e.target.value, 10))}>
      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
    </select>
  );

  return (
    <>
      <div className="section"><Clock size={13} strokeWidth={2.2} style={{ verticalAlign: "-2px", marginRight: 6 }} />Queue hours (all zones · local time)</div>
      <div className="card">
        {!loaded ? <div className="muted">Loading…</div> : (
          <>
            <div className="row wrap" style={{ gap: 18 }}>
              <div><label className="label">Registration opens</label><HourSelect value={reg} onChange={setReg} /></div>
              <div><label className="label">Loading opens</label><HourSelect value={load} onChange={setLoad} /></div>
              <div><label className="label">Queue closes</label><HourSelect value={close} onChange={setClose} /></div>
            </div>
            <button className="btn primary" style={{ marginTop: 14 }} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save hours"}</button>
          </>
        )}
      </div>
    </>
  );
}
