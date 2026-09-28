/**
 * The main thread's client of the io worker, and the kid's library
 * (contract ClipLibraryApi).
 *
 * - One io worker per tab, started lazily through a dynamic import of
 *   workers.ts, so a page that never uses the library never loads it.
 * - Every command carries a request id (protocol IoTag). Events with that id
 *   answer it; events with no id are startup events (the reconcile) and
 *   worker failures.
 * - The library works whatever the clips flag says: the kill switch stops
 *   capture, never the kid's own clips (plan 4.1). getClipLibrary() does not
 *   read the flag.
 * - Kept and watched changes go through the io worker's "update" command:
 *   it writes the row with ClipsDb.update under the library lock and posts
 *   { updated: id } on the "hh-clips" BroadcastChannel. Eviction reads those
 *   flags, so a clip that the kid has not watched is never evicted.
 * - Files from file() carry the plan 12 name, from this deployment's host.
 */

import type { ClipKind, ClipMeta, ClipPackets, ClipRecord, IoCmd, IoEvent, MemoryClass } from "../protocol";
import { GUEST_OWNER_KEY, ownerKeyFor } from "../library/ownerKey";
import { LIBRARY_CHANNEL } from "../library/shared";
import type { ClipLibraryApi } from "./contract";
import { readSessionUserId } from "./lifecycle";
import { renameFile } from "./share";

type IoErrorCode = Extract<IoEvent, { t: "error" }>["code"] | "worker-failed";

/** A failed io command, with the worker's typed code. */
export class IoError extends Error {
  constructor(
    readonly code: IoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IoError";
  }
}

/** A Worker, or a test double. */
export interface IoWorkerLike {
  postMessage(message: IoCmd, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<IoEvent>) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

/** A BroadcastChannel, or a test double. */
export interface ChannelLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  close(): void;
}

export interface IoClientOptions {
  createWorker?: () => Promise<IoWorkerLike>;
  /** The deployment's host, for file names. Default: location.host. */
  host?: () => string;
  /** The "hh-clips" channel. Default: a BroadcastChannel, or null where there is none. */
  openChannel?: () => ChannelLike | null;
  /** The signed-in user id, read when the owner is first needed. Default: /api/auth/session. */
  readUserId?: () => Promise<string | null>;
  log?: (message: string) => void;
}

interface Pending {
  /** Returns true when this event ends the command. */
  onEvent(event: IoEvent): boolean;
  fail(error: IoError): void;
}

export interface RecordSession {
  /** Settles when the io worker listens on the port. */
  started: Promise<void>;
  /** Settles after the tee's "end", with every stored part. */
  finished: Promise<{ parts: Array<{ record: ClipRecord; startUs: number; endUs: number }>; failed: number }>;
}

function defaultCreateWorker(): Promise<IoWorkerLike> {
  return import("./workers").then(({ createIoWorker }) => createIoWorker() as unknown as IoWorkerLike);
}

function defaultChannel(): ChannelLike | null {
  try {
    return typeof BroadcastChannel === "function" ? (new BroadcastChannel(LIBRARY_CHANNEL) as unknown as ChannelLike) : null;
  } catch {
    return null;
  }
}

function errorOf(event: Extract<IoEvent, { t: "error" }>): IoError {
  return new IoError(event.code, event.detail);
}

export class IoClient {
  private worker: Promise<IoWorkerLike> | null = null;
  private nextRid = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<() => void>();
  private channel: ChannelLike | null = null;
  private owner: Promise<string> | null = null;
  private memoryClass: MemoryClass | null = null;
  private readonly createWorker: () => Promise<IoWorkerLike>;
  private readonly host: () => string;
  private readonly openChannel: () => ChannelLike | null;
  private readonly readUserId: () => Promise<string | null>;
  private readonly log: (message: string) => void;

  constructor(options: IoClientOptions = {}) {
    this.createWorker = options.createWorker ?? defaultCreateWorker;
    this.host = options.host ?? (() => (typeof location !== "undefined" ? location.host : ""));
    this.openChannel = options.openChannel ?? defaultChannel;
    this.readUserId = options.readUserId ?? (() => readSessionUserId());
    this.log = options.log ?? ((m) => console.warn(m));
  }

  // ---- owner ---------------------------------------------------------------

  /** The owner key of the library now. The first call reads the signed-in user. */
  ownerKey(): Promise<string> {
    if (!this.owner) {
      this.owner = this.readUserId()
        .then((id) => ownerKeyFor(id))
        .catch(() => GUEST_OWNER_KEY);
    }
    return this.owner;
  }

  /** The signed-in user changed (or was read by the caller). */
  setOwnerKey(ownerKey: string): void {
    this.owner = Promise.resolve(ownerKey);
    this.notify();
  }

  // ---- commands ------------------------------------------------------------

  /** Sets the in-memory budget from the memory class (plan 6.5). Sent again after a worker restart. */
  configure(memoryClass: MemoryClass): void {
    this.memoryClass = memoryClass;
    void this.post({ t: "configure", memoryClass }, [], null);
  }

  mux(packets: ClipPackets, meta: ClipMeta): Promise<ClipRecord> {
    return this.oneAnswer({ t: "mux", packets, meta }, collectTransfers(packets), (event) => (event.t === "saved" ? event.record : undefined));
  }

  picture(png: ArrayBuffer, meta: ClipMeta): Promise<ClipRecord> {
    return this.oneAnswer({ t: "picture", png, meta }, [png], (event) => (event.t === "saved" ? event.record : undefined));
  }

  read(id: string): Promise<{ file: File; record: ClipRecord }> {
    return this.oneAnswer({ t: "read", id }, [], (event) => (event.t === "file" ? { file: event.file, record: event.record } : undefined));
  }

  remove(id: string): Promise<void> {
    return this.oneAnswer<void>({ t: "delete", id }, [], () => undefined, "deleted");
  }

  list(ownerKey: string): Promise<ClipRecord[]> {
    return this.oneAnswer({ t: "list", ownerKey }, [], (event) => (event.t === "list" ? event.records : undefined));
  }

  update(id: string, patch: Extract<IoCmd, { t: "update" }>["patch"]): Promise<ClipRecord> {
    return this.oneAnswer({ t: "update", id, patch }, [], (event) => (event.t === "updated" ? event.record : undefined));
  }

  usage(ownerKey: string): Promise<{ bytes: number; budget: number; count: number }> {
    return this.oneAnswer({ t: "usage", ownerKey }, [], (event) =>
      event.t === "usage" ? { bytes: event.bytes, budget: event.budget, count: event.count } : undefined,
    );
  }

  /** Hands the Record tee port to the io worker (plan 8.4). */
  record(recordingId: string, port: MessagePort, meta: ClipMeta): RecordSession {
    let startOk: () => void = () => undefined;
    let startFail: (error: IoError) => void = () => undefined;
    let doneOk: (value: Awaited<RecordSession["finished"]>) => void = () => undefined;
    let doneFail: (error: IoError) => void = () => undefined;
    const started = new Promise<void>((resolve, reject) => {
      startOk = resolve;
      startFail = reject;
    });
    const finished = new Promise<Awaited<RecordSession["finished"]>>((resolve, reject) => {
      doneOk = resolve;
      doneFail = reject;
    });
    // Callers may await only one of the two.
    started.catch(() => undefined);
    finished.catch(() => undefined);
    let listening = false;
    void this.post({ t: "record", recordingId, port, meta }, [port], {
      onEvent: (event) => {
        if (event.t === "recording") {
          listening = true;
          startOk();
          return false;
        }
        if (event.t === "recorded") {
          this.notify();
          doneOk({ parts: event.parts, failed: event.failed });
          return true;
        }
        if (event.t === "saved" || event.t === "evicted") {
          this.notify();
          return false;
        }
        if (event.t === "error") {
          // A part that failed: the "recorded" answer counts it. Before "recording", the command failed.
          if (listening) return false;
          const error = errorOf(event);
          startFail(error);
          doneFail(error);
          return true;
        }
        return false;
      },
      fail: (error) => {
        startFail(error);
        doneFail(error);
      },
    });
    return { started, finished };
  }

  /** Ends an open recording whose tee stopped without "end" (the encode worker died). */
  recordEnd(recordingId: string): void {
    void this.post({ t: "recordEnd", recordingId }, [], null);
  }

  // ---- library changes -------------------------------------------------------

  /** Calls `listener` after any library change in this tab or another tab. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.channel) {
      this.channel = this.openChannel();
      if (this.channel) this.channel.onmessage = () => this.notify();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.channel) {
        this.channel.onmessage = null;
        this.channel.close();
        this.channel = null;
      }
    };
  }

  private api: ClipLibraryApi | null = null;

  /** The kid's library (contract ClipLibraryApi). The same object on every call. */
  libraryApi(): ClipLibraryApi {
    return (this.api ??= {
      list: async (filter) => {
        const records = await this.list(await this.ownerKey());
        return records.filter(
          (r) =>
            (filter?.gameId === undefined || r.gameId === filter.gameId) &&
            (filter?.kind === undefined || r.kind === (filter.kind as ClipKind)) &&
            (filter?.kept === undefined || r.kept === filter.kept),
        );
      },
      file: async (id) => {
        const { file, record } = await this.read(id);
        return renameFile(file, record, this.host());
      },
      setKept: async (id, kept) => {
        await this.update(id, { kept });
      },
      markWatched: async (id) => {
        await this.update(id, { watched: true });
      },
      remove: (id) => this.remove(id),
      usage: async () => this.usage(await this.ownerKey()),
      subscribe: (listener) => this.subscribe(listener),
    });
  }

  /** Stops the worker (tests). */
  dispose(): void {
    const worker = this.worker;
    this.worker = null;
    void worker?.then((w) => w.terminate()).catch(() => undefined);
    this.failAll(new IoError("worker-failed", "the io client was closed"));
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = null;
    }
  }

  // ---- plumbing --------------------------------------------------------------

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // One bad listener must not stop the others.
      }
    }
  }

  private oneAnswer<T>(
    cmd: IoCmd,
    transfer: Transferable[],
    pick: (event: IoEvent) => T | undefined,
    doneType?: IoEvent["t"],
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      void this.post(cmd, transfer, {
        onEvent: (event) => {
          if (event.t === "evicted") {
            this.notify();
            return false;
          }
          if (event.t === "error") {
            reject(errorOf(event));
            return true;
          }
          if (doneType && event.t === doneType) {
            if (event.t === "deleted") this.notify();
            resolve(undefined as T);
            return true;
          }
          const value = pick(event);
          if (value === undefined) return false;
          if (event.t === "saved" || event.t === "updated") this.notify();
          resolve(value);
          return true;
        },
        fail: reject,
      });
    });
  }

  private async post(cmd: IoCmd, transfer: Transferable[], pending: Pending | null): Promise<void> {
    let worker: IoWorkerLike;
    try {
      worker = await this.ensureWorker();
    } catch (error) {
      pending?.fail(new IoError("worker-failed", `the io worker did not start (${(error as { name?: string } | null)?.name ?? "Error"})`));
      return;
    }
    const rid = this.nextRid++;
    if (pending) this.pending.set(rid, pending);
    try {
      worker.postMessage({ ...cmd, rid } as IoCmd, transfer);
    } catch (error) {
      this.pending.delete(rid);
      pending?.fail(new IoError("bad-command", `the command could not be sent (${(error as { name?: string } | null)?.name ?? "Error"})`));
    }
  }

  private ensureWorker(): Promise<IoWorkerLike> {
    if (!this.worker) {
      const made = this.createWorker().then((worker) => {
        worker.onmessage = (event) => this.onEvent(event.data);
        worker.onerror = () => this.onWorkerError(made);
        if (this.memoryClass) worker.postMessage({ t: "configure", memoryClass: this.memoryClass });
        return worker;
      });
      this.worker = made;
      made.catch(() => {
        if (this.worker === made) this.worker = null;
      });
    }
    return this.worker;
  }

  private onWorkerError(which: Promise<IoWorkerLike>): void {
    if (this.worker !== which) return;
    this.worker = null;
    void which.then((w) => w.terminate()).catch(() => undefined);
    this.log("[clips] the io worker stopped; it starts again at the next library call");
    this.failAll(new IoError("worker-failed", "the io worker stopped"));
  }

  private failAll(error: IoError): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) p.fail(error);
  }

  private onEvent(event: IoEvent): void {
    const rid = event?.rid;
    if (typeof rid === "number") {
      const pending = this.pending.get(rid);
      if (pending && pending.onEvent(event)) this.pending.delete(rid);
      return;
    }
    if (event?.t === "reconciled") {
      this.notify();
      return;
    }
    if (event?.t === "error") {
      // Values-free: the code only.
      this.log(`[clips] library: ${event.code}`);
    }
  }
}

function collectTransfers(packets: ClipPackets): Transferable[] {
  const out = new Set<ArrayBuffer>();
  for (const p of packets.video) out.add(p.data);
  for (const p of packets.audio) out.add(p.data);
  for (const e of packets.videoEpochs) out.add(e.description);
  if (packets.audioConfig) out.add(packets.audioConfig.description);
  return [...out];
}

let shared: IoClient | null = null;

/** The tab's io client (and library). Null on the server. */
export function getIoClient(): IoClient | null {
  if (typeof window === "undefined") return null;
  shared ??= new IoClient();
  return shared;
}

/**
 * The kid's clip library for this tab, or null on the server. It works with
 * clips off (the kill switch never hides the library, plan 4.1).
 */
export function getClipLibrary(): ClipLibraryApi | null {
  return getIoClient()?.libraryApi() ?? null;
}
