/**
 * The picture agrees with the rules: the grass, the runner's feet and the
 * crates share one floor line, and a ducking runner is drawn under the
 * purple bar. (sameBox.test.tsx checks that the drawn boxes are the boxes
 * the store collides with.) This file uses only the constants.
 * Regression (prod clips harness, 2026-10-01): crates were drawn 40 px above
 * the runner's feet, and the runner 8 to 20 px above the grass.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EndlessRunnerGame, HUD_COIN_RADIUS, HUD_COIN_RING, HUD_COIN_Y, SUN } from "../Game";
import { CANVAS_HEIGHT, COIN, COLORS, GROUND, OBSTACLE, PLAYER, type Obstacle } from "../lib/constants";
import { obstacleRect, runnerSilhouette } from "../lib/geometry";
import { useEndlessRunnerStore, type EndlessRunnerState } from "../lib/store";
import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";

import { installRecordingContext, type Call } from "./recordingContext";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

const GRASS_TOP = CANVAS_HEIGHT - GROUND.HEIGHT;
const crate: Obstacle = { x: 300, type: "ground", width: OBSTACLE.GROUND_WIDTH, height: OBSTACLE.GROUND_HEIGHT, id: 1 };
const bar: Obstacle = { x: 500, type: "air", width: OBSTACLE.AIR_WIDTH, height: OBSTACLE.AIR_HEIGHT, id: 2 };

let raf: RafMock;
let restoreContext: () => void;
let calls: Call[];

/** A stand-in text width: 18 px a character (bold 32 px digits are about that wide). */
const measure = (text: string) => text.length * 18;

beforeEach(() => {
  calls = [];
  raf = installRafMock();
  restoreContext = installRecordingContext(calls, measure);
  localStorage.clear();
  useEndlessRunnerStore.getState().reset();
});

afterEach(() => {
  restoreContext();
  uninstallRafMock();
  vi.restoreAllMocks();
  useEndlessRunnerStore.getState().reset();
});

type Pose = { y: number; isJumping: boolean; isDucking: boolean };
const STAND: Pose = { y: PLAYER.GROUND_Y, isJumping: false, isDucking: false };
const DUCK: Pose = { y: PLAYER.GROUND_Y, isJumping: false, isDucking: true };
const JUMP: Pose = { y: PLAYER.GROUND_Y - 60, isJumping: true, isDucking: false };

/** Draw one picture of this state (the loop's first frame draws and moves nothing). */
function drawOnce(isDucking = false, extra: Partial<EndlessRunnerState> = {}, pose?: Pose) {
  const p = pose ?? { ...STAND, isDucking };
  act(() => {
    useEndlessRunnerStore.setState({
      gameState: "playing",
      obstacles: [crate, bar],
      coins: [],
      nextObstacleX: 1e9,
      player: { y: p.y, velocity: 0, isJumping: p.isJumping, isDucking: p.isDucking },
      ...extra,
    });
  });
  render(<EndlessRunnerGame />);
  calls.length = 0;
  act(() => {
    raf.nextFrame(60);
  });
}

/** The [x, y, width, height] of the first fillRect in this colour. */
function rectIn(color: string): number[] {
  const call = calls.find((c) => c.name === "fillRect" && c.fillStyle === color);
  expect(call, `a box drawn in ${color}`).toBeDefined();
  return call!.args;
}

/** The box of the runner's drawing in canvas px (its translate to save/restore). */
function runnerExtent(): { left: number; right: number; top: number; bottom: number } {
  const start = calls.findIndex((c) => c.name === "translate" && c.args[0] === PLAYER.X);
  expect(start, "the runner is drawn").toBeGreaterThanOrEqual(0);
  const [originX, originY] = calls[start].args;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const c of calls.slice(start + 1)) {
    if (c.name === "restore") break;
    if (c.name === "fillRect") {
      const [x, y, w, h] = c.args;
      left = Math.min(left, originX + x);
      right = Math.max(right, originX + x + w);
      top = Math.min(top, originY + y);
      bottom = Math.max(bottom, originY + y + h);
    }
    if (c.name === "arc") {
      const [cx, cy, r] = c.args;
      left = Math.min(left, originX + cx - r);
      right = Math.max(right, originX + cx + r);
      top = Math.min(top, originY + cy - r);
      bottom = Math.max(bottom, originY + cy + r);
    }
  }
  return { left, right, top, bottom };
}

describe("one floor line in the picture", () => {
  it("draws the grass on the runner's floor", () => {
    drawOnce();
    const [, y] = rectIn(GROUND.GRASS_COLOR);
    expect(y).toBe(GRASS_TOP);
    expect(y).toBe(PLAYER.GROUND_Y);
  });

  it("draws the crate standing on the grass, at the runner's feet level", () => {
    drawOnce();
    const [x, y, w, h] = rectIn(OBSTACLE.GROUND_COLOR);
    expect([x, w, h]).toEqual([crate.x, crate.width, crate.height]);
    expect(y + h).toBe(PLAYER.GROUND_Y);
    expect(y + h).toBe(GRASS_TOP);
  });

  it("draws the standing runner with the feet on the grass", () => {
    drawOnce();
    expect(runnerExtent().bottom).toBe(GRASS_TOP);
  });

  it("draws the ducking runner on the grass and under the purple bar", () => {
    drawOnce(true);
    const { top, bottom } = runnerExtent();
    expect(bottom).toBe(GRASS_TOP);
    expect(top).toBeGreaterThanOrEqual(OBSTACLE.AIR_Y + OBSTACLE.AIR_HEIGHT);
  });

  it("draws the purple bar where the rules put it", () => {
    drawOnce();
    expect(rectIn(OBSTACLE.AIR_COLOR)).toEqual([bar.x, OBSTACLE.AIR_Y, bar.width, bar.height]);
  });
});

describe("the coin box is the drawing", () => {
  // Regression (review 2026-10-02): the drawn head was above the coin box,
  // so a line of coins passed through the runner's face and none counted.
  for (const [name, pose, runFrame] of [
    ["standing, one leg up", STAND, 0],
    ["standing, the other leg up", STAND, 100],
    ["jumping", JUMP, 0],
    ["ducking", DUCK, 0],
  ] as const) {
    it(`draws the runner ${name} exactly inside runnerSilhouette()`, () => {
      vi.spyOn(Date, "now").mockReturnValue(runFrame);
      drawOnce(false, {}, pose);
      expect(runnerExtent()).toEqual(runnerSilhouette(pose));
    });
  }
});

describe("the purple bar's stripes", () => {
  // Regression (review 2026-10-02): at a float x, right - left came out as
  // 60.00000000000006 and a fifth stripe was drawn past the bar's end.
  it("draws four whole stripes, all inside the bar, at a float x", () => {
    const x = 467.7500931567046;
    drawOnce(false, { obstacles: [{ ...bar, x }] });
    const box = obstacleRect({ ...bar, x });
    const stripes = calls.filter((c) => c.name === "fillRect" && c.fillStyle === "#FFF");
    expect(stripes).toHaveLength(4);
    for (const [sx, , w] of stripes.map((c) => c.args)) {
      expect(sx).toBeGreaterThanOrEqual(box.left);
      expect(sx + w).toBeLessThanOrEqual(box.right);
    }
  });
});

describe("the coin counter", () => {
  // Regression (review 2026-10-02): the icon sat at a fixed spot and
  // covered a count of two or more digits.
  for (const coins of [0, 30, 1234]) {
    it(`draws the coin icon left of a count of ${coins}`, () => {
      drawOnce(false, { coinsThisRun: coins });
      const text = `${coins}`;
      const count = calls.find((c) => c.name === "fillText" && (c.args[0] as unknown) === text && c.fillStyle === COIN.COLOR);
      expect(count, "the count is drawn").toBeDefined();
      const countLeft = count!.args[1] - measure(text);
      const icon = calls.find((c) => c.name === "arc" && c.args[2] === HUD_COIN_RADIUS && c.args[1] === HUD_COIN_Y);
      expect(icon, "the icon is drawn").toBeDefined();
      expect(icon!.args[0] + HUD_COIN_RADIUS).toBeLessThan(countLeft);
    });
  }

  // Regression (review wave 2, 2026-10-02): on a wide screen the yellow
  // icon sat on the yellow sun with a gold outline, and was hard to see.
  it("rings the coin icon in the dark shadow colour, so it reads on the sun", () => {
    drawOnce(false, { coinsThisRun: 30 });
    const iconAt = calls.findIndex((c) => c.name === "arc" && c.args[2] === HUD_COIN_RADIUS && c.args[1] === HUD_COIN_Y);
    expect(iconAt, "the icon is drawn").toBeGreaterThanOrEqual(0);
    const ring = calls.slice(iconAt).find((c) => c.name === "stroke");
    expect(ring, "the icon is outlined").toBeDefined();
    expect(ring!.strokeStyle).toBe(COLORS.SCORE_SHADOW);
    expect(ring!.lineWidth).toBe(HUD_COIN_RING);
    expect(HUD_COIN_RING).toBeGreaterThanOrEqual(3);
  });

  it("draws the sun and its glow below the coin counter's row", () => {
    drawOnce(false, { coinsThisRun: 30 });
    const glow = calls.find((c) => c.name === "arc" && c.fillStyle === COLORS.SUN_GLOW);
    expect(glow, "the sun's glow is drawn").toBeDefined();
    const [, glowY, glowR] = glow!.args;
    expect(glowR).toBe(SUN.GLOW_R);
    // The glow's top is under the icon's ring and the count's 32 px text.
    expect(glowY - glowR).toBeGreaterThan(HUD_COIN_Y + HUD_COIN_RADIUS + HUD_COIN_RING);
  });
});
