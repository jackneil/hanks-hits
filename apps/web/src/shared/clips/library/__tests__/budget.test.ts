// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MEMORY_BUDGET_BYTES,
  NO_ESTIMATE_BUDGET_BYTES,
  NO_ESTIMATE_QUOTA_BYTES,
  memoryBudgetFor,
  persistentBudgetFor,
} from "../budget";

const MiB = 1024 * 1024;

describe("persistentBudgetFor", () => {
  it("is 25% of estimate().quota", () => {
    expect(persistentBudgetFor({ quota: 4_000_000, usage: 10 })).toBe(1_000_000);
    expect(persistentBudgetFor({ quota: 38.7e9 })).toBe(Math.floor(38.7e9 / 4));
  });

  it("is a fixed 256 MiB where estimate() is missing (Safari before 17): 25% of its 1 GB quota", () => {
    expect(NO_ESTIMATE_QUOTA_BYTES).toBe(1024 * MiB);
    expect(NO_ESTIMATE_BUDGET_BYTES).toBe(256 * MiB);
    expect(persistentBudgetFor(null)).toBe(NO_ESTIMATE_BUDGET_BYTES);
    expect(persistentBudgetFor(undefined)).toBe(NO_ESTIMATE_BUDGET_BYTES);
  });

  it("uses the fixed budget for a quota that is missing or not valid", () => {
    for (const quota of [undefined, 0, -1, Number.NaN, Infinity]) {
      expect(persistentBudgetFor({ quota })).toBe(NO_ESTIMATE_BUDGET_BYTES);
    }
  });
});

describe("memoryBudgetFor", () => {
  it("follows the memory class (plan 6.5)", () => {
    expect(MEMORY_BUDGET_BYTES).toEqual({ low: 64 * MiB, mid: 128 * MiB, high: 256 * MiB });
    expect(memoryBudgetFor("low")).toBe(64 * MiB);
    expect(memoryBudgetFor("mid")).toBe(128 * MiB);
    expect(memoryBudgetFor("high")).toBe(256 * MiB);
  });

  it("uses the lowest budget until the class is known, and for an unknown class", () => {
    expect(memoryBudgetFor(undefined)).toBe(64 * MiB);
    expect(memoryBudgetFor(null)).toBe(64 * MiB);
    expect(memoryBudgetFor("huge" as never)).toBe(64 * MiB);
    expect(memoryBudgetFor("toString" as never)).toBe(64 * MiB);
  });
});
