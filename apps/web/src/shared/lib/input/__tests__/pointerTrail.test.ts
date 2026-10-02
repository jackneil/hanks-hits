import { describe, expect, it } from "vitest";

import { createPointerTrail } from "../pointerTrail";

const at = (pointerId: number, clientX: number, clientY: number) => ({ pointerId, clientX, clientY });

describe("createPointerTrail", () => {
  it("gives the pointerdown point for a tap whose pointerup says (0, 0) (iPhone Safari)", () => {
    const trail = createPointerTrail();
    trail.down(at(1, 585, 22));
    expect(trail.release(at(1, 0, 0))).toEqual({ x: 585, y: 22 });
  });

  it("gives the last move, not the pointerup point", () => {
    const trail = createPointerTrail();
    trail.down(at(1, 100, 100));
    trail.move(at(1, 140, 120));
    trail.move(at(1, 300, 400));
    expect(trail.release(at(1, 0, 0))).toEqual({ x: 300, y: 400 });
  });

  it("keeps one trail for each pointer", () => {
    const trail = createPointerTrail();
    trail.down(at(1, 10, 10));
    trail.down(at(2, 500, 50));
    trail.move(at(2, 520, 60));
    trail.move(at(1, 15, 12));
    expect(trail.release(at(2, 0, 0))).toEqual({ x: 520, y: 60 });
    expect(trail.release(at(1, 0, 0))).toEqual({ x: 15, y: 12 });
  });

  it("ignores the moves of a pointer that is not down (a mouse that only hovers)", () => {
    const trail = createPointerTrail();
    trail.move(at(7, 999, 999));
    trail.down(at(7, 40, 40));
    expect(trail.release(at(7, 0, 0))).toEqual({ x: 40, y: 40 });
  });

  it("stops the trail on release: a later move does not start a new one", () => {
    const trail = createPointerTrail();
    trail.down(at(1, 40, 40));
    trail.release(at(1, 0, 0));
    trail.move(at(1, 300, 300));
    // Never seen down now: the best known point is the event's own point.
    expect(trail.release(at(1, 12, 34))).toEqual({ x: 12, y: 34 });
  });

  it("gives the event's own point for a pointer that never went down here", () => {
    const trail = createPointerTrail();
    expect(trail.release(at(3, 77, 88))).toEqual({ x: 77, y: 88 });
  });

  it("forgets a pointer that ends with no release (pointercancel, lost capture)", () => {
    const trail = createPointerTrail();
    trail.down(at(1, 40, 40));
    trail.move(at(1, 60, 60));
    trail.forget(1);
    trail.move(at(1, 300, 300));
    expect(trail.release(at(1, 5, 6))).toEqual({ x: 5, y: 6 });
  });

  it("gives a copy: a later move of a new press does not change an old result", () => {
    const trail = createPointerTrail();
    trail.down(at(1, 40, 40));
    const first = trail.release(at(1, 0, 0));
    trail.down(at(1, 200, 200));
    trail.move(at(1, 210, 210));
    expect(first).toEqual({ x: 40, y: 40 });
  });
});
