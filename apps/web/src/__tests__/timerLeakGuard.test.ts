import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { installTimerLeakGuard, type TimerLeakGuard } from "./timerLeakGuard";

/** A private target, so the test never touches the suite's own guard. */
function makeTarget() {
  return {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
}

const wait = (ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

describe("installTimerLeakGuard", () => {
  let guard: TimerLeakGuard | null = null;
  afterEach(() => {
    guard?.clearPending();
    guard?.uninstall();
    guard = null;
  });

  it("clears a pending timeout so it never fires after the file ends", async () => {
    const target = makeTarget();
    guard = installTimerLeakGuard(target);
    let fired = false;
    target.setTimeout(() => {
      fired = true;
    }, 20);
    expect(guard.pendingCount()).toBe(1);

    expect(guard.clearPending()).toBe(1);
    await wait(40);
    expect(fired).toBe(false);
    expect(guard.pendingCount()).toBe(0);
  });

  it("forgets a timeout once it fires or is cleared, and passes the arguments", async () => {
    const target = makeTarget();
    guard = installTimerLeakGuard(target);
    const seen: unknown[] = [];
    target.setTimeout((a: unknown, b: unknown) => seen.push(a, b), 1, "x", 2);
    const cleared = target.setTimeout(() => seen.push("never"), 50);
    target.clearTimeout(cleared);
    expect(guard.pendingCount()).toBe(1);

    await wait(20);
    expect(seen).toEqual(["x", 2]);
    expect(guard.pendingCount()).toBe(0);
  });

  it("clears pending intervals and forgets cleared ones", async () => {
    const target = makeTarget();
    guard = installTimerLeakGuard(target);
    let ticks = 0;
    target.setInterval(() => ticks++, 5);
    const other = target.setInterval(() => ticks++, 5);
    target.clearInterval(other);
    expect(guard.pendingCount()).toBe(1);

    expect(guard.clearPending()).toBe(1);
    const after = ticks;
    await wait(30);
    expect(ticks).toBe(after);
  });

  it("keeps util.promisify(setTimeout) working", async () => {
    const target = makeTarget();
    guard = installTimerLeakGuard(target);
    const sleep = promisify(target.setTimeout);
    await expect(sleep(1, "done")).resolves.toBe("done");
  });

  it("puts the original functions back on uninstall", () => {
    const target = makeTarget();
    const original = target.setTimeout;
    guard = installTimerLeakGuard(target);
    expect(target.setTimeout).not.toBe(original);
    guard.uninstall();
    expect(target.setTimeout).toBe(original);
  });

  it("is installed for this suite: the global setTimeout is the guard", () => {
    // The setup file installs the guard; a native Node setTimeout has no wrapper name.
    expect(globalThis.setTimeout.toString()).toContain("native.setTimeout");
  });
});
