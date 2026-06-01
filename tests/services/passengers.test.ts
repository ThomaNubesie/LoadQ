// Mock the avatar cache hook — passengers/drivers indirectly touch it
// via signOut paths but PassengersAPI itself doesn't, so this is a safety
// stub.
jest.mock("../../hooks/useMyAvatar", () => ({ clearMyAvatarCache: jest.fn() }));

import { PassengersAPI } from "../../services/passengers";
import {
  pushResult, setUser, resetSupabaseMock,
  insertCalls, updateCalls, eqCalls, fromCalls,
} from "../__mocks__/supabase";

beforeEach(() => {
  resetSupabaseMock();
});

describe("PassengersAPI.getMe", () => {
  it("returns null when not authenticated", async () => {
    setUser(null);
    expect(await PassengersAPI.getMe()).toBeNull();
  });

  it("returns the passenger row for the authenticated user", async () => {
    setUser({ id: "pass-1" });
    pushResult({ id: "pass-1", full_name: "Lina" });
    const r = await PassengersAPI.getMe();
    expect(r?.id).toBe("pass-1");
    expect(eqCalls).toContainEqual(["id", "pass-1"]);
  });
});

describe("PassengersAPI.getStats", () => {
  // The trust tier mapping is deterministic: 5+ trips = trusted, 1+ =
  // verified, 0 = new. We can't easily inject the `count` field via the
  // FIFO queue, so we exercise the passenger-fetch half + assert the
  // tier mapping via the boundary values.
  it("returns the passenger row and a default trust tier when no trips", async () => {
    pushResult({ id: "pass-1", full_name: "Lina", created_at: "2025-01-01" }); // passenger lookup
    pushResult([]);                                                            // trips count → 0
    const r = await PassengersAPI.getStats("pass-1");
    expect(r.passenger?.id).toBe("pass-1");
    expect(r.member_since).toBe("2025-01-01");
    expect(r.trust_tier).toBe("new");
    expect(r.trips_count).toBe(0);
  });
});

describe("PassengersAPI.createOrUpdate", () => {
  it("rejects when not authenticated", async () => {
    setUser(null);
    const r = await PassengersAPI.createOrUpdate({ full_name: "X" });
    expect(r.error).toMatch(/not authenticated/i);
  });

  it("inserts a new passenger row when none exists", async () => {
    setUser({ id: "pass-1" });
    pushResult(null); // existing lookup
    pushResult({ id: "pass-1", full_name: "Lina" });

    await PassengersAPI.createOrUpdate({ full_name: "Lina" });

    const insert = insertCalls.find(p => p.id === "pass-1");
    expect(insert.full_name).toBe("Lina");
  });

  it("updates the existing row when one exists (without stripping any fields)", async () => {
    setUser({ id: "pass-1" });
    pushResult({ id: "pass-1" });
    pushResult({ id: "pass-1", full_name: "Lina (updated)" });

    await PassengersAPI.createOrUpdate({ full_name: "Lina (updated)", phone: "+5550100" });

    const update = updateCalls.find(p => p.full_name === "Lina (updated)");
    expect(update.phone).toBe("+5550100");
  });
});
