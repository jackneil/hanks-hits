/**
 * The io worker's command loop (protocol IoCmd to IoEvent), without the worker glue,
 * so tests can run it with fakes.
 *
 * - Commands run one at a time, in the order they arrive. Events therefore come back
 *   in command order.
 * - The first command opens the library and runs the startup reconcile once.
 * - Every failure becomes an "error" event with a typed code. Nothing is thrown to
 *   the worker scope.
 * - Clips that a save removed are always reported ("evicted"), also when the save
 *   fails after the removal. The "evicted" event then comes before the "error".
 */

import type { ClipPackets, ClipRecord, EpochInfo, IoCmd, IoEvent, MemoryClass, PacketDTO } from "../../protocol";
import { InvalidInputError, LibraryError, errorText } from "../../library/errors";
import { ClipLibrary, type LibraryEnv } from "../../library/opfsStore";
import { isClipId, isOwnerKey } from "../../library/ownerKey";
import { MoovPatchError, addAacRollGroups } from "./moovPatch";
import { MuxError, muxClip } from "./mux";
import { makePoster } from "./poster";

type IoErrorEvent = Extract<IoEvent, { t: "error" }>;

/** The parts of the library that the handler uses. ClipLibrary fits it. */
export type IoLibrary = Pick<ClipLibrary, "save" | "read" | "remove" | "list" | "reconcile" | "update" | "setMemoryClass">;

export interface IoHandlerEnv {
  post(event: IoEvent): void;
  openLibrary?: () => Promise<IoLibrary>;
  libraryEnv?: LibraryEnv;
  mux?: typeof muxClip;
  patch?: typeof addAacRollGroups;
  poster?: typeof makePoster;
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

export function createIoHandler(env: IoHandlerEnv): IoHandler {
  const now = env.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const mux = env.mux ?? muxClip;
  const patch = env.patch ?? addAacRollGroups;
  const poster = env.poster ?? makePoster;
  let library: Promise<IoLibrary> | null = null;
  let memoryClass: MemoryClass | null = null;
  let queue: Promise<void> = Promise.resolve();

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

  const runMux = async (cmd: Extract<IoCmd, { t: "mux" }>): Promise<void> => {
    const id = cmd.meta?.id;
    if (!isClipId(id)) {
      env.post(errorEvent("mux-failed", `"${String(id)}" is not a valid clip id`));
      return;
    }
    if (!isOwnerKey(cmd.meta.ownerKey)) {
      env.post(errorEvent("mux-failed", `"${cmd.meta.ownerKey}" is not a valid owner key`, id));
      return;
    }
    const packets = cmd.packets as ClipPackets | undefined;
    if (!packets || !Array.isArray(packets.video) || !Array.isArray(packets.audio)) {
      env.post(errorEvent("bad-command", "the mux command has no packet lists", id));
      return;
    }
    const expectedSec = describedVideoSec(cmd.packets);
    const started = now();
    let muxed: Muxed;
    try {
      muxed = await muxAndPatch(cmd.packets);
    } catch (error) {
      const code = error instanceof MuxError || error instanceof MoovPatchError ? error.code : "error";
      env.post(errorEvent("mux-failed", `${code}: ${errorText(error)}`, id));
      return;
    } finally {
      // The command object lives until this command is done. Drop its packet lists
      // so their buffers can be freed now (the first keyframe stays for the poster).
      cmd.packets.video = [];
      cmd.packets.audio = [];
    }
    const muxMs = now() - started;
    const posterDataUrl = await poster(muxed.firstKey.data, muxed.epoch);
    // The library sets durationMs and hasAudio again from the stored file.
    const meta: Omit<ClipRecord, "storage" | "bytes"> = {
      ...cmd.meta,
      mime: "video/mp4",
      hasAudio: muxed.hasAudio,
      posterDataUrl,
    };
    const lib = await getLibrary();
    try {
      const saved = await lib.save(muxed.bytes, meta, expectedSec);
      if (saved.eviction) env.post({ t: "evicted", kept: saved.eviction.kept, removed: saved.eviction.removed });
      env.post({ t: "saved", record: saved.record, muxMs });
    } catch (error) {
      if (error instanceof LibraryError && error.eviction) {
        env.post({ t: "evicted", kept: error.eviction.kept, removed: error.eviction.removed });
      }
      env.post(libraryErrorEvent(error, "opfs-unavailable", id));
    }
  };

  const run = async (cmd: IoCmd): Promise<void> => {
    switch (cmd?.t) {
      case "mux":
        return runMux(cmd);
      case "read": {
        if (!isClipId(cmd.id)) return env.post(errorEvent("not-found", `"${String(cmd.id)}" is not a valid clip id`));
        try {
          const { file } = await (await getLibrary()).read(cmd.id);
          env.post({ t: "file", id: cmd.id, file });
        } catch (error) {
          env.post(libraryErrorEvent(error, "opfs-unavailable", cmd.id));
        }
        return;
      }
      case "delete": {
        if (!isClipId(cmd.id)) return env.post(errorEvent("not-found", `"${String(cmd.id)}" is not a valid clip id`));
        try {
          // Deleting a clip that is already gone is a success: the result is the same.
          await (await getLibrary()).remove(cmd.id);
          env.post({ t: "deleted", id: cmd.id });
        } catch (error) {
          env.post(libraryErrorEvent(error, "opfs-unavailable", cmd.id));
        }
        return;
      }
      case "list": {
        if (!isOwnerKey(cmd.ownerKey)) {
          env.post({ t: "list", records: [] });
          return;
        }
        try {
          env.post({ t: "list", records: await (await getLibrary()).list(cmd.ownerKey) });
        } catch (error) {
          env.post(libraryErrorEvent(error, "opfs-unavailable"));
        }
        return;
      }
      case "update": {
        if (!isClipId(cmd.id)) return env.post(errorEvent("not-found", `"${String(cmd.id)}" is not a valid clip id`));
        try {
          env.post({ t: "updated", record: await (await getLibrary()).update(cmd.id, cmd.patch) });
        } catch (error) {
          env.post(libraryErrorEvent(error, "opfs-unavailable", cmd.id));
        }
        return;
      }
      case "configure": {
        if (!MEMORY_CLASSES.has(cmd.memoryClass)) {
          env.post(errorEvent("bad-command", `"${String(cmd.memoryClass)}" is not a memory class`));
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
        env.post(errorEvent("bad-command", `unknown io command "${String((cmd as { t?: unknown })?.t)}"`));
    }
  };

  const enqueue = (task: () => Promise<unknown>): Promise<void> => {
    const next = queue
      .then(task)
      .then(() => undefined)
      .catch((error) => {
        env.post(errorEvent("opfs-unavailable", `io worker failure: ${errorText(error)}`));
      });
    queue = next;
    return next;
  };

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
