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

import { BlitzBomberGame } from "../Game";
import { useBlitzBomberStore } from "../lib/store";
import { fingerTap, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, blitz-bomber): the in-play hint pair was
// keyed on the md: width breakpoint, so a large phone held sideways (844 px
// wide) read "Press SPACE or any key to drop bombs | R to restart".

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useBlitzBomberStore.setState({ gameState: "playing" });
  });
});

afterEach(() => {
  liftAllFingers();
  vi.unstubAllGlobals();
  resetPointerMock();
  act(() => {
    useBlitzBomberStore.setState({ gameState: "ready" });
  });
});

describe("Blitz Bomber touch input", () => {
  it("one finger tap drops ONE bomb", () => {
    mockPointer(true);
    const dropBomb = vi.fn();
    act(() => {
      useBlitzBomberStore.setState({ dropBomb });
    });
    const { container } = render(<BlitzBomberGame />);
    fingerTap(container.querySelector("canvas") as HTMLCanvasElement, { x: 100, y: 100 });
    expect(dropBomb).toHaveBeenCalledTimes(1);
  });

  it("keys the in-play hint on the pointer, not on a width breakpoint", () => {
    mockPointer(true);
    const { unmount } = render(<BlitzBomberGame />);
    expect(screen.getByText("Tap anywhere to drop bombs")).toBeInTheDocument();
    expect(screen.queryByText(/Press SPACE/)).not.toBeInTheDocument();
    unmount();

    mockPointer(false);
    render(<BlitzBomberGame />);
    expect(screen.getByText(/Press SPACE or any key/)).toBeInTheDocument();
    expect(screen.queryByText("Tap anywhere to drop bombs")).not.toBeInTheDocument();
  });
});
