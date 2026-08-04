"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Bounce the bare domain to the console (or login if signed out).
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      router.replace(session ? "/admin/zones" : "/login");
    });
  }, [router]);
  return <div className="center"><div className="muted">Loading…</div></div>;
}
