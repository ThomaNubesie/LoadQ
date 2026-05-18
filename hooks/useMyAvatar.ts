import { useEffect, useState } from "react";
import { supabase } from "../services/supabase";

// Resolves the signed-in user's avatar URL, checking drivers then passengers.
// Cached at module level so the BottomNav doesn't refetch on every screen.
let _cached: string | null = null;
let _fetched = false;
const _listeners = new Set<() => void>();

export function clearMyAvatarCache() {
  _cached = null;
  _fetched = false;
  _listeners.forEach(fn => fn());
}

async function fetchAvatar(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { _cached = null; _fetched = true; _listeners.forEach(fn => fn()); return; }

  const { data: drv } = await supabase
    .from("drivers").select("avatar_url").eq("id", user.id).maybeSingle();
  if (drv?.avatar_url) {
    _cached = drv.avatar_url;
  } else {
    const { data: pax } = await supabase
      .from("passengers").select("avatar_url").eq("id", user.id).maybeSingle();
    _cached = pax?.avatar_url ?? null;
  }
  _fetched = true;
  _listeners.forEach(fn => fn());
}

export function useMyAvatar(): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const update = () => tick(t => t + 1);
    _listeners.add(update);
    if (!_fetched) fetchAvatar();
    return () => { _listeners.delete(update); };
  }, []);
  return _cached;
}
