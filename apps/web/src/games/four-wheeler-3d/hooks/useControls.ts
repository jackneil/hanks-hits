"use client";

/**
 * Keyboard, touch and tilt, combined into one reading per frame.
 *
 * This is the monster-truck hook rewritten for this game's control set. It is
 * a copy on purpose: one game must never be able to break another one. The
 * pure part lives in `lib/controls.ts`, which is what the tests use.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";

import {
  clearLatch,
  combine,
  createLatch,
  latchDown,
  latchUp,
  NEUTRAL,
  NEUTRAL_TOUCH,
  reduceKeyboard,
  reduceTouch,
  steerFromGamma,
  takeOneShot,
  type ControlValues,
  type OneShot,
  type TouchState,
} from "../lib/controls";

/** Every key the game listens for. Anything else falls through to the page. */
const GAME_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Space", "ShiftLeft", "KeyX",
  "KeyH", "KeyR", "KeyC", "KeyE", "KeyN",
]);

/** The touch buttons the on-screen controls drive. */
export type TouchButton = "gas" | "brake" | "left" | "right" | "jump" | "horn";

export type TouchHandlers = {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
  onPointerLeave: (event: React.PointerEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
};

function useKeyboard(enabled: boolean) {
  const latch = useRef(createLatch());

  useEffect(() => {
    // One latch for the life of the hook. Held here so the cleanup below
    // clears the same one it started with.
    const held = latch.current;
    if (!enabled) {
      clearLatch(held);
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // A focused button or link owns its own Space and Enter.
      if (keyBelongsToTarget(event)) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (!GAME_KEYS.has(event.code)) return;
      // The space bar and the arrows scroll the page. The game owns them here.
      event.preventDefault();
      latchDown(held, event.code);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      latchUp(held, event.code);
    };

    // A tab away leaves a key stuck down. Let go of everything instead.
    const onBlur = () => clearLatch(held);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      clearLatch(held);
    };
  }, [enabled]);

  return latch;
}

/** The on-screen buttons. Pointer events, so two thumbs work at once. */
function useTouch() {
  const stateRef = useRef<TouchState>({ ...NEUTRAL_TOUCH });
  const [state, setState] = useState<TouchState>({ ...NEUTRAL_TOUCH });

  const set = useCallback((button: TouchButton, down: boolean) => {
    if (stateRef.current[button] === down) return;
    const next = { ...stateRef.current, [button]: down };
    // JUMP and HORN happen once per press, so the press is remembered until
    // the game reads it. A tap shorter than one frame still counts.
    if (down && button === "jump") next.jumpPending = true;
    if (down && button === "horn") next.hornPending = true;
    stateRef.current = next;
    setState(next);
  }, []);

  const handlersFor = useCallback(
    (button: TouchButton): TouchHandlers => ({
      onPointerDown: (event) => {
        event.preventDefault();
        // Keep the press even if the thumb slides off the button.
        event.currentTarget.setPointerCapture?.(event.pointerId);
        set(button, true);
      },
      onPointerUp: (event) => {
        event.preventDefault();
        set(button, false);
      },
      onPointerCancel: () => set(button, false),
      onPointerLeave: () => set(button, false),
      onContextMenu: (event) => event.preventDefault(),
    }),
    [set]
  );

  const handlers = useMemo(
    () => ({
      gas: handlersFor("gas"),
      brake: handlersFor("brake"),
      left: handlersFor("left"),
      right: handlersFor("right"),
      jump: handlersFor("jump"),
      horn: handlersFor("horn"),
    }),
    [handlersFor]
  );

  const setSteerAxis = useCallback((axis: number) => {
    stateRef.current.steerAxis = axis;
  }, []);

  return { state, stateRef, handlers, setSteerAxis };
}

/** Tilt steering, with the permission prompt iOS needs. */
export function useDeviceOrientation() {
  const isSupported =
    typeof window !== "undefined" && "DeviceOrientationEvent" in window;
  const hasImplicitPermission =
    isSupported && !("requestPermission" in DeviceOrientationEvent);

  const [isPermissionGranted, setIsPermissionGranted] = useState(
    hasImplicitPermission
  );
  const steerRef = useRef(0);
  const smoothed = useRef(0);
  const offset = useRef(0);

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    const gamma = event.gamma ?? 0;
    // Smooth the reading so a shaky hand does not twitch the wheels.
    smoothed.current += (gamma - smoothed.current) * 0.25;
    steerRef.current = steerFromGamma(smoothed.current - offset.current);
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;
    if ("requestPermission" in DeviceOrientationEvent) {
      try {
        const permission = await (
          DeviceOrientationEvent as unknown as {
            requestPermission: () => Promise<"granted" | "denied">;
          }
        ).requestPermission();
        if (permission !== "granted") return false;
      } catch {
        return false;
      }
    }
    setIsPermissionGranted(true);
    return true;
  }, [isSupported]);

  /** Call this holding the phone the way it will be held. */
  const calibrate = useCallback(() => {
    offset.current = smoothed.current;
  }, []);

  useEffect(() => {
    if (!isPermissionGranted) return;
    window.addEventListener("deviceorientation", handleOrientation);
    return () =>
      window.removeEventListener("deviceorientation", handleOrientation);
  }, [isPermissionGranted, handleOrientation]);

  return { isSupported, isPermissionGranted, requestPermission, calibrate, steerRef };
}

export type GameControls = ReturnType<typeof useGameControls>;

/**
 * One reading of every input.
 *
 * @param enabled False on the start overlay and while the game is paused, so
 * a key pressed on a menu never drives the ATV.
 */
export function useGameControls(enabled: boolean) {
  const latch = useKeyboard(enabled);
  const touch = useTouch();
  const tilt = useDeviceOrientation();

  // The shared hook the rest of the site uses to tell a finger from a mouse.
  const isMobile = useCoarsePointer();
  const [useTilt, setUseTilt] = useState(false);

  /**
   * Everything the player is doing right now.
   *
   * Reading this does NOT use up a waiting one-shot press: `takeOneShot` does
   * that, and each action has exactly one reader in the game, so the camera
   * can never swallow a jump on its way past.
   */
  const getControlValues = useCallback((): ControlValues => {
    if (!enabled) return NEUTRAL;
    touch.setSteerAxis(
      useTilt && tilt.isPermissionGranted ? tilt.steerRef.current : 0
    );
    return combine(
      reduceKeyboard(latch.current.held, latch.current.pending),
      reduceTouch(touch.stateRef.current)
    );
  }, [enabled, latch, touch, tilt, useTilt]);

  /** Read one waiting press and take it away. False when nothing is waiting. */
  const takeAction = useCallback(
    (action: OneShot): boolean => {
      if (!enabled) return false;
      return takeOneShot(latch.current, touch.stateRef.current, action);
    },
    [enabled, latch, touch]
  );

  return {
    getControlValues,
    takeOneShot: takeAction,
    isMobile,
    touch,
    tilt,
    useTilt,
    setUseTilt,
  };
}
