import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    isGuest: true,
    syncStatus: "idle",
    lastSynced: null,
    forceSync: vi.fn(),
  }),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

import {
  DinoRunnerGame,
  getRestartLine,
  INTENT_MOVE_PX,
  JUMP_INTENT_MS,
} from "../Game";
import { useDinoRunnerStore } from "../lib/store";
import {
  fingerCancel,
  fingerDown,
  fingerMove,
  fingerTap,
  fingerUp,
  liftAllFingers,
} from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, dino-runner): the canvas carried
// onTouchStart AND onClick, so one tap ran the input handler twice (at
// 844x340 a game-over tap restarted AND pressed the Play button under the
// finger); every touchstart jumped at once, so "swipe down to duck" hopped
// the dino into the pterodactyl; DUCK sat behind md:hidden, so a large
// phone held sideways (844 px wide) had no duck control at all; the
// game-over line told a phone kid to press Space.

beforeEach(() => {
  localStorage.clear();
  mockPointer(true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useDinoRunnerStore.setState({ gameState: "playing" });
  });
});

afterEach(() => {
  liftAllFingers();
  vi.unstubAllGlobals();
  resetPointerMock();
  act(() => {
    useDinoRunnerStore.setState({ gameState: "idle" });
  });
});

describe("Dino Runner touch input", () => {
  it("one finger tap on the canvas jumps ONCE (no compatibility click)", () => {
    const jump = vi.fn();
    act(() => {
      useDinoRunnerStore.setState({ jump });
    });
    const { container } = render(<DinoRunnerGame />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    fingerTap(canvas, { x: 200, y: 100 });
    expect(jump).toHaveBeenCalledTimes(1);
  });

  it("a swipe down on the ground ducks and never jumps", () => {
    const jump = vi.fn();
    const duck = vi.fn();
    act(() => {
      useDinoRunnerStore.setState({ jump, duck });
    });
    const { container } = render(<DinoRunnerGame />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    fingerDown(canvas, { x: 200, y: 100 });
    expect(jump).not.toHaveBeenCalled();
    fingerMove(canvas, { x: 202, y: 100 + INTENT_MOVE_PX + 2 });
    expect(jump).not.toHaveBeenCalled();
    expect(duck).toHaveBeenLastCalledWith(true);
    fingerUp(canvas);
    expect(duck).toHaveBeenLastCalledWith(false);
    expect(jump).not.toHaveBeenCalled();
  });

  it("a finger that stays still jumps after the intent window and holds the jump until it lifts", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const jump = vi.fn();
      const releaseJump = vi.fn();
      act(() => {
        useDinoRunnerStore.setState({ jump, releaseJump });
      });
      const { container } = render(<DinoRunnerGame />);
      const canvas = container.querySelector("canvas") as HTMLCanvasElement;
      fingerDown(canvas, { x: 200, y: 100 });
      expect(jump).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(JUMP_INTENT_MS);
      });
      expect(jump).toHaveBeenCalledTimes(1);
      expect(releaseJump).not.toHaveBeenCalled();
      fingerUp(canvas);
      expect(releaseJump).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a sideways or upward flick jumps at once", () => {
    const jump = vi.fn();
    const duck = vi.fn();
    act(() => {
      useDinoRunnerStore.setState({ jump, duck });
    });
    const { container } = render(<DinoRunnerGame />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    fingerDown(canvas, { x: 200, y: 100 });
    fingerMove(canvas, { x: 200, y: 100 - INTENT_MOVE_PX - 2 });
    expect(jump).toHaveBeenCalledTimes(1);
    expect(duck).not.toHaveBeenCalled();
    fingerUp(canvas);
  });

  it("shows DUCK on a coarse pointer and never on a fine one, at any width", () => {
    mockPointer(true);
    const { unmount } = render(<DinoRunnerGame />);
    expect(screen.getByRole("button", { name: "DUCK" })).toBeInTheDocument();
    unmount();

    mockPointer(false);
    render(<DinoRunnerGame />);
    expect(screen.queryByRole("button", { name: "DUCK" })).not.toBeInTheDocument();
  });

  it("DUCK is a hold: down ducks, a cancelled touch stands the dino back up", () => {
    const duck = vi.fn();
    act(() => {
      useDinoRunnerStore.setState({ duck });
    });
    render(<DinoRunnerGame />);
    const button = screen.getByRole("button", { name: "DUCK" });
    fingerDown(button);
    expect(duck).toHaveBeenLastCalledWith(true);
    fingerCancel(button);
    expect(duck).toHaveBeenLastCalledWith(false);
  });

  it("the game-over line never says Space to a finger", () => {
    expect(getRestartLine(true)).toBe("Tap to Restart");
    expect(getRestartLine(false)).toBe("Press Space or Tap to Restart");
  });
});
