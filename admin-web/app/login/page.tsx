"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, api, e164, errMsg } from "@/lib/supabase";

// Passwordless sign-in — the same auth.users as the LoadQ app. Drivers sign in
// by phone; email is offered as a fallback. Only drivers.is_admin get in.
export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"phone" | "email">("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const send = async () => {
    setBusy(true); setErr("");
    const { error } = mode === "phone"
      ? await supabase.auth.signInWithOtp({ phone: e164(phone) })
      : await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setSent(true); setCode("");
  };

  const verify = async () => {
    setBusy(true); setErr("");
    const { error } = mode === "phone"
      ? await supabase.auth.verifyOtp({ phone: e164(phone), token: code.trim(), type: "sms" })
      : await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) { setBusy(false); setErr(error.message); return; }
    try {
      const admin = await api.isAdmin();
      if (!admin) {
        await supabase.auth.signOut();
        setBusy(false);
        setErr("This account isn't a LoadQ admin. Ask an owner for access.");
        return;
      }
      router.replace("/admin/zones");
    } catch (e) {
      setBusy(false); setErr(errMsg(e));
    }
  };

  const switchMode = (m: "phone" | "email") => { setMode(m); setErr(""); setSent(false); setCode(""); };

  return (
    <div className="center">
      <div className="card" style={{ width: 360 }}>
        <div style={{ fontWeight: 900, fontSize: 24, color: "var(--accent)", letterSpacing: -0.5 }}>LoadQ</div>
        <div className="sub" style={{ marginTop: 4, marginBottom: 18 }}>Operations console</div>

        <div className="row" style={{ marginBottom: 14 }}>
          <button className={"chip" + (mode === "phone" ? " on" : "")} onClick={() => switchMode("phone")}>Phone</button>
          <button className={"chip" + (mode === "email" ? " on" : "")} onClick={() => switchMode("email")}>Email</button>
        </div>

        {!sent ? (
          <>
            {mode === "phone" ? (
              <>
                <div className="mono">Phone number</div>
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 613 555 0192" inputMode="tel" onKeyDown={(e) => e.key === "Enter" && send()} />
              </>
            ) : (
              <>
                <div className="mono">Email</div>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" onKeyDown={(e) => e.key === "Enter" && send()} />
              </>
            )}
            {err && <div className="err">{err}</div>}
            <button className="btn primary" style={{ width: "100%", marginTop: 4 }} onClick={send} disabled={busy || (mode === "phone" ? !phone.trim() : !email.trim())}>
              {busy ? "Sending…" : "Send code"}
            </button>
          </>
        ) : (
          <>
            <div className="mono">6-digit code</div>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" autoFocus onKeyDown={(e) => e.key === "Enter" && verify()} />
            {err && <div className="err">{err}</div>}
            <button className="btn primary" style={{ width: "100%", marginTop: 4 }} onClick={verify} disabled={busy || code.trim().length < 4}>
              {busy ? "Verifying…" : "Sign in"}
            </button>
            <button className="nav" style={{ justifyContent: "center", marginTop: 8 }} onClick={() => { setSent(false); setErr(""); }}>← Use a different {mode === "phone" ? "number" : "email"}</button>
          </>
        )}
      </div>
    </div>
  );
}
