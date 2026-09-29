/**
 * The capture engine seam (plan 5).
 *
 * ClipService (the state machine, the tap rules, the button) talks to a
 * CaptureEngine only. engineHost.ts implements it for tiers W and W+
 * (WebCodecs in the encode worker, the io worker for files), and
 * engine/recorder/recorderEngine.ts for tiers M and V (rotating
 * MediaRecorders on the main thread, the io worker for files).
 * loadEngine.ts picks the engine from the capability probe. A device with
 * no tier gets no engine, and the clip button is hidden with the reason
 * "no-tier".
 *
 * Types only, plus the failure class. Nothing here touches the browser.
 */

import type { ClipMeta, ClipRecord, MomentMark, Tier } from "../protocol";
import type { GovernorLevel } from "../runtime/governor";
import type { ClipReasonCode } from "./contract";

/** A governor level, as the service sees it (type only: the governor lives in the capture runtime). */
export type GovernorLevelLike = Readonly<GovernorLevel>;

/** The game values the engine paints in the band (never a name, plan 10). */
export interface EngineGame {
  appId: string;
  gameName: string;
  emoji: string;
  score?: () => string | undefined;
}

/** Why the capture timeline is paused. Capture runs only while no reason is set. */
export type PauseReason = "hidden" | "break" | "rest" | "source" | "export" | "owner" | "other-tab";

/** What the engine tells the service. */
export type EngineEvent =
  /** The first encoder output of this arm (with the audio setup done): warming is over. */
  | { t: "output" }
  /** No encoder output 2.5 s after the first frame, on a device with a software encoder (plan 5.1). */
  | { t: "no-output" }
  /** A video encoder failure (never an AAC restart). fatal: the session cannot go on. */
  | { t: "encoder-error"; fatal: boolean }
  /** A new encoder epoch after a failure. */
  | { t: "recovered" }
  /** Seconds of footage in the ring (from the encoder stats). */
  /** Seconds in the ring, and the encoder's time to first frame (plan 15.2) once it is measured. */
  | { t: "buffered"; seconds: number; ttfcMs?: number | null }
  /**
   * Replay granularity (plan 5): a clip starts at most this many seconds
   * before the moment the kid asked for (at the keyframe before it). Tiers M
   * and V measure it from the keyframes of their segments; tiers W and W+
   * keep a keyframe every second and do not send this event.
   */
  | { t: "granularity"; seconds: number }
  /**
   * The engine switch (loadEngine.ts) moved the game to another engine: a
   * fresh probe at arm found this tier (a tier M or V device whose first
   * probe met a cold or busy video encoder, now tier W or W+). It comes
   * before the new engine's first arm; the old engine's measurements, such
   * as the replay granularity, no longer hold.
   */
  | { t: "tier"; tier: Tier }
  /** The governor moved. resting: capture stopped to protect the game. */
  | { t: "governor"; level: GovernorLevelLike; resting: boolean }
  /** A source was registered (present) or the last one went away. */
  | { t: "source"; present: boolean }
  /** A source cannot be read at all (for example a tainted canvas). */
  | { t: "source-error" }
  /**
   * The encoder session ended (disarm): the ring is gone, and the next arm
   * starts a new capture timeline at 0. Footage and timeline positions from
   * before (the last clip, moments) are no longer valid.
   */
  | { t: "reset" }
  /**
   * The engine stopped trying to capture on this device for this game:
   * - "no-encoder": a fresh probe found no encoder for the source (the
   *   device refused the settings that the first probe accepted);
   * - "failing": ARM_FAILURE_LIMIT arms in a row failed before any output.
   * The engine arms again only after the next setGame() or a new source.
   */
  | { t: "unavailable"; reason: "no-encoder" | "failing" };

export interface ClipRequest {
  seconds: number;
  /** Capture-timeline end (a press token froze it), or undefined for "now". */
  endAtUs?: number;
  /**
   * Capture-timeline time that the clip never starts before (the start of
   * the run, plan 11.4). When the keyframe at or before (end - seconds) is
   * earlier, the clip starts at the first keyframe at or after this time
   * instead, so it holds no footage from before it (a clip can then be up
   * to one keyframe gap shorter than asked). Undefined: no bound.
   */
  notBeforeUs?: number;
  meta: ClipMeta;
  /** The marks inside [startUs, endUs] of the clip, with offsets from its start. */
  moments?: (startUs: number, endUs: number) => MomentMark[];
  /** Progress of the save, 0..1 (the button's determinate ring). */
  onProgress?: (fraction: number) => void;
}

/** A stored clip and its span on the capture timeline. */
export interface MadeClip {
  record: ClipRecord;
  startUs: number;
  endUs: number;
}

export interface RecordingHandle {
  readonly recordingId: string;
  /** Stops the tee. Settles when every part is stored. */
  stop(): Promise<{ parts: Array<{ record: ClipRecord; startUs: number; endUs: number }>; failed: number }>;
}

export interface PrepareResult {
  tier: Tier;
  /** True when this engine can capture on this device. */
  supported: boolean;
}

export interface CaptureEngine {
  /** Probes the device (no encoder session is live then) and picks the tier. */
  prepare(): Promise<PrepareResult>;
  /** The game whose frames come next. A different app purges the ring first. */
  setGame(game: EngineGame | null): void;
  /** Registers a canvas. The first one arms the encoder. Returns the unregister function. */
  registerCanvas(canvas: HTMLCanvasElement, options?: { targetFps?: 30 | 60 }): () => void;
  /** Finds the largest drawn canvas under root and registers it. Returns the stop function. */
  autoDiscover(root: Element): () => void;
  setPaused(reason: PauseReason, paused: boolean): void;
  /** Flush and close the encoders (plan 7, 7.1). Send it after the pause that caused it. */
  closeEncoder(reason: "hidden" | "export"): void;
  /** Capture-timeline end of the newest frame sent to the encoder, in microseconds. */
  mediaEndUs(): number;
  /** Makes and stores a clip. startUs and endUs are its span on the capture timeline. */
  clip(request: ClipRequest): Promise<MadeClip>;
  picture(meta: ClipMeta): Promise<ClipRecord>;
  startRecording(meta: ClipMeta): Promise<RecordingHandle>;
  /** Drops the rings (owner change, a different game). */
  purge(): void;
  /**
   * The game went away, but its ring is kept for a while (plan 7: the same
   * game can come back). Flushes and closes the encoders and suspends the
   * audio tap, so no codec session and no game sound stay live. The next
   * registered source wakes the engine: the video encoder opens again on a
   * new epoch and the audio tap starts again.
   */
  park(): void;
  /** Leaves resting (the kid's "turn the clip button back on"). False when a power gate still holds. */
  wake(): boolean;
  /** The governor level to start at (the crash breaker starts one rung lower). */
  setStartLevel(level: number): void;
  /**
   * Closes the encoder session and frees the rings, but keeps the workers.
   * The engine then stays off: it does not arm again (no re-arm timer, no
   * arm for a source that is still registered) until the next setGame(),
   * registerCanvas() or autoDiscover().
   */
  disarm(): void;
  /** Everything off: workers, taps, sources. */
  dispose(): void;
  subscribe(listener: (event: EngineEvent) => void): () => void;
}

/** A failed engine action, with the reason code the UI turns into kid words. */
export class EngineFailure extends Error {
  constructor(
    readonly reason: ClipReasonCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineFailure";
  }
}
