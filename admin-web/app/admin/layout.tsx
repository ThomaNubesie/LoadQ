"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { supabase, api } from "@/lib/supabase";
import { MapPin, ListOrdered, LogOut } from "lucide-react";

const NAV = [
  { href: "/admin/zones", Icon: MapPin, label: "Zones" },
  { href: "/admin/queue", Icon: ListOrdered, label: "Queue" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [ok, setOk] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      try {
        const admin = await api.isAdmin();
        if (!admin) { await supabase.auth.signOut(); router.replace("/login"); return; }
        setOk(true);
      } catch { router.replace("/login"); }
    })();
  }, [router]);

  if (ok === undefined) return <div className="center"><div className="muted">Loading…</div></div>;

  const isActive = (href: string) => path.startsWith(href);

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">LoadQ <small>· Admin</small></div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={"nav" + (isActive(n.href) ? " on" : "")}>
            <n.Icon size={17} strokeWidth={2} style={{ flex: "none" }} />{n.label}
          </Link>
        ))}
        <div className="who">
          <button className="nav" style={{ padding: "8px 12px" }} onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>
            <LogOut size={15} strokeWidth={2} style={{ flex: "none" }} />Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
