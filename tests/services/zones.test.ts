import { ZonesAPI } from "../../services/zones";
import {
  pushResult, resetSupabaseMock,
  fromCalls, eqCalls, orderCalls, insertCalls, updateCalls,
} from "../__mocks__/supabase";

beforeEach(() => {
  resetSupabaseMock();
});

describe("ZonesAPI.list", () => {
  it("returns active zones ordered by region then name", async () => {
    pushResult([
      { id: "gatineau-mcdo", region: "gatineau", name: "McDonald's", is_active: true },
      { id: "ottawa-george", region: "ottawa",   name: "George St",  is_active: true },
    ]);
    const r = await ZonesAPI.list();
    expect(r).toHaveLength(2);
    expect(fromCalls).toContain("zones");
    expect(orderCalls.some(([col]) => col === "region")).toBe(true);
    expect(orderCalls.some(([col]) => col === "name")).toBe(true);
  });
});

describe("ZonesAPI.add", () => {
  it("inserts a new zone row", async () => {
    pushResult({ id: "new-zone" });
    const r = await ZonesAPI.add({
      id:             "new-zone",
      name:           "Test Zone",
      region:         "ottawa",
      address:        "123 Test St",
      latitude:       45.4,
      longitude:      -75.7,
      radius_meters:  100,
      timezone:       "America/Toronto",
      is_active:      true,
    });
    expect(r.data?.id).toBe("new-zone");
    expect(insertCalls.find(p => p.id === "new-zone")).toBeDefined();
  });
});

describe("ZonesAPI.update", () => {
  it("patches the targeted zone", async () => {
    pushResult({ id: "z-1", name: "Renamed" });
    await ZonesAPI.update("z-1", { name: "Renamed" });
    expect(updateCalls.find(p => p.name === "Renamed")).toBeDefined();
    expect(eqCalls).toContainEqual(["id", "z-1"]);
  });
});

describe("ZonesAPI.setActive", () => {
  it("flips is_active", async () => {
    pushResult(null);
    await ZonesAPI.setActive("z-1", false);
    expect(updateCalls.find(p => p.is_active === false)).toBeDefined();
    expect(eqCalls).toContainEqual(["id", "z-1"]);
  });
});
