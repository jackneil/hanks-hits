import { act, render, screen, within } from "@testing-library/react";
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

import { AUTO_FIRE_COOLDOWN_MS, PAD_LABELS, SpaceInvadersGame } from "../Game";
import { useSpaceInvadersStore } from "../lib/store";
import { PLAYER } from "../lib/constants";
import { fingerCancel, fingerDown, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { installNoop2dContext } from "@/__tests__/noop-2d-context";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { installRafMock, uninstallRafMock, type RafMock } from "@/__tests__/raf-mock";

// Regression (2026 phone audit, space-invaders): the pad was declared inside
// the game component, so every frame gave React a new component type and
// the buttons remounted about 30 times a second: a 1 s hold on ◀ moved the
// cannon one step and a 1.5 s FIRE hold fired one bullet. The controls also
// sat behind md:hidden, so a large phone held sideways had none. Now the
// held state drives the shared fixed-step loop: a hold repeats at 60 steps
// a second on any screen, and FIRE auto-fires on a game-time cooldown.

let raf: RafMock;
let restoreContext: () => void;

beforeEach(() => {
  localStorage.clear();
  mockPointer(true);
  raf = installRafMock();
  restoreContext = installNoop2dContext();
  act(() => {
    useSpaceInvadersStore.getState().startGame();
  });
});

afterEach(() => {
  liftAllFingers();
  uninstallRafMock();
  restoreContext();
  resetPointerMock();
  act(() => {
    useSpaceInvadersStore.setState({ gameState: "ready" });
  });
});

/** The first frame only starts the loop's clock. */
function prime(hz: number) {
  act(() => {
    raf.nextFrame(hz);
  });
}

describe("Space Invaders pad", () => {
  it.each([60, 120])("a held ◀ keeps the cannon moving for as long as the finger is down, at the same speed on a %d Hz screen", (hz) => {
    render(<SpaceInvadersGame />);
    prime(hz);
    const startX = useSpaceInvadersStore.getState().playerX;
    const left = screen.getByRole("button", { name: PAD_LABELS.left });
    fingerDown(left);
    raf.runFor(500, hz, act);
    const moved = startX - useSpaceInvadersStore.getState().playerX;
    // 30 steps of PLAYER.SPEED px each: the same distance at 60 and 120 Hz.
    expect(moved).toBe(PLAYER.SPEED * 30);

    fingerUp(left);
    const afterRelease = useSpaceInvadersStore.getState().playerX;
    raf.runFor(300, hz, act);
    expect(useSpaceInvadersStore.getState().playerX).toBe(afterRelease);
  });

  it("a held FIRE fires at once and then auto-fires every cooldown of game time", () => {
    const shoot = vi.fn();
    act(() => {
      useSpaceInvadersStore.setState({ shoot });
    });
    render(<SpaceInvadersGame />);
    prime(60);
    const fire = screen.getByRole("button", { name: PAD_LABELS.fire });
    fingerDown(fire);
    expect(shoot).toHaveBeenCalledTimes(1);
    raf.runFor(1500, 60, act);
    // One shot each AUTO_FIRE_COOLDOWN_MS: ten more in 1.5 s.
    expect(shoot).toHaveBeenCalledTimes(1 + Math.floor(1500 / AUTO_FIRE_COOLDOWN_MS));
    fingerUp(fire);
    const shots = shoot.mock.calls.length;
    raf.runFor(1000, 60, act);
    expect(shoot).toHaveBeenCalledTimes(shots);
  });

  it("a system-cancelled touch lets go of ◀ (an edge swipe, the notification pull)", () => {
    render(<SpaceInvadersGame />);
    prime(60);
    const right = screen.getByRole("button", { name: PAD_LABELS.right });
    fingerDown(right);
    raf.runFor(200, 60, act);
    fingerCancel(right);
    const atCancel = useSpaceInvadersStore.getState().playerX;
    raf.runFor(500, 60, act);
    expect(useSpaceInvadersStore.getState().playerX).toBe(atCancel);
  });

  it("the pad is keyed on the pointer, not on a width breakpoint", () => {
    mockPointer(true);
    const { unmount } = render(<SpaceInvadersGame />);
    expect(screen.getByTestId("space-invaders-pad-move")).toBeInTheDocument();
    expect(screen.getByTestId("space-invaders-pad-fire")).toBeInTheDocument();
    expect(screen.queryByText(/A\/D or Arrows to move/)).not.toBeInTheDocument();
    unmount();

    mockPointer(false);
    render(<SpaceInvadersGame />);
    expect(screen.queryByTestId("space-invaders-pad-move")).not.toBeInTheDocument();
    expect(screen.queryByTestId("space-invaders-pad-fire")).not.toBeInTheDocument();
    expect(screen.getByText(/A\/D or Arrows to move/)).toBeInTheDocument();
  });

  it("upright the pad is one row under the canvas; sideways the arrows and FIRE sit in the gutters beside it", () => {
    // With no GameShell the play box is the window: a phone upright, then sideways.
    const setWindow = (width: number, height: number) => {
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
      Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
    };
    try {
      setWindow(375, 549);
      const { unmount } = render(<SpaceInvadersGame />);
      expect(screen.getByTestId("space-invaders-root").dataset.layout).toBe("upright");
      const row = screen.getByTestId("space-invaders-pad");
      expect(within(row).getByTestId("space-invaders-pad-move")).toBeInTheDocument();
      expect(within(row).getByTestId("space-invaders-pad-fire")).toBeInTheDocument();
      expect(screen.queryByTestId("space-invaders-gutter-left")).toBeNull();
      unmount();

      setWindow(667, 311);
      render(<SpaceInvadersGame />);
      expect(screen.getByTestId("space-invaders-root").dataset.layout).toBe("sideways");
      expect(screen.queryByTestId("space-invaders-pad")).toBeNull();
      expect(within(screen.getByTestId("space-invaders-gutter-left")).getByTestId("space-invaders-pad-move")).toBeInTheDocument();
      expect(within(screen.getByTestId("space-invaders-gutter-right")).getByTestId("space-invaders-pad-fire")).toBeInTheDocument();
      // The HUD sits under the arrows, the sound switch under FIRE.
      expect(within(screen.getByTestId("space-invaders-gutter-left")).getByTestId("space-invaders-hud")).toBeInTheDocument();
      expect(within(screen.getByTestId("space-invaders-gutter-right")).getByTestId("space-invaders-sound")).toBeInTheDocument();
    } finally {
      setWindow(1024, 768);
    }
  });

  it("the pad groups keep their place and hide between rounds, and every button is 44 px or more", () => {
    render(<SpaceInvadersGame />);
    const groups = () => [screen.getByTestId("space-invaders-pad-move"), screen.getByTestId("space-invaders-pad-fire")];
    for (const group of groups()) {
      expect(group.className.split(/\s+/)).not.toContain("invisible");
      expect(group.hasAttribute("inert")).toBe(false);
      for (const button of within(group).getAllByRole("button")) {
        const width = Number.parseInt(button.style.width, 10);
        const height = Number.parseInt(button.style.height, 10);
        expect(width).toBeGreaterThanOrEqual(44);
        expect(height).toBeGreaterThanOrEqual(44);
        expect(button.className).toMatch(/\btouch-none\b/);
      }
    }
    act(() => useSpaceInvadersStore.setState({ gameState: "waveComplete" }));
    for (const group of groups()) {
      expect(group.className.split(/\s+/)).toContain("invisible");
      expect(group.hasAttribute("inert")).toBe(true);
      expect(group.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
