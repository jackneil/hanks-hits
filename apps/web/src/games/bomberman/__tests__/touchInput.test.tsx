import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import BombermanGame from "../Game";
import { useBombermanStore } from "../lib/store";
import { fingerCancel, fingerDown, fingerMove, fingerTap, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";

// Regression (2026 phone audit, bomberman): the bomb button carried
// onTouchStart AND onClick, so one tap placed two bombs (the second one
// swallowed by the maxBombs guard, a latent double); each d-pad button moved
// exactly one tile per touchstart, so crossing the arena took twenty taps;
// and a thumb that slid from one key onto the next stayed on the first.

let raf: RafMock;
const realMovePlayer = useBombermanStore.getState().movePlayer;
const realPlaceBomb = useBombermanStore.getState().placeBomb;

beforeEach(() => {
  localStorage.clear();
  mockPointer(true);
  raf = installRafMock();
  act(() => {
    useBombermanStore.getState().resetGame();
    useBombermanStore.getState().startGame();
  });
});

afterEach(() => {
  liftAllFingers();
  uninstallRafMock();
  resetPointerMock();
  vi.restoreAllMocks();
  act(() => {
    useBombermanStore.setState({ movePlayer: realMovePlayer, placeBomb: realPlaceBomb });
    useBombermanStore.getState().resetGame();
  });
});

describe("Bomberman touch input", () => {
  it("one tap on the bomb button places ONE bomb", () => {
    const placeBomb = vi.fn();
    act(() => {
      useBombermanStore.setState({ placeBomb });
    });
    render(<BombermanGame />);
    fingerTap(screen.getByRole("button", { name: "Drop a bomb" }));
    expect(placeBomb).toHaveBeenCalledTimes(1);
  });

  it("holding a d-pad key keeps moving at the key repeat rate", () => {
    const movePlayer = vi.fn();
    act(() => {
      useBombermanStore.setState({ movePlayer });
    });
    render(<BombermanGame />);
    const right = screen.getByRole("button", { name: "Move right" });
    fingerDown(right);
    raf.runFor(1000, 60, act);
    // MOVE_RATE is 120 ms: a 1 s hold is about eight moves.
    expect(movePlayer.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(movePlayer.mock.calls.every(([dir]) => dir === "RIGHT")).toBe(true);

    fingerUp(right);
    const afterRelease = movePlayer.mock.calls.length;
    raf.runFor(500, 60, act);
    expect(movePlayer.mock.calls.length).toBe(afterRelease);
  });

  it("moves at the same rate on a 120 Hz screen (a fixed step, not a step per frame)", () => {
    const movePlayer = vi.fn();
    act(() => {
      useBombermanStore.setState({ movePlayer });
    });
    render(<BombermanGame />);
    fingerDown(screen.getByRole("button", { name: "Move right" }));
    raf.runFor(1000, 120, act);
    expect(movePlayer.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(movePlayer.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("moves at the key repeat rate even when the real clock is far ahead of the frame clock", () => {
    // Under machine load, performance.now() can run far ahead of the frame
    // timestamps. The loop used to seed its clock from performance.now(), so
    // the first delta was hugely negative and a held button barely moved.
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000_000);
    const movePlayer = vi.fn();
    act(() => {
      useBombermanStore.setState({ movePlayer });
    });
    render(<BombermanGame />);
    fingerDown(screen.getByRole("button", { name: "Move right" }));
    raf.runFor(1000, 60, act);
    expect(movePlayer.mock.calls.length).toBeGreaterThanOrEqual(5);
    now.mockRestore();
  });

  it("a thumb that slides from one key onto another changes direction without lifting", () => {
    const movePlayer = vi.fn();
    act(() => {
      useBombermanStore.setState({ movePlayer });
    });
    render(<BombermanGame />);
    const right = screen.getByRole("button", { name: "Move right" });
    const up = screen.getByRole("button", { name: "Move up" });
    // jsdom has no layout and no elementFromPoint: give it one, where the
    // point under the moved finger is the up key.
    if (typeof document.elementFromPoint !== "function") {
      Object.defineProperty(document, "elementFromPoint", { value: () => null, configurable: true, writable: true });
    }
    const fromPoint = vi.spyOn(document, "elementFromPoint").mockReturnValue(up);
    fingerDown(right, { x: 100, y: 100 });
    raf.runFor(300, 60, act);
    expect(movePlayer).toHaveBeenLastCalledWith("RIGHT");
    fingerMove(right, { x: 60, y: 40 });
    raf.runFor(300, 60, act);
    expect(movePlayer).toHaveBeenLastCalledWith("UP");
    fingerUp(right);
    const afterRelease = movePlayer.mock.calls.length;
    raf.runFor(300, 60, act);
    expect(movePlayer.mock.calls.length).toBe(afterRelease);
    fromPoint.mockRestore();
  });

  it("a cancelled touch on the d-pad stops the movement", () => {
    const movePlayer = vi.fn();
    act(() => {
      useBombermanStore.setState({ movePlayer });
    });
    render(<BombermanGame />);
    const upKey = screen.getByRole("button", { name: "Move up" });
    fingerDown(upKey);
    raf.runFor(300, 60, act);
    expect(movePlayer).toHaveBeenCalled();
    fingerCancel(upKey);
    const afterCancel = movePlayer.mock.calls.length;
    raf.runFor(500, 60, act);
    expect(movePlayer.mock.calls.length).toBe(afterCancel);
  });
});
