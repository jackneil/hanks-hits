/**
 * The store and the picture take an obstacle's box from the one function,
 * obstacleRect(), so they cannot drift apart again (they did: the crate was
 * drawn and tested 40 px above the runner's feet).
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EndlessRunnerGame } from "../Game";
import { OBSTACLE, PLAYER, type Obstacle } from "../lib/constants";
import { obstacleRect } from "../lib/geometry";
import { useEndlessRunnerStore } from "../lib/store";
import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";

import { installRecordingContext, type Call } from "./recordingContext";

vi.mock("../lib/geometry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/geometry")>();
  return { ...actual, obstacleRect: vi.fn(actual.obstacleRect) };
});
vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

const spy = vi.mocked(obstacleRect);
const crate: Obstacle = { x: 300, type: "ground", width: OBSTACLE.GROUND_WIDTH, height: OBSTACLE.GROUND_HEIGHT, id: 7 };
const bar: Obstacle = { x: 500, type: "air", width: OBSTACLE.AIR_WIDTH, height: OBSTACLE.AIR_HEIGHT, id: 8 };

let raf: RafMock;
let restoreContext: () => void;
let calls: Call[];

beforeEach(() => {
  calls = [];
  raf = installRafMock();
  restoreContext = installRecordingContext(calls);
  useEndlessRunnerStore.getState().reset();
  useEndlessRunnerStore.setState({
    gameState: "playing",
    obstacles: [crate, bar],
    coins: [],
    nextObstacleX: 1e9,
    player: { y: PLAYER.GROUND_Y, velocity: 0, isJumping: false, isDucking: false },
  });
  spy.mockClear();
});

afterEach(() => {
  restoreContext();
  uninstallRafMock();
  useEndlessRunnerStore.getState().reset();
});

function drawOnce() {
  render(<EndlessRunnerGame />);
  calls.length = 0;
  act(() => {
    raf.nextFrame(60);
  });
}

describe("one box per obstacle", () => {
  it("the store's collision check asks obstacleRect for every obstacle's box", () => {
    useEndlessRunnerStore.getState().update(16.67);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 7, type: "ground" }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 8, type: "air" }));
  });

  it("the picture asks obstacleRect for every obstacle's box", () => {
    drawOnce();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 7, x: 300, type: "ground" }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 8, x: 500, type: "air" }));
  });

  it("draws each obstacle exactly as its obstacleRect", () => {
    drawOnce();
    for (const [obs, color] of [
      [crate, OBSTACLE.GROUND_COLOR],
      [bar, OBSTACLE.AIR_COLOR],
    ] as const) {
      const box = obstacleRect(obs);
      const drawn = calls.find((c) => c.name === "fillRect" && c.fillStyle === color);
      expect(drawn?.args, `the ${obs.type} obstacle`).toEqual([box.left, box.top, box.width, box.height]);
      expect(box.right - box.left).toBe(box.width);
      expect(box.bottom - box.top).toBe(box.height);
    }
  });
});
