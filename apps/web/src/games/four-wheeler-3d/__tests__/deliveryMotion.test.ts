import { describe, it, expect } from "vitest";
import {
  deliveryFlightPosition,
  helperErrandTarget,
  helperFollow,
  visualRemaining,
} from "../lib/deliveryMotion";
describe("economy-driven delivery motion", () => {
  it("starts the38secondflight at the store and ends above the actual delivery point", () => {
    const origin = { x: -448, y: 25, z: -44 },
      target = { x: 300, y: 2, z: 450 },
      out = { x: 0, y: 0, z: 0 };
    expect(deliveryFlightPosition(origin, target, 38, out)).toEqual(origin);
    deliveryFlightPosition(origin, target, 0, out);
    expect(out.x).toBe(300);
    expect(out.y).toBeCloseTo(14);
    expect(out.z).toBe(450);
    expect(target).toEqual({ x: 300, y: 2, z: 450 });
  });
  it("interpolates saved countdown ticks but never invents an early completion", () => {
    expect(visualRemaining(38, 0.5)).toBe(37.5);
    expect(visualRemaining(1, 5)).toBeGreaterThan(0);
    expect(visualRemaining(10, -10)).toBe(10);
  });
  it("finishes a four-second helper excursion at the player's current follow anchor", () => {
    const anchor = { x: 4, y: 2, z: 7 },
      out = { x: 0, y: 0, z: 0 };
    expect(helperErrandTarget(anchor, 0, 4, out)).toEqual(anchor);
    helperErrandTarget(anchor, 0, 2, out);
    expect(out.x).toBe(14);
    helperErrandTarget(anchor, 0, 0, out);
    expect(out.x).toBeCloseTo(anchor.x);
    expect(out.z).toBe(anchor.z);
  });
  it("the helper follows without overshooting and freezes when the game timer pauses", () => {
    const p = { x: 0, y: 2, z: 0 },
      destination = { x: 15, y: 2, z: 0 };
    expect(helperFollow(p, destination, 0)).toBe(0);
    expect(p.x).toBe(0);
    for (let i = 0; i < 120; i++) helperFollow(p, destination, 1 / 60);
    expect(p.x).toBeLessThanOrEqual(15);
    expect(p.x).toBeGreaterThan(14.7);
    expect(p.z).toBe(0);
  });
});
