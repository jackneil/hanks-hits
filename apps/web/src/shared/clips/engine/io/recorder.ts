/**
 * The io side of Record (plan 8.4): it receives the Record tee of the encode
 * worker and stores the recording as "record" clips.
 *
 * The encode worker posts one RecordTeeMsg "chunk" for each closed GOP (a
 * keyframe first, with the AAC packets made since the last chunk), then
 * "end". A part collects chunks in memory. A part ends, and is muxed and
 * stored as its own clip, when:
 * - the next chunk has a different video config (plan 6.6: one track is never
 *   written across two configs; a new encoder epoch can have a new avcC), or
 * - the next chunk would make the part larger than the part limit.
 *
 * The part limit is a real constraint, not a length cap: the mux holds the
 * packets and the finished file in memory at the same time (plan 6.5 export
 * budgets: 60, 120 and 200 MB per memory class), and Chromium refuses to share
 * a file over 50 MiB (plan 8.4). A long recording therefore becomes several
 * videos. No chunk is ever dropped: every part is stored or reported as failed.
 *
 * All work runs on the io worker's command queue, so a part never races a
 * command. The session timeline journal in OPFS (plan 8.3, a later phase)
 * replaces the in-memory part.
 */

import type { ClipMeta, ClipPackets, ClipRecord, EpochInfo, IoEvent, MemoryClass, PacketDTO, RecordTeeMsg } from "../../protocol";
import { sameVideoConfig } from "./mux";

const MIB = 1024 * 1024;

/** The largest part, in bytes of encoded packets, for each memory class (see the file comment). */
export const RECORD_PART_MAX_BYTES: Readonly<Record<MemoryClass, number>> = Object.freeze({
  low: 24 * MIB,
  mid: 48 * MIB,
  high: 48 * MIB,
});

/** Longest id of a recording's first part, so "-p" plus a part number still fits a 64-character clip id. */
export const RECORD_ID_MAX_LENGTH = 56;

/** One stored part: its row and its span on the capture timeline. */
export interface RecordedPart {
  record: ClipRecord;
  startUs: number;
  endUs: number;
}

export interface RecorderHost {
  /** Muxes and stores one part. It posts the part's "saved", "evicted" and "error" events. Null on failure. */
  storePart(packets: ClipPackets, meta: ClipMeta, post: (event: IoEvent) => void): Promise<ClipRecord | null>;
  /** The part limit now (it follows the "configure" command). */
  maxPartBytes(): number;
}

interface Part {
  video: PacketDTO[];
  audio: PacketDTO[];
  epochs: Map<number, EpochInfo>;
  config: EpochInfo | null;
  audioConfig: ClipPackets["audioConfig"];
  primingSamples: number;
  startUs: number;
  endUs: number;
  bytes: number;
}

function packetBytes(list: readonly PacketDTO[]): number {
  let total = 0;
  for (const p of list) total += p.data?.byteLength ?? 0;
  return total;
}

/** The decoder config of the chunk's first video packet, or null when the chunk does not carry it. */
function chunkConfig(packets: ClipPackets): EpochInfo | null {
  const first = packets.video[0];
  if (!first) return null;
  return packets.videoEpochs.find((info) => info.epoch === first.epoch) ?? null;
}

/** The id of part n (0-based): the recording's id, then id-p2, id-p3, ... */
export function partId(baseId: string, index: number): string {
  return index === 0 ? baseId : `${baseId}-p${index + 1}`;
}

function isChunk(value: unknown): value is Extract<RecordTeeMsg, { t: "chunk" }> {
  const m = value as { t?: unknown; packets?: { video?: unknown; audio?: unknown; videoEpochs?: unknown } } | null;
  return (
    !!m &&
    m.t === "chunk" &&
    !!m.packets &&
    Array.isArray(m.packets.video) &&
    Array.isArray(m.packets.audio) &&
    Array.isArray(m.packets.videoEpochs)
  );
}

export class Recording {
  private part: Part | null = null;
  private partIndex = 0;
  private firstStartUs: number | null = null;
  private readonly parts: RecordedPart[] = [];
  private failed = 0;
  private ended = false;

  constructor(
    private readonly host: RecorderHost,
    readonly recordingId: string,
    private readonly meta: ClipMeta,
    private readonly post: (event: IoEvent) => void,
  ) {}

  get finished(): boolean {
    return this.ended;
  }

  /** Handles one message from the tee. Resolves when its work is done. */
  async handle(message: unknown): Promise<void> {
    if (this.ended) return;
    if (isChunk(message)) {
      if (message.recordingId !== this.recordingId) return;
      await this.chunk(message.packets);
      return;
    }
    const m = message as { t?: unknown; recordingId?: unknown } | null;
    if (m?.t === "end" && m.recordingId === this.recordingId) await this.end();
  }

  private async chunk(packets: ClipPackets): Promise<void> {
    if (packets.video.length === 0) return;
    const config = chunkConfig(packets);
    const bytes = packetBytes(packets.video) + packetBytes(packets.audio);
    const part = this.part;
    if (part) {
      const newConfig = config !== null && part.config !== null && !sameVideoConfig(part.config, config);
      const tooBig = part.bytes + bytes > this.host.maxPartBytes();
      if (newConfig || tooBig) await this.closePart();
    }
    this.firstStartUs ??= packets.startUs;
    if (!this.part) {
      const fresh: Part = {
        video: [],
        audio: [],
        epochs: new Map(),
        config,
        audioConfig: null,
        primingSamples: 0,
        startUs: packets.startUs,
        endUs: packets.endUs,
        bytes: 0,
      };
      this.part = fresh;
    }
    const open = this.part;
    for (const p of packets.video) open.video.push(p);
    for (const p of packets.audio) open.audio.push(p);
    for (const info of packets.videoEpochs) if (!open.epochs.has(info.epoch)) open.epochs.set(info.epoch, info);
    open.config ??= config;
    open.audioConfig ??= packets.audioConfig;
    open.primingSamples = packets.primingSamples;
    open.endUs = Math.max(open.endUs, packets.endUs);
    open.bytes += bytes;
  }

  private async closePart(): Promise<void> {
    const part = this.part;
    this.part = null;
    if (!part) return;
    const index = this.partIndex++;
    const packets: ClipPackets = {
      requestId: this.recordingId,
      video: part.video,
      audio: part.audio,
      videoEpochs: [...part.epochs.values()],
      audioConfig: part.audioConfig,
      primingSamples: part.primingSamples,
      startUs: part.startUs,
      endUs: part.endUs,
      cutToNewestEpoch: false,
      coveredSec: Math.max(0, (part.endUs - part.startUs) / 1e6),
    };
    const offsetMs = Math.max(0, Math.round((part.startUs - (this.firstStartUs ?? part.startUs)) / 1000));
    const meta: ClipMeta = {
      ...this.meta,
      id: partId(this.meta.id, index),
      // Later parts sort after earlier ones: each part is dated at its start in the recording.
      createdAt: this.meta.createdAt + offsetMs,
      durationMs: Math.round(packets.coveredSec * 1000),
      kind: "record",
    };
    const record = await this.host.storePart(packets, meta, this.post);
    if (record) this.parts.push({ record, startUs: part.startUs, endUs: part.endUs });
    else this.failed++;
  }

  private async end(): Promise<void> {
    if (this.ended) return;
    await this.closePart();
    this.ended = true;
    this.post({ t: "recorded", recordingId: this.recordingId, parts: this.parts.slice(), failed: this.failed });
  }
}
