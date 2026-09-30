import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTouchControls, ZONE_IGNORE_SELECTOR } from "../hooks/useControls";
import { useHillClimbStore } from "../lib/store";
import { MobileControls } from "../ui/MobileControls";
import { SettingsMenu } from "../ui/SettingsMenu";
import { fingerCancel, fingerDown, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { useShellOverlays } from "@/shared/lib/shellOverlays";

// Regression (2026 phone audit, hill-climb): the gas/brake zones classified
// EVERY touch on the window by clientX alone, so a finger on the NITRO
// button, a header button or the "Restart game?" dialog drove the truck
// (213 m to 890 m under the dialog); the window listeners were passive, so
// a swipe on the play field scrolled the page 48 px. NITRO itself was a
// React onTouchStart with a no-op preventDefault that logged an error on
// every press.

function windowTouch(type: "touchstart" | "touchend", target: EventTarget, id: number, x: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "changedTouches", {
    value: [{ identifier: id, clientX: x, clientY: 200, target }],
  });
  return event;
}

beforeEach(() => {
  mockPointer(true);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
});

afterEach(() => {
  liftAllFingers();
  resetPointerMock();
  act(() => {
    useHillClimbStore.getState().resumeGame();
  });
});

describe("hill-climb touch zones", () => {
  it("a zone press prevents the touch default, so the page never scrolls under a drag", () => {
    renderHook(() => useTouchControls(true));
    const start = windowTouch("touchstart", document.body, 1, 600);
    act(() => {
      window.dispatchEvent(start);
    });
    expect(start.defaultPrevented).toBe(true);
    act(() => {
      window.dispatchEvent(windowTouch("touchend", document.body, 1, 600));
    });
  });

  it("the zones are off while the game is paused, so a finger on the pause sheet never drives", () => {
    act(() => {
      useHillClimbStore.getState().pauseGame();
    });
    const { result } = renderHook(() => useTouchControls(true));
    const start = windowTouch("touchstart", document.body, 1, 600);
    act(() => {
      window.dispatchEvent(start);
    });
    expect(result.current.gas).toBe(false);
    expect(start.defaultPrevented).toBe(false);
    act(() => {
      window.dispatchEvent(windowTouch("touchend", document.body, 1, 600));
    });

    act(() => {
      useHillClimbStore.getState().resumeGame();
    });
    act(() => {
      window.dispatchEvent(windowTouch("touchstart", document.body, 2, 600));
    });
    expect(result.current.gas).toBe(true);
    act(() => {
      window.dispatchEvent(windowTouch("touchend", document.body, 2, 600));
    });
    expect(result.current.gas).toBe(false);
  });

  it("a touch on the play field's right half is gas", () => {
    const { result } = renderHook(() => useTouchControls(true));
    act(() => {
      window.dispatchEvent(windowTouch("touchstart", document.body, 1, 600));
    });
    expect(result.current.gas).toBe(true);
    act(() => {
      window.dispatchEvent(windowTouch("touchend", document.body, 1, 600));
    });
    expect(result.current.gas).toBe(false);
  });

  it("a touch on a button or a dialog is NOT gas or brake", () => {
    const button = document.createElement("button");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inDialog = document.createElement("span");
    dialog.appendChild(inDialog);
    document.body.append(button, dialog);

    const { result } = renderHook(() => useTouchControls(true));
    act(() => {
      window.dispatchEvent(windowTouch("touchstart", button, 1, 600));
      window.dispatchEvent(windowTouch("touchstart", inDialog, 2, 100));
    });
    expect(result.current.gas).toBe(false);
    expect(result.current.brake).toBe(false);

    button.remove();
    dialog.remove();
  });

  it("names the controls that must never drive", () => {
    expect(ZONE_IGNORE_SELECTOR).toContain("button");
    expect(ZONE_IGNORE_SELECTOR).toContain("[role=dialog]");
    expect(ZONE_IGNORE_SELECTOR).toContain("[data-testid=orientation-tip]");
    expect(ZONE_IGNORE_SELECTOR).not.toContain("orientation-warning");
  });
});

describe("hill-climb NITRO button", () => {
  it("is a pointer hold: down is on, a cancelled touch is off", () => {
    const setNitro = vi.fn();
    render(<MobileControls setNitro={setNitro} />);
    const nitro = screen.getByRole("button", { name: "Nitro" });
    fingerDown(nitro);
    expect(setNitro).toHaveBeenLastCalledWith(true);
    fingerCancel(nitro);
    expect(setNitro).toHaveBeenLastCalledWith(false);

    fingerDown(nitro, { id: 3 });
    fingerUp(nitro, { id: 3 });
    expect(setNitro.mock.calls.map(([v]) => v)).toEqual([true, false, true, false]);
  });
});

describe("hill-climb settings hint", () => {
  it("never tells a finger to press Escape", () => {
    mockPointer(true);
    const { unmount } = render(<SettingsMenu onBack={() => {}} />);
    expect(screen.getByText("Tap Back to go back")).toBeInTheDocument();
    unmount();

    mockPointer(false);
    render(<SettingsMenu onBack={() => {}} />);
    expect(screen.getByText("Press Escape to go back")).toBeInTheDocument();
  });
});

describe("hill-climb touch zones under a shell overlay", () => {
  afterEach(() => {
    useShellOverlays.setState({ count: 0 });
  });

  it("are off while a shell overlay is open, so a finger on a dialog's backdrop or the install sheet drives nothing", () => {
    // The restart question's role=dialog is on its card; its dark
    // backdrop and the install sheet (a section with no role) matched no
    // entry of ZONE_IGNORE_SELECTOR, so a finger resting there was a zone
    // press and the truck drove on under "Restart game?".
    act(() => {
      useShellOverlays.getState().open();
    });
    const { result } = renderHook(() => useTouchControls(true));
    const start = windowTouch("touchstart", document.body, 1, 600);
    act(() => {
      window.dispatchEvent(start);
    });
    expect(result.current.gas).toBe(false);
    expect(start.defaultPrevented).toBe(false);
    act(() => {
      window.dispatchEvent(windowTouch("touchend", document.body, 1, 600));
    });

    // The overlay closes: the zones are back.
    act(() => {
      useShellOverlays.getState().close();
    });
    act(() => {
      window.dispatchEvent(windowTouch("touchstart", document.body, 2, 600));
    });
    expect(result.current.gas).toBe(true);
    act(() => {
      window.dispatchEvent(windowTouch("touchend", document.body, 2, 600));
    });
    expect(result.current.gas).toBe(false);
  });
});
