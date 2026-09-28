/**
 * Clips engine contract.
 *
 * This file is the single source of truth for the messages and records that pass
 * between the clip engine parts:
 *
 *   main thread (ClipService, sources, frame pump)
 *     -> encode worker (compositor, VideoEncoder, audio mixer, AAC, rings)
 *     -> io worker (mux, moov patch, OPFS library)
 *
 * Every part imports its types from here. Change this file first, then the parts.
 * Design: design/GAMEPLAY_CLIPS.html, sections 3a (measured decisions), 5, 6, 7, 8.
 */

// ---------------------------------------------------------------------------
// Capabilities and tiers
// ---------------------------------------------------------------------------

/** Device tier. See plan section 5. "none" means clips are not available. */
export type Tier = "W" | "W+" | "M" | "V" | "none";

/** The result of the capability probe. Feature detection only, never version parsing. */
export interface Capabilities {
  tier: Tier;
  /** VideoEncoder can encode H.264 on this device (probe-encoded, not only isConfigSupported). */
  videoEncoderH264: boolean;
  /** Levels that probe-encoded successfully, for example ["1f", "20", "28"]. */
  h264Levels: string[];
  /** A hardware encoder answered the prefer-hardware probe. */
  hardwareEncoder: boolean;
  /** Native AudioEncoder can encode AAC-LC at 48 kHz stereo. */
  audioEncoderAac: boolean;
  /** AudioData exists (absent on Safari before 26). */
  audioData: boolean;
  /** AudioDecoder exists (absent on iOS before 26). */
  audioDecoder: boolean;
  /** MediaRecorder accepts "video/mp4;codecs=avc1,mp4a.40.2". */
  mediaRecorderMp4: boolean;
  /** MediaRecorder accepts "video/webm;codecs=vp8,opus". */
  mediaRecorderWebm: boolean;
  /** WebGL2 with fenceSync and PIXEL_PACK_BUFFER (path E). */
  webgl2AsyncReadback: boolean;
  /** navigator.storage.getDirectory() and createSyncAccessHandle in a worker. */
  opfsSyncAccess: boolean;
  /** navigator.canShare({ files: [File(video/mp4)] }). */
  shareFiles: boolean;
  /** Estimated memory class (plan 6.5). */
  memoryClass: MemoryClass;
  /** Measured display refresh, snapped to a standard rate (plan 6.2). */
  displayHz: number;
}

/** Memory class drives ring length and export budgets (plan 6.5). */
export type MemoryClass = "low" | "mid" | "high";

// ---------------------------------------------------------------------------
// Sources and capture paths (plan 3a)
// ---------------------------------------------------------------------------

/**
 * How a frame is taken. Chosen per source from its context type (plan 3a):
 * - "P": 2D canvas. Capture the already-presented frame at the START of the next
 *   rAF dispatch, before the game draws. About 2-3 ms on an iPhone SE.
 * - "E": WebGL2. Async blit + PBO + fenceSync readback on the game's own context,
 *   after the game renders. About 0-1 ms. Frames arrive one or more frames later.
 * - "D": WebGL1 or anything else. new VideoFrame(canvas) after the game renders, in
 *   the same task. Cheap only when the GPU is lightly loaded (emulators). The
 *   governor watches its cost.
 */
export type CapturePath = "P" | "E" | "D";

/** The kind of source a game registers. */
export type SourceKind = "canvas" | "replay";

/** Game-supplied values painted into the band above the game picture. Never a name. */
export interface HudState {
  /** The game's display name, from metadata. */
  gameName: string;
  /** The game's emoji, from metadata. */
  emoji: string;
  /** Optional live score text, already formatted (for example "12,400"). */
  score?: string;
}

/** Run phase markers (Steam Timeline model, plan 11.5). */
export type RunPhase = "start" | "end";

/** A moment a game reports for highlights and filmstrip stars (plan 11.5). */
export interface MomentMark {
  kind: "new-best" | "win" | "level-clear" | "combo" | "custom";
  label: string;
  emoji: string;
  priority: "featured" | "standard";
  /** Seconds relative to now. Negative means the moment happened earlier. */
  offsetSec: number;
}

// ---------------------------------------------------------------------------
// Output presets and encoder configuration (plan 5.1)
// ---------------------------------------------------------------------------

export type Orientation = "tall" | "wide";

/** The fixed coded frame for a whole capture session. Width and height are even. */
export interface OutputPreset {
  width: number;
  height: number;
  /** Capture target: 30 or 60. The rung table in plan 6.2 derives the real rate. */
  targetFps: 30 | 60;
  orientation: Orientation;
}

/** Standard presets. The governor scales content inside the coded frame, never the frame. */
export const PRESETS: Record<Orientation, { width: number; height: number }> = {
  tall: { width: 720, height: 1280 },
  wide: { width: 1280, height: 720 },
};

/** Encoder settings chosen by the capability probe for a session. */
export interface VideoEncoderChoice {
  codec: string; // for example "avc1.64001f"
  width: number;
  height: number;
  bitrate: number;
  framerate: number;
  /** Always "quality" (plan 3a: WebKit "realtime" silently drops frames). */
  latencyMode: "quality";
  hardwareAcceleration: "prefer-hardware" | "no-preference";
}

export const AUDIO_SAMPLE_RATE = 48000;
export const AUDIO_CHANNELS = 2;
export const AUDIO_BITRATE = 128000;
/** Instant-replay granularity: a keyframe is requested at least this often. */
export const KEYFRAME_INTERVAL_US = 1_000_000;
/** Frames allowed in flight to the encode worker before new frames are dropped. */
export const MAX_FRAMES_IN_FLIGHT = 2;

// ---------------------------------------------------------------------------
// Main thread -> encode worker
// ---------------------------------------------------------------------------

/** A captured frame. Timestamps come from time slots, never from a counter (plan 6.2). */
export type FrameIn =
  | {
      t: "frame";
      /** Transferred. The worker closes it. */
      frame: VideoFrame;
      tsUs: number;
      durUs: number;
      hud: HudState;
    }
  | {
      t: "pixels";
      /** Transferred RGBA bytes, rows top-down (path E flips during the blit). */
      data: ArrayBuffer;
      width: number;
      height: number;
      tsUs: number;
      durUs: number;
      hud: HudState;
    };

/** Audio from one tap stream (the page bus or an iframe realm), Int16 interleaved stereo. */
export interface PcmBatch {
  t: "pcm";
  streamId: string;
  /** Sample-frame index of the first sample, in the stream's own clock. */
  firstFrame: number;
  sampleRate: number;
  /** Transferred Int16Array buffer, interleaved L,R. */
  data: ArrayBuffer;
}

/**
 * Clock anchor for one audio stream, taken in one task on the main thread (plan 6.4).
 * Production time only: never getOutputTimestamp (Bluetooth latency would leak in).
 */
export interface ClockAnchor {
  t: "anchor";
  streamId: string;
  /** performance.now() in the page realm. */
  perfMs: number;
  /** The stream's AudioContext.currentTime at the same moment. */
  ctxTimeSec: number;
  /** performance.timeOrigin of the stream's realm minus the page's, for iframe realms. */
  timeOriginOffsetMs: number;
  state: "running" | "suspended" | "interrupted" | "closed";
}

/** Commands to the encode worker. */
export type EncodeCmd =
  | {
      t: "arm";
      caps: Capabilities;
      video: VideoEncoderChoice;
      preset: OutputPreset;
      /** Seconds of rolling history to keep (60 by default; 30 on the low memory class). */
      ringSeconds: number;
      /** Port that receives PcmBatch messages directly from the tap worklet. */
      audioPort?: MessagePort;
      /** Priming calibration override in samples (tests); otherwise measured. */
      primingSamples?: number;
      /**
       * The deployment's own host (for example "hankshits.com"), painted small in the
       * band. From location.host, never a literal, so clones brand themselves. Never
       * the site name, which can contain an owner's first name (plan section 10).
       */
      brandHost: string;
    }
  | FrameIn
  | ClockAnchor
  | { t: "timeline"; state: "live" | "paused"; atPerfMs: number }
  | { t: "clip"; requestId: string; seconds: number; endAtUs?: number }
  | { t: "record"; on: boolean; recordingId?: string }
  | { t: "closeEncoder"; reason: "export" | "hidden" }
  | { t: "purge" }
  | { t: "disarm" };

// ---------------------------------------------------------------------------
// Encode worker -> main thread
// ---------------------------------------------------------------------------

/** One encoded packet, copied out of the encoder output (plan 6.5). */
export interface PacketDTO {
  kind: "video" | "audio";
  type: "key" | "delta";
  tsUs: number;
  durUs: number;
  /** Transferred bytes. */
  data: ArrayBuffer;
  /** Encoder session. Different epochs may have different avcC (plan 6.6). */
  epoch: number;
}

/** Decoder configs per epoch, kept while any packet of that epoch is in a ring. */
export interface EpochInfo {
  epoch: number;
  codec: string;
  codedWidth: number;
  codedHeight: number;
  /** avcC bytes (video). */
  description: ArrayBuffer;
}

/** The packets and configs for one clip, handed to the io worker for muxing. */
export interface ClipPackets {
  requestId: string;
  video: PacketDTO[];
  audio: PacketDTO[];
  videoEpochs: EpochInfo[];
  /** AAC AudioSpecificConfig, always rebuilt (WebKit 302253). */
  audioConfig: { codec: "mp4a.40.2"; sampleRate: number; numberOfChannels: number; description: ArrayBuffer } | null;
  /** Encoder delay to signal with an edit list plus sgpd/sbgp roll groups (plan 6.4). */
  primingSamples: number;
  startUs: number;
  endUs: number;
  /** True when a different-avcC epoch forced the clip to start at the newest epoch. */
  cutToNewestEpoch: boolean;
  /** Real seconds covered (shown to the kid when shorter than requested). */
  coveredSec: number;
}

export type EncodeEvent =
  | { t: "armed"; video: VideoEncoderChoice; primingSamples: number }
  | { t: "consumed" }
  | { t: "clipReady"; packets: ClipPackets }
  | { t: "stats"; stats: EngineStats }
  | { t: "epoch"; info: EpochInfo }
  | { t: "error"; code: EngineErrorCode; detail: string };

export interface EngineStats {
  framesIn: number;
  framesEncoded: number;
  framesDropped: number;
  outOfOrder: number;
  encodeQueueMax: number;
  ringSeconds: number;
  ringBytes: number;
  audioStreams: number;
  audioUnderrunMs: number;
  ttfcMs: number | null;
}

export type EngineErrorCode =
  | "config-unsupported"
  | "encoder-error"
  | "encoder-reclaimed"
  | "audio-encoder-missing"
  | "out-of-memory"
  | "keyframe-starved";

// ---------------------------------------------------------------------------
// Main thread -> io worker -> main thread
// ---------------------------------------------------------------------------

export type ClipKind = "clip" | "auto" | "record" | "picture";

/** A library row (IndexedDB). Media bytes live in OPFS (plan 8.1). */
export interface ClipRecord {
  id: string;
  ownerKey: string; // "guest" or "u_" + salted hash of the user id
  gameId: string;
  kind: ClipKind;
  createdAt: number;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  mime: "video/mp4" | "video/webm" | "image/png";
  bytes: number;
  kept: boolean;
  watched: boolean;
  /** Where the bytes are: an OPFS path, or "memory" in private windows. */
  storage: "opfs" | "idb" | "memory";
  /** Small poster JPEG as a data URL, for tiles and toasts. */
  posterDataUrl: string;
  moments: MomentMark[];
  /** Score for "Beat my score" challenges (plan 19, decision 14). */
  challengeScore?: number;
}

export type IoCmd =
  | { t: "mux"; packets: ClipPackets; meta: Omit<ClipRecord, "bytes" | "storage" | "posterDataUrl"> }
  | { t: "read"; id: string }
  | { t: "delete"; id: string }
  | { t: "list"; ownerKey: string };

export type IoEvent =
  | { t: "saved"; record: ClipRecord; muxMs: number }
  | { t: "file"; id: string; file: File }
  | { t: "list"; records: ClipRecord[] }
  | { t: "deleted"; id: string }
  | { t: "error"; code: "quota" | "opfs-unavailable" | "verify-failed" | "mux-failed"; detail: string };
