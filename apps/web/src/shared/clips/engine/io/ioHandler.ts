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
 *   queue as the commands (recorder.ts).
 */

import type { ClipMeta, ClipPackets, ClipRecord, EpochInfo, IoCmd, IoEvent, MemoryClass, PacketDTO } from "../../protocol";
import { InvalidInputError, LibraryError, errorText } from "../../library/errors";
import { ClipLibrary, type LibraryEnv } from "../../library/opfsStore";
import { isClipId, isOwnerKey } from "../../library/ownerKey";
import { MoovPatchError, addAacRollGroups } from "./moovPatch";
import { MuxError, muxClip } from "./mux";
import { makePoster, makePosterFromImage } from "./poster";
import { RECORD_ID_MAX_LENGTH, RECORD_PART_MAX_BYTES, Recording } from "./recorder";

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
  patch?: typeof addAacRollGroups;
  poster?: typeof makePoster;
  /** Poster of a picture. Default: makePosterFromImage. */
  picturePoster?: (png: Blob) => Promise<string>;
  now?: () => number;
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
}

export function createIoHandler(env: IoHandlerEnv): IoHandler {
  const now = env.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const mux = env.mux ?? muxClip;
  const patch = env.patch ?? addAacRollGroups;
  const poster = env.poster ?? makePoster;
  const picturePoster = env.picturePoster ?? ((png: Blob) => makePosterFromImage(png));
  let library: Promise<IoLibrary> | null = null;
  let memoryClass: MemoryClass | null = null;
  let queue: Promise<void> = Promise.resolve();
  const recordings = new Map<string, OpenRecording>();

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
    const recording = new Recording(
      {
        storePart: (packets, meta, partPost) => muxAndStore(packets, meta, partPost),
        maxPartBytes: () => RECORD_PART_MAX_BYTES[memoryClass ?? "low"],
      },
      cmd.recordingId,
      { ...cmd.meta, kind: "record" },
      post,
    );
    const open: OpenRecording = { recording, port };
    recordings.set(cmd.recordingId, open);
    port.onmessage = (event) => {
      void enqueue(() => feedRecording(open, event.data));
    };
    post({ t: "recording", recordingId: cmd.recordingId });
  };

  /** Hands one tee message to a recording, and lets go of its port when it is finished. */
  const feedRecording = async (open: OpenRecording, message: unknown): Promise<void> => {
    await open.recording.handle(message);
    if (open.recording.finished && recordings.get(open.recording.recordingId) === open) {
      recordings.delete(open.recording.recordingId);
      open.port.onmessage = null;
      open.port.close?.();
    }
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

  return {
    start(): Promise<void> {
      return enqueue(getLibrary);
    },
    handle(cmd: IoCmd): Promise<void> {
      return enqueue(() => run(cmd));
    },
    idle(): Promise<void> {
      return queue;
    },
  };
}
