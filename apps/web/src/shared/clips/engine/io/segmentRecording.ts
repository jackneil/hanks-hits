/**
 * The io side of Record on tiers M and V (plan 5, 8.4).
 *
 * On these tiers the main thread records with rotating MediaRecorders, so a
 * recording is a list of whole segment files. While Record runs, the main
 * thread sends each finished segment ("segmentRecordAdd"), and at the end
 * "segmentRecordEnd". Then the segments become record clips: the same part
 * rules as the Record tee (a new part at a different decoder config, or at
 * the part size limit), joined with concatSegments().
 *
 * Crash safety (plan 8.4): each segment is also appended to a journal file in
 * OPFS as it arrives:
 *
 *   rec/<recording id>.segments
 *
 * The file uses the frame format of recordJournal.ts. Frame 1 is the
 * recording (SegmentJournalMeta). Each next frame is one segment: its header
 * holds the capture times, and its body holds the segment bytes. While the
 * recording is open, the io worker holds the recording's Web Lock
 * (recordJournal.holdRecordingLock). At startup, a journal whose lock is free
 * belongs to a tab that is gone: its segments are stored as record clips, and
 * the file is removed. A tab that dies loses at most the segment that the
 * recorder was still making.
 *
 * No segment is dropped silently: a segment that does not parse is reported
 * with an "error" event and counted in "recorded".failed.
 */

import type { ClipMeta, ClipRecord, IoEvent, RecorderSegmentRef, SegmentContainer, SegmentIndex, SegmentJob } from "../../protocol";
import type { DirectoryHandleLike, FileHandleLike, SyncAccessHandleLike } from "../../library/fsTypes";
import { isClipId, isOwnerKey } from "../../library/ownerKey";
import { keysOf, planRecordParts, type SegmentKeys } from "./concat";
import { JOURNAL_DIR, RECORD_LOCK_PREFIX, decodeFrames, encodeFrame, type JournalEnv } from "./recordJournal";
import { partId } from "./recorder";

export const SEGMENT_JOURNAL_SUFFIX = ".segments";

/** The first frame of a segment journal. */
export interface SegmentJournalMeta {
  t: "segmeta";
  v: 1;
  recordingId: string;
  container: SegmentContainer;
  /** The recording's row (part 1's id and createdAt). */
  meta: ClipMeta;
}

interface SegmentFrameHeader {
  t: "segment";
  startUs: number;
  fromUs: number;
  toUs: number;
}

function describe(error: unknown): string {
  return (error as { name?: string } | null)?.name ?? "Error";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMeta(value: unknown): value is SegmentJournalMeta {
  const m = value as Partial<SegmentJournalMeta> | null;
  return (
    !!m &&
    m.t === "segmeta" &&
    m.v === 1 &&
    isClipId(m.recordingId) &&
    (m.container === "mp4" || m.container === "webm") &&
    !!m.meta &&
    isClipId(m.meta.id) &&
    isOwnerKey(m.meta.ownerKey)
  );
}

function isSegmentHeader(value: unknown): value is SegmentFrameHeader {
  const h = value as Partial<SegmentFrameHeader> | null;
  return !!h && h.t === "segment" && isFiniteNumber(h.startUs) && isFiniteNumber(h.fromUs) && isFiniteNumber(h.toUs);
}

/** A segment's window is usable: finite, not empty. */
export function isSegmentRef(value: unknown): value is RecorderSegmentRef {
  const s = value as Partial<RecorderSegmentRef> | null;
  return (
    !!s &&
    s.blob instanceof Blob &&
    isFiniteNumber(s.startUs) &&
    isFiniteNumber(s.fromUs) &&
    isFiniteNumber(s.toUs) &&
    s.fromUs < s.toUs
  );
}

/** The recording and the whole segments of a journal. null when the journal has no valid recording. */
export function readSegmentJournal(bytes: Uint8Array): { meta: SegmentJournalMeta; segments: RecorderSegmentRef[]; torn: boolean } | null {
  const { frames, torn } = decodeFrames(bytes);
  const first = frames[0];
  if (!first || !isMeta(first.header)) return null;
  const meta = first.header;
  const segments: RecorderSegmentRef[] = [];
  for (const frame of frames.slice(1)) {
    const h = frame.header;
    if (!isSegmentHeader(h) || frame.body.length === 0) break;
    segments.push({
      blob: new Blob([frame.body.slice().buffer as ArrayBuffer], { type: meta.container === "mp4" ? "video/mp4" : "video/webm" }),
      startUs: h.startUs,
      fromUs: h.fromUs,
      toUs: h.toUs,
    });
  }
  return { meta, segments, torn };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function journalDir(env: JournalEnv, create: boolean): Promise<DirectoryHandleLike | null> {
  const storage = env.storage;
  if (!storage || typeof storage.getDirectory !== "function") return null;
  const root = await storage.getDirectory();
  try {
    return await root.getDirectoryHandle(JOURNAL_DIR, { create });
  } catch {
    return null;
  }
}

/** The journal of one open segment recording. */
export class SegmentJournal {
  private handle: SyncAccessHandleLike | null;
  private size = 0;
  private broken = false;

  private constructor(
    private readonly dir: DirectoryHandleLike,
    readonly fileName: string,
    handle: SyncAccessHandleLike,
    private readonly log: (message: string) => void,
  ) {
    this.handle = handle;
  }

  /**
   * Creates the journal and writes the recording frame. null when this
   * browser cannot journal (no OPFS or no SyncAccessHandle, or a write
   * failed): the segments then stay in memory only.
   */
  static async open(env: JournalEnv, meta: SegmentJournalMeta): Promise<SegmentJournal | null> {
    const log = env.log ?? (() => undefined);
    const fileName = `${meta.recordingId}${SEGMENT_JOURNAL_SUFFIX}`;
    let dir: DirectoryHandleLike | null = null;
    let file: FileHandleLike | null = null;
    try {
      dir = await journalDir(env, true);
      if (!dir) return null;
      file = await dir.getFileHandle(fileName, { create: true });
      if (typeof file.createSyncAccessHandle !== "function") {
        await dir.removeEntry(fileName).catch(() => undefined);
        return null;
      }
      const handle = await file.createSyncAccessHandle();
      await handle.truncate(0);
      const journal = new SegmentJournal(dir, fileName, handle, log);
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

  /** Appends one segment. A failure ends the journal (the segments stay in memory) and is logged once. */
  async append(segment: RecorderSegmentRef): Promise<void> {
    if (this.broken || !this.handle) return;
    let body: Uint8Array;
    try {
      body = new Uint8Array(await segment.blob.arrayBuffer());
    } catch (error) {
      this.broken = true;
      this.log(`[clips] a recording segment could not be read for the journal (${describe(error)})`);
      return;
    }
    const header: SegmentFrameHeader = { t: "segment", startUs: segment.startUs, fromUs: segment.fromUs, toUs: segment.toUs };
    await this.write(encodeFrame(header, [body]));
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
      this.log(`[clips] the recording journal stopped (${describe(error)}); the rest of this recording is kept in memory only`);
      await Promise.resolve(handle.truncate(this.size)).catch(() => undefined);
      await Promise.resolve(handle.flush()).catch(() => undefined);
      return false;
    }
  }

  /** Closes the file and removes it (the recording is stored, or failed and was reported). */
  async remove(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    if (handle) await Promise.resolve(handle.close()).catch(() => undefined);
    await this.dir.removeEntry(this.fileName).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// The recording
// ---------------------------------------------------------------------------

export interface StoredPart {
  record: ClipRecord;
  startUs: number;
  endUs: number;
}

export interface SegmentRecordingHost {
  /** Joins and stores one part. It posts the part's "saved", "evicted" and "error" events. Null on failure. */
  storePart(job: SegmentJob, meta: ClipMeta, post: (event: IoEvent) => void): Promise<StoredPart | null>;
  /** Reads a segment's configs (to split the parts). Throws for a segment that does not parse. */
  index(blob: Blob, container: SegmentContainer): Promise<SegmentIndex>;
  /** The part limit now (it follows the "configure" command). */
  maxPartBytes(): number;
  /** Opens the journal (plan 8.4). null (or no method): the segments stay in memory only. */
  openJournal?(meta: SegmentJournalMeta): Promise<SegmentJournal | null>;
}

export class SegmentRecording {
  private readonly segments: RecorderSegmentRef[] = [];
  private readonly keys: SegmentKeys[] = [];
  private journal: Promise<SegmentJournal | null> | null = null;
  private failed = 0;
  private ended = false;

  constructor(
    private readonly host: SegmentRecordingHost,
    readonly recordingId: string,
    readonly container: SegmentContainer,
    private readonly meta: ClipMeta,
    private readonly post: (event: IoEvent) => void,
  ) {}

  get finished(): boolean {
    return this.ended;
  }

  /** Opens the journal. Call it once, before the first add(). */
  async start(): Promise<void> {
    this.journal ??= this.host.openJournal
      ? this.host.openJournal({ t: "segmeta", v: 1, recordingId: this.recordingId, container: this.container, meta: this.meta })
      : Promise.resolve(null);
    await this.journal;
  }

  /** Adds one segment: its configs are read now, and it goes to the journal. */
  async add(segment: RecorderSegmentRef): Promise<void> {
    if (this.ended) return;
    if (!isSegmentRef(segment)) {
      this.failed++;
      this.post({ t: "error", code: "bad-command", detail: "a recording segment has no bytes or a bad window", id: this.meta.id });
      return;
    }
    let index: SegmentIndex;
    try {
      index = await this.host.index(segment.blob, this.container);
    } catch (error) {
      // Reported, never dropped silently: the "recorded" answer counts it.
      this.failed++;
      this.post({ t: "error", code: "mux-failed", detail: `a recording segment does not parse: ${(error as Error).message}`, id: this.meta.id });
      return;
    }
    this.segments.push(segment);
    this.keys.push(keysOf(index));
    const journal = await (this.journal ?? Promise.resolve(null));
    await journal?.append(segment);
  }

  /** Stores the parts, removes the journal, and posts "recorded". */
  async end(): Promise<StoredPart[]> {
    if (this.ended) return [];
    this.ended = true;
    const stored: StoredPart[] = [];
    const parts = planRecordParts(this.segments, this.keys, this.host.maxPartBytes());
    const firstStartUs = this.segments[0]?.fromUs ?? 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const offsetMs = Math.max(0, Math.round((part[0].fromUs - firstStartUs) / 1000));
      const meta: ClipMeta = {
        ...this.meta,
        id: partId(this.meta.id, i),
        // Later parts sort after earlier ones: each part is dated at its start in the recording.
        createdAt: this.meta.createdAt + offsetMs,
        kind: "record",
      };
      const result = await this.host.storePart({ container: this.container, segments: part }, meta, this.post);
      if (result) stored.push(result);
      else this.failed++;
    }
    const journal = await (this.journal ?? Promise.resolve(null));
    // Stored, or failed and reported: the journal is not needed any more.
    await journal?.remove();
    this.segments.length = 0;
    this.post({ t: "recorded", recordingId: this.recordingId, parts: stored.slice(), failed: this.failed });
    return stored;
  }
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

/**
 * Stores the segment journals that dead tabs left, and returns the stored
 * rows. A journal whose recording lock is held (a live tab) is skipped.
 * Every other journal is removed after the try, stored or not, so a broken
 * journal is not tried again at every startup.
 */
export async function recoverSegmentJournals(
  env: JournalEnv,
  host: Omit<SegmentRecordingHost, "openJournal">,
  post: (event: IoEvent) => void,
): Promise<ClipRecord[]> {
  const log = env.log ?? (() => undefined);
  const records: ClipRecord[] = [];
  if (!env.storage || !env.locks) return records;
  let dir: DirectoryHandleLike | null;
  try {
    dir = await journalDir(env, false);
  } catch {
    return records;
  }
  if (!dir) return records;
  let held: Set<string>;
  try {
    const snapshot = await env.locks.query();
    held = new Set((snapshot.held ?? []).map((l) => l.name ?? ""));
  } catch {
    return records;
  }
  const names: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file" && name.endsWith(SEGMENT_JOURNAL_SUFFIX)) names.push(name);
  }
  for (const name of names.sort()) {
    let bytes: Uint8Array;
    try {
      const file = await (await dir.getFileHandle(name)).getFile();
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      // Open for writing by a live tab, or gone.
      continue;
    }
    const journal = readSegmentJournal(bytes);
    if (journal && held.has(`${RECORD_LOCK_PREFIX}${journal.meta.recordingId}`)) continue;
    if (journal && journal.segments.length > 0) {
      try {
        const recording = new SegmentRecording(host, journal.meta.recordingId, journal.meta.container, journal.meta.meta, (event) => {
          // The recovered rows go in one "recovered" event; errors go out now.
          if (event.t === "error" || event.t === "evicted") post(event);
        });
        for (const segment of journal.segments) await recording.add(segment);
        for (const part of await recording.end()) records.push(part.record);
      } catch (error) {
        log(`[clips] a saved recording could not be stored (${describe(error)})`);
      }
    }
    await dir.removeEntry(name).catch(() => undefined);
  }
  return records;
}
