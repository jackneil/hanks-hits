import { describe, it, expect } from "vitest";
import { sanitizeSessionNameUpdate } from "../auth-session-update";

describe("sanitizeSessionNameUpdate", () => {
  it("accepts a normal name", () => {
    expect(sanitizeSessionNameUpdate("Speedy Testy")).toBe("Speedy Testy");
  });

  it("trims whitespace", () => {
    expect(sanitizeSessionNameUpdate("  Hank  ")).toBe("Hank");
  });

  it("bounds length to 100 characters", () => {
    expect(sanitizeSessionNameUpdate("x".repeat(500))).toHaveLength(100);
  });

  it("rejects non-strings and empties", () => {
    expect(sanitizeSessionNameUpdate(undefined)).toBeNull();
    expect(sanitizeSessionNameUpdate(42)).toBeNull();
    expect(sanitizeSessionNameUpdate({ name: "x" })).toBeNull();
    expect(sanitizeSessionNameUpdate("   ")).toBeNull();
  });
});
