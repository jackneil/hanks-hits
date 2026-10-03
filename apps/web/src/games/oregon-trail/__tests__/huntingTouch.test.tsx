import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Hunting } from "../components/Hunting";
import { useOregonTrailStore } from "../lib/store";
import { HUNTING_TIME } from "../lib/constants";
import { useHuntPauseStore } from "../lib/huntPause";
import { fingerTap, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, oregon-trail): the hunt field carried
// onClick AND onTouchStart={shoot}, so every finger tap fired two shots and
// spent two bullets (60 -> 58 -> 56). A 60-bullet kid got 30 shots.

beforeEach(() => {
  localStorage.clear();
  mockPointer(true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useOregonTrailStore.setState({
      gamePhase: "hunting",
      supplies: {
        food: 100,
        oxen: 4,
        clothing: 10,
        ammunition: 60,
        spareParts: { wheels: 1, axles: 1, tongues: 1 },
        money: 100,
      },
    });
    useHuntPauseStore.setState({ paused: false });
  });
});

afterEach(() => {
  liftAllFingers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetPointerMock();
  act(() => {
    useOregonTrailStore.setState({ gamePhase: "title" });
  });
});

describe("Oregon Trail hunt", () => {
  it("releases the real capture canvas when the last bullet opens the result card", () => {
    useOregonTrailStore.setState(s => ({ supplies: { ...s.supplies, ammunition: 1 } }));
    const capture = vi.fn();
    const captureResult = vi.fn();
    const view = render(<Hunting onCaptureCanvas={capture} onCaptureResult={captureResult} />);
    const canvas = view.container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(capture).toHaveBeenLastCalledWith(canvas);
    fingerTap(screen.getByTestId("hunt-field"), { x: 120, y: 200 });
    expect(screen.getByTestId("oregon-hunt-done")).toBeInTheDocument();
    expect(view.container.querySelector("canvas")).toBeNull();
    expect(capture).toHaveBeenLastCalledWith(null);
    expect(captureResult).toHaveBeenLastCalledWith({ food: 0, ammo: 1, score: 0, outOfBullets: true });
    view.unmount();
    expect(captureResult).toHaveBeenLastCalledWith(null);
  });
  it("captures the timer-ended hunt's actual result without presenting it as out of bullets", () => {
    vi.useFakeTimers();
    const captureResult = vi.fn();
    render(<Hunting onCaptureResult={captureResult} />);
    fingerTap(screen.getByTestId("hunt-field"), { x: 120, y: 200 });
    act(() => { vi.advanceTimersByTime(HUNTING_TIME * 1000); });
    expect(screen.getByTestId("oregon-hunt-done")).toBeInTheDocument();
    expect(captureResult).toHaveBeenLastCalledWith({ food: 0, ammo: 1, score: 0, outOfBullets: false });
  });
  it("one finger tap spends ONE bullet", () => {
    render(<Hunting />);
    expect(screen.getByTestId("hunt-ammo").textContent).toBe("60");
    fingerTap(screen.getByTestId("hunt-field"), { x: 120, y: 200 });
    expect(screen.getByTestId("hunt-ammo").textContent).toBe("59");
    fingerTap(screen.getByTestId("hunt-field"), { x: 220, y: 180 });
    expect(screen.getByTestId("hunt-ammo").textContent).toBe("58");
  });
});
