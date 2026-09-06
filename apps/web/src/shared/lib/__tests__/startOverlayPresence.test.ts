import { beforeEach, describe, expect, it } from "vitest";

import { useStartOverlayPresence } from "../startOverlayPresence";

describe("startOverlayPresence", () => {
  beforeEach(() => {
    useStartOverlayPresence.setState({ count: 0 });
  });

  it("counts mounted start cards and never goes below zero", () => {
    const { enter, leave } = useStartOverlayPresence.getState();
    enter();
    enter();
    expect(useStartOverlayPresence.getState().count).toBe(2);
    leave();
    leave();
    leave();
    expect(useStartOverlayPresence.getState().count).toBe(0);
  });
});
