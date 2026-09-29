/**
 * ClipService contract (plan 4.1, 7, 8, 11, 12).
 *
 * This file is the boundary between the clip engine (PR 2.4, service/) and
 * every clip surface (PR 2.5, ui/). The service implements ClipServiceApi.
 * The UI reads ClipSnapshot through useSyncExternalStore and calls the
 * actions. Neither side reaches past this file into the other.
 *
 * Rules:
 * - Types only. No runtime code except the constant tables.
 * - Nothing here reads window, document or navigator.
 * - Kid-facing words are NOT here. The UI owns all copy (plan 11.6).
 *   The service reports codes; the UI turns a code into kid words.
 */

import type { ClipKind, ClipRecord, MomentMark, RunPhase, Tier } from "../protocol";

// ---------------------------------------------------------------------------
// Engine state (plan 7, state diagram)
// ---------------------------------------------------------------------------

export type EngineState =
  | "idle"
  | "warming"
  | "bridged"
  | "buffering"
  | "recording"
  | "resting"
  | "suspended"
  | "exporting"
  | "source-lost"
  | "recovering"
  | "record-only"
  | "disabled";

/**
 * What the clip button shows (plan 11.3). The service derives it from the
 * engine state plus short-lived UI facts (saving, made, error).
 * "hidden" means no clip button: clips off, SSR, no clip-enabled module,
 * or the device has no capture tier at all.
 */
export type ClipButtonState =
  | "hidden"
  | "warming"
  | "ready"
  | "saving"
  | "made"
  | "recording"
  | "resting"
  | "suspended"
  | "source-lost"
  | "recovering"
  | "exporting"
  | "record-only"
  | "disabled"
  | "error";

/** Why the service is in a limited state. The UI maps each code to kid words. */
export type ClipReasonCode =
  | "warming" // less than the minimum footage in the ring
  | "flag-off" // CLIPS_MODE is off for this visitor
  | "no-tier" // the browser cannot encode video
  | "other-tab" // another tab holds the capture lock
  | "breaker" // crash-loop breaker (plan 7): "it crashed while recording"
  | "resting" // the governor rested capture to protect the game
  | "record-only" // device fallback: no instant clips, Record still works
  | "quota" // storage is full
  | "storage-unavailable" // OPFS and IndexedDB both failed
  | "encoder-error" // the encoder failed and is recovering
  | "mux-failed" // the file could not be made
  | "source-lost" // the game's picture went away (restart, level swap)
  | "hidden"; // tab hidden or game paused

// ---------------------------------------------------------------------------
// Snapshot (useSyncExternalStore)
// ---------------------------------------------------------------------------

export interface ClipSnapshot {
  /** Bumps on every change. Snapshots are immutable; compare by identity. */
  version: number;
  button: ClipButtonState;
  engine: EngineState;
  reason: ClipReasonCode | null;
  /** The attached module, or null when no clip-enabled game is on screen. */
  appId: string | null;
  tier: Tier;
  /** 0..1 fill of the warming ring (plan 11.3: fills over 3 s of footage). */
  warmProgress: number;
  /** 0..1 while a clip is being made, else null. */
  savingProgress: number | null;
  /** Seconds of footage in the ring right now (0 when not buffering). */
  bufferedSec: number;
  /**
   * Replay granularity (plan 5): a clip can start up to this many seconds
   * before the moment the kid asked for (it starts at a keyframe). Tiers M
   * and V measure it on the device, and the UI can show it. Absent: 1 s
   * (tiers W and W+ keep a keyframe every second), or not measured yet.
   */
  replayGranularitySec?: number;
  /**
   * Time to first encoded frame of the capture session (plan 15.2 TTFC), in
   * milliseconds: from the first frame given to the video encoder to its
   * first output. Absent until the encoder puts out a frame, and on engines
   * that do not measure it (tiers M and V).
   */
  ttfcMs?: number;
  /** True when the newest footage is from before the governor rested capture. */
  preRest: boolean;
  recording: {
    recordingId: string;
    startedAtMs: number;
    /** Seconds recorded so far, paused time removed. */
    elapsedSec: number;
    /** Star marks the kid added with the star button (plan 8.4). */
    stars: number;
  } | null;
  /**
   * The newest manual clip the kid has not watched. The "new clip" chip shows
   * while this is set (plan 11.1). Cleared by markWatched.
   */
  unwatchedClipId: string | null;
  /** The latest action result, for the in-play confirmation and toasts. */
  lastResult: ClipActionResult | null;
  /** Game control handed over by attach(). */
  gameCanPause: boolean;
  /** True between runs, on the start card and in the pause menu (a break, plan 11.1). */
  atBreak: boolean;
}

// ---------------------------------------------------------------------------
// Actions and results
// ---------------------------------------------------------------------------

export type ClipActionResult =
  | {
      ok: true;
      action: "clip" | "extend" | "record" | "picture";
      record: ClipRecord;
      atMs: number;
      /**
       * "record" only: every stored part of the recording, in order (record is
       * parts[0]). A long recording is stored in parts (the io worker's part
       * limit), so the UI can say how many videos it made, never silently.
       */
      parts?: readonly ClipRecord[];
      /** "record" only: parts that could not be stored (each also failed with a reason). */
      failedParts?: number;
    }
  | { ok: false; action: "clip" | "extend" | "record" | "picture"; reason: ClipReasonCode; atMs: number };

/**
 * Taken on pointerdown (plan 11.1). The ring bounds are frozen at the press,
 * so a slow press still clips the moment the kid meant.
 */
export interface PressToken {
  readonly pressId: string;
  readonly downAtMs: number;
  /** Capture-timeline end of the clip if this press commits. */
  readonly endAtUs: number;
}

export type PressOutcome =
  | { kind: "clip"; result: Promise<ClipActionResult> }
  | { kind: "extend"; result: Promise<ClipActionResult> }
  | { kind: "menu" } // a hold of 500 ms or more without movement: open the Capture menu, commit nothing
  /**
   * "cancelled": the browser cancelled a press held HOLD_FOR_MENU_MS or longer
   * (pointercancel), so it commits nothing. A cancelled SHORTER press is a tap
   * (plan 11.1: a tap always means "clip" during play): it clips from the
   * frozen ring end. The clip button uses touch-action: none and
   * -webkit-touch-callout: none, so the browser rarely cancels a press.
   */
  | { kind: "ignored"; reason: ClipReasonCode | "busy" | "cancelled" };

/** Plan 11.1 tap semantics. */
export const HOLD_FOR_MENU_MS = 500;
export const EXTEND_WINDOW_MS = 5000;
export const DEFAULT_CLIP_SECONDS = 30;
export const MIN_CLIP_SECONDS = 3;

export type ShareOutcome =
  | { kind: "shared" }
  | { kind: "cancelled" } // AbortError: "No problem. Your clip is safe in My Clips."
  | { kind: "retry" } // NotAllowedError: re-arm with "Tap Share one more time."
  | { kind: "ignored" } // InvalidStateError (double tap)
  | { kind: "fallback-save" } // the type was rejected: offer Save to phone/computer
  | { kind: "blocked" } // Screen Time or Family Link
  | { kind: "unsupported" };

export type SaveOutcome = { kind: "saved" } | { kind: "failed"; reason: "blocked" | "unknown" };

// ---------------------------------------------------------------------------
// Attaching a game (ClipProvider -> service)
// ---------------------------------------------------------------------------

export interface GameAttachment {
  appId: string;
  gameName: string;
  emoji: string;
  /** The game can pause (GameShell canPause / onPause). */
  canPause: boolean;
  /** Pause the game before a sheet opens or a share starts (plan 12). */
  pause?: () => void;
  resume?: () => void;
  /** Live score text for the HUD band. Read each captured frame; keep it cheap. */
  score?: () => string | undefined;
}

export interface AttachedGame {
  /** Register the game's canvas. Call after the game made its context (see sources/canvasSource). */
  registerCanvas(canvas: HTMLCanvasElement, options?: { targetFps?: 30 | 60 }): () => void;
  /** Find the largest drawn canvas under root (and same-origin iframes) and register it. */
  autoDiscover(root: Element): () => void;
  /** Steam Timeline run markers (plan 11.5). */
  runPhase(phase: RunPhase): void;
  /** A brag moment for highlights and filmstrip stars. */
  markMoment(mark: Omit<MomentMark, "offsetSec"> & { offsetSec?: number }): void;
  /** Start card, pause menu, game over: a break (plan 11.1). */
  setAtBreak(atBreak: boolean): void;
  detach(): void;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export interface ClipLibraryApi {
  list(filter?: { gameId?: string; kind?: ClipKind; kept?: boolean }): Promise<ClipRecord[]>;
  file(id: string): Promise<File>;
  setKept(id: string, kept: boolean): Promise<void>;
  markWatched(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Bytes used and the budget (plan 8.1 storage line). */
  usage(): Promise<{ bytes: number; budget: number; count: number }>;
  /** Subscribe to library changes from any tab (BroadcastChannel "hh-clips"). */
  subscribe(listener: () => void): () => void;
  /**
   * Record videos that were saved from a tab that closed or crashed while it
   * recorded (plan 8.4 crash recovery), for the current player. Each one is
   * returned once, so the UI says "We saved your recording from last time!"
   * one time. subscribe() listeners hear when new ones arrive.
   */
  takeRecovered?(): Promise<ClipRecord[]>;
}

/**
 * subscribe, getSnapshot and getServerSnapshot are called WITHOUT a receiver
 * (useSyncExternalStore), so the implementation binds them (arrow properties).
 * getSnapshot returns the same object until something changes.
 */
export interface ClipServiceApi {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ClipSnapshot;
  /** The same frozen snapshot for SSR and the first client render. */
  getServerSnapshot(): ClipSnapshot;

  attach(game: GameAttachment): AttachedGame;

  /** Plan 11.1: call on pointerdown of the clip button. */
  beginPress(): PressToken | null;
  /** Plan 11.1: call on pointerup or cancel. moved = the pointer left the slop radius. */
  endPress(token: PressToken, info: { upAtMs: number; moved: boolean; cancelled?: boolean }): PressOutcome;

  /** Capture menu row "Clip the last 30 seconds" uses the press token's frozen end. */
  clipLast(seconds?: number, token?: PressToken): Promise<ClipActionResult>;
  startRecording(): Promise<ClipActionResult | null>;
  stopRecording(): Promise<ClipActionResult>;
  addStar(): void;
  takePicture(): Promise<ClipActionResult>;

  /** Clears unwatchedClipId when it matches. */
  markWatched(id: string): void;
  /** Turn capture back on after resting (Capture menu first row, plan 11.3). */
  wake(): void;

  /** Must run synchronously inside the tap (user activation, plan 12). */
  share(file: File): Promise<ShareOutcome>;
  saveToDevice(file: File): Promise<SaveOutcome>;
  /** <host-slug>-<game>-<yyyymmdd-hhmm>.<ext>, from the deployment's own origin (plan 12). */
  fileNameFor(record: ClipRecord): string;

  library: ClipLibraryApi;
}

/** The snapshot every server render and the first client render uses. */
export const HIDDEN_SNAPSHOT: ClipSnapshot = Object.freeze({
  version: 0,
  button: "hidden",
  engine: "idle",
  reason: null,
  appId: null,
  tier: "none",
  warmProgress: 0,
  savingProgress: null,
  bufferedSec: 0,
  preRest: false,
  recording: null,
  unwatchedClipId: null,
  lastResult: null,
  gameCanPause: false,
  atBreak: true,
}) as ClipSnapshot;
