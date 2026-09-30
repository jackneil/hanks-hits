import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTouchInput,
  touchTargetMatches,
  usePointerHold,
  usePointerHolds,
  useTouchInput,
  type PointerHoldOptions,
  type TouchInputHandlers,
  type TouchInputOptions,
  type TouchPoint,
} from "../useTouchInput";

// Regression for the 2026 phone audit (root cause S4): React registers
// touch listeners passive, so preventDefault() in a React onTouchStart did
// nothing and every tap also fired the compatibility click. Games with
// onTouchStart + onClick on one element ran the action twice, and games that
// read e.touches[0] acted on the oldest finger.

type FakeTouch = { id: number; x?: number; y?: number; target?: EventTarget };

/**
 * jsdom has TouchEvent but no Touch constructor, so a touch event is built
 * by hand. The hook reads only identifier, clientX, clientY and target from
 * each changed touch, and cancelable + preventDefault from the event.
 */
function touchEvent(
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  element: EventTarget,
  touches: FakeTouch[],
  cancelable = true
): Event {
  const event = new Event(type, { bubbles: true, cancelable });
  Object.defineProperty(event, "changedTouches", {
    value: touches.map((t) => ({
      identifier: t.id,
      clientX: t.x ?? 0,
      clientY: t.y ?? 0,
      target: t.target ?? element,
    })),
  });
  return event;
}

function send(
  element: EventTarget,
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  touches: FakeTouch[],
  cancelable = true
): Event {
  const event = touchEvent(type, element, touches, cancelable);
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

type SurfaceProps = {
  handlers: TouchInputHandlers<string>;
  options?: TouchInputOptions;
  children?: React.ReactNode;
};

function Surface({ handlers, options, children }: SurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  useTouchInput(ref, handlers, options);
  return (
    <div ref={ref} data-testid="surface">
      {children}
    </div>
  );
}

function ids(calls: unknown[][]): number[] {
  return calls.map((call) => (call[0] as TouchPoint).id);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTouchInput: native listeners", () => {
  it("registers touchstart, touchmove, touchend and touchcancel with { passive: false }", () => {
    // React binds its own listeners on the root div, so keep only the calls
    // made on the surface element.
    const spy = vi.spyOn(HTMLDivElement.prototype, "addEventListener");
    render(<Surface handlers={{}} />);
    const surface = screen.getByTestId("surface");
    const touchListeners = spy.mock.calls.filter(
      ([type], index) =>
        String(type).startsWith("touch") && spy.mock.contexts[index] === surface
    );
    expect(touchListeners.map(([type]) => type).sort()).toEqual([
      "touchcancel",
      "touchend",
      "touchmove",
      "touchstart",
    ]);
    for (const [, , options] of touchListeners) {
      expect(options).toEqual({ passive: false });
    }
  });

  it("prevents the default of a tracked touchstart, so the browser sends no click", () => {
    const onStart = vi.fn();
    render(<Surface handlers={{ onStart }} />);
    const surface = screen.getByTestId("surface");
    const start = send(surface, "touchstart", [{ id: 1, x: 10, y: 20 }]);
    expect(start.defaultPrevented).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
    const end = send(surface, "touchend", [{ id: 1, x: 10, y: 20 }]);
    expect(end.defaultPrevented).toBe(true);
  });

  it("leaves the default alone when asked (a surface that must also scroll)", () => {
    render(<Surface handlers={{}} options={{ preventDefault: false }} />);
    const surface = screen.getByTestId("surface");
    const start = send(surface, "touchstart", [{ id: 1 }]);
    expect(start.defaultPrevented).toBe(false);
  });

  it("does not prevent a touch event that is not cancelable (a scroll already started)", () => {
    render(<Surface handlers={{}} />);
    const surface = screen.getByTestId("surface");
    send(surface, "touchstart", [{ id: 1 }]);
    const move = send(surface, "touchmove", [{ id: 1, x: 5, y: 40 }], false);
    expect(move.defaultPrevented).toBe(false);
  });
});

describe("useTouchInput: every changed touch, tracked by identifier", () => {
  it("starts one point per changed touch when two fingers land in one event", () => {
    const onStart = vi.fn();
    render(<Surface handlers={{ onStart }} />);
    const surface = screen.getByTestId("surface");
    send(surface, "touchstart", [
      { id: 7, x: 10, y: 10 },
      { id: 8, x: 300, y: 10 },
    ]);
    expect(ids(onStart.mock.calls)).toEqual([7, 8]);
    const second = onStart.mock.calls[1][0] as TouchPoint;
    expect(second.startX).toBe(300);
    expect(second.x).toBe(300);
    expect(second.startY).toBe(10);
  });

  it("routes a move and an end to the finger that moved or lifted, not to the oldest one", () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const onStart = vi.fn((touch: TouchPoint) => {
      touch.tag = touch.startX < 100 ? "left" : "right";
    });
    render(<Surface handlers={{ onStart, onMove, onEnd }} />);
    const surface = screen.getByTestId("surface");
    send(surface, "touchstart", [{ id: 1, x: 10, y: 50 }]);
    send(surface, "touchstart", [{ id: 2, x: 320, y: 50 }]);

    send(surface, "touchmove", [{ id: 2, x: 330, y: 90 }]);
    expect(ids(onMove.mock.calls)).toEqual([2]);
    const moved = onMove.mock.calls[0][0] as TouchPoint;
    expect(moved.x).toBe(330);
    expect(moved.y).toBe(90);
    expect(moved.startX).toBe(320);
    expect(moved.tag).toBe("right");

    // The first finger (the held button) lifts: only its zone releases.
    send(surface, "touchend", [{ id: 1, x: 10, y: 50 }]);
    expect(ids(onEnd.mock.calls)).toEqual([1]);
    expect((onEnd.mock.calls[0][0] as TouchPoint).tag).toBe("left");

    send(surface, "touchend", [{ id: 2, x: 330, y: 90 }]);
    expect(ids(onEnd.mock.calls)).toEqual([1, 2]);
  });

  it("ignores a move or an end for a finger it never tracked", () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    render(<Surface handlers={{ onMove, onEnd }} />);
    const surface = screen.getByTestId("surface");
    const move = send(surface, "touchmove", [{ id: 99 }]);
    const end = send(surface, "touchend", [{ id: 99 }]);
    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(move.defaultPrevented).toBe(false);
    expect(end.defaultPrevented).toBe(false);
  });

  it("reports the fingers that are down", () => {
    const seen = vi.fn<(api: { active: () => readonly TouchPoint[] }) => void>();
    function Probe({ onReady }: { onReady: typeof seen }) {
      const ref = useRef<HTMLDivElement>(null);
      const api = useTouchInput(ref, {});
      useEffect(() => onReady(api), [api, onReady]);
      return <div ref={ref} data-testid="surface" />;
    }
    render(<Probe onReady={seen} />);
    const api = seen.mock.calls[0][0];
    const surface = screen.getByTestId("surface");
    send(surface, "touchstart", [{ id: 1 }, { id: 2 }]);
    expect(api.active().map((t) => t.id)).toEqual([1, 2]);
    send(surface, "touchend", [{ id: 1 }]);
    expect(api.active().map((t) => t.id)).toEqual([2]);
  });
});

describe("useTouchInput: cancel paths", () => {
  it("sends a browser touchcancel to onCancel", () => {
    const onEnd = vi.fn();
    const onCancel = vi.fn();
    render(<Surface handlers={{ onEnd, onCancel }} />);
    const surface = screen.getByTestId("surface");
    send(surface, "touchstart", [{ id: 1 }]);
    const cancel = send(surface, "touchcancel", [{ id: 1 }]);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel.mock.calls[0][1]).toBe(cancel);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("falls back to onEnd on a cancel when there is no onCancel, so a hold always lets go", () => {
    const onEnd = vi.fn();
    render(<Surface handlers={{ onEnd }} />);
    const surface = screen.getByTestId("surface");
    send(surface, "touchstart", [{ id: 1 }]);
    const cancel = send(surface, "touchcancel", [{ id: 1 }]);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd.mock.calls[0][1]).toBe(cancel);
  });

  it("lets go of every finger with a null event when the surface unmounts", () => {
    const onCancel = vi.fn();
    const { unmount } = render(<Surface handlers={{ onCancel }} />);
    const surface = screen.getByTestId("surface");
    send(surface, "touchstart", [{ id: 1 }, { id: 2 }]);
    unmount();
    expect(ids(onCancel.mock.calls)).toEqual([1, 2]);
    expect(onCancel.mock.calls[0][1]).toBeNull();
  });

  it("lets go when the window loses focus or the page is hidden", () => {
    const onCancel = vi.fn();
    render(<Surface handlers={{ onCancel }} />);
    const surface = screen.getByTestId("surface");
    send(surface, "touchstart", [{ id: 1 }]);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(ids(onCancel.mock.calls)).toEqual([1]);

    send(surface, "touchstart", [{ id: 2 }]);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockRestore();
    expect(ids(onCancel.mock.calls)).toEqual([1, 2]);
  });

  it("keeps the finger on blur when releaseOnBlur is false", () => {
    const onCancel = vi.fn();
    render(<Surface handlers={{ onCancel }} options={{ releaseOnBlur: false }} />);
    const surface = screen.getByTestId("surface");
    send(surface, "touchstart", [{ id: 1 }]);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("lets go and stops listening when disabled", () => {
    const onStart = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<Surface handlers={{ onStart, onCancel }} />);
    const surface = screen.getByTestId("surface");
    send(surface, "touchstart", [{ id: 1 }]);
    rerender(<Surface handlers={{ onStart, onCancel }} options={{ enabled: false }} />);
    expect(ids(onCancel.mock.calls)).toEqual([1]);
    const start = send(surface, "touchstart", [{ id: 2 }]);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(start.defaultPrevented).toBe(false);
  });
});

describe("useTouchInput: ignored targets", () => {
  it("never tracks a finger that lands on an ignored element, and leaves its default alone", () => {
    const onStart = vi.fn();
    render(
      <Surface handlers={{ onStart }} options={{ ignore: "button, [role=dialog]" }}>
        <button type="button">
          <span data-testid="label">Pause</span>
        </button>
      </Surface>
    );
    const surface = screen.getByTestId("surface");
    const label = screen.getByTestId("label");
    const onButton = send(surface, "touchstart", [{ id: 1, target: label }]);
    expect(onStart).not.toHaveBeenCalled();
    expect(onButton.defaultPrevented).toBe(false);

    const onField = send(surface, "touchstart", [{ id: 2, target: surface }]);
    expect(ids(onStart.mock.calls)).toEqual([2]);
    expect(onField.defaultPrevented).toBe(true);
  });

  it("touchTargetMatches resolves a text node through its parent and survives a bad selector", () => {
    const button = document.createElement("button");
    const text = document.createTextNode("Go");
    button.appendChild(text);
    document.body.appendChild(button);
    expect(touchTargetMatches(text, "button")).toBe(true);
    expect(touchTargetMatches(button, "a")).toBe(false);
    expect(touchTargetMatches(button, "((")).toBe(false);
    expect(touchTargetMatches(null, "button")).toBe(false);
    expect(touchTargetMatches(button, undefined)).toBe(false);
    button.remove();
  });
});

describe("useTouchInput: handlers change without re-binding", () => {
  it("binds once and runs the newest handler", () => {
    const spy = vi.spyOn(HTMLDivElement.prototype, "addEventListener");
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Surface handlers={{ onStart: first }} />);
    rerender(<Surface handlers={{ onStart: second }} />);
    const surface = screen.getByTestId("surface");
    send(surface, "touchstart", [{ id: 1 }]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    const starts = spy.mock.calls.filter(
      ([type], index) => type === "touchstart" && spy.mock.contexts[index] === surface
    );
    expect(starts).toHaveLength(1);
  });

  it("createTouchInput works on any EventTarget and detaches cleanly", () => {
    const target = new EventTarget();
    const onStart = vi.fn();
    const onCancel = vi.fn();
    const input = createTouchInput(target, { onStart, onCancel });
    send(target, "touchstart", [{ id: 4, target }]);
    expect(ids(onStart.mock.calls)).toEqual([4]);
    input.detach();
    expect(ids(onCancel.mock.calls)).toEqual([4]);
    send(target, "touchstart", [{ id: 5, target }]);
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------

type HoldProps = {
  onPress: () => void;
  onRelease: () => void;
  options?: PointerHoldOptions;
};

function HoldButton({ onPress, onRelease, options }: HoldProps) {
  const hold = usePointerHold<HTMLButtonElement>(onPress, onRelease, options);
  return (
    <button type="button" {...hold} className="touch-none">
      GAS
    </button>
  );
}

function down(element: Element, pointerId = 1, extra: Record<string, unknown> = {}) {
  fireEvent.pointerDown(element, {
    pointerId,
    pointerType: "touch",
    button: 0,
    isPrimary: pointerId === 1,
    ...extra,
  });
}

function up(element: Element, pointerId = 1) {
  fireEvent.pointerUp(element, { pointerId, pointerType: "touch", button: 0 });
}

describe("usePointerHold: a pedal that stays pressed", () => {
  it("presses on pointerdown, releases on pointerup, and ignores the compatibility click", () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<HoldButton onPress={onPress} onRelease={onRelease} />);
    const button = screen.getByRole("button");
    down(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
    up(button);
    fireEvent.mouseDown(button, { button: 0 });
    fireEvent.mouseUp(button, { button: 0 });
    fireEvent.click(button, { detail: 1 });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("prevents the default of pointerdown (no compatibility mouse events, no focus)", () => {
    render(<HoldButton onPress={() => {}} onRelease={() => {}} />);
    const button = screen.getByRole("button");
    const event = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "touch",
      button: 0,
    });
    act(() => {
      button.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("captures the pointer so a thumb that slides off still releases", () => {
    render(<HoldButton onPress={() => {}} onRelease={() => {}} />);
    const button = screen.getByRole("button") as HTMLButtonElement & {
      setPointerCapture: (id: number) => void;
    };
    const capture = vi.fn();
    button.setPointerCapture = capture;
    down(button, 3);
    expect(capture).toHaveBeenCalledWith(3);
  });

  it("presses once for two fingers and releases only when the last one lifts", () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<HoldButton onPress={onPress} onRelease={onRelease} />);
    const button = screen.getByRole("button");
    down(button, 1);
    down(button, 2);
    expect(onPress).toHaveBeenCalledTimes(1);
    up(button, 1);
    expect(onRelease).not.toHaveBeenCalled();
    up(button, 2);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("releases on pointercancel (the system took the gesture)", () => {
    const onRelease = vi.fn();
    render(<HoldButton onPress={() => {}} onRelease={onRelease} />);
    const button = screen.getByRole("button");
    down(button);
    fireEvent.pointerCancel(button, { pointerId: 1, pointerType: "touch" });
    expect(onRelease).toHaveBeenCalledTimes(1);
    // The pointerup that may follow is not a second release.
    up(button);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("releases on lostpointercapture", () => {
    const onRelease = vi.fn();
    render(<HoldButton onPress={() => {}} onRelease={onRelease} />);
    const button = screen.getByRole("button");
    down(button);
    fireEvent.lostPointerCapture(button, { pointerId: 1, pointerType: "touch" });
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("ignores a right or middle mouse button", () => {
    const onPress = vi.fn();
    render(<HoldButton onPress={onPress} onRelease={() => {}} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button, { pointerId: 9, pointerType: "mouse", button: 2 });
    fireEvent.pointerDown(button, { pointerId: 9, pointerType: "mouse", button: 1 });
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.pointerDown(button, { pointerId: 9, pointerType: "mouse", button: 0 });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("blocks the long-press context menu", () => {
    render(<HoldButton onPress={() => {}} onRelease={() => {}} />);
    const button = screen.getByRole("button");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      button.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("releases when the window loses focus or the page is hidden", () => {
    const onRelease = vi.fn();
    render(<HoldButton onPress={() => {}} onRelease={onRelease} />);
    const button = screen.getByRole("button");
    down(button);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(onRelease).toHaveBeenCalledTimes(1);

    down(button, 2);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockRestore();
    expect(onRelease).toHaveBeenCalledTimes(2);
  });

  it("releases when the button unmounts while held", () => {
    const onRelease = vi.fn();
    const { unmount } = render(<HoldButton onPress={() => {}} onRelease={onRelease} />);
    down(screen.getByRole("button"));
    unmount();
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("ignores every press while disabled", () => {
    const onPress = vi.fn();
    render(<HoldButton onPress={onPress} onRelease={() => {}} options={{ enabled: false }} />);
    down(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("runs the newest onPress and onRelease with the same handler identity", () => {
    const first = vi.fn();
    const second = vi.fn();
    const release = vi.fn();
    const { rerender } = render(<HoldButton onPress={first} onRelease={release} />);
    rerender(<HoldButton onPress={second} onRelease={release} />);
    const button = screen.getByRole("button");
    down(button);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------

const PAD_KEYS = ["gas", "brake"] as const;

function Pad({ onChange }: { onChange: (key: "gas" | "brake", down: boolean) => void }) {
  const pad = usePointerHolds<"gas" | "brake", HTMLButtonElement>(PAD_KEYS, onChange);
  return (
    <>
      <button type="button" {...pad.handlers.gas}>
        GAS
      </button>
      <button type="button" {...pad.handlers.brake}>
        BRAKE
      </button>
      <output data-testid="held">{pad.isHeld("gas") ? "gas" : "none"}</output>
    </>
  );
}

describe("usePointerHolds: a pad of hold buttons", () => {
  it("reports each key's press and release, and the newest onChange runs", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Pad onChange={first} />);
    rerender(<Pad onChange={second} />);
    const gas = screen.getByRole("button", { name: "GAS" });
    const brake = screen.getByRole("button", { name: "BRAKE" });
    down(gas, 1);
    down(brake, 2);
    up(brake, 2);
    up(gas, 1);
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([
      ["gas", true],
      ["brake", true],
      ["brake", false],
      ["gas", false],
    ]);
  });

  it("releases every held key on window blur and on unmount", () => {
    const onChange = vi.fn();
    const { unmount } = render(<Pad onChange={onChange} />);
    down(screen.getByRole("button", { name: "GAS" }), 1);
    down(screen.getByRole("button", { name: "BRAKE" }), 2);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(onChange.mock.calls.filter(([, isDown]) => isDown === false)).toHaveLength(2);

    down(screen.getByRole("button", { name: "GAS" }), 3);
    unmount();
    expect(onChange.mock.calls.filter(([, isDown]) => isDown === false)).toHaveLength(3);
  });
});
