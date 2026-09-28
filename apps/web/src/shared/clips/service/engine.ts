/**
 * The capture engine seam (plan 5).
 *
 * ClipService (the state machine, the tap rules, the button) talks to a
 * CaptureEngine only. engineHost.ts implements it for tiers W and W+
 * (WebCodecs in the encode worker, the io worker for files). A later PR adds
 * a MediaRecorder engine for tiers M and V behind this same interface. Until
 * then, tiers M and V get no engine, and the clip button is hidden with the
 * reason "no-tier".
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
  | { t: "buffered"; seconds: number }
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
  | { t: "reset" };

export interface ClipRequest {
  seconds: number;
  /** Capture-timeline end (a press token froze it), or undefined for "now". */
  endAtUs?: number;
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
  /** Leaves resting (the kid's "turn the clip button back on"). False when a power gate still holds. */
  wake(): boolean;
  /** The governor level to start at (the crash breaker starts one rung lower). */
  setStartLevel(level: number): void;
  /** Closes the encoder session and frees the rings, but keeps the workers. */
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
