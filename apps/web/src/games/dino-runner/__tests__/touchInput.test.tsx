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

import { DinoRunnerGame, INTENT_MOVE_PX, JUMP_INTENT_MS } from "../Game";
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

// Regression (2026 phone audit, dino-runner): the touch handlers were on the
// canvas only, so the bottom 220 to 275 px of a phone held upright, where a
// thumb rests, was dead; DUCK sat below the fold sideways and did not
// exist at all on a large phone (md:hidden); a game-over tap restarted at
// once (and at 844x340 also pressed the Play button under the finger).
// Now the whole play surface takes the finger, JUMP and DUCK are hold
// buttons beside (or under) the picture, and game over waits for the
// result chip's Play again.

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

const surface = () => screen.getByTestId("dino-surface");

describe("Dino Runner touch input", () => {
  it("one finger tap ANYWHERE on the play surface jumps ONCE (no compatibility click)", () => {
    const jump = vi.fn();
    act(() => {
      useDinoRunnerStore.setState({ jump });
    });
    render(<DinoRunnerGame />);
    // Where a thumb rests: below the picture.
    fingerTap(surface(), { x: 180, y: 480 });
    expect(jump).toHaveBeenCalledTimes(1);
  });

  it("a swipe down on the ground ducks and never jumps", () => {
    const jump = vi.fn();
    const duck = vi.fn();
    act(() => {
      useDinoRunnerStore.setState({ jump, duck });
    });
    render(<DinoRunnerGame />);
    fingerDown(surface(), { x: 200, y: 100 });
    expect(jump).not.toHaveBeenCalled();
    fingerMove(surface(), { x: 202, y: 100 + INTENT_MOVE_PX + 2 });
    expect(jump).not.toHaveBeenCalled();
    expect(duck).toHaveBeenLastCalledWith(true);
    fingerUp(surface());
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
      render(<DinoRunnerGame />);
      fingerDown(surface(), { x: 200, y: 100 });
      expect(jump).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(JUMP_INTENT_MS);
      });
      expect(jump).toHaveBeenCalledTimes(1);
      expect(releaseJump).not.toHaveBeenCalled();
      fingerUp(surface());
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
    render(<DinoRunnerGame />);
    fingerDown(surface(), { x: 200, y: 100 });
    fingerMove(surface(), { x: 200, y: 100 - INTENT_MOVE_PX - 2 });
    expect(jump).toHaveBeenCalledTimes(1);
    expect(duck).not.toHaveBeenCalled();
    fingerUp(surface());
  });

  it("shows JUMP and DUCK on a coarse pointer and never on a fine one, at any width", () => {
    mockPointer(true);
    const { unmount } = render(<DinoRunnerGame />);
    expect(screen.getByRole("button", { name: "DUCK" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JUMP" })).toBeInTheDocument();
    unmount();

    mockPointer(false);
    render(<DinoRunnerGame />);
    expect(screen.queryByRole("button", { name: "DUCK" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "JUMP" })).not.toBeInTheDocument();
  });

  it("DUCK is a hold: down ducks, a cancelled touch stands the dino back up, and the surface never sees it", () => {
    const duck = vi.fn();
    const jump = vi.fn();
    act(() => {
      useDinoRunnerStore.setState({ duck, jump });
    });
    render(<DinoRunnerGame />);
    const button = screen.getByRole("button", { name: "DUCK" });
    fingerDown(button);
    expect(duck).toHaveBeenLastCalledWith(true);
    // The button's press is the button's: the surface under it does not jump.
    expect(jump).not.toHaveBeenCalled();
    fingerCancel(button);
    expect(duck).toHaveBeenLastCalledWith(false);
    expect(jump).not.toHaveBeenCalled();
  });

  it("JUMP is a hold: down jumps once, up lets the jump go (hold = higher)", () => {
    const jump = vi.fn();
    const releaseJump = vi.fn();
    act(() => {
      useDinoRunnerStore.setState({ jump, releaseJump });
    });
    render(<DinoRunnerGame />);
    const button = screen.getByRole("button", { name: "JUMP" });
    fingerDown(button);
    expect(jump).toHaveBeenCalledTimes(1);
    expect(releaseJump).not.toHaveBeenCalled();
    fingerUp(button);
    expect(jump).toHaveBeenCalledTimes(1);
    expect(releaseJump).toHaveBeenCalledTimes(1);
  });

  it("a mouse press on the surface jumps once and its release lets the jump go", () => {
    mockPointer(false);
    const jump = vi.fn();
    const releaseJump = vi.fn();
    act(() => {
      useDinoRunnerStore.setState({ jump, releaseJump });
    });
    const { container } = render(<DinoRunnerGame />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    act(() => {
      canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, ...({ pointerType: "mouse" } as object) }));
    });
    expect(jump).toHaveBeenCalledTimes(1);
    act(() => {
      canvas.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, ...({ pointerType: "mouse" } as object) }));
    });
    expect(releaseJump).toHaveBeenCalledTimes(1);
  });

  it("at game over a tap on the surface does nothing: the result chip restarts", () => {
    act(() => {
      useDinoRunnerStore.setState({ gameState: "game-over", score: 42 });
    });
    const startGame = vi.fn();
    act(() => {
      useDinoRunnerStore.setState({ startGame });
    });
    render(<DinoRunnerGame />);
    fingerTap(surface(), { x: 200, y: 100 });
    fingerTap(surface(), { x: 200, y: 400 });
    expect(startGame).not.toHaveBeenCalled();
    expect(useDinoRunnerStore.getState().gameState).toBe("game-over");
    expect(screen.getByTestId("result-chip")).toBeInTheDocument();
  });
});
