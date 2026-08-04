"use client";
import { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/supabase";
import { REGIONS, COMMON_TZS, slugify, type ZoneRow, type RegionCode } from "@/lib/data";
import { Pencil, Plus, Check, X } from "lucide-react";

export default function ZonesPage() {
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // New-zone form
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [region, setRegion] = useState<RegionCode>("ottawa");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("100");
  const [tz, setTz] = useState("America/Toronto");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");

  // Inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eAddr, setEAddr] = useState("");
  const [eRadius, setERadius] = useState("");
  const [eLat, setELat] = useState("");
  const [eLng, setELng] = useState("");
  const [eTz, setETz] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const load = async () => {
    setLoading(true); setErr("");
    try { setZones(await api.zones()); }
    catch (e) { setErr(errMsg(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const addZone = async () => {
    setFormErr("");
    if (!name.trim()) return setFormErr("Name is required");
    if (!address.trim()) return setFormErr("Address is required");
    const la = parseFloat(lat), lo = parseFloat(lng), r = parseInt(radius, 10);
    if (Number.isNaN(la) || Number.isNaN(lo)) return setFormErr("Latitude and longitude must be numbers");
    if (Number.isNaN(r) || r <= 0) return setFormErr("Radius must be a positive integer");
    const id = `${region}-${slugify(name)}`;
    if (zones.some((z) => z.id === id)) return setFormErr(`A zone with id "${id}" already exists — rename it`);
    setSaving(true);
    try {
      await api.addZone({ id, name: name.trim(), region, address: address.trim(), latitude: la, longitude: lo, radius_meters: r, timezone: tz, is_active: active });
      setName(""); setAddress(""); setLat(""); setLng(""); setRadius("100");
      await load();
    } catch (e) { setFormErr(errMsg(e)); }
    finally { setSaving(false); }
  };

  const startEdit = (z: ZoneRow) => {
    setEditId(z.id); setEName(z.name); setEAddr(z.address ?? "");
    setERadius(String(z.radius_meters)); setELat(String(z.latitude)); setELng(String(z.longitude)); setETz(z.timezone);
  };
  const saveEdit = async (z: ZoneRow) => {
    if (!eName.trim()) { setErr("Zone name can't be empty."); return; }
    const r = parseInt(eRadius, 10), la = parseFloat(eLat), lo = parseFloat(eLng);
    setSavingEdit(true); setErr("");
    try {
      await api.updateZone(z.id, {
        name: eName.trim(),
        address: eAddr.trim() || null,
        radius_meters: Number.isNaN(r) || r <= 0 ? z.radius_meters : r,
        latitude: Number.isNaN(la) ? z.latitude : la,
        longitude: Number.isNaN(lo) ? z.longitude : lo,
        timezone: eTz || z.timezone,
      });
      setEditId(null);
      await load();
    } catch (e) { setErr(errMsg(e)); }
    finally { setSavingEdit(false); }
  };

  const toggle = async (z: ZoneRow) => {
    try { await api.setZoneActive(z.id, !z.is_active); await load(); }
    catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div>
      <h1 className="h1">Zones</h1>
      <div className="sub">Loading locations drivers queue at. Rename, retag or toggle any zone — changes reach the app immediately.</div>
      {err && <div className="err">{err}</div>}

      {/* New zone */}
      <div className="section">New zone</div>
      <div className="card">
        <div className="grid2">
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Universal Grocery" />
          </div>
          <div>
            <label className="label">Address</label>
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="140 George St, Ottawa, ON" />
          </div>
        </div>

        <label className="label">Region</label>
        <div className="row wrap" style={{ marginBottom: 12 }}>
          {REGIONS.map((r) => (
            <button key={r.code} className={"chip" + (region === r.code ? " on" : "")} onClick={() => { setRegion(r.code); setTz(r.timezone); }}>{r.name}</button>
          ))}
        </div>

        <div className="grid2">
          <div><label className="label">Latitude</label><input className="input" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="45.4268" /></div>
          <div><label className="label">Longitude</label><input className="input" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-75.6910" /></div>
        </div>
        <div className="grid2">
          <div><label className="label">Radius (m)</label><input className="input" value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="100" /></div>
          <div>
            <label className="label">Timezone</label>
            <select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>
              {COMMON_TZS.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
        </div>

        <label className="row" style={{ gap: 8, marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> <span className="muted" style={{ fontSize: 13 }}>Active (visible to drivers)</span>
        </label>

        {formErr && <div className="err">{formErr}</div>}
        <button className="btn primary" onClick={addZone} disabled={saving}><Plus size={15} strokeWidth={2.4} />{saving ? "Saving…" : "Add zone"}</button>
      </div>

      {/* Existing */}
      <div className="section">Existing ({zones.length})</div>
      {loading ? <div className="muted">Loading…</div> : (
        <div className="card" style={{ padding: 4 }}>
          <table className="tbl">
            <thead><tr><th>Zone</th><th>Region</th><th>Details</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
            <tbody>
              {zones.map((z) => editId === z.id ? (
                <tr key={z.id}>
                  <td colSpan={4}>
                    <div className="grid2">
                      <div><label className="label">Name</label><input className="input" value={eName} onChange={(e) => setEName(e.target.value)} /></div>
                      <div><label className="label">Address</label><input className="input" value={eAddr} onChange={(e) => setEAddr(e.target.value)} /></div>
                    </div>
                    <div className="grid2">
                      <div><label className="label">Latitude</label><input className="input" value={eLat} onChange={(e) => setELat(e.target.value)} /></div>
                      <div><label className="label">Longitude</label><input className="input" value={eLng} onChange={(e) => setELng(e.target.value)} /></div>
                    </div>
                    <div className="grid2">
                      <div><label className="label">Radius (m)</label><input className="input" value={eRadius} onChange={(e) => setERadius(e.target.value)} /></div>
                      <div>
                        <label className="label">Timezone</label>
                        <select className="input" value={eTz} onChange={(e) => setETz(e.target.value)}>
                          {COMMON_TZS.map((z2) => <option key={z2} value={z2}>{z2}</option>)}
                          {!COMMON_TZS.includes(eTz) && eTz && <option value={eTz}>{eTz}</option>}
                        </select>
                      </div>
                    </div>
                    <div className="row">
                      <button className="btn primary sm" onClick={() => saveEdit(z)} disabled={savingEdit}><Check size={14} strokeWidth={2.4} />{savingEdit ? "Saving…" : "Save"}</button>
                      <button className="btn sm" onClick={() => setEditId(null)} disabled={savingEdit}><X size={14} strokeWidth={2.4} />Cancel</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={z.id}>
                  <td>
                    <div style={{ fontWeight: 700, color: z.is_active ? "var(--t1)" : "var(--t3)" }}>{z.name}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{z.address || "—"}</div>
                  </td>
                  <td><span className="pill gray">{z.region}</span></td>
                  <td className="muted" style={{ fontSize: 12 }}>{z.radius_meters}m · {z.timezone.split("/")[1]}<br />{z.latitude.toFixed(4)}, {z.longitude.toFixed(4)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn sm" onClick={() => startEdit(z)}><Pencil size={13} strokeWidth={2.2} />Edit</button>{" "}
                    <button className={"btn sm" + (z.is_active ? "" : " primary")} onClick={() => toggle(z)}>{z.is_active ? "Disable" : "Enable"}</button>
                  </td>
                </tr>
              ))}
              {zones.length === 0 && <tr><td colSpan={4} className="muted" style={{ padding: 20, textAlign: "center" }}>No zones yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
