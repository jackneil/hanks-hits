import { describe, expect, it } from "vitest";
import { getPlayableHref } from "../app-routing";

describe("getPlayableHref", () => {
  it("routes games under /games", () => {
    expect(getPlayableHref("arkanoid")).toBe("/games/arkanoid");
  });

  it("routes apps under /apps", () => {
    expect(getPlayableHref("trivia")).toBe("/apps/trivia");
  });
});
