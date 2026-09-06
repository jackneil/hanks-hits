import { describe, it, expect } from "vitest";
import { getInstructions, getInstructionLines } from "../lib/instructions";

describe("endless-runner getInstructions", () => {
  it("gives touch hints for a coarse pointer (no keyboard jargon)", () => {
    const { jump, duck } = getInstructions(true);
    expect(jump).toBe("👆 Tap the top to jump");
    expect(duck).toBe("👇 Tap the bottom to duck");
    // A phone kid must never be told about Space or Arrow keys
    expect(jump).not.toMatch(/space/i);
    expect(duck).not.toMatch(/arrow/i);
  });

  it("keeps keyboard hints for a fine pointer", () => {
    const { jump, duck } = getInstructions(false);
    expect(jump).toBe("⌨️ Space to jump");
    expect(duck).toBe("⬇️ Hold the down arrow to duck");
  });

  it("never emits an em-dash in any instruction string", () => {
    for (const coarse of [true, false]) {
      const { jump, duck } = getInstructions(coarse);
      expect(jump).not.toContain("—");
      expect(duck).not.toContain("—");
    }
  });

  it("exposes the same two lines in order for the start overlay", () => {
    for (const coarse of [true, false]) {
      const { jump, duck } = getInstructions(coarse);
      expect(getInstructionLines(coarse)).toEqual([jump, duck]);
    }
  });
});
