import { describe, expect, it } from "vitest";
import { settleWithin } from "../deadline";

describe("settleWithin", () => {
  it("is true when the promise resolves or rejects in time, and never rejects itself", async () => {
    expect(await settleWithin(Promise.resolve(1), 50)).toBe(true);
    expect(await settleWithin(Promise.reject(new Error("flush failed")), 50)).toBe(true);
  });

  it("is false when the time limit comes first, and a late settle changes nothing", async () => {
    let finish: () => void = () => {};
    const slow = new Promise<void>((r) => (finish = r));
    const started = Date.now();
    expect(await settleWithin(slow, 20)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    finish();
    await slow;
  });

  it("does not leave an unhandled rejection when the promise rejects after the time limit", async () => {
    let fail: (e: unknown) => void = () => {};
    const slow = new Promise<void>((_, reject) => (fail = reject));
    expect(await settleWithin(slow, 10)).toBe(false);
    fail(new DOMException("closed", "AbortError"));
    await new Promise((r) => setTimeout(r, 10));
  });
});
