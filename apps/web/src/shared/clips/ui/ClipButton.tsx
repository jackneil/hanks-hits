"use client";

/**
 * The clip button (plan 11.1, 11.3): the 44 px control in GameShell's
 * header clipSlot. Mount it inside ClipUiProvider:
 *
 *   <GameShell clipSlot={<ClipButton />} ...>
 *
 * - A drawn glyph (a clapperboard), white on the dark header, with one look
 *   per state (buttonFace.ts). Motion follows prefers-reduced-motion.
 * - Tap semantics (pressGesture.ts): pointerdown calls beginPress, the
 *   release calls endPress; a hold of 500 ms opens the Capture menu and
 *   commits nothing. Each press acts once: the compatibility click after a
 *   pointer press is ignored, and a held Enter does not repeat.
 * - Keyboard: Enter or Space on the focused button. Alt+C (Option+C) and F8
 *   clip, Alt+R starts or stops a video, anywhere on the page while a
 *   clip-enabled game is on screen (hotkeys.ts). The context-menu key and a
 *   right-click open the Capture menu.
 * - Game controller: the Share or Capture button, or a 1 s hold of Back
 *   (gamepad.ts). Never in Retro Arcade.
 * - It renders nothing when there is no clip service, no ClipUiProvider,
 *   or the state is "hidden".
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type React from "react";

import { useClipService, useClipSnapshot } from "../service/context";
import type { ClipButtonState, ClipServiceApi, ClipSnapshot } from "../service/contract";
import { faceFor, LOOK_HOLD_MS, LOOK_MAX_MS, sameLook, type FaceLook } from "./buttonFace";
import { useClipUi, useClipUiState } from "./ClipUiProvider";
import { BUTTON_NAMES, BUTTON_TOOLTIP, RESULT_COPY } from "./copy";
import { createGamepadPoller, NO_GAMEPAD_CLIP_APPS, type PadLike } from "./gamepad";
import { CheckGlyph, ClipGlyph } from "./glyphs";
import { ignoreForHotkey, listenOnSameOriginWindows, matchClipHotkey } from "./hotkeys";
import { nowMs, prefersReducedMotion, subscribeToReducedMotion } from "./platform";
import { COMPAT_CLICK_WINDOW_MS, createClipPress, forwardPress, type ClipPress } from "./pressGesture";
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
      if (ignoreForHotkey(event)) return;
      // Keys belong to an open clip sheet, not the game or the button.
      if (ui.store.getState().sheet) return;
      event.preventDefault();
      if (action === "clip") press.tap("keyboard");
      else ui.toggleRecord();
    };
    return listenOnSameOriginWindows(window, onKeyDown);
  }, [enabled, pressRef, latest]);
}

function useClipGamepad(enabled: boolean, pressRef: React.RefObject<ClipPress | null>) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof navigator === "undefined") return;
    if (typeof navigator.getGamepads !== "function") return;
    const poller = createGamepadPoller({
      press: forwardPress(() => pressRef.current),
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
  }, [enabled, pressRef]);
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
  useClipGamepad(visible && gamepadAllowed, pressRef);

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

  if (!visible) return null;

  const pointerKey = (event: React.PointerEvent) => `pointer:${event.pointerId}`;

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    lastPointerAt.current = nowMs();
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // A second finger on the button is not a new press.
    if (event.pointerType === "touch" && !event.isPrimary) return;
    const press = pressRef.current;
    if (!press || !press.down(pointerKey(event), event.clientX, event.clientY, "pointer")) return;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // The pointer is already gone (a very fast tap).
    }
  };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    pressRef.current?.move(pointerKey(event), event.clientX, event.clientY);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    lastPointerAt.current = nowMs();
    pressRef.current?.up(pointerKey(event));
  };
  const onPointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    lastPointerAt.current = nowMs();
    pressRef.current?.cancel(pointerKey(event));
  };
  const onClick = () => {
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
    // A long press on a phone must not open the browser menu. A press that
    // is down already opens the Capture menu through its hold.
    event.preventDefault();
    const press = pressRef.current;
    if (!press || press.isActive()) return;
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
        title={BUTTON_TOOLTIP}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
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
