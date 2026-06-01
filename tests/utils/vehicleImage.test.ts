import { getVehicleImageUrl, getFallbackColor } from "../../utils/vehicleImage";

describe("getVehicleImageUrl", () => {
  it("builds an imagin.studio URL with make + model + side angle by default", () => {
    const url = new URL(getVehicleImageUrl("Toyota", "Corolla"));
    expect(url.host).toBe("cdn.imagin.studio");
    expect(url.pathname).toBe("/getImage");
    expect(url.searchParams.get("make")).toBe("toyota");
    expect(url.searchParams.get("modelFamily")).toBe("corolla");
    expect(url.searchParams.get("angle")).toBe("01"); // side
    expect(url.searchParams.get("zoomType")).toBe("fullscreen");
  });

  it("maps known model names to their family slug", () => {
    expect(
      new URL(getVehicleImageUrl("Toyota", "Land Cruiser")).searchParams.get("modelFamily"),
    ).toBe("land-cruiser");
    expect(
      new URL(getVehicleImageUrl("Toyota", "Prado")).searchParams.get("modelFamily"),
    ).toBe("land-cruiser-prado");
    expect(
      new URL(getVehicleImageUrl("Mercedes", "Sprinter")).searchParams.get("modelFamily"),
    ).toBe("sprinter");
  });

  it("falls back to first word of model for unknown models", () => {
    expect(
      new URL(getVehicleImageUrl("Random", "Galactica Z 9000")).searchParams.get("modelFamily"),
    ).toBe("galactica");
  });

  it("includes modelYear when provided", () => {
    const u = new URL(getVehicleImageUrl("Toyota", "Corolla", 2023));
    expect(u.searchParams.get("modelYear")).toBe("2023");
  });

  it("omits modelYear when not provided", () => {
    const u = new URL(getVehicleImageUrl("Toyota", "Corolla"));
    expect(u.searchParams.has("modelYear")).toBe(false);
  });

  it("encodes color via paintId, lowercased and hyphenated", () => {
    const u = new URL(getVehicleImageUrl("Toyota", "Corolla", 2023, "side", "Light Blue"));
    expect(u.searchParams.get("paintId")).toBe("light-blue");
  });

  it("omits paintId when color not provided", () => {
    const u = new URL(getVehicleImageUrl("Toyota", "Corolla"));
    expect(u.searchParams.has("paintId")).toBe(false);
  });

  it("maps front/rear/interior angles to their codes", () => {
    expect(new URL(getVehicleImageUrl("X", "Y", undefined, "front")).searchParams.get("angle")).toBe("13");
    expect(new URL(getVehicleImageUrl("X", "Y", undefined, "rear")).searchParams.get("angle")).toBe("07");
    expect(new URL(getVehicleImageUrl("X", "Y", undefined, "interior")).searchParams.get("angle")).toBe("27");
  });

  it("trims whitespace from make and model", () => {
    const u = new URL(getVehicleImageUrl("  Toyota  ", "  Corolla  "));
    expect(u.searchParams.get("make")).toBe("toyota");
    expect(u.searchParams.get("modelFamily")).toBe("corolla");
  });
});

describe("getFallbackColor", () => {
  it("returns a distinct hex per vehicle type", () => {
    expect(getFallbackColor("minibus")).toMatch(/^#[0-9A-F]{6}$/i);
    expect(getFallbackColor("van")).toMatch(/^#[0-9A-F]{6}$/i);
    expect(getFallbackColor("suv")).not.toBe(getFallbackColor("sedan"));
    expect(getFallbackColor("tricycle")).not.toBe(getFallbackColor("bush_taxi"));
  });
});
