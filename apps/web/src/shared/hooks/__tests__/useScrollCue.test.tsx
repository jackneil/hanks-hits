import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scrollCueEdges, useScrollCue } from "../useScrollCue";

// Regression (verify finding R8): the start card body drew its "more
// below" shadow with pure CSS, and on a 375x667 iPhone the shadow showed as
// a gray line under the hints on every card, including cards whose body
// did not scroll at all. The cue is now measured: an edge gets its shadow
// only while there is more content past it.

/** jsdom has no layout: each test sets the box's sizes by hand. */
const size = { scrollHeight: 300, clientHeight: 300 };
const resizeCallbacks: ResizeObserverCallback[] = [];
const realResizeObserver = global.ResizeObserver;

function Box({ active = true }: { active?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useScrollCue(boxRef, contentRef, active);
  return (
    <div ref={boxRef} data-testid="box" className="scroll-cue">
      <div ref={contentRef}>words</div>
    </div>
  );
}

function edges(box: HTMLElement) {
  return {
    above: box.hasAttribute("data-more-above"),
    below: box.hasAttribute("data-more-below"),
  };
}

/** Like a browser: the box or its content changed size. */
function resize() {
  act(() => {
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
  });
}

describe("useScrollCue", () => {
  beforeEach(() => {
    size.scrollHeight = 300;
    size.clientHeight = 300;
    resizeCallbacks.length = 0;
    // A fake that calls back only when the test says so.
    global.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === "box" ? size.scrollHeight : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === "box" ? size.clientHeight : 0;
      },
    });
  });

  afterEach(() => {
    global.ResizeObserver = realResizeObserver;
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it("draws no cue on a box whose content fits", () => {
    render(<Box />);
    expect(edges(screen.getByTestId("box"))).toEqual({ above: false, below: false });
  });

  it("draws no cue when the content is less than 1 px taller (rounding)", () => {
    size.scrollHeight = 301;
    render(<Box />);
    expect(edges(screen.getByTestId("box"))).toEqual({ above: false, below: false });
  });

  it("shows more below at the top, both in the middle, and more above at the end", () => {
    size.scrollHeight = 500;
    render(<Box />);
    const box = screen.getByTestId("box");
    expect(edges(box)).toEqual({ above: false, below: true });

    box.scrollTop = 100;
    fireEvent.scroll(box);
    expect(edges(box)).toEqual({ above: true, below: true });

    // The end of the scroll, give or take the rounding of a scaled screen.
    box.scrollTop = 199.5;
    fireEvent.scroll(box);
    expect(edges(box)).toEqual({ above: true, below: false });
  });

  it("follows a size change: content that grows gets the cue, and loses it when it fits again", () => {
    render(<Box />);
    const box = screen.getByTestId("box");
    expect(edges(box).below).toBe(false);

    size.scrollHeight = 420;
    resize();
    expect(edges(box).below).toBe(true);

    size.clientHeight = 420;
    resize();
    expect(edges(box)).toEqual({ above: false, below: false });
  });

  it("does nothing while the box is not active", () => {
    size.scrollHeight = 500;
    render(<Box active={false} />);
    expect(edges(screen.getByTestId("box"))).toEqual({ above: false, below: false });
  });

  it("scrollCueEdges reads the box", () => {
    const box = document.createElement("div");
    box.dataset.testid = "box";
    size.scrollHeight = 600;
    box.scrollTop = 0;
    expect(scrollCueEdges(box)).toEqual({ above: false, below: true });
  });
});
