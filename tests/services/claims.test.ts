import { ClaimsAPI } from "../../services/claims";
import {
  pushResult, setUser, resetSupabaseMock,
  fromCalls, insertCalls, updateCalls, eqCalls,
} from "../__mocks__/supabase";

beforeEach(() => {
  resetSupabaseMock();
});

describe("ClaimsAPI.claim", () => {
  it("rejects when not authenticated", async () => {
    setUser(null);
    const r = await ClaimsAPI.claim("entry-1");
    expect(r.error).toMatch(/not authenticated/i);
  });

  it("rejects when the passenger account is blocked", async () => {
    setUser({ id: "pass-1" });
    pushResult({ blocked: true }); // passenger blocked lookup
    const r = await ClaimsAPI.claim("entry-1");
    expect(r.error).toMatch(/blocked/i);
  });

  it("inserts a pending claim for an unblocked passenger", async () => {
    setUser({ id: "pass-1" });
    pushResult({ blocked: false });  // passenger lookup
    pushResult({ id: "claim-1", passenger_id: "pass-1", queue_entry_id: "entry-1", status: "pending" });

    const r = await ClaimsAPI.claim("entry-1");
    expect(r.error).toBeFalsy();
    expect(r.data?.id).toBe("claim-1");

    const insert = insertCalls.find(p => p.queue_entry_id === "entry-1");
    expect(insert).toMatchObject({
      passenger_id:    "pass-1",
      queue_entry_id:  "entry-1",
      status:          "pending",
    });
  });
});

describe("ClaimsAPI.cancel", () => {
  it("updates the claim to cancelled status", async () => {
    pushResult(null); // update returns nothing useful
    await ClaimsAPI.cancel("claim-1");

    const update = updateCalls.find(p => p.status === "cancelled");
    expect(update).toBeDefined();
    expect(update.cancelled_at).toBeTruthy();
    expect(eqCalls).toContainEqual(["id", "claim-1"]);
    expect(eqCalls).toContainEqual(["status", "pending"]);
  });
});

describe("ClaimsAPI.findOpenClaim", () => {
  it("returns null when not authenticated", async () => {
    setUser(null);
    const r = await ClaimsAPI.findOpenClaim("entry-1");
    expect(r).toBeNull();
  });

  it("returns the existing open claim for this user + entry", async () => {
    setUser({ id: "pass-1" });
    pushResult({ id: "claim-1", status: "pending", queue_entry_id: "entry-1", passenger_id: "pass-1", claimed_at: "x" });
    const r = await ClaimsAPI.findOpenClaim("entry-1");
    expect(r?.id).toBe("claim-1");
    expect(eqCalls).toContainEqual(["passenger_id", "pass-1"]);
    expect(eqCalls).toContainEqual(["queue_entry_id", "entry-1"]);
  });

  it("returns null when no claim exists", async () => {
    setUser({ id: "pass-1" });
    pushResult(null);
    const r = await ClaimsAPI.findOpenClaim("entry-1");
    expect(r).toBeNull();
  });
});

describe("ClaimsAPI.listPending", () => {
  it("returns pending claims ordered by claimed_at ascending", async () => {
    pushResult([
      { id: "c1", status: "pending", queue_entry_id: "entry-1", claimed_at: "2026-05-31T10:00:00Z" },
      { id: "c2", status: "pending", queue_entry_id: "entry-1", claimed_at: "2026-05-31T10:01:00Z" },
    ]);
    const r = await ClaimsAPI.listPending("entry-1");
    expect(r).toHaveLength(2);
    expect(eqCalls).toContainEqual(["queue_entry_id", "entry-1"]);
    expect(eqCalls).toContainEqual(["status", "pending"]);
  });
});

describe("ClaimsAPI.listConfirmedFor", () => {
  it("returns confirmed claims ordered by confirmed_at ascending", async () => {
    pushResult([
      { id: "c1", status: "confirmed", confirmed_at: "2026-05-31T10:00:00Z" },
    ]);
    const r = await ClaimsAPI.listConfirmedFor("entry-1");
    expect(r).toHaveLength(1);
    expect(eqCalls).toContainEqual(["status", "confirmed"]);
  });
});

describe("ClaimsAPI.confirm", () => {
  const claim: any = {
    id: "claim-1",
    passenger_id: "pass-1",
    queue_entry_id: "entry-1",
    status: "pending",
  };

  it("returns an error when updating the claim fails", async () => {
    pushResult(null, { message: "race-conflict" });
    const r = await ClaimsAPI.confirm(claim, "zone-1", "montreal", 15);
    expect(r.error).toBe("race-conflict");
  });

  it("locks the first empty seat and bumps boarded + locked counts", async () => {
    pushResult(null);                                              // update claim → ok
    pushResult({                                                   // fetch entry
      seats_boarded: 0,
      seats_locked:  0,
      driver_id:     "drv-1",
      seat_states:   ["empty", "empty", "empty", "empty"],
      vehicle:       { seats: 5 },                                  // capacity 4 (excluding driver) + 1 driver = 5
    });
    pushResult(null);                                              // update entry → ok
    pushResult(null);                                              // insert trip → ok

    await ClaimsAPI.confirm(claim, "zone-1", "montreal", 15);

    const entryUpdate = updateCalls.find(p => p.seat_states);
    expect(entryUpdate.seats_boarded).toBe(1);
    expect(entryUpdate.seats_locked).toBe(1);
    expect(entryUpdate.seat_states).toEqual(["locked", "empty", "empty", "empty"]);

    const tripInsert = insertCalls.find(p => p.passenger_id === "pass-1");
    expect(tripInsert).toMatchObject({
      passenger_id:       "pass-1",
      driver_id:          "drv-1",
      queue_entry_id:     "entry-1",
      zone_id:            "zone-1",
      destination_region: "montreal",
      price_paid:         15,
    });
  });

  it("places the lock at the first empty index when earlier seats are taken", async () => {
    pushResult(null);
    pushResult({
      seats_boarded: 2,
      seats_locked:  1,
      driver_id:     "drv-1",
      seat_states:   ["locked", "boarded", "empty", "empty"],
      vehicle:       { seats: 5 },
    });
    pushResult(null);
    pushResult(null);

    await ClaimsAPI.confirm(claim, "zone-1", "montreal", 15);

    const update = updateCalls.find(p => p.seat_states);
    expect(update.seat_states).toEqual(["locked", "boarded", "locked", "empty"]);
    expect(update.seats_boarded).toBe(3);
    expect(update.seats_locked).toBe(2);
  });

  it("parses seat_states even when stored as a JSON string", async () => {
    pushResult(null);
    pushResult({
      seats_boarded: 0,
      seats_locked:  0,
      driver_id:     "drv-1",
      seat_states:   JSON.stringify(["empty", "empty"]),
      vehicle:       { seats: 3 },
    });
    pushResult(null);
    pushResult(null);

    await ClaimsAPI.confirm(claim, "zone-1", "montreal", 15);

    const update = updateCalls.find(p => p.seat_states);
    expect(Array.isArray(update.seat_states)).toBe(true);
    expect(update.seat_states[0]).toBe("locked");
  });
});

describe("ClaimsAPI.reject", () => {
  it("marks the claim as rejected with a timestamp", async () => {
    pushResult(null);
    const r = await ClaimsAPI.reject("claim-1");
    expect(r.error).toBeFalsy();
    const update = updateCalls.find(p => p.status === "rejected");
    expect(update.rejected_at).toBeTruthy();
    expect(eqCalls).toContainEqual(["id", "claim-1"]);
  });
});
