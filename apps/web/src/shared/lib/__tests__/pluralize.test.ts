import { describe, it, expect } from "vitest";
import { plural, pluralize } from "../pluralize";

describe("plural", () => {
  it("returns the singular noun for a count of 1", () => {
    expect(plural(1, "player")).toBe("player");
  });

  it("returns the plural noun for 0 and for counts above 1", () => {
    expect(plural(0, "player")).toBe("players");
    expect(plural(2, "player")).toBe("players");
    expect(plural(1234, "player")).toBe("players");
  });

  it("uses a custom plural form for irregular words", () => {
    expect(plural(1, "child", "children")).toBe("child");
    expect(plural(3, "child", "children")).toBe("children");
  });
});

describe("pluralize", () => {
  it("prefixes the count to the correctly pluralized noun", () => {
    expect(pluralize(1, "player")).toBe("1 player");
    expect(pluralize(0, "player")).toBe("0 players");
    expect(pluralize(5, "Achievement")).toBe("5 Achievements");
  });

  it("honors a custom plural form", () => {
    expect(pluralize(1, "life", "lives")).toBe("1 life");
    expect(pluralize(3, "life", "lives")).toBe("3 lives");
  });
});
