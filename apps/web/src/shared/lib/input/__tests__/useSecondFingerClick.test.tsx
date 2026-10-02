import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fingerDown, fingerTap, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { SECOND_FINGER_WAIT_MS, useSecondFingerClick } from "../useSecondFingerClick";

function PauseButton({ onPause }: { onPause: () => void }) {
  const pause = useSecondFingerClick(onPause);
  return (
    <>
      <button type="button" {...pause}>
        Pause
      </button>
      <div data-testid="gas">GAS</div>
    </>
  );
}

/** A second finger's tap: pointer events, but no click (a browser clicks only for one finger). */
function secondFingerTap(button: Element, id = 2) {
  act(() => {
    fireEvent.pointerDown(button, { pointerId: id, pointerType: "touch", button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(button, { pointerId: id, pointerType: "touch", button: 0, clientX: 0, clientY: 0 });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  liftAllFingers();
  vi.useRealTimers();
});

describe("useSecondFingerClick", () => {
  it("runs once for a one-finger tap, on the browser's click", () => {
    const onPause = vi.fn();
    render(<PauseButton onPause={onPause} />);
    fingerTap(screen.getByRole("button", { name: "Pause" }));
    expect(onPause).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(SECOND_FINGER_WAIT_MS * 4));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("runs for a tap by a second finger while the first holds GAS", () => {
    const onPause = vi.fn();
    render(<PauseButton onPause={onPause} />);
    fingerDown(screen.getByTestId("gas"), { id: 1 });
    secondFingerTap(screen.getByRole("button", { name: "Pause" }));
    expect(onPause).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SECOND_FINGER_WAIT_MS));
    expect(onPause).toHaveBeenCalledTimes(1);
    fingerUp(screen.getByTestId("gas"), { id: 1 });
  });

  it("ignores a late browser click after the second-finger tap ran", () => {
    const onPause = vi.fn();
    render(<PauseButton onPause={onPause} />);
    const button = screen.getByRole("button", { name: "Pause" });
    secondFingerTap(button);
    act(() => vi.advanceTimersByTime(SECOND_FINGER_WAIT_MS));
    fireEvent.click(button, { detail: 1 });
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the finger slides off before it lifts", () => {
    const onPause = vi.fn();
    render(<PauseButton onPause={onPause} />);
    const button = screen.getByRole("button", { name: "Pause" });
    // A sliding finger sends pointermove events to the button it went down
    // on (a touch is captured to it), then lifts off the button.
    act(() => {
      fireEvent.pointerDown(button, { pointerId: 3, pointerType: "touch", button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(button, { pointerId: 3, pointerType: "touch", button: 0, clientX: 80, clientY: 80 });
      fireEvent.pointerUp(button, { pointerId: 3, pointerType: "touch", button: 0, clientX: 80, clientY: 80 });
    });
    act(() => vi.advanceTimersByTime(SECOND_FINGER_WAIT_MS * 2));
    expect(onPause).not.toHaveBeenCalled();
  });

  describe("a pointerup at (0, 0) (iPhone SE, iOS 27 Safari, 2026-10-01)", () => {
    /** Put the button at (left, top), 60 x 44 px. jsdom has no layout. */
    function place(button: Element, left: number, top: number) {
      vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({ x: left, y: top, width: 60, height: 44 })
      );
    }
    const touch = (pointerId: number, clientX: number, clientY: number) => ({
      pointerId,
      pointerType: "touch",
      button: 0,
      clientX,
      clientY,
    });

    it("still runs a second-finger tap: the release point is the finger's, not the pointerup's", () => {
      const onPause = vi.fn();
      render(<PauseButton onPause={onPause} />);
      const button = screen.getByRole("button", { name: "Pause" });
      place(button, 100, 100);
      fingerDown(screen.getByTestId("gas"), { id: 1 });
      act(() => {
        fireEvent.pointerDown(button, touch(2, 120, 120));
        fireEvent.pointerUp(button, touch(2, 0, 0));
      });
      act(() => vi.advanceTimersByTime(SECOND_FINGER_WAIT_MS));
      expect(onPause).toHaveBeenCalledTimes(1);
      fingerUp(screen.getByTestId("gas"), { id: 1 });
    });

    it("does nothing for a finger that slid off a button in the top-left corner", () => {
      const onPause = vi.fn();
      render(<PauseButton onPause={onPause} />);
      const button = screen.getByRole("button", { name: "Pause" });
      // (0, 0) is ON this button, so the pointerup point says "lifted on it".
      place(button, 0, 0);
      act(() => {
        fireEvent.pointerDown(button, touch(4, 20, 20));
        fireEvent.pointerMove(button, touch(4, 150, 160));
        fireEvent.pointerMove(button, touch(4, 300, 300));
        fireEvent.pointerUp(button, touch(4, 0, 0));
      });
      act(() => vi.advanceTimersByTime(SECOND_FINGER_WAIT_MS * 2));
      expect(onPause).not.toHaveBeenCalled();
    });
  });

  it("works for a mouse and the keyboard through the click", () => {
    const onPause = vi.fn();
    render(<PauseButton onPause={onPause} />);
    const button = screen.getByRole("button", { name: "Pause" });
    fireEvent.pointerDown(button, { pointerId: 9, pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(button, { pointerId: 9, pointerType: "mouse", button: 0 });
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(button, { detail: 0 }); // Enter on the focused button.
    act(() => vi.advanceTimersByTime(SECOND_FINGER_WAIT_MS * 2));
    expect(onPause).toHaveBeenCalledTimes(2);
  });

  it("drops a pending second-finger tap when the button unmounts", () => {
    const onPause = vi.fn();
    const view = render(<PauseButton onPause={onPause} />);
    secondFingerTap(screen.getByRole("button", { name: "Pause" }));
    view.unmount();
    act(() => vi.advanceTimersByTime(SECOND_FINGER_WAIT_MS * 2));
    expect(onPause).not.toHaveBeenCalled();
  });
});
