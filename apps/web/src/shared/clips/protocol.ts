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
  /** Int16 samples, interleaved L,R. The tap worklet posts a copy (it reuses its own buffer). */
  data: ArrayBuffer;
}

/**
 * Clock anchor for one audio stream, taken in one task on the main thread (plan 6.4).
 * Production time only: never getOutputTimestamp (Bluetooth latency would leak in).
 */
export interface ClockAnchor {
  t: "anchor";
  streamId: string;
  /**
   * performance.now() in the realm that read ctxTimeSec. The page time is
   * perfMs + timeOriginOffsetMs (0 when the page realm took the anchor).
   */
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
  /** Start teeing packets to the io worker. It gets RecordTeeMsg on the port. */
  | { t: "record"; on: true; recordingId: string; port: MessagePort }
  | { t: "record"; on: false; recordingId?: string }
  /**
   * Flush and close the encoders (plan 7, 7.1). "hidden" also closes the AAC
   * encoder, and no AAC encoder opens again until the next "timeline" live
   * or frame. Send the "timeline" pause first: the worker queue holds later
   * messages during the flush (at most FLUSH_TIMEOUT_MS per codec).
   */
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
  /**
   * Capture-timeline microseconds (plan 6.2). Audio: the time of the packet's
   * first decoded sample, with the -P priming shift already applied (plan 6.4).
   * Do not shift audio by primingSamples again.
   */
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
  /**
   * The color space the encoder reports in its decoderConfig (plan 5.1). Each
   * encoder family converts the RGB canvas with its own matrix and range, so
   * the muxer writes the colr box from this value. Absent when the encoder
   * reports none. Two epochs with different values never splice.
   */
  colorSpace?: VideoColorSpaceInit;
}

/** The packets and configs for one clip, handed to the io worker for muxing. */
export interface ClipPackets {
  requestId: string;
  video: PacketDTO[];
  audio: PacketDTO[];
  videoEpochs: EpochInfo[];
  /**
   * AAC AudioSpecificConfig, always rebuilt (WebKit 302253). null when the
   * clip has no audio packets: the session has no AAC encoder, or its encoder
   * had no packets for this span yet (loading or stalled). The clip then has
   * no game sounds.
   */
  audioConfig: { codec: "mp4a.40.2"; sampleRate: number; numberOfChannels: number; description: ArrayBuffer } | null;
  /**
   * Encoder delay P in samples (plan 6.4). The audio timestamps already carry
   * the -P shift, so the first packets start before startUs and the edit list
   * follows from the timestamps. P can change between the AAC streams of one
   * clip (a switch from native to WASM), so only the per-packet timestamps are
   * right. Use P for the sgpd/sbgp roll-group patch and diagnostics, never to
   * shift the timestamps again.
   */
  primingSamples: number;
  startUs: number;
  endUs: number;
  /** True when a different-avcC epoch forced the clip to start at the newest epoch. */
  cutToNewestEpoch: boolean;
  /** Real seconds covered (shown to the kid when shorter than requested). */
  coveredSec: number;
}

/**
 * Record tee (plan 8.3, 8.4): encode worker -> io worker, on the port from the
 * "record" command. One chunk per closed GOP, starting at a keyframe, with the
 * AAC packets made since the last chunk. "end" follows the last chunk.
 */
export type RecordTeeMsg =
  | { t: "chunk"; recordingId: string; packets: ClipPackets }
  | { t: "end"; recordingId: string; endUs: number };

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
  /** An AAC stream failed and restarted (gapless). Not a video failure: keep it out of the video breaker. */
  | "audio-encoder-error"
  | "audio-encoder-missing"
  | "out-of-memory"
  | "keyframe-starved";

// ---------------------------------------------------------------------------
// Tiers M and V: MediaRecorder segments (plan 5, 6.6)
// ---------------------------------------------------------------------------

/** The container of a tier M or V file. M: MP4 (H.264, AAC). V: WebM (VP8, Opus). */
export type SegmentContainer = "mp4" | "webm";

/**
 * One finished MediaRecorder segment: a whole file, with its own header and a
 * keyframe first. Rotating recorders make one segment every few seconds. A
 * segment holds video only: the game sound comes from one sound recorder
 * that does not restart (the "audioRun" command), so a hand-off never splices
 * the sound.
 */
export interface RecorderSegmentRef {
  blob: Blob;
  /**
   * Capture-timeline microseconds of the segment's first video packet. The
   * packet times in the file are measured from that packet.
   */
  startUs: number;
  /**
   * Use the packets whose capture time is in [fromUs, toUs). For the first
   * segment of a job, fromUs is a keyframe time (the clip starts at the last
   * keyframe at or before fromUs). Later segments start at their own first
   * packet (a keyframe), so two segments that overlap across a hand-off give
   * each frame once.
   */
  fromUs: number;
  toUs: number;
}

/** Segments to join into one file (a clip) or into Record parts. */
export interface SegmentJob {
  container: SegmentContainer;
  /** In capture-timeline order. Their windows do not overlap. */
  segments: RecorderSegmentRef[];
  /**
   * A JPEG of the game picture, for the poster when this device has no video
   * decoder for the clip (plan 8.1 tiles). Optional.
   */
  poster?: Blob;
  /**
   * The capture timeline (the engine session) of the segments. The io worker
   * adds the game sound of the same timeline from its sound runs ("audioRun").
   * Absent: the file has no sound.
   */
  timeline?: number;
}

/**
 * What the io worker found in one segment (the "index" command). Times are in
 * microseconds from the segment's first video packet.
 */
export interface SegmentIndex {
  container: SegmentContainer;
  /** The video codec string of the decoder config, for example "vp8" or "avc1.42e01f". */
  videoCodec: string;
  /**
   * The video decoder config (codec string, coded size, description bytes) as
   * one string. Two segments with equal keys can share one track (plan 6.6).
   */
  videoConfigKey: string;
  /** Presentation times of the keyframes, from the first video packet. */
  keyframesUs: number[];
  /**
   * Presentation times of every video packet, from the first one, in order.
   * The engine matches them to its paint times to find the capture time of
   * the segment's first frame (engine/recorder/anchor.ts).
   */
  packetTimesUs: number[];
  /** End of the last video packet. */
  durationUs: number;
  videoPackets: number;
  /** The first video packet (in decode order) is a keyframe. */
  firstIsKey: boolean;
}

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

/**
 * Row fields that the UI can change with the "update" command. The io worker sets
 * every other field when it stores the clip.
 */
export type ClipRecordPatch = Partial<Pick<ClipRecord, "kept" | "watched" | "moments" | "challengeScore" | "ownerKey">>;

/** The row fields that a producer gives. The io worker adds the bytes, the storage tier and the poster. */
export type ClipMeta = Omit<ClipRecord, "bytes" | "storage" | "posterDataUrl">;

/**
 * An optional request id on a command. The io worker copies it onto every event
 * that the command causes, so the main thread can match each answer to its
 * command. Events of the startup check have no rid. Without a rid, events come
 * back in command order, as before.
 */
export interface IoTag {
  rid?: number;
}

export type IoCmd = (
  | { t: "mux"; packets: ClipPackets; meta: ClipMeta }
  | { t: "read"; id: string }
  | { t: "delete"; id: string }
  | { t: "list"; ownerKey: string }
  /**
   * Bytes that the library uses (all owners: they share one device budget), the
   * budget, and the count of clips of this owner (plan 8.1 storage line).
   * Answer: "usage".
   */
  | { t: "usage"; ownerKey: string }
  /**
   * Stores a still picture (plan 11.4 "Take a picture"). The io worker sets mime
   * "image/png", hasAudio false and durationMs 0, and makes the poster. Answer:
   * "saved" or "error".
   */
  | { t: "picture"; png: ArrayBuffer; meta: ClipMeta }
  /**
   * Starts to receive a Record tee (plan 8.4) on `port`: RecordTeeMsg chunks from
   * the encode worker. The io worker keeps the chunks of one part in memory, and
   * also appends each chunk to a journal file in OPFS as it arrives, so a tab
   * that closes or crashes loses at most the open chunk (the next startup stores
   * the journal: the "recovered" event). A part ends at a different video config
   * (plan 6.6: one track is never written across two configs) or at the part size
   * limit (RECORD_PART_MAX_BYTES), and is then stored as its own "record" clip, so
   * no footage is dropped. Part 1 gets meta.id; part n gets meta.id + "-p" + n.
   * Answer: "recording" at once, then "saved" (or "error") for each part, then
   * "recorded" after the tee's "end".
   */
  | { t: "record"; recordingId: string; port: MessagePort; meta: ClipMeta }
  /**
   * Ends an open recording whose tee can no longer send "end" (the encode worker
   * stopped). The parts so far are stored, and the recording's "recorded" event
   * follows. A recording that is not open is ignored.
   */
  | { t: "recordEnd"; recordingId: string }
  /**
   * Changes fields of one row: Keep, watched, stars, the challenge score, or the owner
   * ("Which of these are yours?", plan 8.1). The io worker is the only writer of
   * library rows. It applies the change under the library lock, so a change cannot
   * race an eviction. A new ownerKey also moves the clip's file into the folder of the
   * new owner. An ownerKey change must go from "guest" or to "guest". Answer: "updated".
   */
  | { t: "update"; id: string; patch: ClipRecordPatch }
  /**
   * The memory class from the capability probe (plan 6.5). It sets the budget of the
   * in-memory tier (private windows). Until this command arrives, the worker uses the
   * "low" budget. No event answers this command.
   */
  | { t: "configure"; memoryClass: MemoryClass }
  /**
   * Tiers M and V (plan 5): reads one MediaRecorder segment and answers
   * "indexed" with its keyframes and decoder configs. Nothing is stored.
   */
  | { t: "index"; blob: Blob; container: SegmentContainer }
  /**
   * Tiers M and V: joins the segments into one clip file (MP4 for M, WebM for
   * V), then stores it with the write protocol (plan 8.1). Answer: "saved" or
   * "error".
   */
  | { t: "concat"; job: SegmentJob; meta: ClipMeta }
  /**
   * Tiers M and V Record (plan 8.4): opens a recording that gets its segments
   * one at a time ("segmentRecordAdd"). Each segment is also journaled in
   * OPFS, so a tab that closes or crashes keeps it (the next startup stores
   * it: the "recovered" event). The game sound of `timeline` goes into the
   * recording and its journal too. startUs: the capture time of the Record
   * tap (the recording starts at the last keyframe at or before it). poster:
   * a JPEG of the game picture at the tap. Answer: "recording".
   */
  | {
      t: "segmentRecord";
      recordingId: string;
      container: SegmentContainer;
      meta: ClipMeta;
      timeline: number;
      startUs: number;
      poster?: Blob;
    }
  /**
   * Adds the next segment to an open segment recording. The segments can come
   * in any order: the io worker sorts them by start at the end. poster: a
   * JPEG of the game picture near the segment's start, for the tile of a part
   * that starts with this segment. No answer; a failure comes at the end.
   */
  | { t: "segmentRecordAdd"; recordingId: string; segment: RecorderSegmentRef; poster?: Blob }
  /**
   * Ends a segment recording: its segments become record parts (a new part at
   * a different decoder config or at the part size limit, like the Record
   * tee). Answer: "saved" (or "error") for each part, then "recorded".
   */
  | { t: "segmentRecordEnd"; recordingId: string }
  /**
   * Tiers M and V game sound (plan 5, 6.3). One audio-only MediaRecorder on
   * the main thread records the game sound with no restart while capture runs
   * (a "run"), so the sound of a clip never has a splice at a video hand-off.
   * This command opens run `runId`: its bytes come in order with
   * "audioAppend", and the io worker reads the sound packets from them as
   * they arrive. The run's first packet is at capture time startUs.
   * keepSeconds: how much sound the io worker keeps (the ring length). A run
   * of a new timeline replaces the runs of older timelines. The io worker
   * runs the three sound commands at once, not in its command queue. No
   * event answers them.
   */
  | { t: "audioRun"; runId: number; timeline: number; container: SegmentContainer; startUs: number; keepSeconds: number }
  /** The next bytes of an open sound run (one MediaRecorder chunk). */
  | { t: "audioAppend"; runId: number; bytes: ArrayBuffer }
  /** The sound run has no more bytes (its recorder stopped). */
  | { t: "audioEnd"; runId: number }
) &
  IoTag;

/**
 * Events from the io worker. The worker runs commands one at a time, so events come
 * back in command order. An event that a command caused carries the command's rid.
 */
export type IoEvent = (
  | { t: "saved"; record: ClipRecord; muxMs: number }
  /** The answer to "index". */
  | { t: "indexed"; index: SegmentIndex }
  | { t: "usage"; bytes: number; budget: number; count: number }
  /** The io worker listens on the record port now. */
  | { t: "recording"; recordingId: string }
  /**
   * The tee sent "end" and every part is done. `parts` are the stored parts in
   * order, each with its span on the capture timeline (so star marks can go to
   * the right part). `failed` counts the parts that could not be stored (each
   * one also sent an "error" event).
   */
  | {
      t: "recorded";
      recordingId: string;
      parts: Array<{ record: ClipRecord; startUs: number; endUs: number }>;
      failed: number;
    }
  /**
   * The stored clip, for Share and Save. The File of an OPFS clip reads the stored
   * bytes directly, so it stops working (NotReadableError) after the clip is removed
   * or moves to another owner. On NotReadableError, send "read" again. A "not-found"
   * answer then means that the clip is gone.
   */
  | {
      t: "file";
      id: string;
      file: File;
      /** The clip's row, so the main thread can name the file (plan 12: <host-slug>-<game>-<yyyymmdd-hhmm>). */
      record: ClipRecord;
    }
  | { t: "list"; records: ClipRecord[] }
  | { t: "deleted"; id: string }
  | { t: "updated"; record: ClipRecord }
  /**
   * The library was over its budget, so watched, unkept "auto" clips were removed
   * (oldest first) to make space. The UI tells the kid what stays (plan 8.1). When a
   * save removed clips and then failed, this event comes before the "error" event.
   */
  | { t: "evicted"; kept: string[]; removed: string[] }
  /**
   * Startup check of files against rows (plan 8.1, 8.2). "missing" counts rows whose
   * bytes the browser removed; the library tells the kid about this one time.
   */
  | { t: "reconciled"; reindexed: number; missing: number; unreadable: number }
  /**
   * Record crash recovery (plan 8.4), at startup, after "reconciled": the
   * io worker stored the journaled parts of recordings that a tab left open
   * (it closed or crashed while it recorded). No rid. The UI says "We saved
   * your recording from last time!" to each record's owner.
   */
  | { t: "recovered"; records: ClipRecord[] }
  | {
      t: "error";
      /** "bad-command": the command was not valid (an unknown type or bad fields). */
      code: "quota" | "opfs-unavailable" | "verify-failed" | "mux-failed" | "not-found" | "bad-command";
      detail: string;
      /** The clip id of the command that failed, when the command had one. */
      id?: string;
    }
) &
  IoTag;
