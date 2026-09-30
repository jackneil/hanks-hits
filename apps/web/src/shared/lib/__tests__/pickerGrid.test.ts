import { describe, expect, it } from "vitest";

import { PICKER_GRID, pickerCellClass } from "../pickerGrid";

// The start-card picker with short choices (an age) puts three choices to
// a row, so every choice is on screen with the heading on a phone upright
// (phone UX audit 2026-09-29, S12). The last row fills the width.

describe("pickerGrid", () => {
  it("is a six-column grid with three choices to a row", () => {
    expect(PICKER_GRID.split(" ")).toEqual(expect.arrayContaining(["grid", "grid-cols-6"]));
    expect(pickerCellClass(0, 6)).toBe("col-span-2");
    expect(pickerCellClass(5, 6)).toBe("col-span-2");
  });

  it("one choice left on the last row takes the whole row (Math Attack: seven ages)", () => {
    const cells = Array.from({ length: 7 }, (_, i) => pickerCellClass(i, 7));
    expect(cells).toEqual(["col-span-2", "col-span-2", "col-span-2", "col-span-2", "col-span-2", "col-span-2", "col-span-6"]);
  });

  it("two choices left on the last row take half each (Wordle: five ages)", () => {
    const cells = Array.from({ length: 5 }, (_, i) => pickerCellClass(i, 5));
    expect(cells).toEqual(["col-span-2", "col-span-2", "col-span-2", "col-span-3", "col-span-3"]);
  });

  it("every row adds up to six columns", () => {
    for (let count = 1; count <= 9; count++) {
      const spans = Array.from({ length: count }, (_, i) => Number(pickerCellClass(i, count).replace("col-span-", "")));
      let row = 0;
      for (const span of spans) {
        row += span;
        expect(row, `count ${count}`).toBeLessThanOrEqual(6);
        if (row === 6) row = 0;
      }
      expect(row, `count ${count}: the last row is full`).toBe(0);
    }
  });
});
