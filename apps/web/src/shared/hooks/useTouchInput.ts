"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type React from "react";

/**
 * Touch input for a game surface, and hold buttons for a game pad.
 *
 * Why: React attaches touchstart, touchmove and touchend as PASSIVE
 * listeners. A preventDefault() in a React onTouchStart does nothing and
 * logs "Unable to preventDefault inside passive event listener" (the 2026
 * phone audit counted 19 to 150 per session). The browser then sends its
 * compatibility mouse events and a click, so a game with onTouchStart AND
 * onClick on one element ran the action twice: Hextris spun 120 degrees
 * for one tap, the Oregon Trail hunt spent two bullets, Bomberman placed
 * two bombs. Games that read `e.touches[0]` acted on the OLDEST finger, so
 * a tap while a button was held moved the wrong way.
 *
 * Two tools, one file:
 *
 * 1. useTouchInput(ref, handlers): NATIVE touch listeners on an element,
 *    registered with { passive: false }, so preventDefault() works. Every
 *    touch in `changedTouches` is tracked by its identifier, so two fingers
 *    get two starts, two moves and two ends, each with its own start point.
 *    Use it for a play surface: zones, swipes, drags, taps on a canvas.
 *
 * 2. usePointerHold(onPress, onRelease): POINTER events for a button that
 *    stays pressed while the finger is down (a pedal, a d-pad key, FIRE).
 *    Modelled on four-wheeler-3d/hooks/useControls.ts: the element captures
 *    the pointer, so a thumb that slides off still releases; a system
 *    cancel (edge swipe, notification pull) releases; the window losing
 *    focus releases. One press per element, however many fingers are on it.
 *
 * For a one-shot tap on a button or a canvas (rotate, shoot, launch), use
 * usePointerTap from @/shared/lib/input.
 *
 * CSS: a surface used with useTouchInput may keep any touch-action (the
 * hook cancels the browser's scroll itself). A hold button needs
 * `touch-action: none` (Tailwind `touch-none`), or the browser can take
 * the touch for a scroll and cancel the press.
 *
 * Never put onTouchStart together with onClick or onMouseDown on one
 * element (ESLint rule hanks-hits/touch-input): that is the double path.
 */

/** One finger, from its touchstart to its touchend or cancel. */
export interface TouchPoint<Tag = string> {
  /** Touch.identifier: stable for the life of the finger. */
  readonly id: number;
  /** The element the finger landed on. */
  readonly target: EventTarget | null;
  readonly startX: number;
  readonly startY: number;
  /** The newest position (client coordinates). */
  x: number;
  y: number;
  /** performance.now() at touchstart. */
  readonly startedAt: number;
  /** A slot for the game: which zone or control this finger is on. */
  tag?: Tag;
}

export interface TouchInputHandlers<Tag = string> {
  /** A finger went down. Set `touch.tag` here to remember what it is on. */
  onStart?: (touch: TouchPoint<Tag>, event: TouchEvent) => void;
  /** A tracked finger moved. `touch.x` and `touch.y` are already updated. */
  onMove?: (touch: TouchPoint<Tag>, event: TouchEvent) => void;
  /**
   * A tracked finger lifted. Also runs for a cancel when there is no
   * onCancel; then `event` is the touchcancel event, or null when the hook
   * itself let go (unmount, disable, window blur, page hidden).
   */
  onEnd?: (touch: TouchPoint<Tag>, event: TouchEvent | null) => void;
  /** The browser or the hook cancelled a tracked finger. Falls back to onEnd. */
  onCancel?: (touch: TouchPoint<Tag>, event: TouchEvent | null) => void;
}

export interface TouchInputOptions {
  /** False detaches the listeners and lets go of every finger. Default true. */
  enabled?: boolean;
  /**
   * Call preventDefault() on every touch event that has a tracked finger:
   * no page scroll, no pull-to-refresh, no compatibility mouse events, no
   * click. Default true. Set false only for a surface that must also
   * scroll.
   */
  preventDefault?: boolean;
  /**
   * A CSS selector. A finger that lands on a matching element (or inside
   * one) is never tracked and never has its default prevented, so a button
   * or a dialog over the surface keeps working.
   */
  ignore?: string;
  /**
   * Let go of every finger when the window loses focus or the page is
   * hidden (a phone call, the app switcher). Default true.
   */
  releaseOnBlur?: boolean;
}

export type TouchInputConfig<Tag = string> = TouchInputHandlers<Tag> &
  TouchInputOptions;

export interface TouchInput<Tag = string> {
  /** The fingers down right now. */
  active(): readonly TouchPoint<Tag>[];
  /** Replace the handlers and options. */
  configure(next: TouchInputConfig<Tag>): void;
  /** Let go of every finger now (onCancel, or onEnd, with a null event). */
  cancelAll(): void;
  /** Remove the listeners and let go of every finger. */
  detach(): void;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * True when a touch landed on an element that matches `selector`, or on a
 * child of one. A target that is not an Element (text node, window) is
 * resolved through its parent.
 */
export function touchTargetMatches(
  target: EventTarget | null,
  selector: string | undefined
): boolean {
  if (!selector || !target) return false;
  const node = target as Node & { closest?: (s: string) => Element | null };
  const element =
    typeof node.closest === "function"
      ? (node as unknown as Element)
      : (node.parentElement ?? null);
  if (!element) return false;
  try {
    return element.closest(selector) !== null;
  } catch {
    // A bad selector must not break the game: track the touch.
    return false;
  }
}

/**
 * The framework-free core. The hook below wraps it. Code outside React (a
 * window-level control hook) can call it with any EventTarget.
 */
export function createTouchInput<Tag = string>(
  target: EventTarget,
  initial: TouchInputConfig<Tag>
): TouchInput<Tag> {
  let config = initial;
  const points = new Map<number, TouchPoint<Tag>>();

  const prevent = (event: TouchEvent) => {
    if (config.preventDefault === false) return;
    if (event.cancelable) event.preventDefault();
  };

  const letGo = (point: TouchPoint<Tag>, event: TouchEvent | null) => {
    points.delete(point.id);
    if (config.onCancel) config.onCancel(point, event);
    else config.onEnd?.(point, event);
  };

  const onTouchStart = (event: TouchEvent) => {
    if (config.enabled === false) return;
    const started: TouchPoint<Tag>[] = [];
    const changed = event.changedTouches;
    for (let i = 0; i < changed.length; i += 1) {
      const touch = changed[i];
      if (touchTargetMatches(touch.target, config.ignore)) continue;
      const point: TouchPoint<Tag> = {
        id: touch.identifier,
        target: touch.target,
        startX: touch.clientX,
        startY: touch.clientY,
        x: touch.clientX,
        y: touch.clientY,
        startedAt: now(),
      };
      points.set(point.id, point);
      started.push(point);
    }
    if (started.length === 0) return;
    prevent(event);
    for (const point of started) config.onStart?.(point, event);
  };

  const onTouchMove = (event: TouchEvent) => {
    const moved: TouchPoint<Tag>[] = [];
    const changed = event.changedTouches;
    for (let i = 0; i < changed.length; i += 1) {
      const touch = changed[i];
      const point = points.get(touch.identifier);
      if (!point) continue;
      point.x = touch.clientX;
      point.y = touch.clientY;
      moved.push(point);
    }
    if (moved.length === 0) return;
    prevent(event);
    for (const point of moved) config.onMove?.(point, event);
  };

  const onTouchEnd = (event: TouchEvent) => {
    const ended: TouchPoint<Tag>[] = [];
    const changed = event.changedTouches;
    for (let i = 0; i < changed.length; i += 1) {
      const touch = changed[i];
      const point = points.get(touch.identifier);
      if (!point) continue;
      point.x = touch.clientX;
      point.y = touch.clientY;
      points.delete(point.id);
      ended.push(point);
    }
    if (ended.length === 0) return;
    prevent(event);
    for (const point of ended) config.onEnd?.(point, event);
  };

  const onTouchCancel = (event: TouchEvent) => {
    const cancelled: TouchPoint<Tag>[] = [];
    const changed = event.changedTouches;
    for (let i = 0; i < changed.length; i += 1) {
      const point = points.get(changed[i].identifier);
      if (point) cancelled.push(point);
    }
    for (const point of cancelled) letGo(point, event);
  };

  const cancelAll = () => {
    for (const point of Array.from(points.values())) letGo(point, null);
  };

  const onBlur = () => {
    if (config.releaseOnBlur !== false) cancelAll();
  };
  const onVisibilityChange = () => {
    if (config.releaseOnBlur !== false && document.visibilityState === "hidden") {
      cancelAll();
    }
  };

  const options: AddEventListenerOptions = { passive: false };
  target.addEventListener("touchstart", onTouchStart as EventListener, options);
  target.addEventListener("touchmove", onTouchMove as EventListener, options);
  target.addEventListener("touchend", onTouchEnd as EventListener, options);
  target.addEventListener("touchcancel", onTouchCancel as EventListener, options);
  const hasWindow = typeof window !== "undefined";
  if (hasWindow) {
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  return {
    active: () => Array.from(points.values()),
    configure(next) {
      config = next;
    },
    cancelAll,
    detach() {
      target.removeEventListener("touchstart", onTouchStart as EventListener);
      target.removeEventListener("touchmove", onTouchMove as EventListener);
      target.removeEventListener("touchend", onTouchEnd as EventListener);
      target.removeEventListener("touchcancel", onTouchCancel as EventListener);
      if (hasWindow) {
        window.removeEventListener("blur", onBlur);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      cancelAll();
    },
  };
}

/**
 * React hook form of createTouchInput. The listeners bind to the element
 * that `ref.current` holds after each commit, and move when it changes: a
 * surface that mounts late (after the play box is measured) or remounts
 * (under a new parent when the phone turns) is a new element. Binding
 * once on mount left such a surface with no listeners: a dead d-pad
 * (Bomberman, phone check 2026-09-30). The newest handlers always run,
 * with no re-binding on render.
 *
 * Usage:
 *   useTouchInput(canvasRef, {
 *     onStart: (touch) => { touch.tag = zoneAt(touch.startX); press(touch.tag); },
 *     onEnd: (touch) => release(touch.tag),
 *   });
 */
export function useTouchInput<Tag = string>(
  ref: RefObject<Element | null>,
  handlers: TouchInputHandlers<Tag>,
  options: TouchInputOptions = {}
): { active: () => readonly TouchPoint<Tag>[] } {
  const configRef = useRef<TouchInputConfig<Tag>>({ ...handlers, ...options });
  const inputRef = useRef<TouchInput<Tag> | null>(null);
  const enabled = options.enabled !== false;

  useLayoutEffect(() => {
    configRef.current = { ...handlers, ...options };
    inputRef.current?.configure(configRef.current);
  });

  // After every commit: bind to the element the ref holds now, if it is
  // not the one already bound. Cheap when nothing changed (one compare).
  const boundRef = useRef<Element | null>(null);
  useEffect(() => {
    const element = enabled ? ref.current : null;
    if (element === boundRef.current) return;
    inputRef.current?.detach();
    inputRef.current = null;
    boundRef.current = element;
    if (element) inputRef.current = createTouchInput<Tag>(element, configRef.current);
  });
  useEffect(
    () => () => {
      inputRef.current?.detach();
      inputRef.current = null;
      boundRef.current = null;
    },
    []
  );

  return useMemo(
    () => ({ active: () => inputRef.current?.active() ?? [] }),
    []
  );
}

// ---------------------------------------------------------------------------
// Pointer-events hold button
// ---------------------------------------------------------------------------

export interface PointerHoldOptions {
  /** False ignores every press. Default true. */
  enabled?: boolean;
  /** Release when the window loses focus or the page is hidden. Default true. */
  releaseOnBlur?: boolean;
}

export interface PointerHoldHandlers<T extends Element = Element> {
  onPointerDown: (event: React.PointerEvent<T>) => void;
  onPointerUp: (event: React.PointerEvent<T>) => void;
  onPointerCancel: (event: React.PointerEvent<T>) => void;
  onLostPointerCapture: (event: React.PointerEvent<T>) => void;
  onContextMenu: (event: React.MouseEvent<T>) => void;
}

export type PointerHoldConfig<T extends Element = Element> = PointerHoldOptions & {
  onPress: (event: React.PointerEvent<T>) => void;
  onRelease: (event?: React.PointerEvent<T>) => void;
};

export interface PointerHold<T extends Element = Element> {
  /** Spread these on the element. Their identity never changes. */
  handlers: PointerHoldHandlers<T>;
  configure(next: PointerHoldConfig<T>): void;
  /** True while at least one pointer presses the element. */
  isHeld(): boolean;
  /** Release a hold that is still down (for unmount and blur). */
  releaseAll(): void;
}

/**
 * The framework-free core of usePointerHold. A control hook that builds
 * handlers for several buttons in one place (a pad with gas, brake, left
 * and right) can call it once per button.
 */
export function createPointerHold<T extends Element = Element>(
  initial: PointerHoldConfig<T>
): PointerHold<T> {
  let config = initial;
  const active = new Set<number>();

  const end = (event: React.PointerEvent<T>) => {
    if (!active.delete(event.pointerId)) return;
    if (active.size === 0) config.onRelease(event);
  };

  const handlers: PointerHoldHandlers<T> = {
    onPointerDown(event) {
      if (config.enabled === false) return;
      // A right or middle mouse button is not a press.
      if (event.pointerType === "mouse" && event.button !== 0) return;
      // No compatibility mouse events, no focus ring, no text selection.
      event.preventDefault();
      const target = event.currentTarget as Element & {
        setPointerCapture?: (pointerId: number) => void;
      };
      try {
        // Keep the press even if the thumb slides off the button.
        target.setPointerCapture?.(event.pointerId);
      } catch {
        // The pointer is already gone (a very fast tap). Nothing to hold.
      }
      const wasHeld = active.size > 0;
      active.add(event.pointerId);
      if (!wasHeld) config.onPress(event);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onContextMenu(event) {
      // A long press must not open the phone's menu: the menu cancels the
      // touch and lets go of the pedal.
      event.preventDefault();
    },
  };

  return {
    handlers,
    configure(next) {
      config = next;
    },
    isHeld: () => active.size > 0,
    releaseAll() {
      if (active.size === 0) return;
      active.clear();
      config.onRelease();
    },
  };
}

/**
 * React hook form of createPointerHold.
 *
 * Usage:
 *   const gas = usePointerHold(() => setGas(true), () => setGas(false));
 *   <button type="button" {...gas} className="touch-none">GAS</button>
 */
export function usePointerHold<T extends Element = Element>(
  onPress: (event: React.PointerEvent<T>) => void,
  onRelease: (event?: React.PointerEvent<T>) => void,
  options: PointerHoldOptions = {}
): PointerHoldHandlers<T> {
  const [hold] = useState(() =>
    createPointerHold<T>({ ...options, onPress, onRelease })
  );

  useLayoutEffect(() => {
    hold.configure({ ...options, onPress, onRelease });
  });

  const releaseOnBlur = options.releaseOnBlur !== false;
  useEffect(() => {
    if (!releaseOnBlur) return;
    const onBlur = () => hold.releaseAll();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") hold.releaseAll();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hold, releaseOnBlur]);

  useEffect(() => () => hold.releaseAll(), [hold]);

  return hold.handlers;
}

export interface PointerHoldSet<K extends string, T extends Element = Element> {
  /** Spread `handlers[key]` on each button. Their identity never changes. */
  handlers: Record<K, PointerHoldHandlers<T>>;
  /** True while at least one pointer presses that button. */
  isHeld(key: K): boolean;
  /** Release every hold that is still down. */
  releaseAll(): void;
}

/**
 * One hold per key, for a pad built in one place (gas, brake, left, right,
 * nos, horn). `onChange(key, down)` runs on the first press and the last
 * release of each key; the newest `onChange` always runs. `keys` is read
 * once, on mount.
 *
 * Usage:
 *   const pad = usePointerHolds(["gas", "brake"] as const, (key, down) => set(key, down));
 *   <button type="button" {...pad.handlers.gas} className="touch-none">GAS</button>
 */
export function usePointerHolds<K extends string, T extends Element = Element>(
  keys: readonly K[],
  onChange: (key: K, down: boolean) => void,
  options: PointerHoldOptions = {}
): PointerHoldSet<K, T> {
  const [set] = useState(() => {
    const holds = {} as Record<K, PointerHold<T>>;
    const handlers = {} as Record<K, PointerHoldHandlers<T>>;
    for (const key of keys) {
      holds[key] = createPointerHold<T>({
        ...options,
        onPress: () => onChange(key, true),
        onRelease: () => onChange(key, false),
      });
      handlers[key] = holds[key].handlers;
    }
    const all = () => Object.values<PointerHold<T>>(holds);
    return {
      holds,
      api: {
        handlers,
        isHeld: (key: K) => holds[key].isHeld(),
        releaseAll: () => all().forEach((hold) => hold.releaseAll()),
      } satisfies PointerHoldSet<K, T>,
    };
  });

  useLayoutEffect(() => {
    for (const key of Object.keys(set.holds) as K[]) {
      set.holds[key].configure({
        ...options,
        onPress: () => onChange(key, true),
        onRelease: () => onChange(key, false),
      });
    }
  });

  const releaseOnBlur = options.releaseOnBlur !== false;
  useEffect(() => {
    if (!releaseOnBlur) return;
    const onBlur = () => set.api.releaseAll();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") set.api.releaseAll();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [set, releaseOnBlur]);

  useEffect(() => () => set.api.releaseAll(), [set]);

  return set.api;
}
