/**
 * window.__clipsLab: the lab's hook for test drivers (plan 15.3).
 *
 * The Playwright spec (e2e/clips) and the iPhone driver
 * (scripts/clips/ios-device.mjs) read the lab through this object:
 * - status(): what the lab and the clip service show now;
 * - truth(): the ground truth of every beat (labSchedule.ts);
 * - readClipBase64(offset, length, part): the bytes of the last clip, in
 *   base64 chunks. `part` (0 by default) picks a part of a Record that the
 *   io worker stored in parts (labParts.ts). A driver cannot fetch() the
 *   blob URL, because the site's Content Security Policy (connect-src) does
 *   not allow blob:. A WebDriver session also limits the size of one script
 *   result, so the driver reads chunks;
 * - clip(), recordStart(), recordStop(), wake(): the same actions as the
 *   buttons, for a driver whose taps do not reach the page (plan 3a found
 *   this on some pages in WebDriver). Start has no such action: the sound
 *   starts only inside a real tap.
 *
 * The object exists only on the lab page, and the lab page exists only
 * when the server has CLIPS_LAB=1.
 */
import type { ClipRecord, Tier } from "../protocol";
import type { ClipActionResult, ClipButtonState, ClipReasonCode, EngineState } from "../service/contract";
import { readBlobBase64 } from "./labBytes";
import type { LabServiceState } from "./LabClipScope";
import type { BeatTruth } from "./labSchedule";

/** One stored file of a result: a clip, or one part of a Record. */
export interface LabPart {
  record: ClipRecord;
  /** The bytes of the stored file. */
  file: Blob;
}

/** The last result of Clip it! or Record, for drivers. */
export interface LabLastClip {
  action: "clip" | "record";
  /** The first (or only) file of the result. */
  record: ClipRecord;
  /** The bytes of the stored file. */
  file: Blob;
  /** An object URL of `file`. */
  url: string;
  /** performance.now() when the lab asked for the clip, or for the end of the video (page ms). The file ends there. */
  pressedAtMs: number;
  /**
   * Milliseconds from the press to the service's answer: the file is made and
   * stored (plan 15.2 "clip build"; for a Record, the last part after Stop).
   */
  builtMs: number;
  /** Every file of the result, oldest first; parts[0] is `record` and `file`. A clip has one part. */
  parts: LabPart[];
  /** Parts of a Record that the service could not store (0 when it does not say). */
  failedParts: number;
}

export interface LabStatus {
  service: LabServiceState;
  /** The lab game is attached to the service. */
  attached: boolean;
  picture: "2d" | "webgl2" | "none";
  running: boolean;
  /** The game-audio context state, or "none" before Start. */
  audio: string;
  beats: number;
  skippedBeats: number;
  displayHz: number;
  holdFrames: number;
  /** Seconds from one beat to the next at the display rate now (labSchedule.ts beatFrames). */
  beatIntervalSec: number;
  /** The stride of the lowest capture rung (display frames): one capture frame at that rung is the time resolution of a file. */
  maxStride: number;
  targetFps: 30 | 60;
  button: ClipButtonState;
  engine: EngineState;
  reason: ClipReasonCode | null;
  tier: Tier;
  bufferedSec: number;
  /** The encoder's time to first frame (plan 15.2 TTFC) in ms, or null until the service measured it. */
  ttfcMs: number | null;
  recording: boolean;
  busy: "clip" | "record" | null;
  /** Results so far (Clip it! and Record). It grows by 1 at each result. */
  results: number;
  lastClip: {
    action: "clip" | "record";
    record: ClipRecord;
    bytes: number;
    url: string;
    pressedAtMs: number;
    builtMs: number;
    /** The library row of each part, oldest first (parts[0] is `record`). */
    parts: ClipRecord[];
    failedParts: number;
  } | null;
  /** The reason of the last failed action, or null. */
  lastError: string | null;
}

export interface ClipsLabHandle {
  readonly version: 1;
  status(): LabStatus;
  truth(): BeatTruth[];
  /** Bytes of part `part` (default 0) of the last result, as base64. */
  readClipBase64(offset: number, length: number, part?: number): Promise<string>;
  clip(): Promise<ClipActionResult | null>;
  recordStart(): Promise<ClipActionResult | null>;
  recordStop(): Promise<ClipActionResult | null>;
  /** "Turn the clip button back on" after the governor rested capture. */
  wake(): void;
}

export interface LabHandleSource {
  status(): LabStatus;
  truth(): BeatTruth[];
  /** The file of part `part` of the last result, or null. */
  lastFile(part: number): Blob | null;
  clip(): Promise<ClipActionResult | null>;
  recordStart(): Promise<ClipActionResult | null>;
  recordStop(): Promise<ClipActionResult | null>;
  wake(): void;
}

type LabWindow = { __clipsLab?: ClipsLabHandle };

/** Makes the driver hook from the lab's live state. */
export function createLabHandle(source: LabHandleSource): ClipsLabHandle {
  return Object.freeze({
    version: 1 as const,
    status: () => source.status(),
    truth: () => source.truth().map((beat) => ({ ...beat })),
    readClipBase64: async (offset: number, length: number, part = 0) => {
      if (!Number.isInteger(part) || part < 0) throw new RangeError("part must be a whole number, 0 or more");
      const file = source.lastFile(part);
      if (!file) throw new Error(part === 0 ? "the lab has no clip yet" : `the last clip has no part ${part}`);
      return readBlobBase64(file, offset, length);
    },
    clip: () => source.clip(),
    recordStart: () => source.recordStart(),
    recordStop: () => source.recordStop(),
    wake: () => source.wake(),
  });
}

/** Puts `handle` on the window. Returns the remover, which takes off only this handle. */
export function installLabHandle(target: object, handle: ClipsLabHandle): () => void {
  const win = target as LabWindow;
  win.__clipsLab = handle;
  return () => {
    if (win.__clipsLab === handle) delete win.__clipsLab;
  };
}
