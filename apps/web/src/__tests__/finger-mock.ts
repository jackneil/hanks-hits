import { act, fireEvent } from "@testing-library/react";

/**
 * Shared finger double: everything a phone browser sends for one finger,
 * in the browser's order (Pointer Events section 11, Touch Events section
 * 9). Keep this the single copy: every touch-input test uses it.
 *
 * - fingerDown: pointerdown, then a NATIVE touchstart with changedTouches
 *   and touches (touches lists EVERY finger down anywhere, like a browser).
 * - fingerMove: pointermove, then touchmove.
 * - fingerUp: pointerup, then touchend, then the compatibility mousedown,
 *   mouseup and click, but ONLY when neither touchstart nor touchend was
 *   default-prevented. That is the browser rule that made the old
 *   onTouchStart + onClick pairs run an action twice, and that the shared
 *   native touch hook uses to stop the click.
 * - fingerCancel: pointercancel, then touchcancel.
 *
 * jsdom has TouchEvent but no Touch constructor, so the touch events are
 * plain Events with the touch lists defined by hand. Games read only
 * identifier, clientX, clientY and target from each touch.
 */

export type Finger = { id?: number; x?: number; y?: number };

type ActiveFinger = { id: number; x: number; y: number; target: EventTarget; prevented: boolean };

const active = new Map<number, ActiveFinger>();

function touchOf(finger: ActiveFinger) {
  return { identifier: finger.id, clientX: finger.x, clientY: finger.y, target: finger.target };
}

function touchEvent(
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  changed: ActiveFinger[]
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const all = Array.from(active.values()).map(touchOf);
  Object.defineProperty(event, "changedTouches", { value: changed.map(touchOf) });
  Object.defineProperty(event, "touches", { value: all });
  Object.defineProperty(event, "targetTouches", {
    value: all.filter((t) => t.target === changed[0]?.target),
  });
  return event;
}

function pointerInit(finger: ActiveFinger) {
  return {
    pointerId: finger.id,
    pointerType: "touch",
    button: 0,
    buttons: 1,
    isPrimary: finger.id === Array.from(active.keys())[0],
    clientX: finger.x,
    clientY: finger.y,
  };
}

/** A finger lands on the element. */
export function fingerDown(element: Element, { id = 1, x = 0, y = 0 }: Finger = {}): void {
  const finger: ActiveFinger = { id, x, y, target: element, prevented: false };
  active.set(id, finger);
  act(() => {
    fireEvent.pointerDown(element, pointerInit(finger));
    const start = touchEvent("touchstart", [finger]);
    element.dispatchEvent(start);
    if (start.defaultPrevented) finger.prevented = true;
  });
}

/** A finger that is down moves. */
export function fingerMove(element: Element, { id = 1, x = 0, y = 0 }: Finger = {}): void {
  const finger = active.get(id);
  if (!finger) throw new Error(`finger ${id} is not down`);
  finger.x = x;
  finger.y = y;
  act(() => {
    fireEvent.pointerMove(element, pointerInit(finger));
    element.dispatchEvent(touchEvent("touchmove", [finger]));
  });
}

/** A finger lifts. The compatibility mouse events and click follow unless a touch event was prevented. */
export function fingerUp(element: Element, { id = 1, x, y }: Finger = {}): void {
  const finger = active.get(id);
  if (!finger) throw new Error(`finger ${id} is not down`);
  if (x !== undefined) finger.x = x;
  if (y !== undefined) finger.y = y;
  active.delete(id);
  act(() => {
    fireEvent.pointerUp(element, pointerInit(finger));
    const end = touchEvent("touchend", [finger]);
    element.dispatchEvent(end);
    const prevented = finger.prevented || end.defaultPrevented;
    if (!prevented) {
      fireEvent.mouseDown(element, { button: 0, clientX: finger.x, clientY: finger.y });
      fireEvent.mouseUp(element, { button: 0, clientX: finger.x, clientY: finger.y });
      fireEvent.click(element, { detail: 1, clientX: finger.x, clientY: finger.y });
    }
  });
}

/** The system took the finger (an edge swipe, the notification pull). */
export function fingerCancel(element: Element, { id = 1 }: Finger = {}): void {
  const finger = active.get(id);
  if (!finger) throw new Error(`finger ${id} is not down`);
  active.delete(id);
  act(() => {
    fireEvent.pointerCancel(element, pointerInit(finger));
    element.dispatchEvent(touchEvent("touchcancel", [finger]));
  });
}

/** One whole tap: down, then up where it landed. */
export function fingerTap(element: Element, finger: Finger = {}): void {
  fingerDown(element, finger);
  fingerUp(element, finger);
}

/** Forget every finger (test teardown). */
export function liftAllFingers(): void {
  active.clear();
}
