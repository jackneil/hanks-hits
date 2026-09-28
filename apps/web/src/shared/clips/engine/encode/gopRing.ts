/**
 * Video GOP ring (plan 6.5).
 *
 * The ring keeps whole GOPs (a keyframe and the deltas after it), tagged with
 * their epoch. Two budgets apply:
 * - Time: keep the fewest GOPs that still cover ringSeconds. A GOP leaves only
 *   when the GOPs after it still cover the full ringSeconds.
 * - Bytes: a ceiling per memory class, for encoder overshoot. A trim for bytes
 *   can cut coverage below ringSeconds. The ring counts each such trim and
 *   reports the exact coverage that is left, so the clip button can show the
 *   real seconds (plan 6.5: "shows the real seconds on the button").
 * The newest GOP always stays, because it is the only one that can be open.
 * If one GOP is larger than the whole budget (keyframe starvation), it stays,
 * and the starvation recovery starts new GOPs soon after.
 */

import type { MemoryClass } from "../../protocol";
import type { VideoPacket } from "./videoSession";

const MIB = 1024 * 1024;

/**
 * Byte ceilings per memory class. At the plan's highest bitrate (3.5 Mbps,
 * 60 fps 2D), a 60 s ring is 26 MB and a 30 s ring is 13 MB, so each ceiling
 * holds the nominal ring about 2.4 times over. The ceilings only guard against
 * a runaway encoder. They never limit a normal session.
 */
export const VIDEO_RING_BYTE_CEILING: Record<MemoryClass, number> = {
  low: 32 * MIB,
  mid: 64 * MIB,
  high: 128 * MIB,
};

export interface Gop {
  epoch: number;
  startUs: number;
  /** End of the last packet (max ts + duration). */
  endUs: number;
  bytes: number;
  packets: VideoPacket[];
}

export interface RingCoverage {
  startUs: number;
  endUs: number;
  seconds: number;
}

export interface RingTrim {
  reason: "time" | "bytes";
  epoch: number;
  startUs: number;
  endUs: number;
  bytes: number;
}

export interface GopRingOptions {
  ringSeconds: number;
  byteBudget: number;
  /** Called for each GOP that leaves the ring. */
  onTrim?: (trim: RingTrim) => void;
}

export class GopRing {
  private readonly ringUs: number;
  private readonly byteBudget: number;
  private readonly onTrim?: (trim: RingTrim) => void;
  private list: Gop[] = [];
  private totalBytes = 0;
  private droppedDeltas = 0;
  private byteTrimCount = 0;
  private lastTrimReason: "time" | "bytes" | null = null;

  constructor(options: GopRingOptions) {
    this.ringUs = Math.max(0, options.ringSeconds) * 1e6;
    this.byteBudget = options.byteBudget;
    this.onTrim = options.onTrim;
  }

  /** Adds a packet in decode order. A key starts a GOP. A delta joins the newest GOP of its epoch. */
  push(p: VideoPacket): void {
    const last = this.list[this.list.length - 1];
    if (p.type === "key" || !last || last.epoch !== p.epoch) {
      if (p.type !== "key") {
        this.droppedDeltas++;
        return;
      }
      this.list.push({ epoch: p.epoch, startUs: p.tsUs, endUs: p.tsUs + p.durUs, bytes: p.data.byteLength, packets: [p] });
    } else {
      last.packets.push(p);
      last.bytes += p.data.byteLength;
      last.endUs = Math.max(last.endUs, p.tsUs + p.durUs);
    }
    this.totalBytes += p.data.byteLength;
    this.trim();
  }

  /** GOPs, oldest first. Do not change them. */
  get gops(): readonly Gop[] {
    return this.list;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  get empty(): boolean {
    return this.list.length === 0;
  }

  /** End of the newest packet, or -Infinity when empty. */
  get endUs(): number {
    return this.list.length ? this.list[this.list.length - 1].endUs : -Infinity;
  }

  /** Exact coverage: from the oldest keyframe to the end of the newest packet. */
  get coverage(): RingCoverage | null {
    if (!this.list.length) return null;
    const startUs = this.list[0].startUs;
    const endUs = this.endUs;
    return { startUs, endUs, seconds: (endUs - startUs) / 1e6 };
  }

  /** True when a byte trim is why coverage is shorter than ringSeconds. */
  get limitedByBytes(): boolean {
    const c = this.coverage;
    return !!c && this.lastTrimReason === "bytes" && c.endUs - c.startUs < this.ringUs;
  }

  get byteTrims(): number {
    return this.byteTrimCount;
  }

  /** Deltas that arrived with no GOP to join. The session guard makes this 0 in practice. */
  get orphanDeltas(): number {
    return this.droppedDeltas;
  }

  /** The newest GOP, which can still grow. */
  get newest(): Gop | null {
    return this.list[this.list.length - 1] ?? null;
  }

  epochsInUse(): Set<number> {
    return new Set(this.list.map((g) => g.epoch));
  }

  clear(): void {
    this.list = [];
    this.totalBytes = 0;
    this.lastTrimReason = null;
  }

  private trim(): void {
    while (this.list.length > 1 && this.endUs - this.list[1].startUs >= this.ringUs) this.dropOldest("time");
    while (this.list.length > 1 && this.totalBytes > this.byteBudget) {
      this.dropOldest("bytes");
      this.byteTrimCount++;
    }
  }

  private dropOldest(reason: "time" | "bytes"): void {
    const g = this.list.shift()!;
    this.totalBytes -= g.bytes;
    this.lastTrimReason = reason;
    this.onTrim?.({ reason, epoch: g.epoch, startUs: g.startUs, endUs: g.endUs, bytes: g.bytes });
  }
}
