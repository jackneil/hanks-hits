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
import { crossingOf, quoridorLayout } from "../lib/layout";
import { fingerTap, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, quoridor): the grooves carried onClick AND
// onTouchStart/onTouchEnd (a preview set on touchstart and cleared on
// touchend, before anyone could see it), and a finger that missed a 19 px
// groove placed a wall at once, a row away. Now a mouse previews on hover
// and places with one click, and a finger only ever moves the preview:
// the Place button places it (phone.test.tsx has the drag).

beforeEach(() => {
  localStorage.clear();
  act(() => useQuoridorStore.getState().newGame("ai", "easy"));
});

/** The board is inert until the start card's Play is tapped. */
function startInWallMode() {
  render(<QuoridorGame />);
  fireEvent.click(screen.getByRole("button", { name: "▶ Play!" }));
  fireEvent.click(screen.getByRole("button", { name: /wall/i }));
  return screen.getByTestId("quoridor-board");
}

afterEach(() => {
  liftAllFingers();
  resetPointerMock();
});

/** The middle of the board, where every wall is valid at the start. */
function middleCrossing() {
  const { square, groove } = quoridorLayout({ width: window.innerWidth, height: window.innerHeight });
  const pitch = square + groove;
  return { clientX: 3 * pitch + square + groove / 2, clientY: 4 * pitch + square + groove / 2 };
}

describe("Quoridor walls by pointer type", () => {
  it("a mouse hover moves the wall; a finger that is not pressed does not", () => {
    mockPointer(false);
    const board = startInWallMode();
    const first = useQuoridorStore.getState().wallPreview;

    // A finger's pointermove with no press (a pen hovering, say) is not a mouse hover.
    fireEvent.pointerMove(board, { pointerType: "touch", pointerId: 1, buttons: 0, ...middleCrossing() });
    expect(useQuoridorStore.getState().wallPreview).toEqual(first);

    fireEvent.pointerMove(board, { pointerType: "mouse", pointerId: 9, buttons: 0, ...middleCrossing() });
    expect(crossingOf(useQuoridorStore.getState().wallPreview!)).toEqual({ i: 3, j: 4 });
  });

  it("one mouse click places ONE wall", () => {
    mockPointer(false);
    const board = startInWallMode();
    fireEvent.pointerDown(board, { pointerType: "mouse", pointerId: 9, buttons: 1, ...middleCrossing() });
    fireEvent.pointerUp(board, { pointerType: "mouse", pointerId: 9, ...middleCrossing() });
    fireEvent.click(board, { detail: 1, ...middleCrossing() });
    expect(useQuoridorStore.getState().walls).toHaveLength(1);
    expect(useQuoridorStore.getState().wallsRemaining[1]).toBe(9);
  });

  it("one finger tap moves the wall there and places nothing", () => {
    mockPointer(true);
    const board = startInWallMode();
    fingerTap(board, { x: middleCrossing().clientX, y: middleCrossing().clientY });
    expect(useQuoridorStore.getState().walls).toHaveLength(0);
    expect(crossingOf(useQuoridorStore.getState().wallPreview!)).toEqual({ i: 3, j: 4 });
  });
});
