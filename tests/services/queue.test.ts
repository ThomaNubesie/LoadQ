// Mock dependencies BEFORE importing QueueAPI so the module picks up
// the mocked DriversAPI / zones helpers.
jest.mock("../../services/drivers", () => ({
  DriversAPI: {
    getMe: jest.fn(),
    hasActiveSubscription: jest.fn(),
  },
}));

jest.mock("../../hooks/useZones", () => ({
  useZones: jest.fn(),
  getZoneTimezone: jest.fn(() => "America/Toronto"),
  getZoneById:     jest.fn(),
  getCurrentZones: jest.fn(() => []),
}));

import { QueueAPI } from "../../services/queue";
import { DriversAPI } from "../../services/drivers";
import {
  pushResult, setUser, resetSupabaseMock,
  fromCalls, insertCalls, eqCalls, gteCalls, orderCalls,
} from "../__mocks__/supabase";

const mockGetMe              = DriversAPI.getMe              as jest.Mock;
const mockHasActiveSubscription = DriversAPI.hasActiveSubscription as jest.Mock;

const verifiedDriver = {
  id: "drv-1",
  full_name: "Jean Martin",
  phone:     "+15551234567",
  dob:       "1990-01-01",
  sex:       "M",
  verified:  true,
  blocked:   false,
};

beforeEach(() => {
  resetSupabaseMock();
  mockGetMe.mockReset();
  mockHasActiveSubscription.mockReset();
});

describe("QueueAPI.canJoin", () => {
  it("rejects when not authenticated", async () => {
    setUser(null);
    const r = await QueueAPI.canJoin();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not authenticated/i);
  });

  it("rejects when driver profile is missing", async () => {
    setUser({ id: "drv-1" });
    mockGetMe.mockResolvedValue(null);
    const r = await QueueAPI.canJoin();
    expect(r.reason).toMatch(/driver profile not found/i);
  });

  it("rejects a blocked driver", async () => {
    setUser({ id: "drv-1" });
    mockGetMe.mockResolvedValue({ ...verifiedDriver, blocked: true });
    const r = await QueueAPI.canJoin();
    expect(r.reason).toMatch(/blocked/i);
  });

  it("rejects an unverified driver", async () => {
    setUser({ id: "drv-1" });
    mockGetMe.mockResolvedValue({ ...verifiedDriver, verified: false });
    const r = await QueueAPI.canJoin();
    expect(r.reason).toMatch(/pending verification/i);
  });

  it("rejects when profile fields are incomplete", async () => {
    setUser({ id: "drv-1" });
    mockGetMe.mockResolvedValue({ ...verifiedDriver, phone: "" });
    const r = await QueueAPI.canJoin();
    expect(r.reason).toMatch(/complete your profile/i);
  });

  it("rejects when no active vehicle exists", async () => {
    setUser({ id: "drv-1" });
    mockGetMe.mockResolvedValue(verifiedDriver);
    pushResult(null); // vehicles query → no active vehicle
    const r = await QueueAPI.canJoin();
    expect(r.reason).toMatch(/active vehicle/i);
  });

  it("rejects when subscription is inactive", async () => {
    setUser({ id: "drv-1" });
    mockGetMe.mockResolvedValue(verifiedDriver);
    pushResult({ id: "veh-1" }); // active vehicle exists
    mockHasActiveSubscription.mockResolvedValue(false);
    const r = await QueueAPI.canJoin();
    expect(r.reason).toMatch(/subscription/i);
  });

  it("returns ok when all gates pass", async () => {
    setUser({ id: "drv-1" });
    mockGetMe.mockResolvedValue(verifiedDriver);
    pushResult({ id: "veh-1" });
    mockHasActiveSubscription.mockResolvedValue(true);
    const r = await QueueAPI.canJoin();
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });
});

describe("QueueAPI.joinQueue", () => {
  // Helper: prime the 4 results that joinQueue consumes after canJoin
  // passes — cooldown lookup, position lookup, isFirstLoader lookup, insert.
  function primeJoinPath({
    recentDepart,
    maxPosition,
    isFirstLoader,
    insertRow,
  }: {
    recentDepart?:  any;
    maxPosition?:   number | null;
    isFirstLoader?: boolean;
    insertRow?:     any;
  }) {
    pushResult(recentDepart ?? null);                          // loading_history cooldown lookup
    pushResult(maxPosition != null ? [{ position: maxPosition }] : []); // queue_entries position lookup
    pushResult(isFirstLoader ? [] : [{ id: "other-entry" }]);  // queue_entries existing loading lookup
    pushResult(insertRow ?? { id: "new-entry" });              // insert + select + single
  }

  function primeCanJoinOk() {
    mockGetMe.mockResolvedValue(verifiedDriver);
    pushResult({ id: "veh-1" });
    mockHasActiveSubscription.mockResolvedValue(true);
  }

  // Pin clock to a Tuesday afternoon (within 04:00-20:00 window) so the
  // window check passes regardless of when the test runs.
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-31T16:00:00")); // local 4 PM
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it("rejects when not authenticated", async () => {
    setUser(null);
    const r = await QueueAPI.joinQueue("zone-1", "veh-1", "montreal");
    expect(r.error).toMatch(/not authenticated/i);
  });

  it("rejects when destination is missing", async () => {
    setUser({ id: "drv-1" });
    const r = await QueueAPI.joinQueue("zone-1", "veh-1", "");
    expect(r.error).toMatch(/destination is required/i);
  });

  it("rejects when canJoin fails (e.g., blocked driver)", async () => {
    setUser({ id: "drv-1" });
    mockGetMe.mockResolvedValue({ ...verifiedDriver, blocked: true });
    const r = await QueueAPI.joinQueue("zone-1", "veh-1", "montreal");
    expect(r.error).toMatch(/blocked/i);
  });

  it("rejects with remaining-minutes message when departed within last 60 min", async () => {
    setUser({ id: "drv-1" });
    primeCanJoinOk();
    // Departed 20 min ago → 40 min remaining
    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    pushResult({ ended_at: twentyMinAgo });

    const r = await QueueAPI.joinQueue("zone-1", "veh-1", "montreal");
    expect(r.error).toMatch(/wait 40 min/i);
  });

  it("filters the cooldown query by zone + driver + end_reason=departed + 60-min window", async () => {
    setUser({ id: "drv-1" });
    primeCanJoinOk();
    primeJoinPath({ maxPosition: null, isFirstLoader: true });

    await QueueAPI.joinQueue("zone-1", "veh-1", "montreal");

    expect(fromCalls).toContain("loading_history");
    // The cooldown query must filter zone + driver + end_reason='departed'
    expect(eqCalls).toContainEqual(["zone_id", "zone-1"]);
    expect(eqCalls).toContainEqual(["driver_id", "drv-1"]);
    expect(eqCalls).toContainEqual(["end_reason", "departed"]);
    // gte filters by ended_at since 60 min ago
    expect(gteCalls.some(([col]) => col === "ended_at")).toBe(true);
  });

  it("auto-promotes to loading status when no one is currently loading on that route", async () => {
    setUser({ id: "drv-1" });
    primeCanJoinOk();
    primeJoinPath({ maxPosition: null, isFirstLoader: true });

    await QueueAPI.joinQueue("zone-1", "veh-1", "montreal");

    const insert = insertCalls.find(p => p.zone_id === "zone-1");
    expect(insert).toBeDefined();
    expect(insert.status).toBe("loading");
    expect(insert.load_start_at).toBeTruthy();
    expect(insert.load_deadline).toBeTruthy();
    expect(insert.position).toBe(1);
  });

  it("joins as 'waiting' when someone else is already loading on this route", async () => {
    setUser({ id: "drv-1" });
    primeCanJoinOk();
    primeJoinPath({ maxPosition: 3, isFirstLoader: false });

    await QueueAPI.joinQueue("zone-1", "veh-1", "montreal");

    const insert = insertCalls.find(p => p.zone_id === "zone-1");
    expect(insert.status).toBe("waiting");
    expect(insert.load_start_at).toBeUndefined();
    expect(insert.load_deadline).toBeUndefined();
    expect(insert.position).toBe(4); // max + 1
  });

  it("position starts at 1 when no prior entries exist on this route", async () => {
    setUser({ id: "drv-1" });
    primeCanJoinOk();
    primeJoinPath({ maxPosition: null, isFirstLoader: true });

    await QueueAPI.joinQueue("zone-1", "veh-1", "montreal");

    const insert = insertCalls.find(p => p.zone_id === "zone-1");
    expect(insert.position).toBe(1);
  });

  it("position computes max+1 across the entire route's day (including ended rows)", async () => {
    setUser({ id: "drv-1" });
    primeCanJoinOk();
    primeJoinPath({ maxPosition: 17, isFirstLoader: false });

    await QueueAPI.joinQueue("zone-1", "veh-1", "montreal");

    const insert = insertCalls.find(p => p.zone_id === "zone-1");
    expect(insert.position).toBe(18);
  });

  it("retries with a recomputed position when the slot collides (unique violation)", async () => {
    setUser({ id: "drv-1" });
    primeCanJoinOk();
    pushResult(null);                       // cooldown: no recent depart
    // Attempt 0: sees max position 3 → tries 4, but another driver took it.
    pushResult([{ position: 3 }]);          // position lookup
    pushResult([{ id: "other-entry" }]);    // existing loading → waiting
    pushResult(null, { code: "23505", message: "duplicate key value violates unique constraint" });
    // Attempt 1: re-reads (the winner's row 4 is now committed) → takes 5.
    pushResult([{ position: 4 }]);          // position lookup (now sees 4)
    pushResult([{ id: "other-entry" }]);    // existing loading → waiting
    pushResult({ id: "new-entry" });        // insert succeeds

    const r = await QueueAPI.joinQueue("zone-1", "veh-1", "montreal");

    expect(r.error).toBeUndefined();
    const positions = insertCalls.filter(p => p.zone_id === "zone-1").map(p => p.position);
    expect(positions).toEqual([4, 5]);      // first try 4 (rejected), retry 5
  });

  it("does NOT retry on a non-unique error and surfaces it", async () => {
    setUser({ id: "drv-1" });
    primeCanJoinOk();
    pushResult(null);                       // cooldown
    pushResult([{ position: 3 }]);          // position lookup
    pushResult([{ id: "other-entry" }]);    // existing loading → waiting
    pushResult(null, { code: "23514", message: "check constraint violation" });

    const r = await QueueAPI.joinQueue("zone-1", "veh-1", "montreal");

    expect(r.error).toMatch(/check constraint/i);
    // Only one insert attempt — a non-unique error is not retried.
    expect(insertCalls.filter(p => p.zone_id === "zone-1").length).toBe(1);
  });
});
