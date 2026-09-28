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
 * - Keyframe starvation: no verified key within 3 s of a request. Then call
 *   reset() and configure(). An identical configure() alone does nothing in
 *   Chromium.
 * - Epoch boundary guard: every epoch ends with a GOP of at least 2 frames.
 *   Two IDRs from two encoders can share idr_pic_id (H.264 7.4.3), so a lone
 *   IDR at the end of an epoch is dropped. The guard holds back one packet,
 *   so a dropped IDR never reaches the ring or the Record tee.
 * - Count outputs that arrive out of timestamp order.
 */

import { KEYFRAME_INTERVAL_US, type EngineErrorCode, type EpochInfo, type VideoEncoderChoice } from "../../protocol";
import { classifyChunk, parseAvcC } from "./avc";
import { bytesEqual, copyToArrayBuffer } from "./bytes";

/** A request that gets no verified keyframe in this time forces a new session. */
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
  ttfcMs: number | null;
}

export interface VideoSessionOptions {
  /** Clock for TTFC, in milliseconds. */
  now?: () => number;
  /** First epoch number. */
  firstEpoch?: number;
}

/** True when two epochs can be spliced by packet copy (plan 6.6). */
export function sameDecoderConfig(a: EpochInfo, b: EpochInfo): boolean {
  return a.codec === b.codec && a.codedWidth === b.codedWidth && a.codedHeight === b.codedHeight && bytesEqual(a.description, b.description);
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
  /** Outputs of frames before this timestamp belong to a purged owner and are dropped. */
  private purgeBeforeUs = -Infinity;
  private firstEncodeAt: number | null = null;
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
    ttfcMs: null,
  };

  constructor(choice: VideoEncoderChoice, hooks: VideoSessionHooks, options: VideoSessionOptions = {}) {
    this.choice = choice;
    this.config = encoderConfigFor(choice);
    this.hooks = hooks;
    this.now = options.now ?? (() => performance.now());
    this.nextEpoch = options.firstEpoch ?? 0;
    this.frameDurUs = Math.round(1e6 / Math.max(1, choice.framerate));
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
   * Submits one frame. The frame is always closed.
   * Returns true when the encoder took the frame, false when it was dropped.
   */
  encode(frame: VideoFrame): boolean {
    this.s.framesIn++;
    try {
      if (this.closed || (!this.encoder && !this.openEncoder())) return this.drop();
      let enc = this.encoder!;
      const queued = enc.encodeQueueSize;
      if (queued > this.s.encodeQueueMax) this.s.encodeQueueMax = queued;
      if (queued >= MAX_ENCODE_QUEUE) return this.drop();

      const ts = frame.timestamp;
      if (this.pendingKeyReqUs !== null && ts - this.pendingKeyReqUs >= KEYFRAME_STARVATION_US) {
        this.s.starvations++;
        this.hooks.onError("keyframe-starved", `no keyframe ${Math.round((ts - this.pendingKeyReqUs) / 1000)} ms after the request`);
        if (!this.resetSession()) return this.drop();
        enc = this.encoder!;
      }

      const keyFrame = this.firstOfEpoch || ts - this.lastKeyUs >= KEYFRAME_INTERVAL_US - KEY_REQUEST_TOLERANCE_US;
      enc.encode(frame, { keyFrame });
      if (keyFrame) {
        this.lastKeyUs = Math.max(this.lastKeyUs, ts);
        this.pendingKeyReqUs ??= ts;
      }
      this.firstOfEpoch = false;
      this.lastSubmittedTs = ts;
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
   * opens a new encoder, which is a new epoch.
   */
  async closeEncoder(): Promise<void> {
    const enc = this.encoder;
    if (enc && enc.state === "configured") {
      try {
        await enc.flush();
      } catch {
        // A flush can fail when the encoder errors at the same time. The error callback reports it.
      }
    }
    if (enc && this.encoder === enc) {
      this.encoder = null;
      safeClose(enc);
    }
    this.finalizeEpoch();
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
    this.encoder = null;
    if (enc) safeClose(enc);
    this.held = null;
  }

  // ---------------------------------------------------------------------------

  private drop(): false {
    this.s.framesDropped++;
    return false;
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
    this.epoch = this.nextEpoch++;
    this.s.epochsStarted++;
    this.lengthSize = null;
    this.firstOfEpoch = true;
    this.lastKeyUs = -Infinity;
    this.pendingKeyReqUs = null;
  }

  private markUnusable(detail: string): void {
    this.unusable = true;
    this.hooks.onError("config-unsupported", detail);
  }

  private loseEncoder(code: EngineErrorCode, detail: string): void {
    const enc = this.encoder;
    this.encoder = null;
    if (enc) safeClose(enc);
    this.finalizeEpoch();
    this.hooks.onError(code, detail);
  }

  private onEncoderError(enc: VideoEncoder, e: unknown): void {
    if (enc !== this.encoder) return;
    const name = (e as { name?: string } | null)?.name;
    if (name === "NotSupportedError") {
      this.encoder = null;
      safeClose(enc);
      this.finalizeEpoch();
      this.markUnusable(describe(e));
      return;
    }
    this.loseEncoder(name === "QuotaExceededError" ? "encoder-reclaimed" : "encoder-error", describe(e));
  }

  private onOutput(enc: VideoEncoder, chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    if (enc !== this.encoder || this.closed) return;
    if (meta?.decoderConfig) this.acceptConfig(meta.decoderConfig);
    if (!this.infos.has(this.epoch)) {
      this.s.unusableOutputs++;
      return;
    }
    const data = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(data);
    const verdict = classifyChunk(data, chunk.type, this.lengthSize);
    if (verdict.mismatch) this.s.keyMismatches++;
    const ts = chunk.timestamp;
    if (ts < this.lastOutTs) this.s.outOfOrder++;
    else this.lastOutTs = ts;
    if (verdict.key) {
      if (this.pendingKeyReqUs !== null && ts >= this.pendingKeyReqUs) this.pendingKeyReqUs = null;
      this.lastKeyUs = Math.max(this.lastKeyUs, ts);
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
    this.hooks.onEpoch({ ...info, description: info.description.slice(0) });
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
