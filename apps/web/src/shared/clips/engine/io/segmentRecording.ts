/**
 * The io side of Record on tiers M and V (plan 5, 8.4).
 *
 * On these tiers the main thread records video with rotating MediaRecorders,
 * so a recording is a list of whole segment files. While Record runs, the
 * main thread sends each finished segment ("segmentRecordAdd"), and at the
 * end "segmentRecordEnd". The game sound comes from the io worker's sound
 * runs (soundStore.ts): the recording copies the packets of its timeline as
 * they arrive, so the ring length never limits it. At the end the segments
 * become record clips: the same part rules as the Record tee (a new part at a
 * different video config, or at the part size limit), joined with
 * concatSegments() and the recording's sound.
 *
 * The segments can come in any order (two recorders that a pause stopped
 * together in a hand-off give their files in either order). The end puts
 * them in order and makes their windows meet (orderRecordSegments()).
 *
 * Crash safety (plan 8.4): the recording is also written to a journal file
 * in OPFS as it goes:
 *
 *   rec/<recording id>.segments
 *
 * The file uses the frame format of recordJournal.ts. Frame 1 is the
 * recording (SegmentJournalMeta). A "segment" frame holds one segment (its
 * header has the capture times, its body the segment bytes and, for a
 * segment that can start a part, the poster JPEG). A "sound" frame holds the
 * sound packets of about one second. While the recording is open, the io
 * worker holds the recording's Web Lock (recordJournal.holdRecordingLock).
 * At startup, a journal whose lock is free belongs to a tab that is gone:
 * its segments and sound are stored as record clips, and the file is
 * removed. A tab that dies loses at most the segment that the recorder was
 * still making and the last second of sound.
 *
 * Posters: a device with no video decoder (common on tier V) cannot make a
 * poster from the file, so the main thread sends a JPEG of the game picture
 * at the tap and with each segment. The recording keeps the JPEG of each
 * segment that starts a part (and the one of the tap for part 1).
 *
 * No segment is dropped silently: a segment that does not parse is reported
 * with an "error" event and counted in "recorded".failed.
 */

import type { ClipMeta, ClipRecord, IoEvent, RecorderSegmentRef, SegmentContainer, SegmentIndex, SegmentJob } from "../../protocol";
import type { DirectoryHandleLike, FileHandleLike, SyncAccessHandleLike } from "../../library/fsTypes";
import { isClipId, isOwnerKey } from "../../library/ownerKey";
import { audioConfigKey, orderRecordSegments, planRecordParts, type SoundSource } from "./concat";
import { JOURNAL_DIR, RECORD_LOCK_PREFIX, decodeFrames, encodeFrame, type JournalEnv } from "./recordJournal";
import { partId } from "./recorder";
import { pickSound, type SoundFormat, type SoundPacket } from "./soundStore";

export const SEGMENT_JOURNAL_SUFFIX = ".segments";

/**
 * How far before the tap a recording keeps sound. The recording starts at
 * the last keyframe at or before the tap: at most one rotation period (4.5 s)
 * before it, plus a few hand-offs that were tried again. 15 s covers that
 * with room, and it is about 240 KiB of sound at 128 kbit/s.
 */
export const RECORD_SOUND_BACK_US = 15_000_000;

/** The sound of about this long goes into one journal frame. */
export const SOUND_FRAME_US = 1_000_000;

/** How long the end of a recording waits for its last sound. */
export const RECORD_SOUND_WAIT_MS = 3000;

/** The first frame of a segment journal. */
export interface SegmentJournalMeta {
  t: "segmeta";
  v: 2;
  recordingId: string;
  container: SegmentContainer;
  /** The recording's row (part 1's id and createdAt). */
  meta: ClipMeta;
  /** Capture time of the Record tap, or null. */
  tapUs: number | null;
  /** The tap poster's byte count in this frame's body, or 0. */
  posterBytes: number;
}

interface SegmentFrameHeader {
  t: "segment";
  startUs: number;
  fromUs: number;
  toUs: number;
  /** The poster's byte count after the segment bytes, or 0. */
  posterBytes: number;
}

interface SoundFrameHeader {
  t: "sound";
  codec: SoundFormat["codec"];
  sampleRate: number;
  channels: number;
  configCodec: string;
  /** The config description's byte count at the start of the body. */
  descriptionBytes: number;
  packets: Array<{ capUs: number; durUs: number; key: boolean; n: number }>;
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
    m.v === 2 &&
    isClipId(m.recordingId) &&
    (m.container === "mp4" || m.container === "webm") &&
    !!m.meta &&
    isClipId(m.meta.id) &&
    isOwnerKey(m.meta.ownerKey) &&
    (m.tapUs === null || isFiniteNumber(m.tapUs)) &&
    isFiniteNumber(m.posterBytes)
  );
}

function isSegmentHeader(value: unknown): value is SegmentFrameHeader {
  const h = value as Partial<SegmentFrameHeader> | null;
  return !!h && h.t === "segment" && isFiniteNumber(h.startUs) && isFiniteNumber(h.fromUs) && isFiniteNumber(h.toUs) && isFiniteNumber(h.posterBytes);
}

function isSoundHeader(value: unknown): value is SoundFrameHeader {
  const h = value as Partial<SoundFrameHeader> | null;
  return (
    !!h &&
    h.t === "sound" &&
    typeof h.codec === "string" &&
    typeof h.configCodec === "string" &&
    isFiniteNumber(h.sampleRate) &&
    isFiniteNumber(h.channels) &&
    isFiniteNumber(h.descriptionBytes) &&
    Array.isArray(h.packets) &&
    h.packets.every((p) => !!p && isFiniteNumber(p.capUs) && isFiniteNumber(p.durUs) && isFiniteNumber(p.n) && typeof p.key === "boolean")
  );
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

const JPEG = "image/jpeg";

function blobOf(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type });
}

/** A copy of a decoder config description, or null. */
function bytesOfSource(source: AllowSharedBufferSource | undefined): Uint8Array | null {
  if (!source) return null;
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source as ArrayBuffer);
  return view.length > 0 ? view.slice() : null;
}

export interface JournalSegment {
  segment: RecorderSegmentRef;
  poster: Blob | null;
}

/** What a segment journal holds. null when the journal has no valid recording. */
export function readSegmentJournal(
  bytes: Uint8Array,
): { meta: SegmentJournalMeta; poster: Blob | null; segments: JournalSegment[]; sound: SoundPacket[]; torn: boolean } | null {
  const { frames, torn } = decodeFrames(bytes);
  const first = frames[0];
  if (!first || !isMeta(first.header)) return null;
  const meta = first.header;
  const poster = meta.posterBytes > 0 && first.body.length >= meta.posterBytes ? blobOf(first.body.subarray(0, meta.posterBytes), JPEG) : null;
  const segments: JournalSegment[] = [];
  const sound: SoundPacket[] = [];
  const formats = new Map<string, SoundFormat>();
  for (const frame of frames.slice(1)) {
    const h = frame.header;
    if (isSegmentHeader(h)) {
      const segmentBytes = frame.body.length - h.posterBytes;
      if (segmentBytes <= 0) break;
      segments.push({
        segment: {
          blob: blobOf(frame.body.subarray(0, segmentBytes), meta.container === "mp4" ? "video/mp4" : "video/webm"),
          startUs: h.startUs,
          fromUs: h.fromUs,
          toUs: h.toUs,
        },
        poster: h.posterBytes > 0 ? blobOf(frame.body.subarray(segmentBytes), JPEG) : null,
      });
      continue;
    }
    if (isSoundHeader(h)) {
      const description = h.descriptionBytes > 0 ? frame.body.slice(0, h.descriptionBytes) : undefined;
      const config: AudioDecoderConfig = {
        codec: h.configCodec,
        sampleRate: h.sampleRate,
        numberOfChannels: h.channels,
        ...(description ? { description } : {}),
      };
      const key = audioConfigKey(config);
      const format = formats.get(key) ?? { codec: h.codec, config, key };
      formats.set(key, format);
      let at = h.descriptionBytes;
      for (const p of h.packets) {
        if (at + p.n > frame.body.length) break;
        sound.push({ capUs: p.capUs, durUs: p.durUs, key: p.key, data: frame.body.slice(at, at + p.n), format });
        at += p.n;
      }
      continue;
    }
    break;
  }
  return { meta, poster, segments, sound, torn };
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

/** The journal of one open segment recording. Its writes run one at a time, in order. */
export class SegmentJournal {
  private handle: SyncAccessHandleLike | null;
  private size = 0;
  private broken = false;
  private chain: Promise<unknown> = Promise.resolve();

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
   * failed): the recording then stays in memory only.
   */
  static async open(env: JournalEnv, meta: SegmentJournalMeta, poster: Uint8Array | null): Promise<SegmentJournal | null> {
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
      if (!(await journal.write(encodeFrame({ ...meta, posterBytes: poster?.length ?? 0 }, poster ? [poster] : [])))) {
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

  /** Appends one segment (and its poster). A failure ends the journal and is logged once. */
  appendSegment(segment: RecorderSegmentRef, poster: Blob | null): Promise<void> {
    return this.queue(async () => {
      let body: Uint8Array;
      let posterBytes: Uint8Array | null = null;
      try {
        body = new Uint8Array(await segment.blob.arrayBuffer());
        if (poster) posterBytes = new Uint8Array(await poster.arrayBuffer());
      } catch (error) {
        this.broken = true;
        this.log(`[clips] a recording segment could not be read for the journal (${describe(error)})`);
        return;
      }
      const header: SegmentFrameHeader = {
        t: "segment",
        startUs: segment.startUs,
        fromUs: segment.fromUs,
        toUs: segment.toUs,
        posterBytes: posterBytes?.length ?? 0,
      };
      await this.write(encodeFrame(header, posterBytes ? [body, posterBytes] : [body]));
    });
  }

  /** Appends sound packets of one format. */
  appendSound(packets: readonly SoundPacket[]): Promise<void> {
    if (packets.length === 0) return Promise.resolve();
    return this.queue(async () => {
      const format = packets[0].format;
      const description = bytesOfSource(format.config.description);
      const header: SoundFrameHeader = {
        t: "sound",
        codec: format.codec,
        configCodec: format.config.codec,
        sampleRate: format.config.sampleRate,
        channels: format.config.numberOfChannels,
        descriptionBytes: description?.length ?? 0,
        packets: packets.map((p) => ({ capUs: p.capUs, durUs: p.durUs, key: p.key, n: p.data.length })),
      };
      await this.write(encodeFrame(header, [...(description ? [description] : []), ...packets.map((p) => p.data)]));
    });
  }

  /** Waits for the writes so far. */
  flushed(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  private queue(task: () => Promise<void>): Promise<void> {
    const next = this.chain.then(() => (this.broken || !this.handle ? undefined : task()));
    this.chain = next.catch(() => undefined);
    return next.catch(() => undefined);
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
    await this.flushed();
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
  /** Joins and stores one part with its sound. It posts the part's "saved", "evicted" and "error" events. Null on failure. */
  storePart(job: SegmentJob, meta: ClipMeta, post: (event: IoEvent) => void, sound: SoundSource | null): Promise<StoredPart | null>;
  /** Reads a segment's configs (to split the parts). Throws for a segment that does not parse. */
  index(blob: Blob, container: SegmentContainer): Promise<SegmentIndex>;
  /** The part limit now (it follows the "configure" command). */
  maxPartBytes(): number;
  /** Opens the journal (plan 8.4). null (or no method): the recording stays in memory only. */
  openJournal?(meta: SegmentJournalMeta, poster: Uint8Array | null): Promise<SegmentJournal | null>;
}

/** The game sound of a live recording's timeline (the io worker's sound store). */
export interface RecordingSound {
  /** The packets held now. */
  held(): SoundPacket[];
  /** Hears each new packet. Returns the stop function. */
  subscribe(listener: (packet: SoundPacket) => void): () => void;
  /** Settles when the sound reaches untilUs (or no more can come, or a timeout). */
  ready(untilUs: number): Promise<void>;
}

export interface SegmentRecordingOptions {
  recordingId: string;
  container: SegmentContainer;
  meta: ClipMeta;
  /** Capture time of the Record tap (the recording starts at a keyframe at or before it), or null. */
  tapUs: number | null;
  /** A JPEG of the game picture at the tap, or null. */
  poster: Blob | null;
  post: (event: IoEvent) => void;
  /** The live sound. null: the sound comes from `seedSound` only (a recovered journal). */
  sound: RecordingSound | null;
  /** Sound packets that the recording has already (a recovered journal). */
  seedSound?: SoundPacket[];
}

interface Entry {
  segment: RecorderSegmentRef;
  videoKey: string;
  /** Kept only for a segment that can start a part. */
  poster: Blob | null;
}

export class SegmentRecording {
  readonly recordingId: string;
  readonly container: SegmentContainer;
  private readonly meta: ClipMeta;
  private readonly tapUs: number | null;
  private readonly tapPoster: Blob | null;
  private readonly post: (event: IoEvent) => void;
  private readonly entries: Entry[] = [];
  private readonly sound: SoundPacket[] = [];
  private readonly soundSource: RecordingSound | null;
  private pendingSound: SoundPacket[] = [];
  private stopSound: (() => void) | null = null;
  private journal: Promise<SegmentJournal | null> | null = null;
  private failed = 0;
  private ended = false;
  /** Greedy part planning in arrival order: which posters to keep. */
  private planBytes = 0;
  private planKey: string | null = null;

  constructor(
    private readonly host: SegmentRecordingHost,
    options: SegmentRecordingOptions,
  ) {
    this.recordingId = options.recordingId;
    this.container = options.container;
    this.meta = options.meta;
    this.tapUs = options.tapUs;
    this.tapPoster = options.poster;
    this.post = options.post;
    this.soundSource = options.sound;
    for (const p of options.seedSound ?? []) this.keepSound(p, false);
  }

  get finished(): boolean {
    return this.ended;
  }

  /** Opens the journal and starts to copy the sound. Call it once, before the first add(). */
  async start(): Promise<void> {
    if (this.journal) return;
    let posterBytes: Uint8Array | null = null;
    try {
      posterBytes = this.tapPoster ? new Uint8Array(await this.tapPoster.arrayBuffer()) : null;
    } catch {
      posterBytes = null;
    }
    this.journal = this.host.openJournal
      ? this.host.openJournal(
          { t: "segmeta", v: 2, recordingId: this.recordingId, container: this.container, meta: this.meta, tapUs: this.tapUs, posterBytes: 0 },
          posterBytes,
        )
      : Promise.resolve(null);
    if (this.soundSource) {
      for (const p of this.soundSource.held()) this.keepSound(p, true);
      this.stopSound = this.soundSource.subscribe((p) => this.keepSound(p, true));
    }
    await this.journal;
    this.flushSound();
  }

  /** Adds one segment: its configs are read now, and it goes to the journal. */
  async add(segment: RecorderSegmentRef, poster: Blob | null = null): Promise<void> {
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
    const startsPart = this.startsPart(segment, index.videoConfigKey);
    const kept = startsPart && poster instanceof Blob ? poster : null;
    this.entries.push({ segment, videoKey: index.videoConfigKey, poster: kept });
    this.flushSound();
    const journal = await (this.journal ?? Promise.resolve(null));
    await journal?.appendSegment(segment, kept);
  }

  /** Stores the parts, removes the journal, and posts "recorded". */
  async end(): Promise<StoredPart[]> {
    if (this.ended) return [];
    this.ended = true;
    const ordered = orderRecordSegments(this.entries, this.tapUs);
    const lastTo = ordered.reduce((most, e) => Math.max(most, e.segment.toUs), -Infinity);
    if (this.soundSource && Number.isFinite(lastTo)) await this.soundSource.ready(lastTo);
    this.stopSound?.();
    this.stopSound = null;
    this.pendingSound = [];
    const stored: StoredPart[] = [];
    const segments = ordered.map((e) => e.segment);
    const parts = planRecordParts(
      segments,
      ordered.map((e) => e.videoKey),
      this.host.maxPartBytes(),
    );
    const firstStartUs = segments[0]?.fromUs ?? 0;
    const sound: SoundSource = (fromUs, toUs) => pickSound(this.sound, fromUs, toUs);
    let at = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const partEntries = ordered.slice(at, at + part.length);
      at += part.length;
      const offsetMs = Math.max(0, Math.round((part[0].fromUs - firstStartUs) / 1000));
      const meta: ClipMeta = {
        ...this.meta,
        id: partId(this.meta.id, i),
        // Later parts sort after earlier ones: each part is dated at its start in the recording.
        createdAt: this.meta.createdAt + offsetMs,
        kind: "record",
      };
      const poster = partEntries.find((e) => e.poster)?.poster ?? (i === 0 ? this.tapPoster : null);
      const job: SegmentJob = { container: this.container, segments: part, ...(poster ? { poster } : {}) };
      const result = await this.host.storePart(job, meta, this.post, sound);
      if (result) stored.push(result);
      else this.failed++;
    }
    const journal = await (this.journal ?? Promise.resolve(null));
    // Stored, or failed and reported: the journal is not needed any more.
    await journal?.remove();
    this.entries.length = 0;
    this.sound.length = 0;
    this.post({ t: "recorded", recordingId: this.recordingId, parts: stored.slice(), failed: this.failed });
    return stored;
  }

  /** True when this segment starts a new part in the greedy plan (arrival order). */
  private startsPart(segment: RecorderSegmentRef, key: string): boolean {
    const size = segment.blob.size;
    const starts = this.planKey === null || key !== this.planKey || this.planBytes + size > this.host.maxPartBytes();
    this.planBytes = starts ? size : this.planBytes + size;
    this.planKey = key;
    return starts;
  }

  private keepSound(packet: SoundPacket, journal: boolean): void {
    if (this.ended) return;
    if (this.tapUs !== null && packet.capUs < this.tapUs - RECORD_SOUND_BACK_US) return;
    this.sound.push(packet);
    if (!journal) return;
    this.pendingSound.push(packet);
    const first = this.pendingSound[0];
    if (packet.capUs - first.capUs >= SOUND_FRAME_US) this.flushSound();
  }

  /** Writes the pending sound to the journal (once it is open), one frame per format. */
  private flushSound(): void {
    const journal = this.journal;
    if (!journal || this.pendingSound.length === 0) return;
    const pending = this.pendingSound;
    this.pendingSound = [];
    void journal.then((j) => {
      if (!j) return;
      let batch: SoundPacket[] = [];
      for (const p of pending) {
        if (batch.length > 0 && batch[0].format !== p.format) {
          void j.appendSound(batch);
          batch = [];
        }
        batch.push(p);
      }
      void j.appendSound(batch);
    });
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
        const recording = new SegmentRecording(host, {
          recordingId: journal.meta.recordingId,
          container: journal.meta.container,
          meta: journal.meta.meta,
          tapUs: journal.meta.tapUs,
          poster: journal.poster,
          // The recovered rows go in one "recovered" event; errors go out now.
          post: (event) => {
            if (event.t === "error" || event.t === "evicted") post(event);
          },
          sound: null,
          seedSound: journal.sound,
        });
        for (const { segment, poster } of journal.segments) await recording.add(segment, poster);
        for (const part of await recording.end()) records.push(part.record);
      } catch (error) {
        log(`[clips] a saved recording could not be stored (${describe(error)})`);
      }
    }
    await dir.removeEntry(name).catch(() => undefined);
  }
  return records;
}
