/**
 * The store writes localStorage only when the progress changes.
 * Regression (review wave 2, 2026-10-02): persist writes after every set,
 * and the game loop sets the store on every frame of a run, so the
 * unchanged progress was turned into a string and written 60 to 130 times
 * a second on the main thread.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { STEP_MS } from "../lib/constants";
import { useEndlessRunnerStore } from "../lib/store";

const KEY = "endless-runner-storage";

let setItem: MockInstance<Storage["setItem"]>;

beforeEach(() => {
  localStorage.clear();
  // The first set after the clear writes the key (it is gone).
  useEndlessRunnerStore.getState().reset();
  expect(localStorage.getItem(KEY), "a set writes a missing key").not.toBeNull();
  // A spy that still writes: the key stays in localStorage. (The test
  // setup's localStorage is its own class, so spy on the object itself.)
  setItem = vi.spyOn(window.localStorage, "setItem");
});

afterEach(() => {
  setItem.mockRestore();
  useEndlessRunnerStore.getState().reset();
});

const runnerWrites = () => setItem.mock.calls.filter(([key]) => key === KEY).length;

/** Start a run with a clear road, so 100 frames end nothing. */
function startClearRun() {
  useEndlessRunnerStore.getState().startGame();
  useEndlessRunnerStore.setState({ obstacles: [], coins: [], nextObstacleX: 1e9 });
}

describe("Endless Runner store writes", () => {
  it("writes nothing while a run plays, and once when it ends", () => {
    startClearRun();
    for (let i = 0; i < 100; i++) useEndlessRunnerStore.getState().update(STEP_MS / 2);
    expect(useEndlessRunnerStore.getState().gameState).toBe("playing");
    expect(useEndlessRunnerStore.getState().distance).toBeGreaterThan(0);
    expect(runnerWrites(), "100 frames of play write nothing").toBe(0);

    useEndlessRunnerStore.getState().endGame();
    expect(runnerWrites(), "the end of the run writes the progress once").toBe(1);
    const saved = JSON.parse(localStorage.getItem(KEY)!);
    expect(saved.state.progress.gamesPlayed).toBeGreaterThan(0);
    expect(saved.state.progress).toEqual(useEndlessRunnerStore.getState().progress);
  });

  it("writes the key again at the next set when a sign-out cleared it", () => {
    startClearRun();
    useEndlessRunnerStore.getState().update(STEP_MS);
    expect(runnerWrites()).toBe(0);

    localStorage.removeItem(KEY);
    useEndlessRunnerStore.getState().update(STEP_MS);
    expect(runnerWrites(), "the cleared key is written again").toBe(1);
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it("writes a progress change from the cloud", () => {
    const progress = useEndlessRunnerStore.getState().getProgress();
    useEndlessRunnerStore.getState().setProgress({ ...progress, highScore: progress.highScore + 50, lastModified: Date.now() });
    expect(runnerWrites()).toBe(1);
    expect(JSON.parse(localStorage.getItem(KEY)!).state.progress.highScore).toBe(progress.highScore + 50);
  });
});
