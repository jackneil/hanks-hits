import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fingerDown, fingerMove, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";

import { WorldMap } from "../components/ui/WorldMap";
import { useAdventureSession } from "../lib/adventureSession";

/**
 * A tap on the full county map drops a pin where the finger lifted. The
 * point must come from the finger's moves, not from the pointerup: an
 * iPhone SE (iOS 27 Safari, 2026-10-01) sent a pointerup at (0, 0), which
 * put the pin in the map's top-left corner.
 */

/** The map on screen: 400 x 400 px at (0, 0). The whole county is 4200 m wide, centred on (0, 0). */
const MAP = { x: 0, y: 0, width: 400, height: 400 };
/** Metres per pixel at zoom 1. */
const SCALE = 4200 / MAP.width;

function map() {
  return screen.getByRole("group", { name: /Interactive county map/ });
}

function setGps() {
  fireEvent.click(screen.getByRole("button", { name: "Set GPS" }));
}

beforeEach(() => {
  useAdventureSession.getState().setWaypoint(null);
  // jsdom has no pointer capture.
  Object.defineProperty(Element.prototype, "setPointerCapture", { configurable: true, writable: true, value: vi.fn() });
});

afterEach(() => {
  liftAllFingers();
  // @ts-expect-error - remove the stub again
  delete Element.prototype.setPointerCapture;
});

describe("WorldMap tap to pin", () => {
  it("drops the pin where the finger lifted when the pointerup says (0, 0)", () => {
    render(<WorldMap />);
    vi.spyOn(map(), "getBoundingClientRect").mockReturnValue(DOMRect.fromRect(MAP));
    fingerDown(map(), { id: 1, x: 300, y: 100 });
    fingerUp(map(), { id: 1 }, { pointerUpAt: { x: 0, y: 0 } });
    setGps();
    const waypoint = useAdventureSession.getState().waypoint;
    expect(waypoint).toMatchObject({ id: "custom-waypoint", label: "Map pin" });
    // (300, 100) px is 100 px right of and 100 px above the centre.
    expect(waypoint?.x).toBeCloseTo(100 * SCALE);
    expect(waypoint?.z).toBeCloseTo(-100 * SCALE);
  });

  it("drops the pin at the last move of a small wobble, not at the pointerup point", () => {
    render(<WorldMap />);
    vi.spyOn(map(), "getBoundingClientRect").mockReturnValue(DOMRect.fromRect(MAP));
    fingerDown(map(), { id: 1, x: 300, y: 100 });
    // Under the 5 px drag threshold: still a tap.
    fingerMove(map(), { id: 1, x: 303, y: 102 });
    fingerUp(map(), { id: 1 }, { pointerUpAt: { x: 0, y: 0 } });
    setGps();
    const waypoint = useAdventureSession.getState().waypoint;
    expect(waypoint?.x).toBeCloseTo(103 * SCALE);
    expect(waypoint?.z).toBeCloseTo(-98 * SCALE);
  });
});
