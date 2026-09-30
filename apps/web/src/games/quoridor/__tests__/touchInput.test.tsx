import { act, fireEvent, render, screen } from "@testing-library/react";
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

import { QuoridorGame } from "../Game";
import { useQuoridorStore } from "../lib/store";
import { fingerTap, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, quoridor): each groove hitbox carried
// onClick AND onTouchStart/onTouchEnd (a preview that was set on touchstart
// and cleared on touchend, before anyone could see it) plus
// onMouseEnter/Leave. Now one input path places the wall, and the hover
// preview is a mouse-only pointer affordance.

beforeEach(() => {
  localStorage.clear();
  act(() => {
    useQuoridorStore.getState().newGame();
    useQuoridorStore.setState({ wallMode: true, wallOrientation: "horizontal", wallPreview: null });
  });
});

/** The board is inert until the start card's Play is tapped. */
function renderStarted() {
  const view = render(<QuoridorGame />);
  fireEvent.click(screen.getByRole("button", { name: "▶ Play!" }));
  return view;
}

afterEach(() => {
  liftAllFingers();
  resetPointerMock();
});

/** A horizontal wall in the middle of the board is valid at game start. */
const MIDDLE_GROOVE = "groove-horizontal-3-3";

describe("Quoridor grooves", () => {
  it("a mouse hover previews the wall; a finger's pointerenter does not", () => {
    mockPointer(false);
    renderStarted();
    const groove = screen.getByTestId(MIDDLE_GROOVE);

    fireEvent.pointerEnter(groove, { pointerType: "touch", pointerId: 1 });
    expect(useQuoridorStore.getState().wallPreview).toBeNull();

    fireEvent.pointerEnter(groove, { pointerType: "mouse", pointerId: 9 });
    expect(useQuoridorStore.getState().wallPreview).not.toBeNull();

    fireEvent.pointerLeave(groove, { pointerType: "mouse", pointerId: 9 });
    expect(useQuoridorStore.getState().wallPreview).toBeNull();
  });

  it("one finger tap on a groove places ONE wall", () => {
    mockPointer(true);
    renderStarted();
    const groove = screen.getByTestId(MIDDLE_GROOVE);
    const before = useQuoridorStore.getState().walls.length;
    fingerTap(groove);
    expect(useQuoridorStore.getState().walls.length).toBe(before + 1);
  });
});
