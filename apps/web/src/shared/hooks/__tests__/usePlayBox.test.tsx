import { act, render, renderHook, screen } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PLAY_BOX_ATTR,
  PLAY_BOX_FITTED_ATTR,
  PlayBoxContext,
  fitCanvas,
  measurePlayBox,
  usePlayBox,
} from "../usePlayBox";

/**
 * jsdom has no layout: clientWidth and clientHeight are 0 and
 * getBoundingClientRect is all zeros. These helpers give an element a
 * size, the way a browser would report it.
 */
function sizeElement(el: HTMLElement, width: number, height: number, top = 48) {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: height });
  el.getBoundingClientRect = () =>
    ({ top, left: 0, right: width, bottom: top + height, width, height, x: 0, y: top, toJSON() {} }) as DOMRect;
}

function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
}

/** A ResizeObserver double that remembers its callback, so a test can fire it. */
class FakeResizeObserver {
  static callbacks: Array<() => void> = [];
  static observed: Element[] = [];
  constructor(callback: () => void) {
    FakeResizeObserver.callbacks.push(callback);
  }
  observe(el: Element) {
    FakeResizeObserver.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
}

function fireResizeObservers() {
  act(() => {
    for (const callback of FakeResizeObserver.callbacks) callback();
  });
}

/**
 * A play box on the page with a size, as GameShell renders it (the box is
 * in the DOM and has its size before the game's first layout effect).
 */
function mountPlayBox(width: number, height: number, top = 48): HTMLElement {
  const box = document.createElement("div");
  box.setAttribute(PLAY_BOX_ATTR, "");
  sizeElement(box, width, height, top);
  document.body.appendChild(box);
  return box;
}

const RealResizeObserver = globalThis.ResizeObserver;
const DEFAULT_WIDTH = window.innerWidth;
const DEFAULT_HEIGHT = window.innerHeight;
let boxes: HTMLElement[] = [];

beforeEach(() => {
  FakeResizeObserver.callbacks = [];
  FakeResizeObserver.observed = [];
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = RealResizeObserver;
  setWindowSize(DEFAULT_WIDTH, DEFAULT_HEIGHT);
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
  for (const box of boxes) box.remove();
  boxes = [];
});

function Reader({ fit = false }: { fit?: boolean }) {
  const size = usePlayBox({ fit });
  return (
    <div data-testid="size">
      {size.width}x{size.height}/{size.visibleHeight}
    </div>
  );
}

describe("usePlayBox", () => {
  it("measures the play box from GameShell's context before the first paint", () => {
    const box = mountPlayBox(375, 501);
    boxes.push(box);
    const ref = createRef<HTMLElement>() as RefObject<HTMLElement | null>;
    ref.current = box;
    render(
      <PlayBoxContext.Provider value={ref}>
        <Reader />
      </PlayBoxContext.Provider>
    );
    expect(screen.getByTestId("size")).toHaveTextContent("375x501/501");
    expect(FakeResizeObserver.observed).toEqual([box]);
  });

  it("finds the play box on the page when a game has no context (the first pass, a test, an own mount)", () => {
    const box = mountPlayBox(667, 271, 40);
    boxes.push(box);
    const { result } = renderHook(() => usePlayBox());
    expect(result.current).toEqual({ width: 667, height: 271, visibleHeight: 271 });
    expect(FakeResizeObserver.observed).toEqual([box]);
  });

  it("reports the window when there is no play box at all", () => {
    setWindowSize(390, 664);
    const { result } = renderHook(() => usePlayBox());
    expect(result.current).toEqual({ width: 390, height: 664, visibleHeight: 664 });
  });

  it("follows the box when it changes size (the phone turns, the toolbars hide)", () => {
    const box = mountPlayBox(375, 501);
    boxes.push(box);
    render(<Reader />);
    expect(screen.getByTestId("size")).toHaveTextContent("375x501/501");

    sizeElement(box, 667, 271, 40);
    fireResizeObservers();
    expect(screen.getByTestId("size")).toHaveTextContent("667x271/271");
  });

  it("follows a window resize with no ResizeObserver in the browser", () => {
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
    setWindowSize(375, 549);
    const { result } = renderHook(() => usePlayBox());
    expect(result.current.width).toBe(375);
    act(() => {
      setWindowSize(667, 311);
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ width: 667, height: 311, visibleHeight: 311 });
  });

  it("reports the height under the on-screen keyboard as visibleHeight (visualViewport)", () => {
    const listeners: Record<string, () => void> = {};
    const viewport = {
      height: 549,
      offsetTop: 0,
      addEventListener: (name: string, fn: () => void) => {
        listeners[name] = fn;
      },
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    const box = mountPlayBox(375, 501);
    boxes.push(box);
    render(<Reader />);
    expect(screen.getByTestId("size")).toHaveTextContent("375x501/501");

    // The keyboard opens: the visual viewport is 260 px tall and the box
    // starts at 48 px, so 212 px of the box can be seen.
    viewport.height = 260;
    act(() => listeners.resize());
    expect(screen.getByTestId("size")).toHaveTextContent("375x501/212");
    expect(measurePlayBox(box)).toEqual({ width: 375, height: 501, visibleHeight: 212 });
  });

  it("keeps the same size object when nothing changed, so a game's effects on it do not run again", () => {
    const box = mountPlayBox(375, 501);
    boxes.push(box);
    const sizes: unknown[] = [];
    function Watch() {
      sizes.push(usePlayBox());
      return null;
    }
    render(<Watch />);
    const settled = sizes[sizes.length - 1];
    fireResizeObservers();
    expect(sizes[sizes.length - 1]).toBe(settled);
    sizeElement(box, 667, 271, 40);
    fireResizeObservers();
    expect(sizes[sizes.length - 1]).not.toBe(settled);
    expect(sizes[sizes.length - 1]).toEqual({ width: 667, height: 271, visibleHeight: 271 });
  });

  describe("fit", () => {
    it("marks the box fitted while a game asks for it, and clears the mark when the game leaves", () => {
      const box = mountPlayBox(375, 501);
      boxes.push(box);
      const { rerender, unmount } = render(<Reader fit />);
      expect(box).toHaveAttribute(PLAY_BOX_FITTED_ATTR);

      rerender(<Reader fit={false} />);
      expect(box).not.toHaveAttribute(PLAY_BOX_FITTED_ATTR);

      rerender(<Reader fit />);
      expect(box).toHaveAttribute(PLAY_BOX_FITTED_ATTR);
      unmount();
      expect(box).not.toHaveAttribute(PLAY_BOX_FITTED_ATTR);
    });

    it("keeps the mark while any of two components still asks for it", () => {
      const box = mountPlayBox(375, 501);
      boxes.push(box);
      const { rerender } = render(
        <>
          <Reader fit />
          <Reader fit />
        </>
      );
      rerender(
        <>
          <Reader fit />
          <Reader fit={false} />
        </>
      );
      expect(box).toHaveAttribute(PLAY_BOX_FITTED_ATTR);
      rerender(
        <>
          <Reader fit={false} />
          <Reader fit={false} />
        </>
      );
      expect(box).not.toHaveAttribute(PLAY_BOX_FITTED_ATTR);
    });

    it("scrolls a fitted box back to its top", () => {
      const box = mountPlayBox(375, 501);
      boxes.push(box);
      box.scrollTop = 120;
      render(<Reader fit />);
      expect(box.scrollTop).toBe(0);
    });
  });
});

describe("fitCanvas", () => {
  it("fits on both axes with one scale: the smaller ratio wins", () => {
    // 800x600 into a 375x501 box (a phone upright): the width limits.
    expect(fitCanvas({ width: 375, height: 501 }, 800, 600)).toEqual({
      scale: 375 / 800,
      width: 375,
      height: 281,
    });
    // The same canvas into 667x271 (a phone sideways): the height limits.
    // Width-only scaling drew it 500 px tall on a 271 px screen.
    expect(fitCanvas({ width: 667, height: 271 }, 800, 600)).toEqual({
      scale: 271 / 600,
      width: 361,
      height: 271,
    });
  });

  it("keeps room for controls: a number keeps height, an object keeps width and height", () => {
    // 120 px kept under a square board on a phone upright: 381 px of
    // height stay, but the 375 px width limits first.
    expect(fitCanvas({ width: 375, height: 501 }, 400, 400, 120)).toEqual({
      scale: 375 / 400,
      width: 375,
      height: 375,
    });
    // Sideways with two 88 px gutters for buttons: the height still limits.
    expect(fitCanvas({ width: 667, height: 271 }, 800, 600, { width: 2 * 88, height: 0 })).toEqual({
      scale: 271 / 600,
      width: 361,
      height: 271,
    });
    // Wide gutters: now the width limits.
    expect(fitCanvas({ width: 667, height: 271 }, 800, 600, { width: 2 * 200 })).toEqual({
      scale: 267 / 800,
      width: 267,
      height: 200,
    });
  });

  it("never returns a size larger than the box, and never an empty one for a box with room", () => {
    const box = { width: 320, height: 200 };
    for (const [w, h] of [
      [1, 1],
      [1000, 3],
      [3, 1000],
      [320, 200],
      [321, 201],
      [999, 1],
    ]) {
      const fit = fitCanvas(box, w, h);
      expect(fit.width, `${w}x${h}`).toBeLessThanOrEqual(box.width);
      expect(fit.height, `${w}x${h}`).toBeLessThanOrEqual(box.height);
      expect(fit.width, `${w}x${h}`).toBeGreaterThan(0);
      expect(fit.height, `${w}x${h}`).toBeGreaterThan(0);
    }
  });

  it("returns zero before the first measure and when nothing can fit", () => {
    const nothing = { scale: 0, width: 0, height: 0 };
    expect(fitCanvas({ width: 0, height: 0 }, 800, 600)).toEqual(nothing);
    expect(fitCanvas({ width: 375, height: 100 }, 800, 600, 100)).toEqual(nothing);
    expect(fitCanvas({ width: 375, height: 501 }, 0, 600)).toEqual(nothing);
    expect(fitCanvas({ width: 375, height: 501 }, 800, Number.NaN)).toEqual(nothing);
  });
});
