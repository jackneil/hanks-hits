import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMPAT_CLICK_WINDOW_MS,
  usePointerTap,
  type PointerTapOptions,
  type TapEvent,
} from "../usePointerTap";

let clock = 10_000;

beforeEach(() => {
  clock = 10_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Props = {
  onTap: (event: TapEvent<HTMLButtonElement>) => void;
  options?: PointerTapOptions<HTMLButtonElement>;
};

function TapButton({ onTap, options }: Props) {
  const tap = usePointerTap<HTMLButtonElement>(onTap, options);
  return (
    <button type="button" {...tap} className="touch-manipulation">
      Go
    </button>
  );
}

/**
 * Everything a phone browser sends for ONE finger tap: pointer events, touch
 * events, then the compatibility mouse events and the click (W3C Touch
 * Events section 9, Pointer Events section 11).
 */
function fingerTap(element: Element, pointerId = 1) {
  fireEvent.pointerDown(element, { pointerId, pointerType: "touch", button: 0, isPrimary: true });
  fireEvent.touchStart(element);
  fireEvent.pointerUp(element, { pointerId, pointerType: "touch", button: 0, isPrimary: true });
  fireEvent.touchEnd(element);
  fireEvent.mouseDown(element, { button: 0 });
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element, { detail: 1 });
}

function mouseClick(element: Element, button = 0) {
  fireEvent.pointerDown(element, { pointerId: 99, pointerType: "mouse", button });
  fireEvent.mouseDown(element, { button });
  fireEvent.pointerUp(element, { pointerId: 99, pointerType: "mouse", button });
  fireEvent.mouseUp(element, { button });
  if (button === 0) fireEvent.click(element, { detail: 1 });
}

describe("usePointerTap: one action per tap", () => {
  it("runs the action ONCE for a whole finger tap, compatibility click included", () => {
    const onTap = vi.fn();
    render(<TapButton onTap={onTap} />);
    fingerTap(screen.getByRole("button"));
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap.mock.calls[0][0].type).toBe("pointerdown");
  });

  it("runs the action ONCE for a mouse click", () => {
    const onTap = vi.fn();
    render(<TapButton onTap={onTap} />);
    mouseClick(screen.getByRole("button"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("runs once per tap when a kid taps fast", () => {
    const onTap = vi.fn();
    render(<TapButton onTap={onTap} />);
    const button = screen.getByRole("button");
    for (let i = 0; i < 5; i += 1) {
      fingerTap(button);
      clock += 120;
    }
    expect(onTap).toHaveBeenCalledTimes(5);
  });

  it("covers a slow press: the click after a 2 s hold is still ignored", () => {
    const onTap = vi.fn();
    render(<TapButton onTap={onTap} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: "touch", button: 0 });
    clock += 2000;
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", button: 0 });
    fireEvent.click(button, { detail: 1 });
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("counts each finger of a two-thumb tap", () => {
    const onTap = vi.fn();
    render(<TapButton onTap={onTap} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: "touch", button: 0, isPrimary: true });
    fireEvent.pointerDown(button, { pointerId: 2, pointerType: "touch", button: 0, isPrimary: false });
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", button: 0 });
    fireEvent.pointerUp(button, { pointerId: 2, pointerType: "touch", button: 0 });
    fireEvent.click(button, { detail: 1 });
    expect(onTap).toHaveBeenCalledTimes(2);
  });

  it("ignores touch events on their own: nothing listens to touchstart", () => {
    const onTap = vi.fn();
    render(<TapButton onTap={onTap} />);
    fireEvent.touchStart(screen.getByRole("button"));
    fireEvent.touchEnd(screen.getByRole("button"));
    expect(onTap).not.toHaveBeenCalled();
  });

  it("still works from the keyboard: a click with no pointer runs the action", () => {
    const onTap = vi.fn();
    render(<TapButton onTap={onTap} />);
    fireEvent.click(screen.getByRole("button"), { detail: 0 });
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap.mock.calls[0][0].type).toBe("click");
  });

  it("accepts a keyboard click that comes long after a pointer tap", () => {
    const onTap = vi.fn();
    render(<TapButton onTap={onTap} />);
    const button = screen.getByRole("button");
    fingerTap(button);
    clock += COMPAT_CLICK_WINDOW_MS + 1;
    fireEvent.click(button, { detail: 0 });
    expect(onTap).toHaveBeenCalledTimes(2);
  });

  it("ignores the right and middle mouse buttons", () => {
    const onTap = vi.fn();
    render(<TapButton onTap={onTap} />);
    mouseClick(screen.getByRole("button"), 2);
    mouseClick(screen.getByRole("button"), 1);
    expect(onTap).not.toHaveBeenCalled();
  });

  it("can accept every mouse button when asked", () => {
    const onTap = vi.fn();
    render(<TapButton onTap={onTap} options={{ mainButtonOnly: false }} />);
    mouseClick(screen.getByRole("button"), 2);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled, keyboard included", () => {
    const onTap = vi.fn();
    render(<TapButton onTap={onTap} options={{ enabled: false }} />);
    const button = screen.getByRole("button");
    fingerTap(button);
    clock += COMPAT_CLICK_WINDOW_MS + 1;
    fireEvent.click(button, { detail: 0 });
    expect(onTap).not.toHaveBeenCalled();
  });

  it("keeps handler identity across renders and runs the newest action", () => {
    const first = vi.fn();
    const second = vi.fn();
    const seen: unknown[] = [];

    function Probe({ onTap }: { onTap: () => void }) {
      const tap = usePointerTap<HTMLButtonElement>(onTap);
      seen.push(tap.onPointerDown);
      return (
        <button type="button" {...tap}>
          Go
        </button>
      );
    }

    const { rerender } = render(<Probe onTap={first} />);
    rerender(<Probe onTap={second} />);
    fingerTap(screen.getByRole("button"));

    expect(new Set(seen).size).toBe(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not stop the long-press menu on a plain tap control", () => {
    render(<TapButton onTap={vi.fn()} />);
    const allowed = fireEvent.contextMenu(screen.getByRole("button"));
    expect(allowed).toBe(true);
  });
});

describe("usePointerTap: hold controls", () => {
  it("presses on pointerdown and releases once on pointerup", () => {
    const onTap = vi.fn();
    const onRelease = vi.fn();
    render(<TapButton onTap={onTap} options={{ onRelease }} />);
    const button = screen.getByRole("button");

    fireEvent.pointerDown(button, { pointerId: 1, pointerType: "touch", button: 0 });
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();

    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", button: 0 });
    fireEvent.lostPointerCapture(button, { pointerId: 1, pointerType: "touch" });
    fireEvent.click(button, { detail: 1 });
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("releases only when the LAST finger lets go", () => {
    const onRelease = vi.fn();
    render(<TapButton onTap={vi.fn()} options={{ onRelease }} />);
    const button = screen.getByRole("button");

    fireEvent.pointerDown(button, { pointerId: 1, pointerType: "touch", button: 0 });
    fireEvent.pointerDown(button, { pointerId: 2, pointerType: "touch", button: 0 });
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", button: 0 });
    expect(onRelease).not.toHaveBeenCalled();
    fireEvent.pointerUp(button, { pointerId: 2, pointerType: "touch", button: 0 });
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("releases when the browser cancels the touch", () => {
    const onRelease = vi.fn();
    render(<TapButton onTap={vi.fn()} options={{ onRelease }} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button, { pointerId: 7, pointerType: "touch", button: 0 });
    fireEvent.pointerCancel(button, { pointerId: 7, pointerType: "touch" });
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("captures the pointer so a finger that slides off still releases", () => {
    const capture = vi.fn();
    render(<TapButton onTap={vi.fn()} options={{ onRelease: vi.fn() }} />);
    const button = screen.getByRole("button") as HTMLButtonElement & {
      setPointerCapture: (id: number) => void;
    };
    button.setPointerCapture = capture;
    fireEvent.pointerDown(button, { pointerId: 4, pointerType: "touch", button: 0 });
    expect(capture).toHaveBeenCalledWith(4);
  });

  it("keeps working when pointer capture throws", () => {
    const onTap = vi.fn();
    render(<TapButton onTap={onTap} options={{ onRelease: vi.fn() }} />);
    const button = screen.getByRole("button") as HTMLButtonElement & {
      setPointerCapture: (id: number) => void;
    };
    button.setPointerCapture = () => {
      throw new DOMException("gone", "NotFoundError");
    };
    fireEvent.pointerDown(button, { pointerId: 4, pointerType: "touch", button: 0 });
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("releases a held control when it unmounts", () => {
    const onRelease = vi.fn();
    const { unmount } = render(<TapButton onTap={vi.fn()} options={{ onRelease }} />);
    fireEvent.pointerDown(screen.getByRole("button"), {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
    });
    unmount();
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledWith();
  });

  it("does not release on unmount when nothing is held", () => {
    const onRelease = vi.fn();
    const { unmount } = render(<TapButton onTap={vi.fn()} options={{ onRelease }} />);
    unmount();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("treats a keyboard press as a full press and release", () => {
    const calls: string[] = [];
    render(
      <TapButton
        onTap={() => calls.push("press")}
        options={{ onRelease: () => calls.push("release") }}
      />
    );
    fireEvent.click(screen.getByRole("button"), { detail: 0 });
    expect(calls).toEqual(["press", "release"]);
  });

  it("stops the long-press menu so the phone cannot cancel the hold", () => {
    render(<TapButton onTap={vi.fn()} options={{ onRelease: vi.fn() }} />);
    const allowed = fireEvent.contextMenu(screen.getByRole("button"));
    expect(allowed).toBe(false);
  });
});
