import { describe, expect, it } from "vitest";

import { PHYSICS } from "../lib/constants";
import { useGameStore } from "../lib/store";

/**
 * A slow frame must not fling the truck (phone check, 2026-09-30: a 207 MPH
 * spike when Gas was held through the first frames, which compile shaders).
 * The grip takes back GRIP_FORCE x tires x dt / CHASSIS_MASS of the
 * sideways speed each frame; past 1 it overshoots and grows. The clamp on
 * dt keeps it under 1 for the best tires any truck can reach.
 */
describe("the truck's forces stay stable on a slow frame", () => {
  it("keeps the grip under one full correction per frame with the best tires", () => {
    const state = useGameStore.getState();
    const maxed = Object.fromEntries(
      Object.entries(state.upgrades).map(([id, u]) => [
        id,
        { ...u, tires: { ...u.tires, level: u.tires.maxLevel } },
      ]),
    );
    useGameStore.setState({ upgrades: maxed as typeof state.upgrades });
    const bestTires = Math.max(
      ...state.trucks.map((t) => useGameStore.getState().getTruckStats(t.id).tires),
    );
    expect(bestTires).toBeGreaterThan(1);

    const share = (PHYSICS.GRIP_FORCE * bestTires * PHYSICS.MAX_FRAME_DELTA) / PHYSICS.CHASSIS_MASS;
    expect(share).toBeLessThan(1);
  });

  it("clamps no tighter than a 20 fps frame", () => {
    expect(PHYSICS.MAX_FRAME_DELTA).toBeGreaterThanOrEqual(1 / 20);
  });
});
