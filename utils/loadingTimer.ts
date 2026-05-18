// Per-driver loading timer rules:
//   t < 1h00:        required = seats
//   1h00 ≤ t < 1h30: required = seats - 1
//   1h30 ≤ t < 2h00: required = seats - 3   (cumulative jump)
//   t ≥ 1h50:        warning banner ("reaching 2-hour mark")
//   t ≥ 2h00:        hard close (handled server-side by watchdog)
//
// Loading window: 4:00 — 23:59 local time. Outside this window joinQueue
// and startLoading are blocked; in-progress loads are force-closed at 23:59
// by the watchdog regardless of timer.

const MIN  = 60_000;
const HOUR = 60 * MIN;

export type LoadingPhase = "normal" | "reduced1" | "reduced3" | "warning" | "expired";

export interface LoadingState {
  phase:             LoadingPhase;
  elapsedMs:         number;
  remainingMs:       number;          // until 2h hard close (0 if expired)
  effectiveRequired: number;          // seats after reduction (no floor — can go negative)
  showWarning:       boolean;         // true once t ≥ 1h50
}

export function loadingState(loadStartAt: string | null | undefined, seats: number, now: number = Date.now()): LoadingState | null {
  if (!loadStartAt) return null;
  const startMs   = new Date(loadStartAt).getTime();
  if (Number.isNaN(startMs)) return null;
  const elapsedMs = Math.max(0, now - startMs);

  let phase: LoadingPhase;
  let effectiveRequired: number;
  if      (elapsedMs >= 2 * HOUR)             { phase = "expired";  effectiveRequired = seats - 3; }
  else if (elapsedMs >= HOUR + 50 * MIN)      { phase = "warning";  effectiveRequired = seats - 3; }
  else if (elapsedMs >= HOUR + 30 * MIN)      { phase = "reduced3"; effectiveRequired = seats - 3; }
  else if (elapsedMs >= HOUR)                 { phase = "reduced1"; effectiveRequired = seats - 1; }
  else                                        { phase = "normal";   effectiveRequired = seats;     }

  return {
    phase,
    elapsedMs,
    remainingMs: Math.max(0, 2 * HOUR - elapsedMs),
    effectiveRequired,
    showWarning: elapsedMs >= HOUR + 50 * MIN,
  };
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Loading window in the zone's local time. Pass `tz` (IANA) to evaluate it
// for a specific zone; omit to use the device's local time.
//   Open  04:00
//   Close 20:00 (8 PM) — window is [04:00, 20:00)
export const LOAD_WINDOW_OPEN_HOUR  = 4;
export const LOAD_WINDOW_CLOSE_HOUR = 20;
export const LOAD_WINDOW_CLOSE_MIN  = 0;

function partsInTz(d: Date, tz?: string): { hour: number; minute: number } {
  if (!tz) return { hour: d.getHours(), minute: d.getMinutes() };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  return {
    hour:   Number(parts.find(p => p.type === "hour")?.value   ?? "0"),
    minute: Number(parts.find(p => p.type === "minute")?.value ?? "0"),
  };
}

export function isWithinLoadingWindow(now: Date = new Date(), tz?: string): boolean {
  const { hour, minute } = partsInTz(now, tz);
  if (hour < LOAD_WINDOW_OPEN_HOUR) return false;
  // Closed at exactly 20:00 onward (window is [04:00, 20:00)).
  if (hour > LOAD_WINDOW_CLOSE_HOUR) return false;
  if (hour === LOAD_WINDOW_CLOSE_HOUR && minute >= LOAD_WINDOW_CLOSE_MIN) return false;
  return true;
}

// Returns the next Date at which the loading window opens in `tz`.
// When `tz` is omitted, computes against the device's local time.
export function nextWindowOpen(now: Date = new Date(), tz?: string): Date {
  if (!tz) {
    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setHours(LOAD_WINDOW_OPEN_HOUR, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }
  // Find the soonest instant where (hour,minute) in `tz` is 04:00.
  // Step minute-by-minute from `now`; cap at 24h to bound the loop.
  const start = new Date(now);
  for (let i = 1; i <= 60 * 24; i++) {
    const candidate = new Date(start.getTime() + i * 60_000);
    const { hour, minute } = partsInTz(candidate, tz);
    if (hour === LOAD_WINDOW_OPEN_HOUR && minute === 0) return candidate;
  }
  return new Date(start.getTime() + 60 * 60_000); // fallback
}
