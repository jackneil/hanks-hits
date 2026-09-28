// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { MomentMark } from "../../protocol";
import { MAX_MOMENTS, MAX_MOMENT_TEXT, checkOwnerChange, sanitizePatch } from "../patch";

const USER = "u_0123456789abcdef0123";
const OTHER = "u_fedcba9876543210fedc";
const moment: MomentMark = { kind: "new-best", label: "New best!", emoji: "🏆", priority: "featured", offsetSec: -1.5 };

describe("sanitizePatch", () => {
  it("keeps the fields the UI may change, as clean copies", () => {
    const input = { kept: true, watched: false, moments: [{ ...moment, extra: "dropped" }], challengeScore: 1200, ownerKey: USER };
    const patch = sanitizePatch(input);
    expect(patch).toEqual({ kept: true, watched: false, moments: [moment], challengeScore: 1200, ownerKey: USER });
    expect(patch.moments![0]).not.toBe(input.moments[0]);
  });

  it("accepts an empty patch and a cleared challenge score", () => {
    expect(sanitizePatch({})).toEqual({});
    expect(sanitizePatch({ challengeScore: undefined })).toEqual({ challengeScore: undefined });
  });

  it("refuses a field that only the io worker sets", () => {
    for (const key of ["id", "storage", "bytes", "mime", "posterDataUrl", "createdAt", "kind", "__proto__x"]) {
      expect(() => sanitizePatch({ [key]: "x" })).toThrow(TypeError);
    }
  });

  it("refuses fields of the wrong type", () => {
    expect(() => sanitizePatch(null)).toThrow(TypeError);
    expect(() => sanitizePatch([])).toThrow(TypeError);
    expect(() => sanitizePatch("kept")).toThrow(TypeError);
    expect(() => sanitizePatch({ kept: "yes" })).toThrow(TypeError);
    expect(() => sanitizePatch({ watched: 1 })).toThrow(TypeError);
    expect(() => sanitizePatch({ challengeScore: Number.NaN })).toThrow(TypeError);
    expect(() => sanitizePatch({ challengeScore: "12" })).toThrow(TypeError);
    expect(() => sanitizePatch({ ownerKey: "../../x" })).toThrow(TypeError);
    expect(() => sanitizePatch({ ownerKey: "u_short" })).toThrow(TypeError);
  });

  it("refuses moments that are not valid, too long, or too many", () => {
    expect(() => sanitizePatch({ moments: "star" })).toThrow(TypeError);
    expect(() => sanitizePatch({ moments: [null] })).toThrow(TypeError);
    expect(() => sanitizePatch({ moments: [{ ...moment, kind: "boom" }] })).toThrow(TypeError);
    expect(() => sanitizePatch({ moments: [{ ...moment, priority: "top" }] })).toThrow(TypeError);
    expect(() => sanitizePatch({ moments: [{ ...moment, offsetSec: Infinity }] })).toThrow(TypeError);
    expect(() => sanitizePatch({ moments: [{ ...moment, label: "x".repeat(MAX_MOMENT_TEXT + 1) }] })).toThrow(TypeError);
    expect(() => sanitizePatch({ moments: Array.from({ length: MAX_MOMENTS + 1 }, () => moment) })).toThrow(TypeError);
    expect(sanitizePatch({ moments: Array.from({ length: MAX_MOMENTS }, () => moment) }).moments!.length).toBe(MAX_MOMENTS);
  });
});

describe("checkOwnerChange", () => {
  it("allows a claim from guest and a give-back to guest", () => {
    expect(() => checkOwnerChange("guest", USER)).not.toThrow();
    expect(() => checkOwnerChange(USER, "guest")).not.toThrow();
    expect(() => checkOwnerChange(USER, USER)).not.toThrow();
  });

  it("refuses a move from one player straight to another", () => {
    expect(() => checkOwnerChange(USER, OTHER)).toThrow(TypeError);
  });
});
