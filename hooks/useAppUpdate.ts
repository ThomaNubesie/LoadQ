// "Update available" check: compares the installed app version against
// loadq_settings.loadq_latest_version. Returns a numeric "behind" count for the
// Profile badge and a helper to open the right store.
import { useEffect, useState } from "react";
import { Platform, Linking } from "react-native";
import Constants from "expo-constants";
import { supabase } from "../services/supabase";

const IOS_URL = "https://apps.apple.com/app/id6770652996";
const ANDROID_URL = "https://play.google.com/store/apps/details?id=ca.loadq.app";

const parse = (v?: string | null) => (v || "0.0.0").split(".").map((n) => parseInt(n, 10) || 0);
const cmp = (a: number[], b: number[]) => { for (let i = 0; i < 3; i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };

function behindCount(installed: number[], latest: number[]): number {
  if (cmp(latest, installed) <= 0) return 0;
  if (latest[0] === installed[0] && latest[1] === installed[1]) return Math.max(1, latest[2] - installed[2]);
  return 1;
}

export function useAppUpdate() {
  const installed = Constants.expoConfig?.version ?? (Constants as any).nativeAppVersion ?? "0.0.0";
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    supabase.rpc("loadq_app_latest_version").then(({ data }) => { if (on) setLatest((data as string) ?? null); });
    return () => { on = false; };
  }, []);

  const behind = latest ? behindCount(parse(installed), parse(latest)) : 0;

  const openStore = () => {
    Linking.openURL(Platform.OS === "ios" ? IOS_URL : ANDROID_URL).catch(() => {});
  };

  return { available: behind > 0, behind, latest, installed, openStore };
}
