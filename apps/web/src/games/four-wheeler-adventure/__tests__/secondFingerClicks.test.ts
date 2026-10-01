import { readFileSync } from "fs";
import { join } from "path";
import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The static game's second-finger click script (public/games/
 * four-wheeler-adventure/index.html, secondFingerClicks): a touch that
 * lifts on the button it went down on clicks it, when the browser sends no
 * click (a second finger while one thumb holds GAS).
 *
 * "Lifts on the button" must use the finger's last pointermove, not the
 * pointerup's own point: an iPhone SE (iOS 27 Safari, 2026-10-01) sent a
 * pointerup at (0, 0). These tests run the real script from the file.
 */

const html = readFileSync(
  join(__dirname, "../../../../public/games/four-wheeler-adventure/index.html"),
  "utf8"
);

/** The script's source: from its opening line to the end of the IIFE. */
function scriptSource(): string {
  const start = html.indexOf("(function secondFingerClicks() {");
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf("\n})();", start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end + "\n})();".length);
}

/** The listeners the script added to the window, for removal after each test. */
let added: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]> = [];

function runScript() {
  const addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) => {
    window.addEventListener(type, listener, options);
    added.push([type, listener, options]);
  };
  new Function("addEventListener", scriptSource())(addEventListener);
}

/** A game button at (left, top), 60 x 44 px. jsdom has no layout. */
function gameButton(left: number, top: number) {
  const button = document.createElement("button");
  button.textContent = "Map";
  document.body.appendChild(button);
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: left, y: top, width: 60, height: 44 }));
  const clicks = vi.fn();
  button.addEventListener("click", clicks);
  return { button, clicks };
}

const touch = (pointerId: number, clientX: number, clientY: number) => ({
  pointerId,
  pointerType: "touch",
  button: 0,
  clientX,
  clientY,
});

beforeEach(() => {
  vi.useFakeTimers();
  added = [];
  runScript();
});

afterEach(() => {
  for (const [type, listener, options] of added) window.removeEventListener(type, listener, options);
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("four-wheeler-adventure second-finger clicks, with a pointerup at (0, 0)", () => {
  it("clicks a button that a second finger tapped", () => {
    const { button, clicks } = gameButton(100, 100);
    act(() => {
      fireEvent.pointerDown(button, touch(2, 120, 120));
      fireEvent.pointerUp(button, touch(2, 0, 0));
    });
    act(() => vi.advanceTimersByTime(250));
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("does not click a button in the top-left corner that the finger slid off", () => {
    const { button, clicks } = gameButton(0, 0);
    act(() => {
      fireEvent.pointerDown(button, touch(3, 20, 20));
      // A touch is captured to its button: the moves go there.
      fireEvent.pointerMove(button, touch(3, 150, 160));
      fireEvent.pointerMove(button, touch(3, 300, 300));
      fireEvent.pointerUp(button, touch(3, 0, 0));
    });
    act(() => vi.advanceTimersByTime(500));
    expect(clicks).not.toHaveBeenCalled();
  });
});
