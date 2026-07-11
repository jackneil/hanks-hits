import { describe, it, expect } from "vitest";
import { getInstructions } from "../lib/instructions";

describe("endless-runner getInstructions", () => {
  it("gives touch hints for a coarse pointer (no keyboard jargon)", () => {
    const { jump, duck } = getInstructions(true);
    expect(jump).toBe("Tap to Jump!");
    expect(duck).toBe("Tap the Bottom to Duck");
    // A phone kid must never be told about Space or Arrow keys
    expect(jump).not.toMatch(/space/i);
    expect(duck).not.toMatch(/arrow/i);
  });

  it("keeps keyboard hints for a fine pointer", () => {
    const { jump, duck } = getInstructions(false);
    expect(jump).toBe("Tap or Press Space to Jump!");
    expect(duck).toBe("Hold Down Arrow to Duck");
  });

  it("never emits an em-dash in any instruction string", () => {
    for (const coarse of [true, false]) {
      const { jump, duck } = getInstructions(coarse);
      expect(jump).not.toContain("—");
      expect(duck).not.toContain("—");
    }
  });
});
