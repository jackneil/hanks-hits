import { describe, expect, it } from "vitest";
import {
  validateDisplayName,
  displayNameFromEmail,
  DISPLAY_NAME_MAX,
} from "../validators";

describe("validateDisplayName", () => {
  it("accepts a normal name and returns it trimmed", () => {
    const result = validateDisplayName("  Hank  ");
    expect(result).toEqual({ ok: true, name: "Hank" });
  });

  it("accepts allowed punctuation", () => {
    for (const name of ["O'Brien", "Mary-Jane", "J.R.", "cool_kid", "player 1"]) {
      expect(validateDisplayName(name).ok).toBe(true);
    }
  });

  it("rejects non-string input (number, object, array, null)", () => {
    for (const bad of [123, {}, [], null, undefined, true]) {
      const result = validateDisplayName(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/must be a string/i);
    }
  });

  it("rejects an empty or whitespace-only name", () => {
    for (const bad of ["", "   ", "\t\n"]) {
      const result = validateDisplayName(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/characters/i);
    }
  });

  it("rejects a name longer than the max after trimming", () => {
    const tooLong = "a".repeat(DISPLAY_NAME_MAX + 1);
    const result = validateDisplayName(tooLong);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/characters/i);
  });

  it("accepts a name exactly at the max length", () => {
    expect(validateDisplayName("a".repeat(DISPLAY_NAME_MAX)).ok).toBe(true);
  });

  it("rejects markup / injection characters", () => {
    // Every string here carries at least one disallowed character
    // (angle bracket, quote, ampersand, slash, or emoji).
    for (const bad of ["<script>", 'a"b', "a'b<c>", "a&b", "name<>", "emoji😀", "a/b"]) {
      expect(validateDisplayName(bad).ok).toBe(false);
    }
  });

  it("rejects a megabyte-sized name (the storage-abuse case)", () => {
    const huge = "x".repeat(1_000_000);
    expect(validateDisplayName(huge).ok).toBe(false);
  });
});

describe("displayNameFromEmail", () => {
  it("uses the email local-part", () => {
    expect(displayNameFromEmail("hank@example.com")).toBe("hank");
  });

  it("strips characters outside the allowed name charset", () => {
    // '+' is legal in an email local-part but not in a display name.
    expect(displayNameFromEmail("hank+games@example.com")).toBe("hankgames");
  });

  it("clamps an overly long local-part to the max length", () => {
    const long = "a".repeat(200) + "@example.com";
    const out = displayNameFromEmail(long);
    expect(out.length).toBe(DISPLAY_NAME_MAX);
  });

  it("falls back to 'player' when nothing usable remains", () => {
    expect(displayNameFromEmail("+++@example.com")).toBe("player");
    expect(displayNameFromEmail("@example.com")).toBe("player");
  });

  it("always returns something that passes validateDisplayName", () => {
    for (const email of [
      "hank@example.com",
      "hank+games@example.com",
      "+++@example.com",
      "a".repeat(200) + "@example.com",
      "@example.com",
    ]) {
      const derived = displayNameFromEmail(email);
      expect(validateDisplayName(derived).ok).toBe(true);
    }
  });
});
