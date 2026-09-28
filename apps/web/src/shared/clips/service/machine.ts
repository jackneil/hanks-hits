/**
 * The clip engine state machine (plan 7 diagram) and the clip button
 * derivation (plan 11.3). Pure: no timers, no browser APIs.
 *
 * transition() allows exactly the edges of the plan 7 diagram, plus the edges
 * that the diagram and the plan 7 text imply (IMPLIED_EDGES):
 * - IDLE -> DISABLED when the crash breaker already says "disabled" as a game
 *   attaches (the diagram draws the breaker only from RECOVERING).
 * - WARMING and BRIDGED -> RECOVERING on an encoder error. An encoder that
 *   fails before its first output (a config the device refuses, a worker
 *   that does not load) must count toward "4 failures in 60 s", so it
 *   reaches DISABLED and stops the re-arm loop.
 * - SUSPENDED, RESTING and RECORDING -> EXPORTING on export. Plan 7: the
 *   editor and "Make it longer" export while the game is paused, and a
 *   paused game is SUSPENDED. The live encoder must close first in every
 *   state that holds it, so a phone never needs three codec sessions.
 *   EXPORTING -> BUFFERING follows, and the service then applies the pause,
 *   the rest or the recording again.
 * Every other event in a state returns null: the service ignores it.
 */

import type { ClipButtonState, ClipReasonCode, EngineState } from "./contract";

export type MachineEvent =
  | "source-registered" // IDLE -> WARMING
  | "output-ok" // WARMING -> BUFFERING (output + calibration ok)
  | "no-output" // WARMING -> BRIDGED (no output 2.5 s after the first frame; Chromium)
  | "hardware-ready" // BRIDGED -> BUFFERING (new epoch)
  | "record" // BUFFERING -> RECORDING; RESTING -> RECORDING (low-power rung)
  | "stop" // RECORDING -> BUFFERING (not rested) or RESTING (the session was rested)
  | "governor-severe" // BUFFERING -> RESTING; RECORDING -> RESTING (keeps recording at low power)
  | "probe-passes" // RESTING -> BUFFERING
  | "suspend" // BUFFERING -> SUSPENDED (hidden, paused, start card)
  | "hidden" // RECORDING -> SUSPENDED (the recording is finalized)
  | "resume" // SUSPENDED -> BUFFERING (visible and playing)
  | "export" // BUFFERING, SUSPENDED, RESTING, RECORDING -> EXPORTING (the encoder is closed)
  | "export-done" // EXPORTING -> BUFFERING (new epoch)
  | "canvas-gone" // BUFFERING -> SOURCE_LOST; RECORDING -> SOURCE_LOST (the recording is finalized)
  | "re-registered" // SOURCE_LOST -> BUFFERING (within 1.5 s)
  | "grace-over" // SOURCE_LOST -> IDLE (the ring is kept 5 min, then purged)
  | "encoder-error" // BUFFERING, WARMING, BRIDGED -> RECOVERING; RECORDING -> RECOVERING (the recording is closed)
  | "recreated" // RECOVERING -> BUFFERING (new epoch)
  | "disable" // RECOVERING -> DISABLED (4 failures in 60 s, or the breaker)
  | "breaker" // IDLE -> DISABLED (the breaker said "disabled" at attach)
  | "device-fallback" // IDLE -> RECORD_ONLY
  | "owner-change"; // BUFFERING -> IDLE (purge rules)

export interface TransitionContext {
  /** For "stop": the session rested before or during the recording. */
  rested?: boolean;
}

type Edge = EngineState | ((ctx: TransitionContext) => EngineState);

/** The plan 7 diagram, edge by edge. */
export const TRANSITIONS: Readonly<Record<EngineState, Partial<Record<MachineEvent, Edge>>>> = Object.freeze({
  idle: { "source-registered": "warming", "device-fallback": "record-only", breaker: "disabled" },
  warming: { "output-ok": "buffering", "no-output": "bridged", "encoder-error": "recovering" },
  bridged: { "hardware-ready": "buffering", "encoder-error": "recovering" },
  buffering: {
    record: "recording",
    "governor-severe": "resting",
    suspend: "suspended",
    export: "exporting",
    "canvas-gone": "source-lost",
    "encoder-error": "recovering",
    "owner-change": "idle",
  },
  recording: {
    stop: (ctx: TransitionContext) => (ctx.rested ? "resting" : "buffering"),
    "governor-severe": "resting",
    hidden: "suspended",
    "encoder-error": "recovering",
    "canvas-gone": "source-lost",
    export: "exporting",
  },
  resting: { record: "recording", "probe-passes": "buffering", export: "exporting" },
  suspended: { resume: "buffering", export: "exporting" },
  exporting: { "export-done": "buffering" },
  "source-lost": { "re-registered": "buffering", "grace-over": "idle" },
  recovering: { recreated: "buffering", disable: "disabled" },
  "record-only": {},
  disabled: {},
});

/** The edges that the plan implies but the diagram does not draw (see the file comment). */
export const IMPLIED_EDGES: ReadonlyArray<readonly [EngineState, MachineEvent]> = Object.freeze([
  ["idle", "breaker"],
  ["warming", "encoder-error"],
  ["bridged", "encoder-error"],
  ["suspended", "export"],
  ["resting", "export"],
  ["recording", "export"],
] as const);

/** The next state, or null when the event is not an edge of the current state. */
export function transition(state: EngineState, event: MachineEvent, ctx: TransitionContext = {}): EngineState | null {
  const edge = TRANSITIONS[state][event];
  if (edge === undefined) return null;
  return typeof edge === "function" ? edge(ctx) : edge;
}

// ---------------------------------------------------------------------------
// Clip button (plan 11.3)
// ---------------------------------------------------------------------------

/** Footage the warming ring needs before a tap clips (plan 11.3: "fills over 3 s"). */
export const WARM_SECONDS = 3;
/** "Made" shows a check mark this long, then Ready (plan 11.3). */
export const MADE_MS = 1200;
/** "Error" shows an amber mark this long (plan 11.3). */
export const ERROR_MS = 3000;
/** Source lost: the button stays unchanged this long, then the ring empties (plan 11.3). */
export const SOURCE_LOST_GRACE_MS = 1500;
/** Recovering: the button stays unchanged this long, then shows as Warming (plan 11.3). */
export const RECOVERING_QUIET_MS = 3000;

export interface ButtonInput {
  attached: boolean;
  /** The tier has a capture engine. */
  supported: boolean;
  engine: EngineState;
  /** Why the engine is disabled: the breaker, or 4 encoder failures in 60 s. */
  disabledReason: "breaker" | "encoder-error" | null;
  otherTab: boolean;
  recording: boolean;
  saving: boolean;
  made: boolean;
  error: ClipReasonCode | null;
  /** Seconds of footage since the ring last started (warm-up), capped by the ring. */
  warmSec: number;
  /** IDLE after a source was lost (plan 11.3 "then the ring empties"). */
  lostSource: boolean;
  /** The button shown before a quiet period (source lost, recovering), or null after it. */
  held: ClipButtonState | null;
}

export interface ButtonOutput {
  button: ClipButtonState;
  reason: ClipReasonCode | null;
  warmProgress: number;
}

function warmOrReady(warmSec: number): ButtonOutput {
  const warmProgress = Math.max(0, Math.min(1, warmSec / WARM_SECONDS));
  return warmProgress >= 1
    ? { button: "ready", reason: null, warmProgress: 1 }
    : { button: "warming", reason: "warming", warmProgress };
}

/** The clip button for one moment (plan 11.3). */
export function deriveButton(input: ButtonInput): ButtonOutput {
  if (!input.attached) return { button: "hidden", reason: null, warmProgress: 0 };
  if (!input.supported) return { button: "hidden", reason: "no-tier", warmProgress: 0 };
  if (input.engine === "disabled") {
    return { button: "disabled", reason: input.disabledReason ?? "breaker", warmProgress: 0 };
  }
  if (input.recording) return { button: "recording", reason: null, warmProgress: 1 };
  if (input.otherTab) return { button: "suspended", reason: "other-tab", warmProgress: 0 };
  if (input.saving) return { button: "saving", reason: null, warmProgress: 1 };
  if (input.error) return { button: "error", reason: input.error, warmProgress: 0 };
  if (input.made) return { button: "made", reason: null, warmProgress: 1 };
  switch (input.engine) {
    case "idle":
      return input.lostSource
        ? { button: "source-lost", reason: "source-lost", warmProgress: 0 }
        : { button: "warming", reason: "warming", warmProgress: 0 };
    case "warming":
    case "bridged":
      return { button: "warming", reason: "warming", warmProgress: 0 };
    case "buffering":
      return warmOrReady(input.warmSec);
    case "recording":
      return { button: "recording", reason: null, warmProgress: 1 };
    case "resting":
      return { button: "resting", reason: "resting", warmProgress: 1 };
    case "suspended":
      return { button: "suspended", reason: "hidden", warmProgress: Math.min(1, input.warmSec / WARM_SECONDS) };
    case "exporting":
      return { button: "exporting", reason: null, warmProgress: 1 };
    case "source-lost":
      return input.held
        ? { button: input.held, reason: null, warmProgress: 1 }
        : { button: "source-lost", reason: "source-lost", warmProgress: 0 };
    case "recovering":
      return input.held
        ? { button: input.held, reason: null, warmProgress: 1 }
        : { button: "recovering", reason: "encoder-error", warmProgress: 0 };
    case "record-only":
      return { button: "record-only", reason: "record-only", warmProgress: 0 };
  }
}
