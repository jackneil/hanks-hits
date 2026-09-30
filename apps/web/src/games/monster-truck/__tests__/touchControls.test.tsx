import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type React from "react";

import { useTouchControls } from "../hooks/useControls";

// Regression (2026 phone audit, monster-truck): the pedal handlers were
// React onTouchStart/onTouchEnd with a preventDefault() that React's
// passive listeners ignored (an error on every press) plus onMouseDown/Up/
// Leave on the same button, so a tap also fired the compatibility mouse
// events (a double set and unset). They are pointer events now, with
// pointer capture and a release on cancel.

function pointerEvent(pointerId: number, pointerType = "touch") {
  const captured: number[] = [];
  const event = {
    pointerId,
    pointerType,
    button: 0,
    preventDefault: () => {},
    currentTarget: { setPointerCapture: (id: number) => captured.push(id) },
  } as unknown as React.PointerEvent<HTMLButtonElement>;
  return { event, captured };
}

describe("monster-truck useTouchControls", () => {
  it("presses on pointerdown, captures the pointer, releases on pointerup", () => {
    const { result } = renderHook(() => useTouchControls());
    const { event, captured } = pointerEvent(1);
    act(() => {
      result.current.handlers.gas.onPointerDown(event);
    });
    expect(result.current.state.gas).toBe(true);
    expect(result.current.getControlValues().throttle).toBe(1);
    expect(captured).toEqual([1]);
    act(() => {
      result.current.handlers.gas.onPointerUp(event);
    });
    expect(result.current.state.gas).toBe(false);
  });

  it("releases on pointercancel (the system took the touch)", () => {
    const { result } = renderHook(() => useTouchControls());
    const { event } = pointerEvent(2);
    act(() => {
      result.current.handlers.brake.onPointerDown(event);
    });
    expect(result.current.state.brake).toBe(true);
    act(() => {
      result.current.handlers.brake.onPointerCancel(event);
    });
    expect(result.current.state.brake).toBe(false);
  });

  it("holds the pedal with two fingers until the last one lifts", () => {
    const { result } = renderHook(() => useTouchControls());
    const first = pointerEvent(1).event;
    const second = pointerEvent(2).event;
    act(() => {
      result.current.handlers.gas.onPointerDown(first);
      result.current.handlers.gas.onPointerDown(second);
      result.current.handlers.gas.onPointerUp(first);
    });
    expect(result.current.state.gas).toBe(true);
    act(() => {
      result.current.handlers.gas.onPointerUp(second);
    });
    expect(result.current.state.gas).toBe(false);
  });

  it("lets go of every pedal when the window loses focus", () => {
    const { result } = renderHook(() => useTouchControls());
    act(() => {
      result.current.handlers.gas.onPointerDown(pointerEvent(1).event);
      result.current.handlers.left.onPointerDown(pointerEvent(2).event);
    });
    expect(result.current.state.gas).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(result.current.state.gas).toBe(false);
    expect(result.current.state.left).toBe(false);
  });
});
