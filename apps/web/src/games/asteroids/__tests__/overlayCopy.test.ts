import { describe, it, expect } from "vitest";
import { getOverlayCopy } from "../lib/overlayCopy";

describe("asteroids overlay copy", () => {
  it("touch viewports never see keyboard-only copy", () => {
    const copy = getOverlayCopy(true);
    for (const text of Object.values(copy)) {
      expect(text).not.toMatch(/space|escape|click|press/i);
      expect(text).toMatch(/tap/i);
    }
  });

  it("keyboard viewports keep the key legend", () => {
    const copy = getOverlayCopy(false);
    expect(copy.playAgain).toContain("Space");
    expect(copy.nextWave).toContain("Space");
    expect(copy.resume).toContain("Escape");
  });
});
