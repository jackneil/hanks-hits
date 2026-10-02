// @vitest-environment node
/**
 * The in-flight limits (src/lib/in-flight.ts): a gate with a limit in all
 * and for each key, a byte budget that reserves while bytes arrive, and one
 * instance for each name in the process.
 */
import { describe, expect, it } from "vitest";

import { InFlightGate, processSingleton } from "../in-flight";

describe("InFlightGate", () => {
  it("gives at most `limit` places in all", () => {
    const gate = new InFlightGate(2);
    expect(gate.tryEnter("a")).toBe(true);
    expect(gate.tryEnter("b")).toBe(true);
    expect(gate.tryEnter("c")).toBe(false);
    expect(gate.active).toBe(2);
    gate.leave("a");
    expect(gate.tryEnter("c")).toBe(true);
  });

  it("gives at most `perKeyLimit` places to one key, and other keys still get in", () => {
    const gate = new InFlightGate(10, 1);
    expect(gate.tryEnter("203.0.113.9")).toBe(true);
    expect(gate.tryEnter("203.0.113.9")).toBe(false);
    expect(gate.tryEnter("198.51.100.4")).toBe(true);
    expect(gate.activeFor("203.0.113.9")).toBe(1);
    gate.leave("203.0.113.9");
    expect(gate.tryEnter("203.0.113.9")).toBe(true);
  });

  it("keeps no key that holds no place (the map does not grow)", () => {
    const gate = new InFlightGate(Number.POSITIVE_INFINITY, 2);
    for (let i = 0; i < 1000; i++) {
      expect(gate.tryEnter(`user-${i}`)).toBe(true);
      gate.leave(`user-${i}`);
    }
    expect(gate.keysInFlight).toBe(0);
    expect(gate.active).toBe(0);
  });

  it("never goes below zero on an extra leave", () => {
    const gate = new InFlightGate(1);
    gate.leave();
    gate.leave("x");
    expect(gate.active).toBe(0);
    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(false);
  });
});

describe("processSingleton", () => {
  it("gives the same value for a name, also to a second copy of the module (it lives on globalThis)", async () => {
    const name = `test-${Math.random()}`;
    const first = processSingleton(name, () => ({ made: 1 }));
    const second = processSingleton(name, () => ({ made: 2 }));
    expect(second).toBe(first);
    expect((globalThis as unknown as Record<symbol, unknown>)[Symbol.for(`hanks-hits:${name}`)]).toBe(first);
  });
});
