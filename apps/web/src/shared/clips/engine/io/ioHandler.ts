/**
 * The io worker's command loop (protocol IoCmd to IoEvent), without the worker glue,
 * so tests can run it with fakes.
 *
 * - Commands run one at a time, in the order they arrive. Events therefore come back
 *   in command order.
 * - The first command opens the library and runs the startup reconcile once.
 * - Every failure becomes an "error" event with a typed code. Nothing is thrown to
 *   the worker scope.
 */

import type { ClipRecord, IoCmd, IoEvent } from "../../protocol";
import { LibraryError, errorText } from "../../library/errors";
import { ClipLibrary, type LibraryEnv } from "../../library/opfsStore";
import { isClipId, isOwnerKey } from "../../library/ownerKey";
import { MoovPatchError, addAacRollGroups } from "./moovPatch";
import { MuxError, type MuxResult, muxClip } from "./mux";
import { makePoster } from "./poster";

type IoErrorEvent = Extract<IoEvent, { t: "error" }>;

/** The parts of the library that the handler uses. ClipLibrary fits it. */
export type IoLibrary = Pick<ClipLibrary, "save" | "read" | "remove" | "list" | "reconcile">;

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

function errorEvent(code: IoErrorEvent["code"], detail: string, id?: string): IoErrorEvent {
  return id === undefined ? { t: "error", code, detail } : { t: "error", code, detail, id };
}

function libraryErrorEvent(error: unknown, fallback: IoErrorEvent["code"], id?: string): IoErrorEvent {
  if (error instanceof LibraryError) return errorEvent(error.code, error.message, id);
  return errorEvent(fallback, errorText(error), id);
}

export function createIoHandler(env: IoHandlerEnv): IoHandler {
  const now = env.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const mux = env.mux ?? muxClip;
  const patch = env.patch ?? addAacRollGroups;
  const poster = env.poster ?? makePoster;
  let library: Promise<IoLibrary> | null = null;
  let queue: Promise<void> = Promise.resolve();

  const getLibrary = (): Promise<IoLibrary> => {
    if (!library) {
      library = (async () => {
        const lib = env.openLibrary ? await env.openLibrary() : await ClipLibrary.open(env.libraryEnv);
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
    const started = now();
    let bytes: Uint8Array;
    let muxed: MuxResult;
    try {
      muxed = await mux(cmd.packets);
      bytes = muxed.hasAudio ? patch(muxed.bytes).bytes : muxed.bytes;
    } catch (error) {
      const code = error instanceof MuxError || error instanceof MoovPatchError ? error.code : "error";
      env.post(errorEvent("mux-failed", `${code}: ${errorText(error)}`, id));
      return;
    }
    const muxMs = now() - started;
    const posterDataUrl = await poster(muxed.firstKey.data, muxed.epoch);
    const meta: Omit<ClipRecord, "storage" | "bytes"> = {
      ...cmd.meta,
      mime: "video/mp4",
      hasAudio: muxed.hasAudio,
      durationMs: Math.round(muxed.videoDurationSec * 1000),
      posterDataUrl,
    };
    const lib = await getLibrary();
    try {
      const saved = await lib.save(bytes, meta, muxed.videoDurationSec);
      if (saved.eviction) env.post({ t: "evicted", kept: saved.eviction.kept, removed: saved.eviction.removed });
      env.post({ t: "saved", record: saved.record, muxMs });
    } catch (error) {
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
      default:
        env.post(errorEvent("mux-failed", `unknown io command "${String((cmd as { t?: unknown })?.t)}"`));
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
