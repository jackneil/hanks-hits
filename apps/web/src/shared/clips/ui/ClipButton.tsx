"use client";

/**
 * The clip button (plan 11.1, 11.3): the 44 px control in GameShell's
 * header clip slot. GameShell puts it there through the shell mount (see
 * ClipUiRuntime.tsx); a game adds nothing for it.
 *
 * - A drawn glyph (a clapperboard), white on the dark header, with one look
 *   per state (buttonFace.ts). Motion follows prefers-reduced-motion.
 * - Tap semantics (pressGesture.ts): pointerdown calls beginPress, the
 *   release calls endPress; a hold of 500 ms opens the Capture menu and
 *   commits nothing. A release more than 48 px outside the button commits
 *   nothing either (drag off to cancel, like a native iOS button). Each
 *   press acts once: the compatibility click after a pointer press is
 *   ignored, and a held Enter does not repeat.
 * - Every finger counts: a kid who holds a gas pedal with one thumb can
 *   clip with the other (the press machine refuses a second press on the
 *   button itself).
 * - The game never sees the button's taps: the events of a press that
 *   started on the button stop here (Hill Climb reads any touch on the
 *   right half of the window as gas). A press that started on the game
 *   and crosses or ends over the button still reaches the game's window
 *   listeners (shared/lib/input/pressOwnership.ts), so a paddle keeps
 *   following the cursor and a held thrust lets go.
 * - A pointer press never leaves keyboard focus on the button. A focused
 *   button owns Space and Enter (keyBelongsToTarget), so the game's jump key
 *   would make clips instead. Keyboard focus (Tab) works as usual.
 * - Keyboard: Enter or Space on the focused button. Alt+C (Option+C) and F8
 *   clip, Alt+R starts or stops a video, anywhere on the page while a
 *   clip-enabled game is on screen (hotkeys.ts). A matched shortcut stops
 *   there: the game never also sees it (Alt+R is not a truck reset). The
 *   context-menu key, a right-click and a Mac Control-click open the
 *   Capture menu.
 * - Game controller: the Share or Capture button, or a 1 s hold of Back
 *   (gamepad.ts). A controller always clips; it never opens a sheet, and it
 *   does nothing while a clip sheet is open. Never in Retro Arcade.
 * - It renders nothing when there is no clip service, no clip UI
 *   controller (ClipUiRuntime), or the state is "hidden".
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type React from "react";

import { createPressOwnership } from "@/shared/lib/input/pressOwnership";

import { useClipService, useClipSnapshot } from "../service/context";
import type { ClipButtonState, ClipServiceApi, ClipSnapshot } from "../service/contract";
import { faceFor, LOOK_HOLD_MS, LOOK_MAX_MS, sameLook, type FaceLook } from "./buttonFace";
import { useClipUi, useClipUiState } from "./uiContext";
import { BUTTON_NAMES, buttonTooltip, RESULT_COPY } from "./copy";
import { createGamepadPoller, NO_GAMEPAD_CLIP_APPS, type PadLike } from "./gamepad";
import { CheckGlyph, ClipGlyph } from "./glyphs";
import { hotkeyBelongsToTarget, listenOnSameOriginWindows, matchClipHotkey } from "./hotkeys";
import { isApplePlatform, nowMs, prefersReducedMotion, subscribeToNothing, subscribeToReducedMotion } from "./platform";
import { COMPAT_CLICK_WINDOW_MS, createClipPress, forwardPress, releasedOff, type ClipPress } from "./pressGesture";
import type { ClipUiController } from "./uiStore";

export interface ClipButtonProps {
  /** Alt+C, F8 and Alt+R. Default true. */
  keyboardShortcuts?: boolean;
  /** Game controller clips. Default true (always off in Retro Arcade). */
  gamepad?: boolean;
}

// ---------------------------------------------------------------------------
// The face
// ---------------------------------------------------------------------------

const RING_RADIUS = 19.5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const AMBER = "#fbbf24"; // amber-400: 11.5:1 on the slate-950 header
const RED = "#dc2626"; // red-600
const HEADER = "#020617"; // slate-950, the header background

function ClipButtonFace({ look, reducedMotion }: { look: FaceLook; reducedMotion: boolean }) {
  const ringTransition = reducedMotion ? undefined : "stroke-dashoffset 250ms linear";
  return (
    <svg
      width={44}
      height={44}
      viewBox="0 0 44 44"
      aria-hidden="true"
      focusable="false"
      data-glyph={look.glyph}
      data-ring={look.ring}
      data-progress={look.ring === "progress" ? look.progress.toFixed(2) : undefined}
      data-slashed={look.slashed ? "true" : "false"}
      data-dot={look.dot ? "true" : "false"}
      style={{ opacity: look.opacity }}
      className="pointer-events-none"
    >
      {look.ring === "static" && (
        <circle cx={22} cy={22} r={RING_RADIUS} fill="none" stroke="white" strokeOpacity={0.9} strokeWidth={1.5} />
      )}
      {look.ring === "full" && <circle cx={22} cy={22} r={RING_RADIUS} fill="none" stroke="white" strokeWidth={2.5} />}
      {look.ring === "amber" && <circle cx={22} cy={22} r={RING_RADIUS} fill="none" stroke={AMBER} strokeWidth={2} />}
      {look.ring === "progress" && (
        <>
          <circle cx={22} cy={22} r={RING_RADIUS} fill="none" stroke="white" strokeOpacity={0.3} strokeWidth={2.5} />
          <circle
            data-part="progress"
            cx={22}
            cy={22}
            r={RING_RADIUS}
            fill="none"
            stroke="white"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - look.progress)}
            transform="rotate(-90 22 22)"
            style={{ transition: ringTransition }}
          />
        </>
      )}

      {look.glyph === "clip" && <ClipGlyph x={10} y={10} size={24} stroke="white" />}
      {look.glyph === "check" && <CheckGlyph x={10} y={10} size={24} stroke="white" />}
      {look.glyph === "stop" && (
        <>
          <circle cx={22} cy={22} r={17} fill={RED} />
          <rect x={16} y={16} width={12} height={12} rx={2.5} fill="white" />
        </>
      )}
      {look.glyph === "alert" && (
        <>
          <path d="M22 12.5v11" stroke={AMBER} strokeWidth={3.5} strokeLinecap="round" />
          <circle cx={22} cy={30} r={2.2} fill={AMBER} />
        </>
      )}

      {look.slashed && (
        <>
          <path d="M11.5 32.5 32.5 11.5" stroke={HEADER} strokeWidth={5.5} strokeLinecap="round" />
          <path d="M11.5 32.5 32.5 11.5" stroke="white" strokeWidth={2.25} strokeLinecap="round" />
        </>
      )}
      {look.dot && <circle data-part="dot" cx={33} cy={11} r={4.5} fill="#ef4444" stroke={HEADER} strokeWidth={1.5} />}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Look timing (plan 11.3): source-lost keeps the old look for 1.5 s and
// recovering for 3 s; the check mark lasts at most 1.2 s and the amber "!"
// at most 3 s.
// ---------------------------------------------------------------------------

interface LookTrack {
  state: ClipButtonState;
  entry: number;
  displayed: FaceLook;
  frozen: FaceLook | null;
}

/**
 * The look to draw. A state in LOOK_HOLD_MS keeps the look that was on
 * screen when it began ("unchanged"), then shows its own look. A state in
 * LOOK_MAX_MS shows its own look, then the ready look.
 */
function useButtonLook(snapshot: ClipSnapshot): FaceLook {
  const state = snapshot.button;
  const target = faceFor(state, snapshot);
  const [track, setTrack] = useState<LookTrack>(() => ({ state, entry: 0, displayed: target, frozen: null }));
  const [timedOutEntry, setTimedOutEntry] = useState(-1);

  const holdMs = LOOK_HOLD_MS[state] ?? 0;
  const maxMs = LOOK_MAX_MS[state] ?? 0;
  let next = track;
  if (track.state !== state) {
    next = { state, entry: track.entry + 1, displayed: track.displayed, frozen: holdMs > 0 ? track.displayed : null };
  }
  const timedOut = timedOutEntry === next.entry;
  let display = target;
  if (holdMs > 0 && next.frozen !== null && !timedOut) display = next.frozen;
  else if (maxMs > 0 && timedOut) display = faceFor("ready", snapshot);
  if (next !== track || !sameLook(track.displayed, display)) {
    next = { ...next, displayed: display };
    setTrack(next);
  }

  const entry = next.entry;
  const delayMs = holdMs || maxMs;
  useEffect(() => {
    if (delayMs <= 0) return;
    const timer = setTimeout(() => setTimedOutEntry(entry), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, entry]);

  return display;
}

// ---------------------------------------------------------------------------
// Keyboard and game controller
// ---------------------------------------------------------------------------

interface LatestRefs {
  service: ClipServiceApi | null;
  snapshot: ClipSnapshot;
  ui: ClipUiController | null;
}

function useClipHotkeys(
  enabled: boolean,
  pressRef: React.RefObject<ClipPress | null>,
  latest: React.RefObject<LatestRefs>,
) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const press = forwardPress(() => pressRef.current);
    const onKeyDown = (event: KeyboardEvent) => {
      const action = matchClipHotkey(event);
      if (!action) return;
      const { snapshot, ui, service } = latest.current;
      if (!ui || !service || snapshot.button === "hidden" || snapshot.appId === null) return;
      // A text field or a focused control keeps its own keys.
      if (hotkeyBelongsToTarget(event)) return;
      // Keys belong to an open clip sheet, not the game or the button.
      if (ui.store.getState().sheet) return;
      // The shortcut is ours: the game must not also act on it. The games
      // match event.code and do not look at Alt, so Alt+R would also reset a
      // truck and Alt+C would switch a camera. This listener is in the
      // capture phase on the window, the first stop of the event, so
      // stopImmediatePropagation keeps it from every game listener.
      event.preventDefault();
      event.stopImmediatePropagation();
      // A held key repeats: only the first press acts. The repeats stop here too.
      if (event.repeat) return;
      if (action === "clip") press.tap("keyboard");
      else ui.toggleRecord();
    };
    return listenOnSameOriginWindows(window, onKeyDown);
  }, [enabled, pressRef, latest]);
}

function useClipGamepad(
  enabled: boolean,
  pressRef: React.RefObject<ClipPress | null>,
  latest: React.RefObject<LatestRefs>,
) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof navigator === "undefined") return;
    if (typeof navigator.getGamepads !== "function") return;
    const poller = createGamepadPoller({
      press: forwardPress(() => pressRef.current),
      // A press while a clip sheet is open would clip behind the sheet.
      enabled: () => !latest.current.ui?.store.getState().sheet,
      getGamepads: () => {
        try {
          return (navigator.getGamepads() ?? []) as unknown as ReadonlyArray<PadLike | null>;
        } catch {
          // A Permissions-Policy that blocks gamepads throws.
          return [];
        }
      },
      now: nowMs,
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    });
    const onConnected = () => poller.start();
    window.addEventListener("gamepadconnected", onConnected);
    // The poller stops by itself when no controller is left.
    poller.start();
    return () => {
      window.removeEventListener("gamepadconnected", onConnected);
      poller.stop();
    };
  }, [enabled, pressRef, latest]);
}

// ---------------------------------------------------------------------------
// The button
// ---------------------------------------------------------------------------

/** The pulse on a warming tap: one quick grow and back (the house easing). */
const PULSE_KEYFRAMES: Keyframe[] = [{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }];
const PULSE_TIMING: KeyframeAnimationOptions = { duration: 250, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

export function ClipButton({ keyboardShortcuts = true, gamepad = true }: ClipButtonProps) {
  const ui = useClipUi();
  const service = useClipService();
  const snapshot = useClipSnapshot();
  const uiState = useClipUiState();
  const reducedMotion = useSyncExternalStore(subscribeToReducedMotion, prefersReducedMotion, () => false);
  const apple = useSyncExternalStore(subscribeToNothing, () => isApplePlatform(), () => false);

  const latest = useRef<LatestRefs>({ service, snapshot, ui });
  useLayoutEffect(() => {
    latest.current = { service, snapshot, ui };
  });

  // The press machine lives as long as the button. It reads the newest
  // service, snapshot and controller through `latest`.
  const pressRef = useRef<ClipPress | null>(null);
  useEffect(() => {
    const press = createClipPress({
      service: () => latest.current.service,
      snapshot: () => latest.current.snapshot,
      onOutcome: (outcome) => latest.current.ui?.handleTapOutcome(outcome),
    });
    pressRef.current = press;
    return () => {
      press.dispose();
      if (pressRef.current === press) pressRef.current = null;
    };
  }, []);

  const look = useButtonLook(snapshot);
  const visible = ui !== null && service !== null && snapshot.button !== "hidden";

  useClipHotkeys(visible && keyboardShortcuts, pressRef, latest);
  const gamepadAllowed = gamepad && !(snapshot.appId !== null && NO_GAMEPAD_CLIP_APPS.has(snapshot.appId));
  useClipGamepad(visible && gamepadAllowed, pressRef, latest);

  // One pulse per warming tap. No motion with reduced motion.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pulse = uiState.pulse;
  // A pulse from before this button appeared is not played.
  const playedPulse = useRef(pulse);
  useEffect(() => {
    // Each pulse plays once: a later change of the motion setting does not replay it.
    if (pulse === playedPulse.current) return;
    playedPulse.current = pulse;
    if (reducedMotion) return;
    const element = buttonRef.current;
    if (element && typeof element.animate === "function") element.animate(PULSE_KEYFRAMES, PULSE_TIMING);
  }, [pulse, reducedMotion]);

  // Announce a result made after this button appeared.
  const result = snapshot.lastResult;
  const resultKey = result ? `${result.action}:${result.atMs}:${result.ok ? 1 : 0}` : null;
  const [firstResultKey] = useState(resultKey);
  const announcement = result && result.ok && resultKey !== firstResultKey ? RESULT_COPY[result.action] : "";

  const lastPointerAt = useRef(Number.NEGATIVE_INFINITY);
  /** The pointer of the press that is down, and whether the button had focus before it. */
  const activePointer = useRef<{ key: string; type: string; hadFocus: boolean } | null>(null);
  /** The presses that started on the button: only their events stop here. */
  const [owned] = useState(createPressOwnership);

  if (!visible) return null;

  const pointerKey = (event: React.PointerEvent) => `pointer:${event.pointerId}`;

  /**
   * After a pointer press, take away any focus the press gave the button
   * (some browsers focus a button on touch). Focus that the kid gave it
   * with the keyboard stays.
   */
  const dropPointerFocus = (element: HTMLButtonElement, hadFocus: boolean) => {
    if (!hadFocus && element.ownerDocument.activeElement === element) element.blur();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    owned.down(event.pointerId);
    lastPointerAt.current = nowMs();
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Every finger counts, the first one on the page or not. The press
    // machine refuses a second press while one is down on the button.
    const press = pressRef.current;
    const key = pointerKey(event);
    const hadFocus = event.currentTarget.ownerDocument.activeElement === event.currentTarget;
    if (!press || !press.down(key, event.clientX, event.clientY, "pointer")) return;
    activePointer.current = { key, type: event.pointerType, hadFocus };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // The pointer is already gone (a very fast tap).
    }
  };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    // A pointer that went down on the game passes over: the game still hears it.
    if (!owned.owns(event.pointerId)) return;
    event.stopPropagation();
    pressRef.current?.move(pointerKey(event), event.clientX, event.clientY);
  };
  const endPointer = (event: React.PointerEvent<HTMLButtonElement>, how: "up" | "cancel") => {
    // The release of a press that started on the game belongs to the game.
    // (The press machine still hears it: it acts only on its own press.)
    if (owned.end(event.pointerId)) {
      event.stopPropagation();
      lastPointerAt.current = nowMs();
    }
    const key = pointerKey(event);
    const pointer = activePointer.current;
    if (pointer?.key === key) {
      activePointer.current = null;
      dropPointerFocus(event.currentTarget, pointer.hadFocus);
    }
    // Drag off to cancel: a release far outside the button commits nothing.
    // The button keeps pointer capture, so it hears that release.
    if (how === "up" && !releasedOff(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)) {
      pressRef.current?.up(key);
    } else {
      pressRef.current?.cancel(key);
    }
  };
  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => endPointer(event, "up");
  const onPointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => endPointer(event, "cancel");
  const onPointerLeave = (event: React.PointerEvent<HTMLButtonElement>) => owned.leave(event.pointerId, event.pointerType);
  const onMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    owned.mouseDown();
    // A mouse or pen press must not focus the button (see above).
    event.preventDefault();
  };
  const onMouseUp = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (owned.mouseUp()) event.stopPropagation();
  };
  // A touch event always goes to the element where the touch started.
  const stopHere = (event: React.SyntheticEvent) => event.stopPropagation();
  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    // The compatibility click after a pointer press: that press already acted.
    if (nowMs() - lastPointerAt.current < COMPAT_CLICK_WINDOW_MS) return;
    // A click with no pointer: Enter, Space or a screen reader.
    pressRef.current?.tap("keyboard");
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    // A held Enter repeats the click. Only a new press may act.
    if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
  };
  const onContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    // A long press on a phone must not open the browser menu.
    event.preventDefault();
    const press = pressRef.current;
    if (!press) return;
    const pointer = activePointer.current;
    if (press.isActive()) {
      // A finger or pen that is down opens the menu through its own hold.
      if (!pointer || pointer.type !== "mouse") return;
      // A Mac Control-click is a mouse press AND a context menu: end the
      // press with no clip, and open the menu.
      activePointer.current = null;
      press.cancel(pointer.key);
    }
    press.openMenu(nowMs() - lastPointerAt.current < COMPAT_CLICK_WINDOW_MS ? "pointer" : "keyboard");
  };

  const busy = snapshot.button === "saving" || snapshot.button === "exporting";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="clip-button"
        data-state={snapshot.button}
        aria-label={BUTTON_NAMES[snapshot.button as Exclude<ClipButtonState, "hidden">]}
        aria-disabled={busy ? "true" : undefined}
        aria-haspopup="dialog"
        title={buttonTooltip(apple)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onTouchStart={stopHere}
        onTouchMove={stopHere}
        onTouchEnd={stopHere}
        onTouchCancel={stopHere}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        className="relative flex h-11 w-11 shrink-0 touch-none select-none items-center justify-center rounded-full text-white [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <ClipButtonFace look={look} reducedMotion={reducedMotion} />
      </button>
      <span role="status" aria-live="polite" className="sr-only" data-testid="clip-button-announcer">
        <span key={resultKey ?? "none"}>{announcement}</span>
      </span>
    </>
  );
}
