import { describe, expect, it } from "vitest";

import { createPressOwnership } from "../pressOwnership";

describe("createPressOwnership", () => {
  it("owns only the presses that went down on the control, until they end", () => {
    const owned = createPressOwnership();
    expect(owned.owns(1)).toBe(false);
    expect(owned.end(1)).toBe(false);
    owned.down(1);
    owned.down(2);
    expect(owned.owns(1)).toBe(true);
    expect(owned.end(1)).toBe(true);
    expect(owned.owns(1)).toBe(false);
    // Each release counts once.
    expect(owned.end(1)).toBe(false);
    expect(owned.owns(2)).toBe(true);
  });

  it("drops a press that leaves the control, and the mouse press with a mouse pointer", () => {
    const owned = createPressOwnership();
    owned.down(1);
    owned.mouseDown();
    owned.leave(1, "mouse");
    expect(owned.end(1)).toBe(false);
    expect(owned.mouseUp()).toBe(false);

    owned.down(5);
    owned.mouseDown();
    // A finger that leaves does not end the mouse press.
    owned.leave(5, "touch");
    expect(owned.owns(5)).toBe(false);
    expect(owned.mouseUp()).toBe(true);
  });

  it("claims a mouse release once, and only after a mouse press on the control", () => {
    const owned = createPressOwnership();
    expect(owned.mouseUp()).toBe(false);
    owned.mouseDown();
    expect(owned.mouseUp()).toBe(true);
    expect(owned.mouseUp()).toBe(false);
  });
});
