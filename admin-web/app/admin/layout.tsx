"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { supabase, api } from "@/lib/supabase";
import { useLang, LANGS, LANG_LABEL, type I18nKey } from "@/lib/i18n";
import { MapPin, ListOrdered, FileText, LogOut } from "lucide-react";

const NAV: { href: string; Icon: typeof MapPin; label: I18nKey }[] = [
  { href: "/admin/zones", Icon: MapPin, label: "navZones" },
  { href: "/admin/queue", Icon: ListOrdered, label: "navQueue" },
  { href: "/admin/documents", Icon: FileText, label: "navDocuments" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { t, lang, setLang } = useLang();
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

  if (ok === undefined) return <div className="center"><div className="muted">{t("loading")}</div></div>;

  const isActive = (href: string) => path.startsWith(href);

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">LoadQ <small>· Admin</small></div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={"nav" + (isActive(n.href) ? " on" : "")}>
            <n.Icon size={17} strokeWidth={2} style={{ flex: "none" }} />{t(n.label)}
          </Link>
        ))}
        <div className="who">
          <div className="row" style={{ gap: 6, padding: "0 12px 8px" }}>
            {LANGS.map((l) => (
              <button key={l} className={"chip" + (lang === l ? " on" : "")} style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setLang(l)}>{LANG_LABEL[l]}</button>
            ))}
          </div>
          <button className="nav" style={{ padding: "8px 12px" }} onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>
            <LogOut size={15} strokeWidth={2} style={{ flex: "none" }} />{t("signOut")}
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
