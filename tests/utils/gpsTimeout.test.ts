import { tryGetUserLocation, getCurrentLocationWithTimeout, __resetGpsSingleFlight } from "../../utils/gpsTimeout";
import * as Location from "expo-location";

const mockedLocation = Location as jest.Mocked<typeof Location>;
const sampleCoords = { coords: { latitude: 45.4215, longitude: -75.6972 } } as any;

describe("tryGetUserLocation", () => {
  beforeEach(() => {
    jest.useRealTimers();
    __resetGpsSingleFlight();
    mockedLocation.requestForegroundPermissionsAsync.mockReset();
    mockedLocation.getCurrentPositionAsync.mockReset();
  });

  it("returns the location when permission granted and read succeeds", async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" } as any);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue(sampleCoords);

    const result = await tryGetUserLocation(1000);
    expect(result).toBe(sampleCoords);
  });

  it("returns null when permission denied", async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied" } as any);

    const result = await tryGetUserLocation(1000);
    expect(result).toBeNull();
    expect(mockedLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("returns null when permission request itself rejects", async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockRejectedValue(new Error("boom"));

    const result = await tryGetUserLocation(1000);
    expect(result).toBeNull();
  });

  it("returns null when getCurrentPositionAsync rejects", async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" } as any);
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error("gps off"));

    const result = await tryGetUserLocation(1000);
    expect(result).toBeNull();
  });

  it("returns null when the permission request hangs past timeout", async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockImplementation(
      () => new Promise(() => { /* never resolves */ }) as any,
    );

    const result = await tryGetUserLocation(50);
    expect(result).toBeNull();
  });

  it("returns null when location read hangs past timeout", async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" } as any);
    mockedLocation.getCurrentPositionAsync.mockImplementation(
      () => new Promise(() => { /* never resolves */ }) as any,
    );

    const result = await tryGetUserLocation(50);
    expect(result).toBeNull();
  });
});

describe("getCurrentLocationWithTimeout", () => {
  beforeEach(() => {
    jest.useRealTimers();
    __resetGpsSingleFlight();
    mockedLocation.getCurrentPositionAsync.mockReset();
  });

  it("returns location on success", async () => {
    mockedLocation.getCurrentPositionAsync.mockResolvedValue(sampleCoords);

    const result = await getCurrentLocationWithTimeout(1000);
    expect(result).toBe(sampleCoords);
  });

  it("returns null on timeout", async () => {
    mockedLocation.getCurrentPositionAsync.mockImplementation(
      () => new Promise(() => { /* never */ }) as any,
    );

    const result = await getCurrentLocationWithTimeout(50);
    expect(result).toBeNull();
  });

  it("returns null when getCurrentPositionAsync throws", async () => {
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error("gps error"));

    const result = await getCurrentLocationWithTimeout(1000);
    expect(result).toBeNull();
  });
});
