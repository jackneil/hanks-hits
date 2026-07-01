import { describe, expect, it } from "vitest";
import { mapWeatherCode } from "../constants";

describe("mapWeatherCode", () => {
  it("maps freezing rain codes to snowy before rain", () => {
    expect(mapWeatherCode(66)).toBe("snowy");
    expect(mapWeatherCode(67)).toBe("snowy");
  });

  it("keeps regular rain codes rainy", () => {
    expect(mapWeatherCode(61)).toBe("rainy");
    expect(mapWeatherCode(65)).toBe("rainy");
  });
});
