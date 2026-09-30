import { beforeEach, describe, expect, it } from "vitest";

import { DINO, GROUND_Y } from "../lib/constants";
import { useDinoRunnerStore } from "../lib/store";

// Regression (phone UX audit 2026-09-29, dino-runner finding 2): "hold =
// higher" was inverted. The store added a positive term to the upward
// (negative) velocity while the jump was held, so a held jump reached 74 px
// and a tapped one 108 px. A kid who held for a big cactus got a stubby hop.

const STEP_MS = 1000 / 60;

/** Runs one jump to its apex and back to the ground; returns the apex height in px above the ground. */
function jumpApex(holdMs: number): number {
  const store = useDinoRunnerStore.getState();
  store.startGame();
  store.jump();
  let held = holdMs;
  let apex = 0;
  for (let i = 0; i < 400; i++) {
    if (held <= 0) useDinoRunnerStore.getState().releaseJump();
    held -= STEP_MS;
    useDinoRunnerStore.getState().update(STEP_MS);
    const s = useDinoRunnerStore.getState();
    apex = Math.max(apex, GROUND_Y - DINO.HEIGHT - s.dinoY);
    if (!s.isJumping && i > 2) break;
  }
  return apex;
}

beforeEach(() => {
  localStorage.clear();
  useDinoRunnerStore.getState().reset();
});

describe("Dino Runner jump", () => {
  it("a held jump goes higher than a tapped jump, and stays inside the canvas", () => {
    const tapped = jumpApex(STEP_MS * 2);
    useDinoRunnerStore.getState().reset();
    const held = jumpApex(2000);
    expect(tapped).toBeGreaterThan(100);
    expect(held).toBeGreaterThan(tapped * 1.3);
    // The dino's head never leaves the top of the canvas (its y stays 0 or more).
    expect(GROUND_Y - DINO.HEIGHT - held).toBeGreaterThanOrEqual(0);
  });
});

describe("Dino Runner runs", () => {
  it("counts every start as a new run, from any state, and never saves the count", () => {
    const first = useDinoRunnerStore.getState().runId;
    useDinoRunnerStore.getState().startGame();
    expect(useDinoRunnerStore.getState().runId).toBe(first + 1);
    // A restart in the middle of a run (the header's Restart) is a new run too.
    useDinoRunnerStore.getState().startGame();
    expect(useDinoRunnerStore.getState()).toMatchObject({ gameState: "playing", runId: first + 2 });
    useDinoRunnerStore.getState().gameOver();
    useDinoRunnerStore.getState().startGame();
    expect(useDinoRunnerStore.getState()).toMatchObject({ gameState: "playing", runId: first + 3, score: 0 });
    const saved = JSON.parse(window.localStorage.getItem("dino-runner-progress") ?? "{}");
    expect(saved.state).not.toHaveProperty("runId");
  });
});
