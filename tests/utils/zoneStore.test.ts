import { saveActiveZone, loadActiveZone, clearActiveZone } from "../../utils/zoneStore";
import AsyncStorage from "@react-native-async-storage/async-storage";

const mockedAS = AsyncStorage as any;

describe("zoneStore", () => {
  beforeEach(async () => {
    mockedAS._store.clear();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("returns null when no zone has been saved", async () => {
    const result = await loadActiveZone();
    expect(result).toBeNull();
  });

  it("save/load round-trips zoneId + manual flag", async () => {
    await saveActiveZone("zone-1", true);
    const loaded = await loadActiveZone();
    expect(loaded?.zoneId).toBe("zone-1");
    expect(loaded?.manual).toBe(true);
    expect(typeof loaded?.savedAt).toBe("number");
  });

  it("manual=false is preserved on roundtrip", async () => {
    await saveActiveZone("zone-2", false);
    const loaded = await loadActiveZone();
    expect(loaded?.manual).toBe(false);
  });

  it("returns null after clearActiveZone", async () => {
    await saveActiveZone("zone-x", true);
    await clearActiveZone();
    expect(await loadActiveZone()).toBeNull();
  });

  it("returns null when stored entry is older than 6h TTL", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-31T10:00:00Z"));
    await saveActiveZone("zone-old", true);

    // Advance time past 6h.
    jest.setSystemTime(new Date("2026-05-31T16:00:01Z"));
    const result = await loadActiveZone();
    expect(result).toBeNull();
    jest.useRealTimers();
  });

  it("returns the zone when within 6h TTL", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-31T10:00:00Z"));
    await saveActiveZone("zone-fresh", false);

    jest.setSystemTime(new Date("2026-05-31T15:59:00Z"));
    const result = await loadActiveZone();
    expect(result?.zoneId).toBe("zone-fresh");
    jest.useRealTimers();
  });

  it("returns null when stored JSON is malformed", async () => {
    await mockedAS.setItem("active-zone-v1", "not json");
    const result = await loadActiveZone();
    expect(result).toBeNull();
  });

  it("returns null when stored payload is missing zoneId", async () => {
    await mockedAS.setItem("active-zone-v1", JSON.stringify({ manual: true, savedAt: Date.now() }));
    const result = await loadActiveZone();
    expect(result).toBeNull();
  });

  it("returns null when stored payload has non-numeric savedAt", async () => {
    await mockedAS.setItem("active-zone-v1", JSON.stringify({ zoneId: "z", manual: true, savedAt: "now" }));
    const result = await loadActiveZone();
    expect(result).toBeNull();
  });
});
