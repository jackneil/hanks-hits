import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Space Invaders builds an AudioContext at module load. jsdom has none, so stub
// it BEFORE the Game module is imported (vi.hoisted runs above imports).
vi.hoisted(() => {
  class MockAudioContext {}
  Object.defineProperty(globalThis, "AudioContext", {
    writable: true,
    configurable: true,
    value: MockAudioContext,
  });
});

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

import { SpaceInvadersGame } from "../Game";
import { useSpaceInvadersStore } from "../lib/store";
import { PLAYER } from "../lib/constants";
import { fingerDown, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";

// Regression (2026 phone audit, space-invaders): the pad was declared inside
// the game component, so every frame gave React a new component type and
// the buttons remounted about 30 times a second: a 1 s hold on ◀ moved the
// cannon one step and a 1.5 s FIRE hold fired one bullet. The controls also
// sat behind md:hidden, so a large phone held sideways had none.

let raf: RafMock;
const realGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  localStorage.clear();
  mockPointer(true);
  raf = installRafMock();
  // The game loop needs a 2D context (jsdom has none): a context whose
  // every method is a no-op and every property is writable.
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => (key in target ? target[key] : () => undefined),
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  act(() => {
    // Sound off: the game's sound manager would call createOscillator on
    // the bare AudioContext stub inside the loop.
    const state = useSpaceInvadersStore.getState();
    useSpaceInvadersStore.setState({
      progress: { ...state.progress, settings: { ...state.progress.settings, soundEnabled: false } },
    });
    useSpaceInvadersStore.getState().startGame();
  });
});

afterEach(() => {
  liftAllFingers();
  uninstallRafMock();
  resetPointerMock();
  HTMLCanvasElement.prototype.getContext = realGetContext;
  act(() => {
    useSpaceInvadersStore.setState({ gameState: "ready" });
  });
});

describe("Space Invaders pad", () => {
  it("a held ◀ keeps the cannon moving for as long as the finger is down", () => {
    render(<SpaceInvadersGame />);
    const startX = useSpaceInvadersStore.getState().playerX;
    const left = screen.getByRole("button", { name: "Move left" });
    fingerDown(left);
    raf.runFor(500, 60, act);
    const moved = startX - useSpaceInvadersStore.getState().playerX;
    // 30 frames at PLAYER.SPEED px each, far more than the one step it was.
    expect(moved).toBeGreaterThanOrEqual(PLAYER.SPEED * 10);

    fingerUp(left);
    const afterRelease = useSpaceInvadersStore.getState().playerX;
    raf.runFor(300, 60, act);
    expect(useSpaceInvadersStore.getState().playerX).toBe(afterRelease);
  });

  it("a held FIRE fires at once and then auto-fires", () => {
    const shoot = vi.fn();
    act(() => {
      useSpaceInvadersStore.setState({ shoot });
    });
    render(<SpaceInvadersGame />);
    const fire = screen.getByRole("button", { name: "Fire" });
    fingerDown(fire);
    expect(shoot).toHaveBeenCalledTimes(1);

    // The auto-fire cooldown reads Date.now(), so the wall clock must move
    // with the frames.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let frame = 0; frame < 90; frame += 1) {
        vi.setSystemTime(Date.now() + 1000 / 60);
        act(() => {
          raf.nextFrame(60);
        });
      }
    } finally {
      vi.useRealTimers();
    }
    // Auto-fire every 150 ms: about ten more shots in 1.5 s.
    expect(shoot.mock.calls.length).toBeGreaterThanOrEqual(5);
    fingerUp(fire);
  });

  it("the pad is keyed on the pointer, not on a width breakpoint", () => {
    mockPointer(true);
    const { unmount } = render(<SpaceInvadersGame />);
    expect(screen.getByTestId("space-invaders-pad")).toBeInTheDocument();
    expect(screen.queryByText(/A\/D or Arrows to move/)).not.toBeInTheDocument();
    unmount();

    mockPointer(false);
    render(<SpaceInvadersGame />);
    expect(screen.queryByTestId("space-invaders-pad")).not.toBeInTheDocument();
    expect(screen.getByText(/A\/D or Arrows to move/)).toBeInTheDocument();
  });
});
