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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

import { AsteroidsGame } from "../Game";
import { useAsteroidsStore } from "../lib/store";
import { PAD_LABELS } from "../lib/overlayCopy";
import { fingerCancel, fingerDown, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, asteroids): the pad buttons carried
// onTouchStart/onTouchEnd AND onMouseDown/Up/Leave with no touchcancel
// path, so a system-cancelled touch (an edge swipe, the notification pull)
// left the thrust stuck on and the ship flew into rocks on its own.

beforeEach(() => {
  localStorage.clear();
  mockPointer(true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useAsteroidsStore.getState().startGame();
  });
});

afterEach(() => {
  liftAllFingers();
  vi.unstubAllGlobals();
  resetPointerMock();
  act(() => {
    useAsteroidsStore.setState({ status: "ready" });
  });
});

function input() {
  const { thrusting, shooting, rotatingLeft } = useAsteroidsStore.getState();
  return { thrusting, shooting, rotatingLeft };
}

describe("Asteroids pad", () => {
  it("thrust holds while the finger is down and releases on touchcancel", () => {
    render(<AsteroidsGame />);
    const thrust = screen.getByRole("button", { name: PAD_LABELS.thrust });
    fingerDown(thrust);
    expect(input().thrusting).toBe(true);
    fingerCancel(thrust);
    expect(input().thrusting).toBe(false);
  });

  it("releases on lift and on window blur", () => {
    render(<AsteroidsGame />);
    const fire = screen.getByRole("button", { name: PAD_LABELS.fire });
    fingerDown(fire);
    expect(input().shooting).toBe(true);
    fingerUp(fire);
    expect(input().shooting).toBe(false);

    const left = screen.getByRole("button", { name: PAD_LABELS.turnLeft });
    fingerDown(left);
    expect(input().rotatingLeft).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(input().rotatingLeft).toBe(false);
  });
});
