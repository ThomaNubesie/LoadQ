import { loadingState, formatRemaining, isWithinLoadingWindow, nextWindowOpen } from "../../utils/loadingTimer";

const MIN  = 60_000;
const HOUR = 60 * MIN;

describe("loadingState", () => {
  const seats = 4;
  const start = new Date("2026-05-31T10:00:00Z").getTime();

  it("returns null when loadStartAt is missing", () => {
    expect(loadingState(null, seats, start)).toBeNull();
    expect(loadingState(undefined, seats, start)).toBeNull();
  });

  it("returns null when loadStartAt is unparseable", () => {
    expect(loadingState("not-a-date", seats, start)).toBeNull();
  });

  it("normal phase when t < 1h30", () => {
    const s = loadingState(new Date(start).toISOString(), seats, start + HOUR);
    expect(s).toMatchObject({ phase: "normal", effectiveRequired: seats });
    expect(s!.remainingMs).toBe(2 * HOUR);
    expect(s!.showWarning).toBe(false);
  });

  it("reduced1 phase at 1h30 elapsed", () => {
    const s = loadingState(new Date(start).toISOString(), seats, start + HOUR + 30 * MIN);
    expect(s!.phase).toBe("reduced1");
    expect(s!.effectiveRequired).toBe(seats - 1);
  });

  it("reduced1 phase still active just before 2h15", () => {
    const s = loadingState(new Date(start).toISOString(), seats, start + 2 * HOUR + 14 * MIN);
    expect(s!.phase).toBe("reduced1");
    expect(s!.effectiveRequired).toBe(seats - 1);
  });

  it("reduced3 phase at exactly 2h15 elapsed", () => {
    const s = loadingState(new Date(start).toISOString(), seats, start + 2 * HOUR + 15 * MIN);
    expect(s!.phase).toBe("reduced3");
    expect(s!.effectiveRequired).toBe(seats - 3);
  });

  it("warning phase at 2h45 elapsed", () => {
    const s = loadingState(new Date(start).toISOString(), seats, start + 2 * HOUR + 45 * MIN);
    expect(s!.phase).toBe("warning");
    expect(s!.showWarning).toBe(true);
    expect(s!.effectiveRequired).toBe(seats - 3);
  });

  it("expired phase at exactly 3h elapsed", () => {
    const s = loadingState(new Date(start).toISOString(), seats, start + 3 * HOUR);
    expect(s!.phase).toBe("expired");
    expect(s!.remainingMs).toBe(0);
    expect(s!.effectiveRequired).toBe(seats - 3);
  });

  it("expired phase past 3h", () => {
    const s = loadingState(new Date(start).toISOString(), seats, start + 5 * HOUR);
    expect(s!.phase).toBe("expired");
    expect(s!.remainingMs).toBe(0);
  });

  it("elapsedMs clamps at 0 for future loadStartAt", () => {
    const s = loadingState(new Date(start + HOUR).toISOString(), seats, start);
    expect(s!.elapsedMs).toBe(0);
    expect(s!.phase).toBe("normal");
  });

  it("effectiveRequired can go negative when seats is small", () => {
    const s = loadingState(new Date(start).toISOString(), 2, start + 2 * HOUR + 30 * MIN);
    // seats=2 minus 3 = -1, no floor by design
    expect(s!.effectiveRequired).toBe(-1);
  });
});

describe("formatRemaining", () => {
  it("returns 0:00 when remaining <= 0", () => {
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-1000)).toBe("0:00");
  });

  it("formats minutes and seconds", () => {
    expect(formatRemaining(125 * 1000)).toBe("2:05");
  });

  it("pads single-digit seconds", () => {
    expect(formatRemaining(61 * 1000)).toBe("1:01");
  });

  it("handles >60 minutes by counting up", () => {
    expect(formatRemaining(75 * 60 * 1000)).toBe("75:00");
  });
});

describe("isWithinLoadingWindow", () => {
  it("returns true at 04:00 device-local", () => {
    const d = new Date();
    d.setHours(4, 0, 0, 0);
    expect(isWithinLoadingWindow(d)).toBe(true);
  });

  it("returns false at 03:59 device-local", () => {
    const d = new Date();
    d.setHours(3, 59, 0, 0);
    expect(isWithinLoadingWindow(d)).toBe(false);
  });

  it("returns true at 19:59 device-local", () => {
    const d = new Date();
    d.setHours(19, 59, 0, 0);
    expect(isWithinLoadingWindow(d)).toBe(true);
  });

  it("returns false at 20:00 device-local (window closes at 20:00)", () => {
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    expect(isWithinLoadingWindow(d)).toBe(false);
  });

  it("returns false at 23:59 device-local", () => {
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    expect(isWithinLoadingWindow(d)).toBe(false);
  });
});

describe("nextWindowOpen", () => {
  it("returns same day 04:00 when called before 04:00", () => {
    const at = new Date();
    at.setHours(2, 0, 0, 0);
    const next = nextWindowOpen(at);
    expect(next.getHours()).toBe(4);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(at.getDate());
  });

  it("returns next day 04:00 when called at or after 04:00", () => {
    const at = new Date();
    at.setHours(10, 0, 0, 0);
    const next = nextWindowOpen(at);
    expect(next.getHours()).toBe(4);
    expect(next.getDate()).toBe(at.getDate() + 1);
  });
});
