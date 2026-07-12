import { describe, expect, it } from "vitest";

import { validateProgress } from "@/lib/progress-schemas";

describe("achievements progress schema", () => {
  it("accepts a valid synced blob", () => {
    const result = validateProgress("achievements", {
      unlocked: { "first-play:snake": Date.now(), "explorer:3": Date.now() },
      lastModified: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields (strict) and injected shapes", () => {
    expect(
      validateProgress("achievements", {
        unlocked: {},
        lastModified: Date.now(),
        coins: 999999999,
      }).success
    ).toBe(false);

    expect(
      validateProgress("achievements", {
        unlocked: { "first-play:snake": "not-a-number" },
        lastModified: Date.now(),
      }).success
    ).toBe(false);
  });

  it("rejects far-future unlock timestamps", () => {
    expect(
      validateProgress("achievements", {
        unlocked: { "first-play:snake": Date.now() + 7 * 86400000 },
        lastModified: Date.now(),
      }).success
    ).toBe(false);
  });

  it("rejects an empty-string achievement key", () => {
    expect(
      validateProgress("achievements", {
        unlocked: { "": Date.now() },
        lastModified: Date.now(),
      }).success
    ).toBe(false);
  });

  it("a __proto__ key can never pollute Object.prototype (pins the Zod record behavior we rely on)", () => {
    const hostile = JSON.parse(
      `{"unlocked":{"__proto__":${Date.now()},"first-play:snake":${Date.now()}},"lastModified":${Date.now()}}`
    );
    const result = validateProgress("achievements", hostile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    if (result.success) {
      const unlocked = (result.data as { unlocked: Record<string, number> }).unlocked;
      // zod's record must not carry __proto__ through as an own key that
      // could later hit a [[Set]] path; a future zod major changing this
      // should fail here loudly.
      expect(Object.prototype.hasOwnProperty.call(unlocked, "__proto__")).toBe(false);
    }
  });

  it("accepts a catalog-sized unlocked set but rejects a hostile one", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 250; i++) big[`plays:app-${i}:5`] = Date.now();
    expect(
      validateProgress("achievements", { unlocked: big, lastModified: Date.now() })
        .success
    ).toBe(true);

    const hostile: Record<string, number> = {};
    for (let i = 0; i < 600; i++) hostile[`x:${i}`] = Date.now();
    expect(
      validateProgress("achievements", { unlocked: hostile, lastModified: Date.now() })
        .success
    ).toBe(false);
  });
});
