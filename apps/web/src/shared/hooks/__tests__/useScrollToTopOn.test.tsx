import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PLAY_BOX_ATTR } from "../usePlayBox";
import { useScrollToTopOn } from "../useScrollToTopOn";

/**
 * A route that swaps screens by state keeps its scroll position: the
 * Retro Arcade catalog opened 355 px down, Oregon Trail came back from
 * the store with the scene off screen (phone UX audit 2026-09-29, S13).
 */

let box: HTMLElement | null = null;

afterEach(() => {
  box?.remove();
  box = null;
  document.documentElement.scrollTop = 0;
});

function Screen({ screen }: { screen: string }) {
  useScrollToTopOn(screen);
  return <div>{screen}</div>;
}

describe("useScrollToTopOn", () => {
  it("scrolls the play box and the page to the top when the key changes, not on other renders", () => {
    box = document.createElement("div");
    box.setAttribute(PLAY_BOX_ATTR, "");
    document.body.appendChild(box);
    box.scrollTop = 355;
    document.documentElement.scrollTop = 120;

    const { rerender } = render(<Screen screen="catalog" />);
    expect(box.scrollTop).toBe(0);
    expect(document.documentElement.scrollTop).toBe(0);

    box.scrollTop = 200;
    rerender(<Screen screen="catalog" />);
    expect(box.scrollTop).toBe(200);

    rerender(<Screen screen="uploader" />);
    expect(box.scrollTop).toBe(0);
  });

  it("works with no play box on the page", () => {
    document.documentElement.scrollTop = 90;
    render(<Screen screen="store" />);
    expect(document.documentElement.scrollTop).toBe(0);
  });
});
