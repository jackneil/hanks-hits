import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Hunting } from "../components/Hunting";
import { useOregonTrailStore } from "../lib/store";
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
  vi.unstubAllGlobals();
  resetPointerMock();
  act(() => {
    useOregonTrailStore.setState({ gamePhase: "title" });
  });
});

describe("Oregon Trail hunt", () => {
  it("one finger tap spends ONE bullet", () => {
    render(<Hunting />);
    expect(screen.getByTestId("hunt-ammo").textContent).toBe("60");
    fingerTap(screen.getByTestId("hunt-field"), { x: 120, y: 200 });
    expect(screen.getByTestId("hunt-ammo").textContent).toBe("59");
    fingerTap(screen.getByTestId("hunt-field"), { x: 220, y: 180 });
    expect(screen.getByTestId("hunt-ammo").textContent).toBe("58");
  });
});
