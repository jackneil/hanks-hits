/**
 * The Record journal (plan 8.4 crash recovery). It runs in the io worker.
 *
 * A Record part lives in the io worker's memory until the part closes and is
 * muxed. A tab that closes or crashes (or an iOS memory kill after the page
 * is hidden) would lose the whole open part. So each tee chunk is also
 * appended to a journal file in OPFS when it arrives:
 *
 *   rec/<part id>.journal
 *
 * - One file per part. The file is removed when its part is stored (or
 *   failed and was reported).
 * - While a recording is open, the io worker holds the Web Lock
 *   "hh-clips-rec:<recording id>". The browser lets it go when the tab dies.
 * - At startup (after the library check), a journal whose recording lock is
 *   free belongs to a tab that is gone. The recovering worker takes that lock
 *   (ifAvailable) and holds it while it reads the file again, stores its
 *   chunks as the record part and removes the file. The stored rows go to
 *   the main thread in one "recovered" event ("We saved your recording from
 *   last time!"). A journal whose lock is held is left alone: a live tab
 *   records into it, or another tab recovers it now (two tabs that start at
 *   once after a crash store each part once). Without Web Locks a live tab
 *   cannot be told from a dead one, so no journal is recovered (it is never
 *   taken from a live tab).
 *
 * File format: frames, each one (little-endian)
 *   u32 magic "HRRJ" | u32 header bytes | u32 body bytes | u32 FNV-1a of header and body
 *   header: UTF-8 JSON | body: the media bytes the header lists, in order
 * The first frame is the part's row (ClipMeta). Each next frame is one chunk.
 * A frame is written with one write and then flushed. After a crash, the
 * file can end in a part frame, or (on some file systems) in zeros: reading
 * stops at the first frame that does not fit the file or fails its
 * checksum, and every frame before it is used. Nothing after a bad frame is
 * trusted.
 *
 * The session timeline journal (plan 8.3, a later phase) replaces this
 * format; its recovery replaces this one.
 */

import type { ClipMeta, ClipPackets, EpochInfo, PacketDTO } from "../../protocol";
import type { DirectoryHandleLike, FileHandleLike, StorageLike, SyncAccessHandleLike } from "../../library/fsTypes";
import { isClipId, isOwnerKey } from "../../library/ownerKey";

export const JOURNAL_DIR = "rec";
export const JOURNAL_SUFFIX = ".journal";
export const RECORD_LOCK_PREFIX = "hh-clips-rec:";
/** The bytes "HRRJ" read as a little-endian u32. */
const MAGIC = 0x4a525248;
const FRAME_HEAD_BYTES = 16;
/** A header larger than this is not ours (a torn or foreign file). */
const MAX_HEADER_BYTES = 4 * 1024 * 1024;

/** The Web Locks call the journal uses. navigator.locks in a worker fits it. */
export interface JournalLocks {
  request<T>(name: string, options: { mode?: "exclusive" | "shared"; ifAvailable?: boolean }, callback: (lock: unknown) => Promise<T> | T): Promise<T>;
}

export interface JournalEnv {
  /** navigator.storage. null: no OPFS here (no journal). */
  storage: StorageLike | null;
  /** navigator.locks. null: no Web Locks (journals are written, never recovered). */
  locks: JournalLocks | null;
  log?: (message: string) => void;
}

/** The first frame of a journal. */
export interface JournalMeta {
  t: "meta";
  v: 1;
  recordingId: string;
  /** The part's row, with its own id and createdAt. */
  meta: ClipMeta;
}

interface PacketHead {
  type: PacketDTO["type"];
  tsUs: number;
  durUs: number;
  epoch: number;
  n: number;
}

interface EpochHead {
  epoch: number;
  codec: string;
  codedWidth: number;
  codedHeight: number;
  colorSpace?: VideoColorSpaceInit;
  n: number;
}

interface ChunkHeader {
  t: "chunk";
  video: PacketHead[];
  audio: PacketHead[];
  epochs: EpochHead[];
  audioConfig: { codec: "mp4a.40.2"; sampleRate: number; numberOfChannels: number; n: number } | null;
  primingSamples: number;
  startUs: number;
  endUs: number;
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** FNV-1a, 32 bits, over two byte ranges. */
function fnv1a(a: Uint8Array, b: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const part of [a, b]) {
    for (let i = 0; i < part.length; i++) {
      h ^= part[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

function bytesOf(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

/** One frame: the head, the header JSON and the body parts, in one buffer. */
export function encodeFrame(header: unknown, bodyParts: readonly Uint8Array[]): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(header));
  let bodyBytes = 0;
  for (const part of bodyParts) bodyBytes += part.length;
  const body = new Uint8Array(bodyBytes);
  let at = 0;
  for (const part of bodyParts) {
    body.set(part, at);
    at += part.length;
  }
  const out = new Uint8Array(FRAME_HEAD_BYTES + head.length + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, head.length, true);
  view.setUint32(8, body.length, true);
  view.setUint32(12, fnv1a(head, body), true);
  out.set(head, FRAME_HEAD_BYTES);
  out.set(body, FRAME_HEAD_BYTES + head.length);
  return out;
}

/** The frames of a journal, up to the first one that is torn or fails its checksum. */
export function decodeFrames(bytes: Uint8Array): { frames: Array<{ header: unknown; body: Uint8Array }>; torn: boolean } {
  const frames: Array<{ header: unknown; body: Uint8Array }> = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at < bytes.length) {
    if (bytes.length - at < FRAME_HEAD_BYTES) return { frames, torn: true };
    const magic = view.getUint32(at, true);
    const headLen = view.getUint32(at + 4, true);
    const bodyLen = view.getUint32(at + 8, true);
    const sum = view.getUint32(at + 12, true);
    const start = at + FRAME_HEAD_BYTES;
    if (magic !== MAGIC || headLen > MAX_HEADER_BYTES || start + headLen + bodyLen > bytes.length) return { frames, torn: true };
    const head = bytes.subarray(start, start + headLen);
    const body = bytes.subarray(start + headLen, start + headLen + bodyLen);
    if (fnv1a(head, body) !== sum) return { frames, torn: true };
    let header: unknown;
    try {
      header = JSON.parse(new TextDecoder().decode(head));
    } catch {
      return { frames, torn: true };
    }
    frames.push({ header, body });
    at = start + headLen + bodyLen;
  }
  return { frames, torn: false };
}

/** A chunk frame for the packets of one tee chunk. */
export function chunkFrame(packets: ClipPackets): Uint8Array {
  const parts: Uint8Array[] = [];
  const epochs: EpochHead[] = packets.videoEpochs.map((e) => {
    const bytes = bytesOf(e.description);
    parts.push(bytes);
    const head: EpochHead = { epoch: e.epoch, codec: e.codec, codedWidth: e.codedWidth, codedHeight: e.codedHeight, n: bytes.length };
    if (e.colorSpace) head.colorSpace = e.colorSpace;
    return head;
  });
  let audioConfig: ChunkHeader["audioConfig"] = null;
  if (packets.audioConfig) {
    const bytes = bytesOf(packets.audioConfig.description);
    parts.push(bytes);
    audioConfig = {
      codec: packets.audioConfig.codec,
      sampleRate: packets.audioConfig.sampleRate,
      numberOfChannels: packets.audioConfig.numberOfChannels,
      n: bytes.length,
    };
  }
  const packetHeads = (list: readonly PacketDTO[]): PacketHead[] =>
    list.map((p) => {
      const bytes = bytesOf(p.data);
      parts.push(bytes);
      return { type: p.type, tsUs: p.tsUs, durUs: p.durUs, epoch: p.epoch, n: bytes.length };
    });
  const video = packetHeads(packets.video);
  const audio = packetHeads(packets.audio);
  const header: ChunkHeader = {
    t: "chunk",
    video,
    audio,
    epochs,
    audioConfig,
    primingSamples: packets.primingSamples,
    startUs: packets.startUs,
    endUs: packets.endUs,
  };
  return encodeFrame(header, parts);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validHeads(list: unknown): list is PacketHead[] {
  return (
    Array.isArray(list) &&
    list.every(
      (p) =>
        !!p &&
        (p.type === "key" || p.type === "delta") &&
        isFiniteNumber(p.tsUs) &&
        isFiniteNumber(p.durUs) &&
        isFiniteNumber(p.epoch) &&
        Number.isInteger(p.n) &&
        p.n >= 0,
    )
  );
}

function isChunkHeader(value: unknown): value is ChunkHeader {
  const h = value as Partial<ChunkHeader> | null;
  return (
    !!h &&
    h.t === "chunk" &&
    validHeads(h.video) &&
    validHeads(h.audio) &&
    Array.isArray(h.epochs) &&
    h.epochs.every((e) => !!e && isFiniteNumber(e.epoch) && typeof e.codec === "string" && Number.isInteger(e.n) && e.n >= 0) &&
    (h.audioConfig === null || (!!h.audioConfig && Number.isInteger(h.audioConfig.n) && h.audioConfig.n >= 0)) &&
    isFiniteNumber(h.primingSamples) &&
    isFiniteNumber(h.startUs) &&
    isFiniteNumber(h.endUs)
  );
}

function isJournalMeta(value: unknown): value is JournalMeta {
  const m = value as Partial<JournalMeta> | null;
  return !!m && m.t === "meta" && m.v === 1 && isClipId(m.recordingId) && !!m.meta && isClipId(m.meta.id) && isOwnerKey(m.meta.ownerKey);
}

/** A copy of `length` body bytes at `at`, as its own ArrayBuffer (the muxer may transfer or keep it). */
function take(body: Uint8Array, at: number, length: number): ArrayBuffer {
  return body.slice(at, at + length).buffer as ArrayBuffer;
}

/**
 * The part a journal holds: its row, and the packets of every whole chunk,
 * joined in order (null when no chunk has video). null when the journal has
 * no valid row.
 */
export function readJournal(bytes: Uint8Array, requestId: string): { meta: JournalMeta; packets: ClipPackets | null; torn: boolean } | null {
  const { frames, torn } = decodeFrames(bytes);
  const first = frames[0];
  if (!first || !isJournalMeta(first.header)) return null;
  const meta = first.header;
  const packets: ClipPackets = {
    requestId,
    video: [],
    audio: [],
    videoEpochs: [],
    audioConfig: null,
    primingSamples: 0,
    startUs: 0,
    endUs: 0,
    cutToNewestEpoch: false,
    coveredSec: 0,
  };
  const epochs = new Map<number, EpochInfo>();
  let started = false;
  for (const frame of frames.slice(1)) {
    const h = frame.header;
    if (!isChunkHeader(h)) break;
    let at = 0;
    const need = h.epochs.reduce((s, e) => s + e.n, 0) + (h.audioConfig?.n ?? 0) + [...h.video, ...h.audio].reduce((s, p) => s + p.n, 0);
    if (need !== frame.body.length) break;
    for (const e of h.epochs) {
      const info: EpochInfo = { epoch: e.epoch, codec: e.codec, codedWidth: e.codedWidth, codedHeight: e.codedHeight, description: take(frame.body, at, e.n) };
      if (e.colorSpace) info.colorSpace = e.colorSpace;
      at += e.n;
      if (!epochs.has(e.epoch)) epochs.set(e.epoch, info);
    }
    if (h.audioConfig) {
      const description = take(frame.body, at, h.audioConfig.n);
      at += h.audioConfig.n;
      packets.audioConfig ??= {
        codec: h.audioConfig.codec,
        sampleRate: h.audioConfig.sampleRate,
        numberOfChannels: h.audioConfig.numberOfChannels,
        description,
      };
    }
    for (const p of h.video) {
      packets.video.push({ kind: "video", type: p.type, tsUs: p.tsUs, durUs: p.durUs, epoch: p.epoch, data: take(frame.body, at, p.n) });
      at += p.n;
    }
    for (const p of h.audio) {
      packets.audio.push({ kind: "audio", type: p.type, tsUs: p.tsUs, durUs: p.durUs, epoch: p.epoch, data: take(frame.body, at, p.n) });
      at += p.n;
    }
    if (!started) packets.startUs = h.startUs;
    started = true;
    packets.endUs = Math.max(packets.endUs, h.endUs);
    packets.primingSamples = h.primingSamples;
  }
  if (packets.video.length === 0) return { meta, packets: null, torn };
  packets.videoEpochs = [...epochs.values()];
  packets.coveredSec = Math.max(0, (packets.endUs - packets.startUs) / 1e6);
  return { meta, packets, torn };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function journalDir(storage: StorageLike, create: boolean): Promise<DirectoryHandleLike | null> {
  if (typeof storage.getDirectory !== "function") return null;
  const root = await storage.getDirectory();
  try {
    return await root.getDirectoryHandle(JOURNAL_DIR, { create });
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  return (error as { name?: string } | null)?.name ?? "Error";
}

/** The journal of one open Record part. */
export class PartJournal {
  private handle: SyncAccessHandleLike | null;
  private size: number;
  private broken = false;

  private constructor(
    private readonly dir: DirectoryHandleLike,
    readonly fileName: string,
    handle: SyncAccessHandleLike,
    size: number,
    private readonly log: (message: string) => void,
  ) {
    this.handle = handle;
    this.size = size;
  }

  /**
   * Creates the journal of a part and writes its row. null when this browser
   * cannot journal (no OPFS, no SyncAccessHandle, or a write failed): the part
   * then lives in memory only, as before.
   */
  static async open(env: JournalEnv, meta: JournalMeta): Promise<PartJournal | null> {
    const log = env.log ?? (() => undefined);
    if (!env.storage) return null;
    let dir: DirectoryHandleLike | null = null;
    let file: FileHandleLike | null = null;
    const fileName = `${meta.meta.id}${JOURNAL_SUFFIX}`;
    try {
      dir = await journalDir(env.storage, true);
      if (!dir) return null;
      file = await dir.getFileHandle(fileName, { create: true });
      if (typeof file.createSyncAccessHandle !== "function") {
        // Not a dedicated worker: no appends in place. No journal, and no empty file left.
        await dir.removeEntry(fileName).catch(() => undefined);
        return null;
      }
      const handle = await file.createSyncAccessHandle();
      await handle.truncate(0);
      const journal = new PartJournal(dir, fileName, handle, 0, log);
      if (!(await journal.write(encodeFrame(meta, [])))) {
        await journal.remove();
        return null;
      }
      return journal;
    } catch (error) {
      log(`[clips] the recording journal could not start (${describe(error)}); the recording is kept in memory only`);
      if (dir && file) await dir.removeEntry(fileName).catch(() => undefined);
      return null;
    }
  }

  /** Appends one chunk. A failure ends the journal (the part stays in memory) and is logged once. */
  async append(packets: ClipPackets): Promise<void> {
    if (this.broken || !this.handle) return;
    await this.write(chunkFrame(packets));
  }

  private async write(frame: Uint8Array): Promise<boolean> {
    const handle = this.handle;
    if (!handle || this.broken) return false;
    try {
      let written = 0;
      while (written < frame.length) {
        const count = await handle.write(frame.subarray(written), { at: this.size + written });
        if (!(count > 0)) throw new Error(`the write stopped at ${written} of ${frame.length} bytes`);
        written += count;
      }
      await handle.flush();
      this.size += frame.length;
      return true;
    } catch (error) {
      this.broken = true;
      this.log(`[clips] the recording journal stopped (${describe(error)}); the rest of this part is kept in memory only`);
      // Cut a part frame off, so the file ends at the last whole frame.
      await Promise.resolve(handle.truncate(this.size)).catch(() => undefined);
      await Promise.resolve(handle.flush()).catch(() => undefined);
      return false;
    }
  }

  /** Closes the file and removes it (its part is stored, or failed and was reported). */
  async remove(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    if (handle) await Promise.resolve(handle.close()).catch(() => undefined);
    await this.dir.removeEntry(this.fileName).catch(() => undefined);
  }
}

/**
 * Holds the lock of an open recording until release(). Resolves when the lock
 * is held (or at once without Web Locks, or when the request fails).
 */
export async function holdRecordingLock(locks: JournalLocks | null, recordingId: string): Promise<{ release(): void }> {
  if (!locks) return { release: () => undefined };
  let letGo: () => void = () => undefined;
  let granted: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    granted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  try {
    void locks
      .request(`${RECORD_LOCK_PREFIX}${recordingId}`, { mode: "exclusive" }, () => {
        granted();
        return released;
      })
      .catch(() => granted());
  } catch {
    granted();
  }
  await held;
  return { release: () => letGo() };
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export interface RecoveredPart {
  meta: ClipMeta;
  packets: ClipPackets;
}

/** The whole file, or null when it cannot be read (open for writing by a live tab, or gone). */
export async function readJournalFile(dir: DirectoryHandleLike, name: string): Promise<Uint8Array | null> {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Runs `body` while this worker holds the recording's lock, taken with
 * ifAvailable, and returns true. Returns false and does not run `body` when
 * the lock is held somewhere else: a live tab records into the journal, or
 * another tab recovers it now. The lock is held until `body` settles, so the
 * read, the store and the remove of one journal happen in one tab only.
 */
export async function withFreeRecordingLock(
  locks: JournalLocks,
  recordingId: string,
  body: () => Promise<void>,
): Promise<boolean> {
  return locks.request(`${RECORD_LOCK_PREFIX}${recordingId}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await body();
    return true;
  });
}

/**
 * Stores the journals that dead tabs left (see the file comment) and returns
 * the stored rows. `store` muxes and saves one part and gives its row, or
 * null when it failed (the failure is reported there). Either way the
 * journal is removed, so a broken journal is never tried again at every
 * startup. Each journal is read again, stored and removed while this worker
 * holds its recording lock; a journal whose lock is held is skipped.
 */
export async function recoverJournals<R>(env: JournalEnv, store: (part: RecoveredPart) => Promise<R | null>): Promise<R[]> {
  const log = env.log ?? (() => undefined);
  const stored: R[] = [];
  const locks = env.locks;
  if (!env.storage || !locks) return stored;
  let dir: DirectoryHandleLike | null;
  try {
    dir = await journalDir(env.storage, false);
  } catch {
    return stored;
  }
  if (!dir) return stored;
  const journals = dir;
  const names: string[] = [];
  for await (const [name, handle] of journals.entries()) {
    if (handle.kind === "file" && name.endsWith(JOURNAL_SUFFIX)) names.push(name);
  }
  for (const name of names.sort()) {
    const partName = name.slice(0, -JOURNAL_SUFFIX.length);
    // The first read only finds the recording, so its lock can be asked for.
    const first = await readJournalFile(journals, name);
    if (!first) continue;
    const found = readJournal(first, partName);
    if (!found) {
      // No row frame: nothing to store and no recording to ask about.
      await journals.removeEntry(name).catch(() => undefined);
      continue;
    }
    try {
      await withFreeRecordingLock(locks, found.meta.recordingId, async () => {
        // Read again under the lock: another tab can have stored and removed it.
        const bytes = await readJournalFile(journals, name);
        if (!bytes) return;
        const part = readJournal(bytes, partName);
        if (part?.packets) {
          try {
            const row = await store({ meta: part.meta.meta, packets: part.packets });
            if (row !== null) stored.push(row);
          } catch (error) {
            log(`[clips] a saved recording could not be stored (${describe(error)})`);
          }
        }
        // Stored, failed for good (reported), or nothing in it: the journal goes.
        await journals.removeEntry(name).catch(() => undefined);
      });
    } catch (error) {
      // The lock request failed: a live tab cannot be told from a dead one.
      log(`[clips] a saved recording was left for later (${describe(error)})`);
    }
  }
  return stored;
}
