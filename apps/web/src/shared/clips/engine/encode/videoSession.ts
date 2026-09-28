/**
 * Live H.264 encode session (plan 5.1 and 6.6).
 *
 * Responsibilities:
 * - Configure VideoEncoder from the probe's VideoEncoderChoice. latencyMode is
 *   always "quality" (plan 3a: WebKit "realtime" drops frames silently).
 * - Request a keyframe when ts - lastKey >= KEYFRAME_INTERVAL_US. Verify each
 *   keyframe from chunk.type plus an IDR NAL scan (mediabunny #365).
 * - Drop a frame when encodeQueueSize >= 2. Never queue it.
 * - Copy every output packet into its own ArrayBuffer.
 * - Keep the epoch table. Start a new epoch on every recreate: an encoder
 *   error, a reclaim (QuotaExceededError), closeEncoder (export or hidden),
 *   and keyframe starvation.
 * - Health check, before the backpressure drop, once the encoder session has
 *   given its first output. Starvation is either of:
 *   - 3 s (of input frames) after the encoder put out a delta for a frame that
 *     asked for a keyframe: it skips the requests (Chromium Android);
 *   - 3 s (of input frames) with no output arriving at all: the encoder hangs,
 *     and its queue may never drain.
 *   Both count from outputs that arrived, so a long but steady latency is not
 *   starvation. Then call reset() and configure(). reset() also empties a
 *   full queue. An identical configure() alone does nothing in Chromium.
 * - Before its first output, a session is warming (plan 5.1 and 7). The
 *   session never resets it: each reset would start the cold start again.
 *   The main thread sees the missing "epoch" event and decides (Warming, or a
 *   bridge encoder on Chromium).
 * - closeEncoder waits at most FLUSH_TIMEOUT_MS for the flush, then closes the
 *   encoder, so the worker queue never stops behind a hung codec.
 * - Epoch boundary guard: every epoch ends with a GOP of at least 2 frames.
 *   Two IDRs from two encoders can share idr_pic_id (H.264 7.4.3), so a lone
 *   IDR at the end of an epoch is dropped. The guard holds back one packet,
 *   so a dropped IDR never reaches the ring or the Record tee.
 * - Count outputs that arrive out of timestamp order.
 */

import { KEYFRAME_INTERVAL_US, type EngineErrorCode, type EpochInfo, type VideoEncoderChoice } from "../../protocol";
import { classifyChunk, parseAvcC } from "./avc";
import { bytesEqual, copyToArrayBuffer } from "./bytes";
import { FLUSH_TIMEOUT_MS, settleWithin } from "./deadline";

/** A request that gets no verified keyframe in this time (or no output at all) forces a new session. */
export const KEYFRAME_STARVATION_US = 3_000_000;
/** Frames waiting in the encoder queue before a new frame is dropped. */
export const MAX_ENCODE_QUEUE = 2;
/**
 * Slot timestamps are rounded to whole microseconds, so the frame one second
 * after a keyframe can read 999,990 us at 30 fps. The request fires 1 ms early
 * at most, so a GOP never grows by a whole frame from rounding.
 */
export const KEY_REQUEST_TOLERANCE_US = 1000;

export interface VideoPacket {
  type: "key" | "delta";
  tsUs: number;
  durUs: number;
  /** Owned by the ring. Copy before a transfer. */
  data: ArrayBuffer;
  epoch: number;
}

export interface VideoSessionHooks {
  /** A packet that passed the epoch boundary guard, in decode order. */
  onPacket(packet: VideoPacket): void;
  /** The decoder config of a new epoch. The description is a private copy. */
  onEpoch(info: EpochInfo): void;
  onError(code: EngineErrorCode, detail: string): void;
}

export interface VideoSessionStats {
  framesIn: number;
  framesSubmitted: number;
  /** Packets committed to the ring. */
  framesEncoded: number;
  framesDropped: number;
  outOfOrder: number;
  encodeQueueMax: number;
  /** chunk.type and the NAL scan disagreed. */
  keyMismatches: number;
  /** Lone IDRs dropped at epoch boundaries. */
  loneKeysDropped: number;
  /** Outputs dropped because no decoder config or no GOP start came first. */
  unusableOutputs: number;
  epochsStarted: number;
  starvations: number;
  /** Flushes that did not finish in time. The encoder was closed. */
  flushTimeouts: number;
  ttfcMs: number | null;
}

export interface VideoSessionOptions {
  /** Clock for TTFC, in milliseconds. */
  now?: () => number;
  /** First epoch number. */
  firstEpoch?: number;
  /** Longest wait for a flush in closeEncoder. Default FLUSH_TIMEOUT_MS. */
  flushTimeoutMs?: number;
}

/** Where the Record tee stops: the newest frame the encoder took, and the encoder session that took it. */
export interface TailMark {
  lastTs: number;
  generation: number;
}

function sameColorSpace(a: VideoColorSpaceInit | undefined, b: VideoColorSpaceInit | undefined): boolean {
  return (
    (a?.primaries ?? null) === (b?.primaries ?? null) &&
    (a?.transfer ?? null) === (b?.transfer ?? null) &&
    (a?.matrix ?? null) === (b?.matrix ?? null) &&
    (a?.fullRange ?? null) === (b?.fullRange ?? null)
  );
}

/** True when two epochs can be spliced by packet copy (plan 6.6). */
export function sameDecoderConfig(a: EpochInfo, b: EpochInfo): boolean {
  return (
    a.codec === b.codec &&
    a.codedWidth === b.codedWidth &&
    a.codedHeight === b.codedHeight &&
    bytesEqual(a.description, b.description) &&
    sameColorSpace(a.colorSpace, b.colorSpace)
  );
}

/** Builds the VideoEncoderConfig for a choice. */
export function encoderConfigFor(choice: VideoEncoderChoice): VideoEncoderConfig {
  return {
    codec: choice.codec,
    width: choice.width,
    height: choice.height,
    bitrate: choice.bitrate,
    bitrateMode: "variable",
    framerate: choice.framerate,
    latencyMode: "quality",
    hardwareAcceleration: choice.hardwareAcceleration,
    avc: { format: "avc" },
  };
}

export class VideoSession {
  readonly choice: VideoEncoderChoice;
  private readonly config: VideoEncoderConfig;
  private readonly hooks: VideoSessionHooks;
  private readonly now: () => number;
  private readonly frameDurUs: number;
  private readonly flushTimeoutMs: number;
  private encoder: VideoEncoder | null = null;
  private unusable = false;
  private closed = false;
  private nextEpoch: number;
  private epoch = -1;
  private readonly infos = new Map<number, EpochInfo>();
  private lengthSize: number | null = null;
  private firstOfEpoch = true;
  private lastKeyUs = -Infinity;
  private pendingKeyReqUs: number | null = null;
  private lastOutTs = -Infinity;
  private lastSubmittedTs = -Infinity;
  private lastSubmittedEnd = -Infinity;
  private lastSubmittedGen = -1;
  /** Outputs of frames before this timestamp belong to a purged owner and are dropped. */
  private purgeBeforeUs = -Infinity;
  private firstEncodeAt: number | null = null;
  /** Changes whenever the encoder session that takes frames changes (open, reset, close, loss). */
  private gen = 0;
  /** Outputs of the current encoder session. 0 means the session is still warming. */
  private sessionOutputs = 0;
  /** Newest output timestamp of the current encoder session. */
  private sessionLastOutTs = -Infinity;
  /** The newest frame given to the encoder when its newest output arrived (input-side time). */
  private lastArrivalTs = -Infinity;
  /** The newest frame given to the encoder when a delta at or after the open key request came out. */
  private skippedAtTs: number | null = null;
  // Epoch boundary guard.
  private held: VideoPacket | null = null;
  private heldEpoch = -1;
  private gopOpen = false;
  private readonly s: VideoSessionStats = {
    framesIn: 0,
    framesSubmitted: 0,
    framesEncoded: 0,
    framesDropped: 0,
    outOfOrder: 0,
    encodeQueueMax: 0,
    keyMismatches: 0,
    loneKeysDropped: 0,
    unusableOutputs: 0,
    epochsStarted: 0,
    starvations: 0,
    flushTimeouts: 0,
    ttfcMs: null,
  };

  constructor(choice: VideoEncoderChoice, hooks: VideoSessionHooks, options: VideoSessionOptions = {}) {
    this.choice = choice;
    this.config = encoderConfigFor(choice);
    this.hooks = hooks;
    this.now = options.now ?? (() => performance.now());
    this.nextEpoch = options.firstEpoch ?? 0;
    this.frameDurUs = Math.round(1e6 / Math.max(1, choice.framerate));
    this.flushTimeoutMs = options.flushTimeoutMs ?? FLUSH_TIMEOUT_MS;
  }

  get stats(): Readonly<VideoSessionStats> {
    return this.s;
  }

  /** The current epoch number, or -1 before the first encoder. */
  get currentEpoch(): number {
    return this.epoch;
  }

  /** True when an encoder is open. */
  get open(): boolean {
    return this.encoder !== null;
  }

  /** True after a config the device cannot encode. Only a new arm clears it. */
  get failed(): boolean {
    return this.unusable;
  }

  /** True while the current encoder session has given no output yet (cold start). */
  get warming(): boolean {
    return this.encoder !== null && this.sessionOutputs === 0;
  }

  /** Capture time just after the newest frame the encoder took. -Infinity before the first. */
  get submittedEndUs(): number {
    return this.lastSubmittedEnd;
  }

  /** The newest frame the encoder took and the session that took it (for Record Stop). */
  tailMark(): TailMark {
    return { lastTs: this.lastSubmittedTs, generation: this.lastSubmittedGen };
  }

  epochInfo(epoch: number): EpochInfo | undefined {
    return this.infos.get(epoch);
  }

  /** Forgets decoder configs that no ring packet uses. Keeps the current epoch. */
  retainEpochs(inUse: ReadonlySet<number>): void {
    for (const e of this.infos.keys()) if (e !== this.epoch && !inUse.has(e)) this.infos.delete(e);
  }

  /** Opens the encoder now, so the probe error (if any) arrives before the first frame. */
  start(): boolean {
    return this.encoder !== null || this.openEncoder();
  }

  /**
   * Decides, before the caller paints a frame for ts, whether encode() will
   * take it. The health check runs first, so a reset can empty a full queue.
   * A refused frame is counted as dropped here; the caller must not call
   * encode() for it. Painting a frame that the queue would drop wastes the
   * compositor time that a struggling device needs.
   */
  admit(ts: number): boolean {
    try {
      if (this.ready(ts)) return true;
    } catch (e) {
      this.loseEncoder("encoder-error", `encoder check threw: ${describe(e)}`);
    }
    this.s.framesIn++;
    this.drop();
    return false;
  }

  /**
   * Submits one frame. The frame is always closed.
   * Returns true when the encoder took the frame, false when it was dropped.
   */
  encode(frame: VideoFrame): boolean {
    this.s.framesIn++;
    try {
      const ts = frame.timestamp;
      const enc = this.ready(ts);
      if (!enc) return this.drop();

      const keyFrame = this.firstOfEpoch || ts - this.lastKeyUs >= KEYFRAME_INTERVAL_US - KEY_REQUEST_TOLERANCE_US;
      enc.encode(frame, { keyFrame });
      if (keyFrame) {
        this.lastKeyUs = Math.max(this.lastKeyUs, ts);
        this.pendingKeyReqUs ??= ts;
      }
      this.firstOfEpoch = false;
      this.lastSubmittedTs = ts;
      const dur = frame.duration;
      this.lastSubmittedEnd = ts + (dur !== null && dur !== undefined && dur > 0 ? dur : this.frameDurUs);
      this.lastSubmittedGen = this.gen;
      this.firstEncodeAt ??= this.now();
      this.s.framesSubmitted++;
      return true;
    } catch (e) {
      this.loseEncoder("encoder-error", `encode threw: ${describe(e)}`);
      return this.drop();
    } finally {
      frame.close();
    }
  }

  /**
   * Flushes and closes the encoder (export or hidden, plan 7). The next frame
   * opens a new encoder, which is a new epoch. A flush that does not finish in
   * time closes the encoder anyway (it is hung) and reports an encoder error.
   */
  async closeEncoder(): Promise<void> {
    const enc = this.encoder;
    if (enc && enc.state === "configured") {
      // A flush can fail when the encoder errors at the same time. The error callback reports it.
      const settled = await settleWithin(enc.flush(), this.flushTimeoutMs);
      if (!settled && this.encoder === enc) {
        this.s.flushTimeouts++;
        this.detach(enc);
        this.finalizeEpoch();
        this.hooks.onError("encoder-error", `flush did not finish in ${this.flushTimeoutMs} ms`);
        return;
      }
    }
    if (enc && this.encoder === enc) this.detach(enc);
    this.finalizeEpoch();
  }

  /**
   * Record Stop (plan 8.3): true when the frame of `mark` and every frame
   * before it are out of the encoder. A held delta at or before the mark is
   * committed at once (the guard only ever drops a held keyframe, so this
   * changes nothing else). A held keyframe stays held: it can be a lone IDR
   * at an epoch end.
   *
   * With `giveUp`, it commits what is out and returns true. An encoder can
   * keep its newest frame until the next input comes, and in a pause no input
   * comes, so the caller gives up when no frame followed the stop.
   */
  releaseTail(mark: TailMark, giveUp = false): boolean {
    if (mark.generation !== this.gen) return true; // That encoder session ended: its outputs are final.
    if (this.sessionLastOutTs < mark.lastTs && !giveUp) return false;
    const h = this.held;
    if (h && h.type === "delta" && h.tsUs <= mark.lastTs) {
      this.held = null;
      this.commit(h);
    }
    return true;
  }

  /**
   * Owner change (plan 7.1): drops the held packet and the outputs of every
   * frame submitted so far, so no frame of the old owner reaches the emptied
   * ring. Asks for a keyframe on the next frame, so the new ring starts at once.
   */
  purge(): void {
    this.held = null;
    this.gopOpen = false;
    this.firstOfEpoch = true;
    // Frames already inside the encoder come out after this call. Their outputs are dropped too.
    this.purgeBeforeUs = this.lastSubmittedTs + 1;
  }

  /** Closes everything for good (disarm). Held packets are dropped. */
  close(): void {
    this.closed = true;
    const enc = this.encoder;
    if (enc) this.detach(enc);
    this.held = null;
  }

  // ---------------------------------------------------------------------------

  private drop(): false {
    this.s.framesDropped++;
    return false;
  }

  /**
   * Makes the encoder ready for a frame at ts, or returns null when the frame
   * must be dropped. Opens the encoder when none is open. The health check
   * runs before the backpressure check: reset() empties a full queue, so a
   * hung encoder is recovered, not only dropped around.
   */
  private ready(ts: number): VideoEncoder | null {
    if (this.closed) return null;
    if (!this.encoder && !this.openEncoder()) return null;
    const starved = this.starvation(ts);
    if (starved) {
      this.s.starvations++;
      this.hooks.onError("keyframe-starved", starved);
      if (!this.resetSession()) return null;
    }
    const enc = this.encoder;
    if (!enc) return null;
    const queued = enc.encodeQueueSize;
    if (queued > this.s.encodeQueueMax) this.s.encodeQueueMax = queued;
    return queued >= MAX_ENCODE_QUEUE ? null : enc;
  }

  /**
   * Why the encoder session needs a reset at ts, or null when it is healthy or
   * still warming. Both rules count from outputs that arrived, so a long but
   * steady encoder latency is never taken for starvation.
   */
  private starvation(ts: number): string | null {
    // Warming: no output yet. A reset would only start the cold start again (plan 5.1).
    if (this.sessionOutputs === 0) return null;
    // The encoder put out a delta for (or after) the requested frame: it skipped the request.
    if (this.skippedAtTs !== null && ts - this.skippedAtTs >= KEYFRAME_STARVATION_US) {
      return `no keyframe ${Math.round((ts - this.skippedAtTs) / 1000)} ms after the encoder skipped the request`;
    }
    if (ts - this.lastArrivalTs >= KEYFRAME_STARVATION_US) {
      return `no output for ${Math.round((ts - this.lastArrivalTs) / 1000)} ms (the encoder stopped)`;
    }
    return null;
  }

  private openEncoder(): boolean {
    if (this.unusable || this.closed) return false;
    if (typeof VideoEncoder === "undefined") {
      this.markUnusable("VideoEncoder is not available");
      return false;
    }
    const enc: VideoEncoder = new VideoEncoder({
      output: (chunk, meta) => this.onOutput(enc, chunk, meta),
      error: (e) => this.onEncoderError(enc, e),
    });
    try {
      enc.configure(this.config);
    } catch (e) {
      safeClose(enc);
      this.markUnusable(`configure threw: ${describe(e)}`);
      return false;
    }
    this.encoder = enc;
    this.beginEpoch();
    return true;
  }

  /** reset() plus configure() on the same encoder: a new session and a new epoch. */
  private resetSession(): boolean {
    const enc = this.encoder;
    if (!enc) return this.openEncoder();
    try {
      enc.reset();
      enc.configure(this.config);
    } catch (e) {
      this.loseEncoder("encoder-error", `reset failed: ${describe(e)}`);
      return this.openEncoder();
    }
    this.beginEpoch();
    return true;
  }

  private beginEpoch(): void {
    this.finalizeEpoch();
    this.gen++;
    this.epoch = this.nextEpoch++;
    this.s.epochsStarted++;
    this.lengthSize = null;
    this.firstOfEpoch = true;
    this.lastKeyUs = -Infinity;
    this.pendingKeyReqUs = null;
    this.sessionOutputs = 0;
    this.sessionLastOutTs = -Infinity;
    this.lastArrivalTs = -Infinity;
    this.skippedAtTs = null;
  }

  /** Stops taking outputs from enc and closes it. */
  private detach(enc: VideoEncoder): void {
    if (this.encoder === enc) {
      this.encoder = null;
      this.gen++;
    }
    safeClose(enc);
  }

  private markUnusable(detail: string): void {
    this.unusable = true;
    this.hooks.onError("config-unsupported", detail);
  }

  private loseEncoder(code: EngineErrorCode, detail: string): void {
    const enc = this.encoder;
    if (enc) this.detach(enc);
    this.finalizeEpoch();
    this.hooks.onError(code, detail);
  }

  private onEncoderError(enc: VideoEncoder, e: unknown): void {
    if (enc !== this.encoder) return;
    const name = (e as { name?: string } | null)?.name;
    if (name === "NotSupportedError") {
      this.detach(enc);
      this.finalizeEpoch();
      this.markUnusable(describe(e));
      return;
    }
    this.loseEncoder(name === "QuotaExceededError" ? "encoder-reclaimed" : "encoder-error", describe(e));
  }

  private onOutput(enc: VideoEncoder, chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    if (enc !== this.encoder || this.closed) return;
    const ts = chunk.timestamp;
    this.sessionOutputs++;
    if (ts > this.sessionLastOutTs) this.sessionLastOutTs = ts;
    this.lastArrivalTs = this.lastSubmittedTs;
    if (meta?.decoderConfig) this.acceptConfig(meta.decoderConfig);
    if (!this.infos.has(this.epoch)) {
      this.s.unusableOutputs++;
      return;
    }
    const data = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(data);
    const verdict = classifyChunk(data, chunk.type, this.lengthSize);
    if (verdict.mismatch) this.s.keyMismatches++;
    if (ts < this.lastOutTs) this.s.outOfOrder++;
    else this.lastOutTs = ts;
    if (verdict.key) {
      if (this.pendingKeyReqUs !== null && ts >= this.pendingKeyReqUs) {
        this.pendingKeyReqUs = null;
        this.skippedAtTs = null;
      }
      this.lastKeyUs = Math.max(this.lastKeyUs, ts);
    } else if (this.pendingKeyReqUs !== null && ts >= this.pendingKeyReqUs) {
      this.skippedAtTs ??= this.lastSubmittedTs;
    }
    if (this.s.ttfcMs === null && this.firstEncodeAt !== null) this.s.ttfcMs = this.now() - this.firstEncodeAt;
    if (ts < this.purgeBeforeUs) return;
    const duration = chunk.duration;
    this.guard({
      type: verdict.key ? "key" : "delta",
      tsUs: ts,
      durUs: duration !== null && duration !== undefined && duration > 0 ? duration : this.frameDurUs,
      data,
      epoch: this.epoch,
    });
  }

  private acceptConfig(dc: VideoDecoderConfig): void {
    const info: EpochInfo = {
      epoch: this.epoch,
      codec: dc.codec,
      codedWidth: dc.codedWidth ?? this.config.width,
      codedHeight: dc.codedHeight ?? this.config.height,
      description: dc.description ? copyToArrayBuffer(dc.description) : new ArrayBuffer(0),
    };
    if (dc.colorSpace) info.colorSpace = copyColorSpace(dc.colorSpace);
    const current = this.infos.get(this.epoch);
    if (current) {
      if (sameDecoderConfig(current, info)) return;
      // The encoder changed its config inside one session. Treat it as a new epoch.
      this.finalizeEpoch();
      this.epoch = this.nextEpoch++;
      this.s.epochsStarted++;
      info.epoch = this.epoch;
    }
    this.infos.set(this.epoch, info);
    this.lengthSize = parseAvcC(info.description)?.lengthSize ?? null;
    this.hooks.onEpoch(copyEpochInfo(info));
  }

  // ---- epoch boundary guard ----

  private guard(p: VideoPacket): void {
    if (p.epoch !== this.heldEpoch) {
      this.finalizeEpoch();
      this.heldEpoch = p.epoch;
    }
    if (p.type === "delta" && !this.gopOpen) {
      this.s.unusableOutputs++;
      return;
    }
    if (this.held) this.commit(this.held);
    this.held = p;
    if (p.type === "key") this.gopOpen = true;
  }

  /** Ends the guard's epoch: commits the held packet, or drops it when it is a lone IDR. */
  private finalizeEpoch(): void {
    const h = this.held;
    this.held = null;
    this.gopOpen = false;
    if (!h) return;
    if (h.type === "key") this.s.loneKeysDropped++;
    else this.commit(h);
  }

  private commit(p: VideoPacket): void {
    this.s.framesEncoded++;
    this.hooks.onPacket(p);
  }
}

/** A plain copy of a color space (a VideoColorSpace object or an init dictionary). */
function copyColorSpace(cs: VideoColorSpaceInit): VideoColorSpaceInit {
  return {
    primaries: cs.primaries ?? null,
    transfer: cs.transfer ?? null,
    matrix: cs.matrix ?? null,
    fullRange: cs.fullRange ?? null,
  };
}

/** A private copy of an epoch: new description bytes and a new color space object. */
export function copyEpochInfo(info: EpochInfo): EpochInfo {
  const out: EpochInfo = { ...info, description: info.description.slice(0) };
  if (info.colorSpace) out.colorSpace = { ...info.colorSpace };
  return out;
}

function safeClose(enc: VideoEncoder): void {
  try {
    if (enc.state !== "closed") enc.close();
  } catch {
    // Closing a closed codec throws in some engines. Nothing is left to free.
  }
}

function describe(e: unknown): string {
  if (e instanceof Error || (e && typeof e === "object" && "message" in e)) {
    const err = e as { name?: string; message?: string };
    return `${err.name ?? "Error"}: ${err.message ?? ""}`.trim();
  }
  return String(e);
}
