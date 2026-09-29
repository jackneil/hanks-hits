/**
 * The io worker's command loop (protocol IoCmd to IoEvent), without the worker glue,
 * so tests can run it with fakes.
 *
 * - Commands run one at a time, in the order they arrive. Events therefore come back
 *   in command order.
 * - A command with a rid gets the rid on every event it causes, so the main thread
 *   can match answers to commands (protocol IoTag). Startup check events have no rid.
 * - The first command opens the library and runs the startup reconcile once.
 * - Every failure becomes an "error" event with a typed code. Nothing is thrown to
 *   the worker scope.
 * - Clips that a save removed are always reported ("evicted"), also when the save
 *   fails after the removal. The "evicted" event then comes before the "error".
 * - A "record" command attaches the Record tee port. Its chunks run on the same
 *   queue as the commands (recorder.ts). While the recording is open, the
 *   handler holds its Web Lock, and each part is journaled in OPFS
 *   (recordJournal.ts).
 * - Tiers M and V (plan 5): "index" reads a MediaRecorder segment, "concat"
 *   joins segments into one clip (concat.ts), and "segmentRecord",
 *   "segmentRecordAdd" and "segmentRecordEnd" make Record parts from
 *   segments, with a segment journal in OPFS (segmentRecording.ts). The
 *   joined file goes through the same write protocol as a muxed clip.
 * - Tiers M and V game sound: "audioRun", "audioAppend" and "audioEnd" feed
 *   the sound store (soundStore.ts). They run at once, not in the queue:
 *   the store must read the newest sound while a join waits for it, and a
 *   join can be long.
 * - After the first library open, the journals that dead tabs left are stored
 *   as record clips (plan 8.4 crash recovery), in their own queue task, and
 *   one "recovered" event lists the stored rows.
 */

import type { ClipMeta, ClipPackets, ClipRecord, EpochInfo, IoCmd, IoEvent, MemoryClass, PacketDTO, SegmentJob } from "../../protocol";
import { InvalidInputError, LibraryError, errorText } from "../../library/errors";
import type { StorageLike } from "../../library/fsTypes";
import { ClipLibrary, type LibraryEnv } from "../../library/opfsStore";
import { isClipId, isOwnerKey } from "../../library/ownerKey";
import { ConcatError, concatSegments, indexSegment, type SoundSource } from "./concat";
import { MoovPatchError, addAacRollGroups } from "./moovPatch";
import { MuxError, muxClip } from "./mux";
import { PLACEHOLDER_POSTER, makePoster, makePosterFromImage } from "./poster";
import { PartJournal, holdRecordingLock, recoverJournals, type JournalEnv, type JournalLocks } from "./recordJournal";
import { RECORD_ID_MAX_LENGTH, RECORD_PART_MAX_BYTES, Recording } from "./recorder";
import {
  RECORD_SOUND_WAIT_MS,
  SegmentJournal,
  SegmentRecording,
  isSegmentRef,
  recoverSegmentJournals,
  type SegmentRecordingHost,
  type StoredPart,
} from "./segmentRecording";
import { SoundStore } from "./soundStore";

/**
 * How long a clip waits for the game sound up to its end. The main thread
 * asks the sound recorder for its newest bytes just before the clip, so the
 * wait is one message and one read; after it, the clip is stored with the
 * sound it has (the sound ends early, the video is whole).
 */
export const CLIP_SOUND_WAIT_MS = 2000;

type IoErrorEvent = Extract<IoEvent, { t: "error" }>;
type Post = (event: IoEvent) => void;

/** The parts of the library that the handler uses. ClipLibrary fits it. */
export type IoLibrary = Pick<
  ClipLibrary,
  "save" | "read" | "remove" | "list" | "reconcile" | "update" | "setMemoryClass" | "budget"
>;

export interface IoHandlerEnv {
  post(event: IoEvent): void;
  openLibrary?: () => Promise<IoLibrary>;
  libraryEnv?: LibraryEnv;
  mux?: typeof muxClip;
  /** Tiers M and V: joins MediaRecorder segments. Default: concatSegments. */
  concat?: typeof concatSegments;
  /** Tiers M and V: reads a segment's keyframes and configs. Default: indexSegment. */
  index?: typeof indexSegment;
  patch?: typeof addAacRollGroups;
  poster?: typeof makePoster;
  /** Poster of a picture. Default: makePosterFromImage. */
  picturePoster?: (png: Blob) => Promise<string>;
  /**
   * OPFS and Web Locks for the Record journal (plan 8.4). Default: the
   * worker's navigator.storage and navigator.locks. null: no journal.
   */
  journal?: JournalEnv | null;
  now?: () => number;
  /** Timers for the sound waits. Default: the global ones. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  log?: (message: string) => void;
}

/** The worker's own OPFS and Web Locks, or null where there are none. */
function defaultJournalEnv(): JournalEnv | null {
  const nav = (globalThis as unknown as { navigator?: { storage?: StorageLike; locks?: JournalLocks } }).navigator;
  const storage = nav?.storage && typeof nav.storage.getDirectory === "function" ? nav.storage : null;
  if (!storage) return null;
  const locks = nav?.locks && typeof nav.locks.request === "function" ? nav.locks : null;
  return { storage, locks, log: (message) => console.warn(message) };
}

export interface IoHandler {
  /**
   * Opens the library and runs the startup check now, before any command. The
   * worker entry calls it at load. Without it, the first command does the same.
   */
  start(): Promise<void>;
  /** Queues a command. The returned promise settles when the command is done. */
  handle(cmd: IoCmd): Promise<void>;
  /** Settles when every queued command is done. */
  idle(): Promise<void>;
}

const MEMORY_CLASSES: ReadonlySet<MemoryClass> = new Set(["low", "mid", "high"]);

function errorEvent(code: IoErrorEvent["code"], detail: string, id?: string): IoErrorEvent {
  return id === undefined ? { t: "error", code, detail } : { t: "error", code, detail, id };
}

function libraryErrorEvent(error: unknown, fallback: IoErrorEvent["code"], id?: string): IoErrorEvent {
  if (error instanceof LibraryError) return errorEvent(error.code, error.message, id);
  if (error instanceof InvalidInputError) return errorEvent("bad-command", error.message, id);
  return errorEvent(fallback, errorText(error), id);
}

/**
 * The video length that the encode worker described for the clip. It comes from the
 * clip bounds, not from the muxer, so the save check compares two independent
 * values: a lost packet or a short mux shows as a difference.
 */
export function describedVideoSec(packets: Pick<ClipPackets, "startUs" | "endUs">): number | null {
  const sec = (packets.endUs - packets.startUs) / 1e6;
  return Number.isFinite(sec) && sec > 0 ? sec : null;
}

/** What the steps after the mux need. The mux result and the packets are not kept. */
interface Muxed {
  bytes: Uint8Array;
  hasAudio: boolean;
  firstKey: PacketDTO;
  epoch: EpochInfo;
}

/** A port as the handler uses it: a MessagePort, or a test double. */
interface PortLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  close?: () => void;
}

function isPort(value: unknown): value is PortLike {
  return typeof value === "object" && value !== null && "onmessage" in value;
}

interface OpenRecording {
  recording: Recording;
  port: PortLike;
  /** The recording's Web Lock (recordJournal.ts), or null with no journal. */
  lock: Promise<{ release(): void }> | null;
}

/** A tier M or V recording (segmentRecording.ts), fed by commands instead of a port. */
interface OpenSegmentRecording {
  recording: SegmentRecording;
  /** The recording's events go with the rid of its "segmentRecord" command. */
  post: Post;
  lock: Promise<{ release(): void }> | null;
}

export function createIoHandler(env: IoHandlerEnv): IoHandler {
  const now = env.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const mux = env.mux ?? muxClip;
  const concat = env.concat ?? concatSegments;
  const index = env.index ?? indexSegment;
  const patch = env.patch ?? addAacRollGroups;
  const poster = env.poster ?? makePoster;
  const picturePoster = env.picturePoster ?? ((png: Blob) => makePosterFromImage(png));
  let library: Promise<IoLibrary> | null = null;
  let memoryClass: MemoryClass | null = null;
  let queue: Promise<void> = Promise.resolve();
  const recordings = new Map<string, OpenRecording>();
  const segmentRecordings = new Map<string, OpenSegmentRecording>();
  const journalEnv = env.journal === undefined ? defaultJournalEnv() : env.journal;
  let recoveryQueued = false;
  const setTimer = env.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = env.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const sound = new SoundStore({
    log: env.log ?? ((m) => console.warn(m)),
    setTimeout: setTimer,
    clearTimeout: clearTimer,
  });

  const getLibrary = (): Promise<IoLibrary> => {
    if (!library) {
      library = (async () => {
        const lib = env.openLibrary ? await env.openLibrary() : await ClipLibrary.open(env.libraryEnv);
        if (memoryClass) lib.setMemoryClass(memoryClass);
        try {
          const result = await lib.reconcile();
          env.post({ t: "reconciled", reindexed: result.reindexed, missing: result.missing, unreadable: result.unreadable });
        } catch (error) {
          env.post(errorEvent("opfs-unavailable", `startup check failed: ${errorText(error)}`));
        }
        // Record crash recovery runs once, as its own queue task after this one
        // (it stores clips, which needs this library to be open).
        if (!recoveryQueued && journalEnv) {
          recoveryQueued = true;
          void enqueue(recoverRecordings);
        }
        return lib;
      })();
      // A failed open is tried again by the next command, not cached.
      library.catch(() => {
        library = null;
      });
    }
    return library;
  };

  /**
   * Muxes and patches the clip. Only the finished bytes, the first keyframe and its
   * config leave this function: the mux output copy and every other packet buffer
   * can be freed before the save (plan 6.5 memory budgets).
   */
  const muxAndPatch = async (packets: ClipPackets): Promise<Muxed> => {
    const muxed = await mux(packets);
    const bytes = muxed.hasAudio ? patch(muxed.bytes).bytes : muxed.bytes;
    return { bytes, hasAudio: muxed.hasAudio, firstKey: muxed.firstKey, epoch: muxed.epoch };
  };

  /** Stores finished bytes. Posts "evicted" (when the save removed clips), then "saved" or "error". */
  const store = async (
    bytes: Uint8Array,
    meta: Omit<ClipRecord, "storage" | "bytes">,
    expectedSec: number | null,
    muxMs: number,
    post: Post,
  ): Promise<ClipRecord | null> => {
    const lib = await getLibrary();
    try {
      const saved = await lib.save(bytes, meta, expectedSec);
      if (saved.eviction) post({ t: "evicted", kept: saved.eviction.kept, removed: saved.eviction.removed });
      post({ t: "saved", record: saved.record, muxMs });
      return saved.record;
    } catch (error) {
      if (error instanceof LibraryError && error.eviction) {
        post({ t: "evicted", kept: error.eviction.kept, removed: error.eviction.removed });
      }
      post(libraryErrorEvent(error, "opfs-unavailable", meta.id));
      return null;
    }
  };

  /** Muxes, patches and stores one clip. The packet lists are emptied as soon as the mux is done. */
  const muxAndStore = async (packets: ClipPackets, meta: ClipMeta, post: Post): Promise<ClipRecord | null> => {
    const expectedSec = describedVideoSec(packets);
    const started = now();
    let muxed: Muxed;
    try {
      muxed = await muxAndPatch(packets);
    } catch (error) {
      const code = error instanceof MuxError || error instanceof MoovPatchError ? error.code : "error";
      post(errorEvent("mux-failed", `${code}: ${errorText(error)}`, meta.id));
      return null;
    } finally {
      // The packet lists live until the command is done. Drop them so their
      // buffers can be freed now (the first keyframe stays for the poster).
      packets.video = [];
      packets.audio = [];
    }
    const muxMs = now() - started;
    const posterDataUrl = await poster(muxed.firstKey.data, muxed.epoch);
    // The library sets durationMs and hasAudio again from the stored file.
    return store(muxed.bytes, { ...meta, mime: "video/mp4", hasAudio: muxed.hasAudio, posterDataUrl }, expectedSec, muxMs, post);
  };

  /**
   * Tiers M and V: joins the segments, patches AAC in MP4, makes the poster
   * and stores the file (plan 8.1 write protocol). The expected length for
   * the save check comes from the packet plan, not from the written file, so
   * a short write shows as a difference.
   */
  const concatAndStore = async (job: SegmentJob, meta: ClipMeta, post: Post, withSound: SoundSource | null): Promise<StoredPart | null> => {
    const started = now();
    let joined: Awaited<ReturnType<typeof concatSegments>>;
    let bytes: Uint8Array;
    try {
      joined = await concat(job, withSound);
      bytes = joined.aacInMp4 ? patch(joined.bytes).bytes : joined.bytes;
    } catch (error) {
      const code = error instanceof ConcatError || error instanceof MoovPatchError ? error.code : "error";
      post(errorEvent("mux-failed", `${code}: ${errorText(error)}`, meta.id));
      return null;
    }
    const muxMs = now() - started;
    let posterDataUrl = await poster(joined.firstKey.data, joined.firstKey.config);
    // No video decoder here (common on tier V): use the game picture from the main thread.
    if (posterDataUrl === PLACEHOLDER_POSTER && job.poster instanceof Blob) posterDataUrl = await picturePoster(job.poster);
    const record = await store(bytes, { ...meta, mime: joined.mime, hasAudio: joined.hasAudio, posterDataUrl }, joined.videoSec, muxMs, post);
    return record ? { record, startUs: joined.startUs, endUs: joined.endUs } : null;
  };

  const validJob = (job: SegmentJob | undefined, id: string, post: Post): job is SegmentJob => {
    if (!job || (job.container !== "mp4" && job.container !== "webm") || !Array.isArray(job.segments) || !job.segments.every(isSegmentRef)) {
      post(errorEvent("bad-command", "the segment job is not valid", id));
      return false;
    }
    return true;
  };

  const runIndex = async (cmd: Extract<IoCmd, { t: "index" }>, post: Post): Promise<void> => {
    if (!(cmd.blob instanceof Blob) || (cmd.container !== "mp4" && cmd.container !== "webm")) {
      post(errorEvent("bad-command", "the index command has no segment"));
      return;
    }
    try {
      post({ t: "indexed", index: await index(cmd.blob, cmd.container) });
    } catch (error) {
      const code = error instanceof ConcatError ? error.code : "error";
      post(errorEvent("mux-failed", `${code}: ${errorText(error)}`));
    }
  };

  const runConcat = async (cmd: Extract<IoCmd, { t: "concat" }>, post: Post): Promise<void> => {
    if (!validMeta(cmd.meta, "mux-failed", post)) return;
    if (!validJob(cmd.job, cmd.meta.id, post)) return;
    const timeline = cmd.job.timeline;
    let withSound: SoundSource | null = null;
    if (typeof timeline === "number" && Number.isFinite(timeline)) {
      // The sound up to the clip's end can still be on its way from the main thread.
      const endUs = cmd.job.segments.reduce((most, s) => Math.max(most, s.toUs), -Infinity);
      await sound.ready(timeline, endUs, CLIP_SOUND_WAIT_MS);
      withSound = (fromUs, toUs) => sound.take(timeline, fromUs, toUs);
    }
    await concatAndStore(cmd.job, cmd.meta, post, withSound);
  };

  /** The segment recording's parts: joined with the recording's own sound. */
  const recordingHost = (): Omit<SegmentRecordingHost, "openJournal"> => ({
    storePart: (job, meta, partPost, partSound) => concatAndStore(job, meta, partPost, partSound),
    index: (blob, container) => index(blob, container),
    maxPartBytes: () => RECORD_PART_MAX_BYTES[memoryClass ?? "low"],
  });

  const runSegmentRecord = async (cmd: Extract<IoCmd, { t: "segmentRecord" }>, post: Post): Promise<void> => {
    if (!isClipId(cmd.recordingId)) {
      post(errorEvent("bad-command", `"${String(cmd.recordingId)}" is not a valid recording id`));
      return;
    }
    if (!validMeta(cmd.meta, "bad-command", post)) return;
    if (cmd.meta.id.length > RECORD_ID_MAX_LENGTH) {
      post(errorEvent("bad-command", `a recording id has at most ${RECORD_ID_MAX_LENGTH} characters`, cmd.meta.id));
      return;
    }
    if (cmd.container !== "mp4" && cmd.container !== "webm") {
      post(errorEvent("bad-command", "the recording has no segment container", cmd.meta.id));
      return;
    }
    const timeline = cmd.timeline;
    if (typeof timeline !== "number" || !Number.isFinite(timeline) || typeof cmd.startUs !== "number" || !Number.isFinite(cmd.startUs)) {
      post(errorEvent("bad-command", "the recording has no capture timeline", cmd.meta.id));
      return;
    }
    if (recordings.has(cmd.recordingId) || segmentRecordings.has(cmd.recordingId)) {
      post(errorEvent("bad-command", `recording "${cmd.recordingId}" is already open`, cmd.meta.id));
      return;
    }
    // The recording's lock marks its journal as live (never recovered by another tab).
    const lock = journalEnv ? holdRecordingLock(journalEnv.locks, cmd.recordingId) : null;
    const recording = new SegmentRecording(
      {
        ...recordingHost(),
        openJournal: async (journalMeta, poster) => {
          if (!journalEnv || !lock) return null;
          // The lock is held before the journal file exists.
          await lock;
          return SegmentJournal.open(journalEnv, journalMeta, poster);
        },
      },
      {
        recordingId: cmd.recordingId,
        container: cmd.container,
        meta: { ...cmd.meta, kind: "record" },
        tapUs: cmd.startUs,
        poster: cmd.poster instanceof Blob ? cmd.poster : null,
        post,
        sound: {
          held: () => sound.held(timeline),
          subscribe: (listener) =>
            sound.subscribe((packetTimeline, packet) => {
              if (packetTimeline === timeline) listener(packet);
            }),
          ready: (untilUs) => sound.ready(timeline, untilUs, RECORD_SOUND_WAIT_MS),
        },
      },
    );
    segmentRecordings.set(cmd.recordingId, { recording, post, lock });
    await recording.start();
    post({ t: "recording", recordingId: cmd.recordingId });
  };

  const runSegmentRecordAdd = async (cmd: Extract<IoCmd, { t: "segmentRecordAdd" }>, post: Post): Promise<void> => {
    const open = segmentRecordings.get(cmd.recordingId);
    if (!open) {
      post(errorEvent("bad-command", `recording "${String(cmd.recordingId)}" is not open`));
      return;
    }
    // A segment that fails is reported with the recording's own rid.
    await open.recording.add(cmd.segment, cmd.poster instanceof Blob ? cmd.poster : null);
  };

  const runSegmentRecordEnd = async (cmd: Extract<IoCmd, { t: "segmentRecordEnd" }>, post: Post): Promise<void> => {
    const open = segmentRecordings.get(cmd.recordingId);
    if (!open) {
      post(errorEvent("bad-command", `recording "${String(cmd.recordingId)}" is not open`));
      return;
    }
    segmentRecordings.delete(cmd.recordingId);
    try {
      // The parts and "recorded" answer the recording's "segmentRecord" command.
      await open.recording.end();
    } finally {
      // Every part is stored (or reported) and the journal is removed: the lock can go.
      void open.lock?.then((held) => held.release());
    }
  };

  /** Checks the id and owner of a producer's row. Posts the error and returns false when one is bad. */
  const validMeta = (meta: ClipMeta | undefined, code: IoErrorEvent["code"], post: Post): meta is ClipMeta => {
    const id = meta?.id;
    if (!isClipId(id)) {
      post(errorEvent(code, `"${String(id)}" is not a valid clip id`));
      return false;
    }
    if (!isOwnerKey(meta?.ownerKey)) {
      post(errorEvent(code, `"${String(meta?.ownerKey)}" is not a valid owner key`, id));
      return false;
    }
    return true;
  };

  const runMux = async (cmd: Extract<IoCmd, { t: "mux" }>, post: Post): Promise<void> => {
    if (!validMeta(cmd.meta, "mux-failed", post)) return;
    const packets = cmd.packets as ClipPackets | undefined;
    if (!packets || !Array.isArray(packets.video) || !Array.isArray(packets.audio)) {
      post(errorEvent("bad-command", "the mux command has no packet lists", cmd.meta.id));
      return;
    }
    await muxAndStore(packets, cmd.meta, post);
  };

  const runPicture = async (cmd: Extract<IoCmd, { t: "picture" }>, post: Post): Promise<void> => {
    if (!validMeta(cmd.meta, "bad-command", post)) return;
    if (!(cmd.png instanceof ArrayBuffer) || cmd.png.byteLength === 0) {
      post(errorEvent("bad-command", "the picture command has no PNG bytes", cmd.meta.id));
      return;
    }
    const bytes = new Uint8Array(cmd.png);
    const posterDataUrl = await picturePoster(new Blob([bytes], { type: "image/png" }));
    await store(
      bytes,
      { ...cmd.meta, mime: "image/png", hasAudio: false, durationMs: 0, posterDataUrl },
      null,
      0,
      post,
    );
  };

  const runRecord = (cmd: Extract<IoCmd, { t: "record" }>, post: Post): void => {
    if (!isClipId(cmd.recordingId)) {
      post(errorEvent("bad-command", `"${String(cmd.recordingId)}" is not a valid recording id`));
      return;
    }
    if (!validMeta(cmd.meta, "bad-command", post)) return;
    if (cmd.meta.id.length > RECORD_ID_MAX_LENGTH) {
      post(errorEvent("bad-command", `a recording id has at most ${RECORD_ID_MAX_LENGTH} characters`, cmd.meta.id));
      return;
    }
    const port = cmd.port as unknown;
    if (!isPort(port)) {
      post(errorEvent("bad-command", "the record command has no port", cmd.meta.id));
      return;
    }
    if (recordings.has(cmd.recordingId)) {
      post(errorEvent("bad-command", `recording "${cmd.recordingId}" is already open`, cmd.meta.id));
      return;
    }
    // The recording's lock marks its journals as live (never recovered by another tab).
    const lock = journalEnv ? holdRecordingLock(journalEnv.locks, cmd.recordingId) : null;
    const recording = new Recording(
      {
        storePart: (packets, meta, partPost) => muxAndStore(packets, meta, partPost),
        maxPartBytes: () => RECORD_PART_MAX_BYTES[memoryClass ?? "low"],
        openJournal: async (journalMeta) => {
          if (!journalEnv || !lock) return null;
          // The lock is held before the journal file exists.
          await lock;
          return PartJournal.open(journalEnv, journalMeta);
        },
      },
      cmd.recordingId,
      { ...cmd.meta, kind: "record" },
      post,
    );
    const open: OpenRecording = { recording, port, lock };
    recordings.set(cmd.recordingId, open);
    port.onmessage = (event) => {
      void enqueue(() => feedRecording(open, event.data));
    };
    post({ t: "recording", recordingId: cmd.recordingId });
  };

  /** Hands one tee message to a recording, and lets go of its port (and its lock) when it is finished. */
  const feedRecording = async (open: OpenRecording, message: unknown): Promise<void> => {
    await open.recording.handle(message);
    if (open.recording.finished && recordings.get(open.recording.recordingId) === open) {
      recordings.delete(open.recording.recordingId);
      open.port.onmessage = null;
      open.port.close?.();
      // Every part is stored and its journal removed: the lock can go.
      void open.lock?.then((held) => held.release());
    }
  };

  /** Stores the journals that closed or crashed tabs left (plan 8.4), then tells the main thread. */
  const recoverRecordings = async (): Promise<void> => {
    if (!journalEnv) return;
    const records = await recoverJournals(journalEnv, ({ packets, meta }) => muxAndStore(packets, meta, env.post));
    // Tiers M and V: the segment journals of recordings that a tab left open.
    const fromSegments = await recoverSegmentJournals(journalEnv, recordingHost(), env.post);
    records.push(...fromSegments);
    if (records.length > 0) env.post({ t: "recovered", records });
  };

  const run = async (cmd: IoCmd): Promise<void> => {
    const rid = (cmd as { rid?: unknown } | null)?.rid;
    const post: Post = typeof rid === "number" ? (event) => env.post({ ...event, rid }) : env.post;
    switch (cmd?.t) {
      case "mux":
        return runMux(cmd, post);
      case "picture":
        return runPicture(cmd, post);
      case "record":
        return runRecord(cmd, post);
      case "index":
        return runIndex(cmd, post);
      case "concat":
        return runConcat(cmd, post);
      case "segmentRecord":
        return runSegmentRecord(cmd, post);
      case "segmentRecordAdd": {
        // A segment's failure goes with the recording's own rid.
        const open = segmentRecordings.get(cmd.recordingId);
        return runSegmentRecordAdd(cmd, open ? open.post : post);
      }
      case "segmentRecordEnd":
        return runSegmentRecordEnd(cmd, post);
      case "recordRung": {
        // No answer: a recording that is not open (or already ended) ignores it.
        const open = recordings.get(cmd.recordingId);
        if (open && typeof cmd.atUs === "number" && typeof cmd.fps === "number") open.recording.rung(cmd.atUs, cmd.fps);
        return;
      }
      case "recordEnd": {
        const open = recordings.get(cmd.recordingId);
        // The recording's own events (with the record command's rid) follow.
        if (open) await feedRecording(open, { t: "end", recordingId: cmd.recordingId });
        return;
      }
      case "read": {
        if (!isClipId(cmd.id)) return post(errorEvent("not-found", `"${String(cmd.id)}" is not a valid clip id`));
        try {
          const { file, record } = await (await getLibrary()).read(cmd.id);
          post({ t: "file", id: cmd.id, file, record });
        } catch (error) {
          post(libraryErrorEvent(error, "opfs-unavailable", cmd.id));
        }
        return;
      }
      case "delete": {
        if (!isClipId(cmd.id)) return post(errorEvent("not-found", `"${String(cmd.id)}" is not a valid clip id`));
        try {
          // Deleting a clip that is already gone is a success: the result is the same.
          await (await getLibrary()).remove(cmd.id);
          post({ t: "deleted", id: cmd.id });
        } catch (error) {
          post(libraryErrorEvent(error, "opfs-unavailable", cmd.id));
        }
        return;
      }
      case "list": {
        if (!isOwnerKey(cmd.ownerKey)) {
          post({ t: "list", records: [] });
          return;
        }
        try {
          post({ t: "list", records: await (await getLibrary()).list(cmd.ownerKey) });
        } catch (error) {
          post(libraryErrorEvent(error, "opfs-unavailable"));
        }
        return;
      }
      case "usage": {
        if (!isOwnerKey(cmd.ownerKey)) {
          post(errorEvent("bad-command", `"${String(cmd.ownerKey)}" is not a valid owner key`));
          return;
        }
        try {
          const lib = await getLibrary();
          const { budgetBytes, usedBytes } = await lib.budget();
          const count = (await lib.list(cmd.ownerKey)).length;
          post({ t: "usage", bytes: usedBytes, budget: budgetBytes, count });
        } catch (error) {
          post(libraryErrorEvent(error, "opfs-unavailable"));
        }
        return;
      }
      case "update": {
        if (!isClipId(cmd.id)) return post(errorEvent("not-found", `"${String(cmd.id)}" is not a valid clip id`));
        try {
          post({ t: "updated", record: await (await getLibrary()).update(cmd.id, cmd.patch) });
        } catch (error) {
          post(libraryErrorEvent(error, "opfs-unavailable", cmd.id));
        }
        return;
      }
      case "configure": {
        if (!MEMORY_CLASSES.has(cmd.memoryClass)) {
          post(errorEvent("bad-command", `"${String(cmd.memoryClass)}" is not a memory class`));
          return;
        }
        const chosen = cmd.memoryClass;
        memoryClass = chosen;
        // Applied now when the library is open, else when it opens. No event answers it.
        const open = library;
        if (open) await open.then((lib) => lib.setMemoryClass(chosen)).catch(() => undefined);
        return;
      }
      default:
        post(errorEvent("bad-command", `unknown io command "${String((cmd as { t?: unknown })?.t)}"`));
    }
  };

  function enqueue(task: () => Promise<unknown>): Promise<void> {
    const next = queue
      .then(task)
      .then(() => undefined)
      .catch((error) => {
        env.post(errorEvent("opfs-unavailable", `io worker failure: ${errorText(error)}`));
      });
    queue = next;
    return next;
  }

  /** The sound commands: at once, never behind a join in the queue. True when `cmd` was one. */
  const runSound = (cmd: IoCmd): boolean => {
    switch (cmd?.t) {
      case "audioRun":
        if (cmd.container !== "mp4" && cmd.container !== "webm") return true;
        sound.open(cmd.runId, cmd.timeline, cmd.container, cmd.startUs, cmd.keepSeconds);
        return true;
      case "audioAppend":
        if (cmd.bytes instanceof ArrayBuffer) sound.append(cmd.runId, cmd.bytes);
        return true;
      case "audioEnd":
        sound.end(cmd.runId);
        return true;
      default:
        return false;
    }
  };

  return {
    start(): Promise<void> {
      return enqueue(getLibrary);
    },
    handle(cmd: IoCmd): Promise<void> {
      if (runSound(cmd)) return Promise.resolve();
      return enqueue(() => run(cmd));
    },
    idle(): Promise<void> {
      return queue;
    },
  };
}
