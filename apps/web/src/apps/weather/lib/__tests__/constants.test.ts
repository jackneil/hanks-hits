import { describe, expect, it } from "vitest";
import { getRandomFact, mapWeatherCode, WEATHER_FACTS } from "../constants";

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

describe("getRandomFact", () => {
  it("never repeats the excluded (current) fact", () => {
    // "Tell me another!" must ALWAYS show another one — a 1-in-N repeat
    // reads as a dead button to a kid.
    for (const fact of WEATHER_FACTS) {
      for (let i = 0; i < 5; i++) {
        expect(getRandomFact(fact)).not.toBe(fact);
      }
    }
  });

  it("returns a fact from the list without an exclusion", () => {
    expect(WEATHER_FACTS).toContain(getRandomFact());
  });
});
