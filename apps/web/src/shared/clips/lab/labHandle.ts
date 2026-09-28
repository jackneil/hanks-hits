/**
 * window.__clipsLab: the lab's hook for test drivers (plan 15.3).
 *
 * The Playwright spec (e2e/clips) and the iPhone driver
 * (scripts/clips/ios-device.mjs) read the lab through this object:
 * - status(): what the lab and the clip service show now;
 * - truth(): the ground truth of every beat (labSchedule.ts);
 * - readClipBase64(offset, length): the bytes of the last clip, in base64
 *   chunks. A driver cannot fetch() the blob URL, because the site's Content
 *   Security Policy (connect-src) does not allow blob:. A WebDriver session
 *   also limits the size of one script result, so the driver reads chunks;
 * - clip(), recordStart(), recordStop(): the same actions as the buttons,
 *   for a driver whose taps do not reach the page (plan 3a found this on
 *   some pages in WebDriver). Start has no such action: the sound starts
 *   only inside a real tap.
 *
 * The object exists only on the lab page, and the lab page exists only
 * when the server has CLIPS_LAB=1.
 */
import type { ClipRecord, Tier } from "../protocol";
import type { ClipActionResult, ClipButtonState, ClipReasonCode, EngineState } from "../service/contract";
import { readBlobBase64 } from "./labBytes";
import type { LabServiceState } from "./LabClipScope";
import type { BeatTruth } from "./labSchedule";

/** The last result of Clip it! or Record, for drivers. */
export interface LabLastClip {
  action: "clip" | "record";
  record: ClipRecord;
  /** The bytes of the stored file. */
  file: Blob;
  /** An object URL of `file`. */
  url: string;
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
  targetFps: 30 | 60;
  button: ClipButtonState;
  engine: EngineState;
  reason: ClipReasonCode | null;
  tier: Tier;
  bufferedSec: number;
  recording: boolean;
  busy: "clip" | "record" | null;
  /** Results so far (Clip it! and Record). It grows by 1 at each result. */
  results: number;
  lastClip: { action: "clip" | "record"; record: ClipRecord; bytes: number; url: string } | null;
  /** The reason of the last failed action, or null. */
  lastError: string | null;
}

export interface ClipsLabHandle {
  readonly version: 1;
  status(): LabStatus;
  truth(): BeatTruth[];
  readClipBase64(offset: number, length: number): Promise<string>;
  clip(): Promise<ClipActionResult | null>;
  recordStart(): Promise<ClipActionResult | null>;
  recordStop(): Promise<ClipActionResult | null>;
}

export interface LabHandleSource {
  status(): LabStatus;
  truth(): BeatTruth[];
  lastFile(): Blob | null;
  clip(): Promise<ClipActionResult | null>;
  recordStart(): Promise<ClipActionResult | null>;
  recordStop(): Promise<ClipActionResult | null>;
}

type LabWindow = { __clipsLab?: ClipsLabHandle };

/** Makes the driver hook from the lab's live state. */
export function createLabHandle(source: LabHandleSource): ClipsLabHandle {
  return Object.freeze({
    version: 1 as const,
    status: () => source.status(),
    truth: () => source.truth().map((beat) => ({ ...beat })),
    readClipBase64: async (offset: number, length: number) => {
      const file = source.lastFile();
      if (!file) throw new Error("the lab has no clip yet");
      return readBlobBase64(file, offset, length);
    },
    clip: () => source.clip(),
    recordStart: () => source.recordStart(),
    recordStop: () => source.recordStop(),
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
