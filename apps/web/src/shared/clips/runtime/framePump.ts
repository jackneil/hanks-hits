/**
 * Frame pump: slot timing, backpressure and pause removal (plan 6.2).
 *
 * The pump decides WHEN a source takes a frame and gives every frame a
 * timestamp from TIME, never from a counter:
 *
 *   elapsed = contentMs - epochMs - removedPauseMs
 *   m       = round(elapsed / vsyncMs)               nearest vsync index
 *   slot    = floor((m - segmentStartM) / k)         k = capture stride
 *   tsUs    = (segmentStartM + slot * k) * vsyncUs
 *
 * This is the plan's slot formula with the epoch put on the vsync grid: a
 * frame that the display shows on vsync n falls in the slot that starts at the
 * last multiple of k at or before n. A regular game therefore gets exact
 * timestamps, and jitter under half a vsync never moves a frame to another
 * slot. The first frame of a slot is taken; later frames in the same slot are
 * not taken, so the capture cost stays at the rung rate.
 *
 * Durations: the pump holds the newest frame until the next frame arrives. The
 * held frame then goes to the sink with duration = next.ts - held.ts. So an
 * empty slot (a missed vsync, a stall or a backpressure drop) extends the
 * previous frame, and the video is as long as the wall time. When two frames
 * get the same timestamp (after a rung change or a pause), the later frame
 * replaces the held one.
 *
 * Backpressure: at most maxInFlight frames are posted and not yet "consumed".
 * When the sink is full, the pump does not take a new frame (counted as a
 * drop) and the held frame extends. Frames are never queued.
 *
 * Timeline: the pump posts { t: "timeline" } commands on the same sink, so
 * the encode worker removes the same paused spans from audio:
 *   live   atPerfMs = epochMs        before the first frame (media time 0)
 *   paused atPerfMs = pause time
 *   live   atPerfMs = resume time
 * Media time of a page instant T = T - epochMs - (paused time before T).
 *
 * All times are page-realm performance.now() milliseconds. A source in an
 * iframe realm converts its rAF timestamps first (see canvasSource).
 */
import { MAX_FRAMES_IN_FLIGHT, type EncodeCmd, type FrameIn, type HudState } from "../protocol";
import { strideFor } from "./rungs";

/** A MessagePort-like target: a worker, a MessagePort, or a test double. */
export interface FrameSink {
  postMessage(message: EncodeCmd, transfer: Transferable[]): void;
}

/** What a source hands to the pump for one ticket. */
export type CapturedPayload =
  | { t: "frame"; frame: VideoFrame }
  | { t: "pixels"; data: ArrayBuffer; width: number; height: number };

/** Permission to take one frame. Submit or abandon it, in ticket order. */
export interface CaptureTicket {
  readonly seq: number;
  readonly tsUs: number;
}

export interface FramePumpOptions {
  sink: FrameSink;
  displayHz: number;
  targetFps: number;
  /** Stride override (a governor rung). Default: ceil(displayHz / targetFps). */
  stride?: number;
  maxInFlight?: number;
}

export interface FramePumpStats {
  /** Tickets given out. */
  offered: number;
  /** Payloads accepted from sources. */
  captured: number;
  /** Frames posted to the sink. */
  sent: number;
  /** Frames not taken because the sink was full. */
  dropsBackpressure: number;
  /** Captured frames closed because the sink was full when they arrived. */
  dropsLate: number;
  /** Tickets a source could not fill (busy readback slots, errors). */
  abandoned: number;
  /** Held frames replaced by a later frame with the same timestamp. */
  replaced: number;
  /** Payloads that arrived out of ticket order and were closed. */
  outOfOrder: number;
  /** Frames posted and not yet consumed. */
  inFlight: number;
  /** End of the last posted frame, in media microseconds. */
  mediaEndUs: number;
}

interface Held {
  tsUs: number;
  payload: CapturedPayload;
  hud: HudState;
  /** Fixed end (a pause or a flush sealed the frame). Null while open. */
  endUs: number | null;
}

function closePayload(payload: CapturedPayload): void {
  if (payload.t === "frame") {
    try {
      payload.frame.close();
    } catch {
      // Already closed or transferred.
    }
  }
}

export class FramePump {
  private readonly sink: FrameSink;
  private readonly maxInFlight: number;
  private hz: number;
  private target: number;
  private k: number;

  private epochMs: number | null = null;
  private removedMs = 0;
  private pausedAtMs: number | null = null;
  private stopped = false;

  private segmentStartM = 0;
  private lastSlot = -Infinity;
  private lastDroppedSlot = -Infinity;
  private rebase = true;
  /** The next frame is the first after a resume. */
  private resumePending = false;

  private nextSeq = 1;
  private lastSettledSeq = 0;
  private held: Held | null = null;
  private lastEndUs = 0;

  private counters = {
    offered: 0,
    captured: 0,
    sent: 0,
    dropsBackpressure: 0,
    dropsLate: 0,
    abandoned: 0,
    replaced: 0,
    outOfOrder: 0,
    inFlight: 0,
  };

  constructor(options: FramePumpOptions) {
    this.sink = options.sink;
    this.maxInFlight = options.maxInFlight ?? MAX_FRAMES_IN_FLIGHT;
    this.hz = options.displayHz;
    this.target = options.targetFps;
    this.k = options.stride ?? strideFor(this.hz, this.target);
    this.assertStride(this.k);
  }

  get displayHz(): number {
    return this.hz;
  }
  get targetFps(): number {
    return this.target;
  }
  get stride(): number {
    return this.k;
  }
  get paused(): boolean {
    return this.pausedAtMs !== null;
  }
  get vsyncMs(): number {
    return 1000 / this.hz;
  }
  /** Nominal duration of one slot, in microseconds. */
  get slotUs(): number {
    return (this.k * 1e6) / this.hz;
  }

  /**
   * Change the display rate, the target or the stride (a governor rung).
   * A change starts a new slot segment at the next frame.
   */
  configure(change: { displayHz?: number; targetFps?: number; stride?: number }): void {
    if (change.displayHz !== undefined) this.hz = change.displayHz;
    if (change.targetFps !== undefined) this.target = change.targetFps;
    const k = change.stride ?? strideFor(this.hz, this.target);
    this.assertStride(k);
    this.k = k;
    this.rebase = true;
  }

  /**
   * Ask for permission to take a frame whose content belongs to page time
   * contentMs. Returns null when the frame is not needed (same slot as the
   * last frame taken), when the sink is full, or while paused or stopped.
   */
  offer(contentMs: number): CaptureTicket | null {
    if (this.stopped || this.pausedAtMs !== null) return null;
    if (this.epochMs === null) {
      this.epochMs = contentMs;
      this.post({ t: "timeline", state: "live", atPerfMs: contentMs }, []);
    }
    const vsync = this.vsyncMs;
    const elapsed = Math.max(0, contentMs - this.epochMs - this.removedMs);
    const m = Math.round(elapsed / vsync);
    if (this.rebase) {
      this.segmentStartM = m;
      this.lastSlot = -Infinity;
      this.lastDroppedSlot = -Infinity;
      this.rebase = false;
    }
    const slot = Math.floor((m - this.segmentStartM) / this.k);
    if (slot <= this.lastSlot) return null;
    if (this.held && this.counters.inFlight >= this.maxInFlight) {
      // Backpressure: do not take the frame; the held frame extends.
      // A later frame in the same slot can still go when the sink frees up.
      // Count each slot once.
      if (slot !== this.lastDroppedSlot) this.counters.dropsBackpressure++;
      this.lastDroppedSlot = slot;
      return null;
    }
    this.lastSlot = slot;
    this.counters.offered++;
    const startM = this.segmentStartM + slot * this.k;
    return { seq: this.nextSeq++, tsUs: Math.round((startM * 1e6) / this.hz) };
  }

  /** Hand over the frame for a ticket. The pump owns the payload from now on. */
  submit(ticket: CaptureTicket, payload: CapturedPayload, hud: HudState): void {
    if (this.stopped || !this.settle(ticket)) {
      if (!this.stopped) this.counters.outOfOrder++;
      closePayload(payload);
      return;
    }
    this.counters.captured++;
    const held = this.held;
    if (held) {
      const ts = this.placeAfter(ticket.tsUs, held.endUs ?? -Infinity);
      if (held.endUs === null && ts <= held.tsUs) {
        // Two frames in one slot: keep the later one.
        closePayload(held.payload);
        held.payload = payload;
        held.hud = hud;
        this.counters.replaced++;
        return;
      }
      if (this.counters.inFlight >= this.maxInFlight) {
        closePayload(payload);
        this.counters.dropsLate++;
        return;
      }
      this.send(held, (held.endUs ?? ts) - held.tsUs);
      this.held = { tsUs: ts, payload, hud, endUs: null };
    } else {
      const ts = this.placeAfter(ticket.tsUs, -Infinity);
      this.held = { tsUs: ts, payload, hud, endUs: null };
    }
    if (this.pausedAtMs !== null) this.sealHeld(this.held.tsUs + this.minDurUs());
  }

  /** A source could not fill a ticket. The held frame extends. */
  abandon(ticket: CaptureTicket): void {
    if (this.settle(ticket)) this.counters.abandoned++;
  }

  /** The encode worker replied "consumed" for one frame. */
  consumed(): void {
    this.counters.inFlight = Math.max(0, this.counters.inFlight - 1);
    this.trySendSealed();
  }

  /** Timeline pause at page time atMs. Paused time is removed from media time. */
  pause(atMs: number): void {
    if (this.stopped || this.pausedAtMs !== null) return;
    this.pausedAtMs = atMs;
    if (this.epochMs === null) return;
    this.post({ t: "timeline", state: "paused", atPerfMs: atMs }, []);
    if (this.held) this.sealHeld(this.mediaUsOnGrid(atMs));
  }

  /** Timeline resume at page time atMs. */
  resume(atMs: number): void {
    if (this.stopped || this.pausedAtMs === null) return;
    const pausedAt = this.pausedAtMs;
    this.pausedAtMs = null;
    if (this.epochMs === null) return;
    this.removedMs += Math.max(0, atMs - pausedAt);
    this.rebase = true;
    this.resumePending = true;
    this.post({ t: "timeline", state: "live", atPerfMs: atMs }, []);
  }

  /**
   * Send the held frame now, with its end at page time atMs (default: one
   * slot after its start). Use it when a source goes away.
   */
  flush(atMs?: number): void {
    if (!this.held) return;
    const end =
      atMs === undefined ? this.held.tsUs + this.minDurUs() : this.mediaUsOnGrid(atMs);
    this.sealHeld(end);
  }

  /** Flush, then refuse all further frames. A held frame that cannot go is closed. */
  stop(atMs?: number): void {
    if (this.stopped) return;
    this.flush(atMs);
    if (this.held) {
      closePayload(this.held.payload);
      this.counters.dropsLate++;
      this.held = null;
    }
    this.stopped = true;
  }

  stats(): FramePumpStats {
    return { ...this.counters, mediaEndUs: this.lastEndUs };
  }

  // -------------------------------------------------------------------------

  private assertStride(k: number): void {
    if (!Number.isInteger(k) || k < 1) throw new RangeError(`stride must be a positive integer, got ${k}`);
  }

  private minDurUs(): number {
    return Math.max(1, Math.round(this.slotUs));
  }

  /** Media microseconds of page time atMs, snapped to the vsync grid. */
  private mediaUsOnGrid(atMs: number): number {
    if (this.epochMs === null) return 0;
    const pausedExtra = this.pausedAtMs !== null && atMs > this.pausedAtMs ? atMs - this.pausedAtMs : 0;
    const elapsed = Math.max(0, atMs - this.epochMs - this.removedMs - pausedExtra);
    const m = Math.round(elapsed / this.vsyncMs);
    return Math.round((m * 1e6) / this.hz);
  }

  /**
   * Timestamp for a new frame: never before the end of the frames before it.
   * The first frame after a resume moves back by up to one slot to close the
   * gap after the frame that the pause sealed. A longer gap stays: it is real
   * time with no new picture, and the muxer extends the frame before it.
   */
  private placeAfter(ticketTsUs: number, sealedEndUs: number): number {
    const floor = Math.max(this.lastEndUs, sealedEndUs);
    let ts = Math.max(ticketTsUs, floor);
    if (this.resumePending) {
      this.resumePending = false;
      if (ts - floor <= this.slotUs + 1) ts = floor;
    }
    return ts;
  }

  /** Tickets settle in order. Returns false for a stale or repeated ticket. */
  private settle(ticket: CaptureTicket): boolean {
    if (ticket.seq <= this.lastSettledSeq || ticket.seq >= this.nextSeq) return false;
    this.lastSettledSeq = ticket.seq;
    return true;
  }

  private sealHeld(endUs: number): void {
    const held = this.held;
    if (!held) return;
    // At least one vsync, so no sample rounds to zero length in the file.
    held.endUs = Math.max(endUs, held.tsUs + Math.max(1, Math.round(1e6 / this.hz)));
    this.trySendSealed();
  }

  private trySendSealed(): void {
    const held = this.held;
    if (!held || held.endUs === null) return;
    if (this.counters.inFlight >= this.maxInFlight) return;
    this.held = null;
    this.send(held, held.endUs - held.tsUs);
  }

  private send(frame: Held, durUs: number): void {
    const dur = Math.max(1, Math.round(durUs));
    let message: FrameIn;
    let transfer: Transferable[];
    if (frame.payload.t === "frame") {
      message = { t: "frame", frame: frame.payload.frame, tsUs: frame.tsUs, durUs: dur, hud: frame.hud };
      transfer = [frame.payload.frame];
    } else {
      const p = frame.payload;
      message = {
        t: "pixels",
        data: p.data,
        width: p.width,
        height: p.height,
        tsUs: frame.tsUs,
        durUs: dur,
        hud: frame.hud,
      };
      transfer = [p.data];
    }
    if (!this.post(message, transfer)) {
      closePayload(frame.payload);
      this.counters.dropsLate++;
      return;
    }
    this.counters.inFlight++;
    this.counters.sent++;
    this.lastEndUs = frame.tsUs + dur;
  }

  private post(message: EncodeCmd, transfer: Transferable[]): boolean {
    try {
      this.sink.postMessage(message, transfer);
      return true;
    } catch {
      return false;
    }
  }
}
