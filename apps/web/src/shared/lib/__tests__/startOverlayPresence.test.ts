import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useStartOverlayPresence } from "../startOverlayPresence";

describe("startOverlayPresence", () => {
  beforeEach(() => {
    useStartOverlayPresence.setState({ count: 0, enteredOn: null, leftOn: null });
  });

  afterEach(() => {
    window.history.pushState({}, "", "/");
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

  it("remembers the route where a start card left", () => {
    // An app whose start card has left counts as play (gameBreaks.ts): the
    // kid pressed Start on /apps/trivia and the quiz runs.
    window.history.pushState({}, "", "/apps/trivia");
    const { enter, leave } = useStartOverlayPresence.getState();
    expect(useStartOverlayPresence.getState().leftOn).toBeNull();
    enter();
    expect(useStartOverlayPresence.getState().enteredOn).toBe("/apps/trivia");
    leave();
    expect(useStartOverlayPresence.getState().leftOn).toBe("/apps/trivia");
  });

  it("names the route the card entered on, not the route the URL shows when it leaves", () => {
    // A card leaves in the commit of a route change, when the URL is
    // already the next page. Naming the next page would make that page
    // count as "in the app" before its own start card ever showed.
    window.history.pushState({}, "", "/apps/trivia");
    const { enter, leave } = useStartOverlayPresence.getState();
    enter();
    window.history.pushState({}, "", "/apps/weather");
    leave();
    expect(useStartOverlayPresence.getState().leftOn).toBe("/apps/trivia");
  });
});
