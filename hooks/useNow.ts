import { useEffect, useState } from "react";

// Re-renders every `intervalMs` so timer-driven UI stays current.
// Default 1s. Pause by passing `enabled=false`.
export function useNow(intervalMs: number = 1000, enabled: boolean = true): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}
