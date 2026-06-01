import { HistoryAPI } from "../../services/history";
import {
  pushResult, setUser, resetSupabaseMock,
  fromCalls, eqCalls, gteCalls, orderCalls, limitCalls,
} from "../__mocks__/supabase";

beforeEach(() => {
  resetSupabaseMock();
});

describe("HistoryAPI.listMine", () => {
  it("returns [] when not authenticated", async () => {
    setUser(null);
    expect(await HistoryAPI.listMine()).toEqual([]);
  });

  it("filters by driver_id and ended_at >= 7 days ago", async () => {
    setUser({ id: "drv-1" });
    pushResult([{ id: "h1", driver_id: "drv-1", zone_id: "z-1", ended_at: "x", end_reason: "departed", seats_filled: 4, created_at: "y" }]);

    await HistoryAPI.listMine();

    expect(fromCalls).toContain("loading_history");
    expect(eqCalls).toContainEqual(["driver_id", "drv-1"]);
    expect(gteCalls.some(([col]) => col === "ended_at")).toBe(true);
    expect(orderCalls).toContainEqual(["ended_at", { ascending: false }]);
  });
});

describe("HistoryAPI.listAll", () => {
  it("orders by ended_at desc and caps at 500", async () => {
    pushResult([]);
    await HistoryAPI.listAll();
    expect(orderCalls).toContainEqual(["ended_at", { ascending: false }]);
    expect(limitCalls).toContain(500);
  });
});

describe("HistoryAPI.listForZone", () => {
  it("filters by zone_id, ended_at >= sinceMs, orders desc, caps at 200", async () => {
    pushResult([]);
    const since = Date.UTC(2026, 4, 31, 4, 0, 0); // 4am May 31 UTC

    await HistoryAPI.listForZone("zone-1", since);

    expect(fromCalls).toContain("loading_history");
    expect(eqCalls).toContainEqual(["zone_id", "zone-1"]);
    expect(gteCalls.some(([col, val]) => col === "ended_at" && typeof val === "string")).toBe(true);
    expect(orderCalls).toContainEqual(["ended_at", { ascending: false }]);
    expect(limitCalls).toContain(200);
  });

  it("returns rows when they exist", async () => {
    pushResult([{ id: "h1" }, { id: "h2" }]);
    const r = await HistoryAPI.listForZone("zone-1", 0);
    expect(r).toHaveLength(2);
  });
});
