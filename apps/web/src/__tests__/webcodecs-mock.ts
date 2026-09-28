/**
 * Shared WebCodecs test double (single copy).
 *
 * jsdom has no VideoEncoder, VideoFrame, EncodedVideoChunk, AudioEncoder,
 * AudioData, AudioDecoder, EncodedAudioChunk or OffscreenCanvas. This file
 * installs fakes with the real API shapes. Each class can be present or
 * absent, so a test can model a device tier (for example W+: no AudioData).
 *
 * The fakes copy the behavior that the Phase 0 measurements found on real
 * devices (plan section 3a):
 * - An identical configure() on a configured VideoEncoder does nothing
 *   (Chromium). Only reset() plus configure() starts a new session.
 * - A device can ignore keyFrame requests (Chromium Android defaults
 *   MediaCodec to a long GOP). Set honorKeyFrameRequests to false.
 * - A chunk can say "key" without an IDR NAL unit (mediabunny #365).
 * - Codec reclamation closes the encoder with a QuotaExceededError.
 * - A stalled encoder (stall(true)) takes no work: encodeQueueSize grows and
 *   flush() does not settle. reset() and close() empty the queue and reject
 *   the pending flush, as the spec says.
 * - decoderConfig carries the encoder's color space (BT.709 limited range by
 *   default, as Chromium reports it).
 * - WebKit AudioEncoder returns esds box bytes as the AAC description
 *   (WebKit 302253) and drops the first 1024 input samples.
 * - The AAC fakes are a delay line. The fake decoder returns the input
 *   delayed by the encoder delay, so a priming measurement is real.
 *
 * Use installWebCodecsMock() in beforeEach and mock.uninstall() in afterEach.
 */

// ---------------------------------------------------------------------------
// Options and shared state
// ---------------------------------------------------------------------------

export interface FakeVideoEncoderBehavior {
  /** Frames held inside the codec before output. "quality" mode measured about 1. */
  outputLatencyFrames: number;
  /** False models a device that ignores keyFrame requests. */
  honorKeyFrameRequests: boolean;
  /** Natural GOP length in frames when requests are ignored. */
  gopLength: number;
  /** Chromium: configure() with an identical config on a configured encoder does nothing. */
  identicalConfigureIsNoop: boolean;
  /**
   * Returns a label fault for the output with this index in the session, or null.
   * "key-without-idr": chunk.type is "key" but the NAL unit is a non-IDR slice.
   * "idr-as-delta": chunk.type is "delta" but the NAL unit is an IDR slice.
   */
  labelFault: (frameIndexInSession: number) => "key-without-idr" | "idr-as-delta" | null;
  /** Emits pairs of frames in reverse order (a reordering encoder). */
  reorder: boolean;
  /** Changes the SPS bytes, so two encoders can give different avcC. */
  avcCVariant: number;
  /** Codec strings that isConfigSupported and configure accept. */
  supportedCodec: RegExp;
  /**
   * The color space the encoder reports in decoderConfig, or null for none.
   * Each encoder family converts RGB input with its own matrix and range.
   */
  colorSpace: VideoColorSpaceInit | null;
}

export interface WebCodecsMockOptions {
  videoEncoder?: boolean;
  videoFrame?: boolean;
  encodedVideoChunk?: boolean;
  audioEncoder?: boolean;
  audioData?: boolean;
  audioDecoder?: boolean;
  encodedAudioChunk?: boolean;
  offscreenCanvas?: boolean;
  /** "webkit" returns an esds description and drops the first 1024 samples. */
  audioEncoderFlavor?: "chromium" | "webkit";
  /**
   * Decoded-output delay of the fake AAC encoder, in samples. The default
   * gives the measured 2114 samples (plan 3a) for both flavors when the
   * delay is measured without a pre-pad.
   */
  audioEncoderDelay?: number;
  /** WebKit AudioDecoder accepts the esds bytes. Strict decoders reject them. */
  audioDecoderAcceptsEsds?: boolean;
  video?: Partial<FakeVideoEncoderBehavior>;
}

export interface WebCodecsMock {
  readonly videoEncoders: FakeVideoEncoder[];
  readonly audioEncoders: FakeAudioEncoder[];
  readonly audioDecoders: FakeAudioDecoder[];
  readonly canvases: FakeOffscreenCanvas[];
  /** Shared video behavior. Changes apply to encoders made after the change. */
  readonly video: FakeVideoEncoderBehavior;
  /** VideoFrames that are not closed yet. A test fails a leak when this is not 0. */
  openFrames(): number;
  uninstall(): void;
}

/** The esds bytes that WebKit returns for AAC-LC 48 kHz stereo (measured on Safari 26.5). */
export const WEBKIT_AAC_ESDS = new Uint8Array([
  0x03, 0x80, 0x80, 0x80, 0x22, 0x00, 0x00, 0x00, 0x04, 0x80, 0x80, 0x80, 0x14, 0x40, 0x14, 0x00, 0x18, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x80, 0x80, 0x80, 0x02, 0x11, 0x90, 0x06, 0x80, 0x80, 0x80, 0x01,
  0x02,
]);

const AAC_FRAME = 1024;
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

interface MockState {
  video: FakeVideoEncoderBehavior;
  videoEncoders: FakeVideoEncoder[];
  audioEncoders: FakeAudioEncoder[];
  audioDecoders: FakeAudioDecoder[];
  canvases: FakeOffscreenCanvas[];
  openFrames: Set<FakeVideoFrame>;
  audioFlavor: "chromium" | "webkit";
  audioDelay: number;
  decoderAcceptsEsds: boolean;
}

let state: MockState | null = null;

function mockState(): MockState {
  if (!state) throw new Error("webcodecs-mock is not installed");
  return state;
}

function defaultVideoBehavior(): FakeVideoEncoderBehavior {
  return {
    outputLatencyFrames: 1,
    honorKeyFrameRequests: true,
    gopLength: 3000,
    identicalConfigureIsNoop: true,
    labelFault: () => null,
    reorder: false,
    avcCVariant: 0,
    supportedCodec: /^avc1\.[0-9a-fA-F]{6}$/,
    colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false },
  };
}

/** Awaits enough microtasks for every fake codec to finish its queued work. */
export async function flushMicrotasks(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

function toBytes(src: unknown): Uint8Array {
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  throw new TypeError("Expected a BufferSource");
}

function invalidState(message: string): DOMException {
  return new DOMException(message, "InvalidStateError");
}

// ---------------------------------------------------------------------------
// H.264 byte helpers (length-prefixed "avc" format with 4-byte lengths)
// ---------------------------------------------------------------------------

/** Builds an avcC record. The SPS carries the size and variant, so they change the bytes. */
export function fakeAvcC(width: number, height: number, variant: number, codec = "avc1.64001f"): Uint8Array {
  const profile = parseInt(codec.slice(5, 7), 16) || 0x64;
  const compat = parseInt(codec.slice(7, 9), 16) || 0;
  const level = parseInt(codec.slice(9, 11), 16) || 0x1f;
  const sps = [0x67, profile, compat, level, (width >> 8) & 0xff, width & 0xff, (height >> 8) & 0xff, height & 0xff, variant & 0xff];
  const pps = [0x68, 0xee, 0x3c, 0x80];
  return new Uint8Array([
    0x01, profile, compat, level, 0xff, 0xe1, 0x00, sps.length, ...sps, 0x01, 0x00, pps.length, ...pps,
  ]);
}

/** One access unit: an optional AUD, then one slice NAL unit that carries the timestamp. */
function fakeAccessUnit(nalType: number, timestamp: number): Uint8Array {
  const aud = [0x09, 0xf0];
  const slice = [0x60 | nalType, 0x88, (timestamp >>> 24) & 0xff, (timestamp >>> 16) & 0xff, (timestamp >>> 8) & 0xff, timestamp & 0xff, 0x80];
  const out: number[] = [];
  for (const nal of [aud, slice]) out.push(0, 0, 0, nal.length, ...nal);
  return new Uint8Array(out);
}

/** Reads the timestamp that fakeAccessUnit wrote into a slice NAL unit. */
export function fakeAccessUnitTimestamp(data: ArrayBuffer | Uint8Array): number {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  // AUD: 4 + 2 bytes; slice length: 4 bytes; slice header: 2 bytes.
  const o = 6 + 4 + 2;
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

// ---------------------------------------------------------------------------
// VideoFrame
// ---------------------------------------------------------------------------

type FrameSource =
  | { kind: "buffer"; pixels: Uint8Array }
  | { kind: "canvas"; canvasId: number; ops: CanvasOp[] }
  | { kind: "frame"; parent: FrameSource };

export class FakeVideoFrame {
  format: string | null;
  codedWidth: number;
  codedHeight: number;
  displayWidth: number;
  displayHeight: number;
  timestamp: number;
  duration: number | null;
  /** Test surface: where the pixels came from. */
  readonly __source: FrameSource;
  private closed = false;

  constructor(source: unknown, init?: Partial<VideoFrameBufferInit> & VideoFrameInit) {
    if (source instanceof FakeVideoFrame) {
      if (source.closed) throw invalidState("VideoFrame is closed");
      this.format = source.format;
      this.codedWidth = source.codedWidth;
      this.codedHeight = source.codedHeight;
      this.displayWidth = source.displayWidth;
      this.displayHeight = source.displayHeight;
      this.timestamp = init?.timestamp ?? source.timestamp;
      this.duration = init?.duration ?? source.duration;
      this.__source = { kind: "frame", parent: source.__source };
    } else if (source instanceof FakeOffscreenCanvas) {
      if (init?.timestamp === undefined) throw new TypeError("timestamp is required for a canvas source");
      if (source.width === 0 || source.height === 0) throw invalidState("Canvas has no pixels");
      this.format = init.alpha === "discard" ? "RGBX" : "RGBA";
      this.codedWidth = source.width;
      this.codedHeight = source.height;
      this.displayWidth = source.width;
      this.displayHeight = source.height;
      this.timestamp = init.timestamp;
      this.duration = init.duration ?? null;
      this.__source = { kind: "canvas", canvasId: source.id, ops: source.context.ops.slice() };
    } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
      const f = init?.format;
      const w = init?.codedWidth;
      const h = init?.codedHeight;
      if (!f || !w || !h || init?.timestamp === undefined) {
        throw new TypeError("format, codedWidth, codedHeight and timestamp are required");
      }
      const bytesPerPixel = f === "RGBA" || f === "RGBX" || f === "BGRA" || f === "BGRX" ? 4 : 1.5;
      const bytes = toBytes(source);
      if (bytes.byteLength < Math.ceil(w * h * bytesPerPixel)) throw new TypeError("Buffer is too small");
      this.format = f;
      this.codedWidth = w;
      this.codedHeight = h;
      this.displayWidth = init.displayWidth ?? w;
      this.displayHeight = init.displayHeight ?? h;
      this.timestamp = init.timestamp;
      this.duration = init.duration ?? null;
      this.__source = { kind: "buffer", pixels: bytes.slice() };
    } else {
      throw new TypeError("Unsupported VideoFrame source");
    }
    mockState().openFrames.add(this);
  }

  get __closed(): boolean {
    return this.closed;
  }

  clone(): FakeVideoFrame {
    if (this.closed) throw invalidState("VideoFrame is closed");
    return new FakeVideoFrame(this);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.format = null;
    this.codedWidth = 0;
    this.codedHeight = 0;
    this.displayWidth = 0;
    this.displayHeight = 0;
    state?.openFrames.delete(this);
  }
}

// ---------------------------------------------------------------------------
// OffscreenCanvas with a recording 2D context
// ---------------------------------------------------------------------------

export type CanvasOp =
  | { op: "fillRect"; x: number; y: number; w: number; h: number; fillStyle: string; alpha: number }
  | { op: "clearRect"; x: number; y: number; w: number; h: number }
  | { op: "drawImage"; source: DrawSource; dx: number; dy: number; dw: number; dh: number }
  | { op: "fillText"; text: string; x: number; y: number; font: string; fillStyle: string; align: string }
  | { op: "fill"; fillStyle: string; path: PathPart[] };

type DrawSource =
  | { kind: "videoframe"; timestamp: number; width: number; height: number; source: FrameSource }
  | { kind: "canvas"; canvasId: number; width: number; height: number };

type PathPart = { part: "roundRect" | "rect"; x: number; y: number; w: number; h: number };

let canvasIds = 0;

export class FakeOffscreenCanvas {
  readonly id = ++canvasIds;
  width: number;
  height: number;
  readonly context: FakeContext2D;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeContext2D(this);
    mockState().canvases.push(this);
  }

  getContext(type: string): FakeContext2D | null {
    return type === "2d" ? this.context : null;
  }
}

function fontPx(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 10;
}

export class FakeContext2D {
  readonly canvas: FakeOffscreenCanvas;
  readonly ops: CanvasOp[] = [];
  fillStyle = "#000000";
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  globalAlpha = 1;
  imageSmoothingEnabled = true;
  imageSmoothingQuality = "low";
  private path: PathPart[] = [];
  private stack: Array<{ fillStyle: string; font: string; textAlign: string; textBaseline: string; globalAlpha: number }> = [];

  constructor(canvas: FakeOffscreenCanvas) {
    this.canvas = canvas;
  }

  save(): void {
    this.stack.push({
      fillStyle: this.fillStyle,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      globalAlpha: this.globalAlpha,
    });
  }

  restore(): void {
    const s = this.stack.pop();
    if (s) Object.assign(this, s);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.ops.push({ op: "fillRect", x, y, w, h, fillStyle: this.fillStyle, alpha: this.globalAlpha });
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.ops.push({ op: "clearRect", x, y, w, h });
  }

  drawImage(source: unknown, ...a: number[]): void {
    let desc: DrawSource;
    if (source instanceof FakeVideoFrame) {
      if (source.__closed) throw invalidState("The VideoFrame is closed");
      desc = { kind: "videoframe", timestamp: source.timestamp, width: source.displayWidth, height: source.displayHeight, source: source.__source };
    } else if (source instanceof FakeOffscreenCanvas) {
      desc = { kind: "canvas", canvasId: source.id, width: source.width, height: source.height };
    } else {
      throw new TypeError("Unsupported image source");
    }
    let dx: number, dy: number, dw: number, dh: number;
    if (a.length === 2) [dx, dy, dw, dh] = [a[0], a[1], desc.width, desc.height];
    else if (a.length === 4) [dx, dy, dw, dh] = [a[0], a[1], a[2], a[3]];
    else if (a.length === 8) [dx, dy, dw, dh] = [a[4], a[5], a[6], a[7]];
    else throw new TypeError("drawImage needs 2, 4 or 8 numbers");
    this.ops.push({ op: "drawImage", source: desc, dx, dy, dw, dh });
  }

  fillText(text: string, x: number, y: number): void {
    this.ops.push({ op: "fillText", text: String(text), x, y, font: this.font, fillStyle: this.fillStyle, align: this.textAlign });
  }

  measureText(text: string): { width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number } {
    const px = fontPx(this.font);
    let width = 0;
    for (const ch of String(text)) width += (ch.codePointAt(0) ?? 0) > 0x2000 ? px * 1.2 : px * 0.55;
    return { width, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.2 };
  }

  beginPath(): void {
    this.path = [];
  }

  roundRect(x: number, y: number, w: number, h: number): void {
    this.path.push({ part: "roundRect", x, y, w, h });
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.path.push({ part: "rect", x, y, w, h });
  }

  fill(): void {
    this.ops.push({ op: "fill", fillStyle: this.fillStyle, path: this.path.slice() });
  }

  /** Test helper: every fillText string in draw order. */
  texts(): string[] {
    return this.ops.flatMap((o) => (o.op === "fillText" ? [o.text] : []));
  }
}

// ---------------------------------------------------------------------------
// EncodedVideoChunk and EncodedAudioChunk
// ---------------------------------------------------------------------------

class FakeEncodedChunk {
  readonly type: "key" | "delta";
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  private readonly bytes: Uint8Array;

  constructor(init: { type: "key" | "delta"; timestamp: number; duration?: number; data: unknown }) {
    if (init.type !== "key" && init.type !== "delta") throw new TypeError("type must be key or delta");
    if (typeof init.timestamp !== "number") throw new TypeError("timestamp is required");
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration ?? null;
    this.bytes = toBytes(init.data).slice();
    this.byteLength = this.bytes.byteLength;
  }

  copyTo(destination: unknown): void {
    const d = toBytes(destination);
    if (d.byteLength < this.byteLength) throw new TypeError("destination is too small");
    d.set(this.bytes);
  }
}

export class FakeEncodedVideoChunk extends FakeEncodedChunk {}
export class FakeEncodedAudioChunk extends FakeEncodedChunk {}

// ---------------------------------------------------------------------------
// VideoEncoder
// ---------------------------------------------------------------------------

interface VideoWork {
  frame: FakeVideoFrame;
  keyFrame: boolean;
}

function sameVideoConfig(a: VideoEncoderConfig | null, b: VideoEncoderConfig): boolean {
  if (!a) return false;
  const keys = ["codec", "width", "height", "bitrate", "framerate", "latencyMode", "hardwareAcceleration", "bitrateMode"] as const;
  return keys.every((k) => a[k] === b[k]) && JSON.stringify(a.avc ?? null) === JSON.stringify(b.avc ?? null);
}

export class FakeVideoEncoder extends EventTarget {
  static async isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
    const ok = mockState().video.supportedCodec.test(config.codec) && config.width > 0 && config.height > 0;
    return { supported: ok, config: { ...config } };
  }

  state: CodecState = "unconfigured";
  encodeQueueSize = 0;
  ondequeue: ((ev: Event) => void) | null = null;
  /** Per-encoder behavior, copied from the shared behavior at construction. */
  readonly behavior: FakeVideoEncoderBehavior;
  readonly configureCalls: VideoEncoderConfig[] = [];
  readonly encodeCalls: Array<{ timestamp: number; keyFrame: boolean }> = [];
  resetCalls = 0;
  closeCalls = 0;
  /** Output chunks in emit order, for assertions. */
  readonly outputs: Array<{ type: "key" | "delta"; timestamp: number; nalType: number; hadConfig: boolean }> = [];
  private readonly output: EncodedVideoChunkOutputCallback;
  private readonly onError: WebCodecsErrorCallback;
  private config: VideoEncoderConfig | null = null;
  private queue: VideoWork[] = [];
  private held: VideoWork[] = [];
  private reorderSlot: VideoWork | null = null;
  private sessionFrames = 0;
  private needMeta = false;
  private forceKey = false;
  private generation = 0;
  private stalled = false;
  private flushes: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

  constructor(init: VideoEncoderInit) {
    super();
    if (typeof init?.output !== "function" || typeof init?.error !== "function") {
      throw new TypeError("output and error callbacks are required");
    }
    this.output = init.output;
    this.onError = init.error;
    this.behavior = { ...mockState().video };
    mockState().videoEncoders.push(this);
  }

  configure(config: VideoEncoderConfig): void {
    if (this.state === "closed") throw invalidState("VideoEncoder is closed");
    if (!config || typeof config.codec !== "string" || !(config.width > 0) || !(config.height > 0)) {
      throw new TypeError("Invalid VideoEncoderConfig");
    }
    this.configureCalls.push({ ...config });
    if (this.state === "configured" && this.behavior.identicalConfigureIsNoop && sameVideoConfig(this.config, config)) {
      return;
    }
    this.config = { ...config };
    this.state = "configured";
    this.sessionFrames = 0;
    this.needMeta = true;
    this.forceKey = true;
    if (!this.behavior.supportedCodec.test(config.codec)) {
      const gen = this.generation;
      queueMicrotask(() => {
        if (gen === this.generation) this.closeWithError(new DOMException("Unsupported codec", "NotSupportedError"));
      });
    }
  }

  encode(frame: FakeVideoFrame, options?: VideoEncoderEncodeOptions): void {
    if (this.state !== "configured") throw invalidState(`VideoEncoder is ${this.state}`);
    if (!(frame instanceof FakeVideoFrame) || frame.__closed) throw new TypeError("The frame is closed");
    const keyFrame = !!options?.keyFrame;
    this.encodeCalls.push({ timestamp: frame.timestamp, keyFrame });
    // The real encoder takes its own reference, so the caller can close the frame at once.
    this.queue.push({ frame: frame.clone(), keyFrame });
    this.encodeQueueSize++;
    this.schedule();
  }

  flush(): Promise<void> {
    if (this.state !== "configured") return Promise.reject(invalidState(`VideoEncoder is ${this.state}`));
    return new Promise((resolve, reject) => {
      this.flushes.push({ resolve, reject });
      this.schedule();
    });
  }

  reset(): void {
    if (this.state === "closed") throw invalidState("VideoEncoder is closed");
    this.resetCalls++;
    this.abortWork(new DOMException("reset", "AbortError"));
    this.state = "unconfigured";
    this.config = null;
  }

  close(): void {
    if (this.state === "closed") return;
    this.closeCalls++;
    this.abortWork(new DOMException("close", "AbortError"));
    this.state = "closed";
  }

  // ---- test hooks ----

  /** Stops taking work from the queue, so encodeQueueSize grows. */
  stall(on: boolean): void {
    this.stalled = on;
    if (!on) this.schedule();
  }

  /** Closes the encoder with an error, like a hardware encoder failure. */
  fail(error: DOMException = new DOMException("Encoder failure", "EncodingError")): void {
    this.closeWithError(error);
  }

  /** Closes the encoder the way Chromium reclaims an inactive codec. */
  reclaim(): void {
    this.closeWithError(new DOMException("Codec reclaimed due to inactivity.", "QuotaExceededError"));
  }

  // ---- internals ----

  private closeWithError(error: DOMException): void {
    if (this.state === "closed") return;
    this.abortWork(error);
    this.state = "closed";
    this.onError(error);
  }

  private abortWork(error: DOMException): void {
    this.generation++;
    for (const w of [...this.queue, ...this.held]) w.frame.close();
    if (this.reorderSlot) this.reorderSlot.frame.close();
    this.queue = [];
    this.held = [];
    this.reorderSlot = null;
    this.encodeQueueSize = 0;
    const flushes = this.flushes;
    this.flushes = [];
    for (const f of flushes) f.reject(error);
  }

  private schedule(): void {
    const gen = this.generation;
    queueMicrotask(() => {
      if (gen === this.generation) this.process();
    });
  }

  private process(): void {
    while (!this.stalled && this.queue.length > 0 && this.state === "configured") {
      const w = this.queue.shift()!;
      this.encodeQueueSize--;
      const ev = new Event("dequeue");
      this.dispatchEvent(ev);
      this.ondequeue?.(ev);
      this.held.push(w);
      while (this.held.length > this.behavior.outputLatencyFrames) this.route(this.held.shift()!);
    }
    if (this.flushes.length > 0 && this.queue.length === 0 && !this.stalled && this.state === "configured") {
      while (this.held.length > 0) this.route(this.held.shift()!);
      if (this.reorderSlot) {
        const w = this.reorderSlot;
        this.reorderSlot = null;
        this.emit(w);
      }
      const flushes = this.flushes;
      this.flushes = [];
      for (const f of flushes) f.resolve();
    }
  }

  private route(w: VideoWork): void {
    if (!this.behavior.reorder) {
      this.emit(w);
      return;
    }
    if (this.reorderSlot) {
      const first = this.reorderSlot;
      this.reorderSlot = null;
      this.emit(w);
      this.emit(first);
    } else {
      this.reorderSlot = w;
    }
  }

  private emit(w: VideoWork): void {
    const cfg = this.config!;
    const index = this.sessionFrames++;
    const isKey = this.forceKey || (this.behavior.honorKeyFrameRequests ? w.keyFrame : index % this.behavior.gopLength === 0);
    this.forceKey = false;
    const fault = this.behavior.labelFault(index);
    let type: "key" | "delta" = isKey ? "key" : "delta";
    let nalType = isKey ? 5 : 1;
    if (fault === "key-without-idr") {
      type = "key";
      nalType = 1;
    } else if (fault === "idr-as-delta") {
      type = "delta";
      nalType = 5;
    }
    const chunk = new FakeEncodedVideoChunk({
      type,
      timestamp: w.frame.timestamp,
      duration: w.frame.duration ?? undefined,
      data: fakeAccessUnit(nalType, w.frame.timestamp),
    });
    w.frame.close();
    let meta: EncodedVideoChunkMetadata | undefined;
    if (this.needMeta) {
      this.needMeta = false;
      meta = {
        decoderConfig: {
          codec: cfg.codec,
          codedWidth: cfg.width,
          codedHeight: cfg.height,
          description: fakeAvcC(cfg.width, cfg.height, this.behavior.avcCVariant, cfg.codec),
          ...(this.behavior.colorSpace ? { colorSpace: { ...this.behavior.colorSpace } } : {}),
        },
      };
    }
    this.outputs.push({ type, timestamp: chunk.timestamp, nalType, hadConfig: !!meta });
    this.output(chunk as unknown as EncodedVideoChunk, meta);
  }
}

// ---------------------------------------------------------------------------
// AudioData
// ---------------------------------------------------------------------------

export class FakeAudioData {
  format: AudioSampleFormat | null;
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  timestamp: number;
  duration: number;
  /** Planar float copy of the samples. */
  private planes: Float32Array[];
  private closed = false;

  constructor(init: AudioDataInit | { planes: Float32Array[]; sampleRate: number; timestamp: number }) {
    if ("planes" in init) {
      this.planes = init.planes.map((p) => p.slice());
      this.format = "f32-planar";
      this.sampleRate = init.sampleRate;
      this.numberOfChannels = init.planes.length;
      this.numberOfFrames = init.planes[0]?.length ?? 0;
      this.timestamp = init.timestamp;
    } else {
      const { format, sampleRate, numberOfFrames, numberOfChannels, timestamp, data } = init;
      if (!format || !(sampleRate > 0) || !(numberOfFrames > 0) || !(numberOfChannels > 0) || typeof timestamp !== "number") {
        throw new TypeError("Invalid AudioDataInit");
      }
      this.format = format;
      this.sampleRate = sampleRate;
      this.numberOfFrames = numberOfFrames;
      this.numberOfChannels = numberOfChannels;
      this.timestamp = timestamp;
      this.planes = readPlanes(format, toBytes(data), numberOfFrames, numberOfChannels);
    }
    this.duration = Math.round((this.numberOfFrames / this.sampleRate) * 1e6);
  }

  get __planes(): Float32Array[] {
    return this.planes;
  }

  get __closed(): boolean {
    return this.closed;
  }

  allocationSize(options: AudioDataCopyToOptions): number {
    const format = options.format ?? this.format ?? "f32-planar";
    const frames = options.frameCount ?? this.numberOfFrames - (options.frameOffset ?? 0);
    const bps = format.startsWith("s16") ? 2 : format.startsWith("u8") ? 1 : 4;
    return format.endsWith("planar") ? frames * bps : frames * bps * this.numberOfChannels;
  }

  copyTo(destination: unknown, options: AudioDataCopyToOptions): void {
    if (this.closed) throw invalidState("AudioData is closed");
    const format = options.format ?? this.format ?? "f32-planar";
    const offset = options.frameOffset ?? 0;
    const frames = options.frameCount ?? this.numberOfFrames - offset;
    const dest = toBytes(destination);
    if (dest.byteLength < this.allocationSize(options)) throw new RangeError("destination is too small");
    const view = new DataView(dest.buffer, dest.byteOffset, dest.byteLength);
    const planar = format.endsWith("planar");
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < this.numberOfChannels; c++) {
        if (planar && c !== options.planeIndex) continue;
        const v = this.planes[c][offset + f];
        const index = planar ? f : f * this.numberOfChannels + c;
        if (format.startsWith("f32")) view.setFloat32(index * 4, v, true);
        else if (format.startsWith("s16")) view.setInt16(index * 2, Math.max(-32768, Math.min(32767, Math.round(v * 32767))), true);
        else throw new TypeError(`Unsupported format ${format}`);
      }
    }
  }

  clone(): FakeAudioData {
    if (this.closed) throw invalidState("AudioData is closed");
    return new FakeAudioData({ planes: this.planes, sampleRate: this.sampleRate, timestamp: this.timestamp });
  }

  close(): void {
    this.closed = true;
    this.format = null;
  }
}

function readPlanes(format: AudioSampleFormat, bytes: Uint8Array, frames: number, channels: number): Float32Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const planes = Array.from({ length: channels }, () => new Float32Array(frames));
  const planar = format.endsWith("planar");
  const bps = format.startsWith("s16") ? 2 : 4;
  if (bytes.byteLength < frames * channels * bps) throw new TypeError("data is too small");
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const index = planar ? c * frames + f : f * channels + c;
      planes[c][f] = format.startsWith("s16") ? view.getInt16(index * 2, true) / 32768 : view.getFloat32(index * 4, true);
    }
  }
  return planes;
}

// ---------------------------------------------------------------------------
// AudioEncoder (a delay line) and AudioDecoder
// ---------------------------------------------------------------------------

const FAKE_AAC_MAGIC = 0x46414143; // "FAAC"

/** Builds the 2-byte AAC-LC AudioSpecificConfig that a correct encoder returns. */
function realAsc(sampleRate: number, channels: number): Uint8Array {
  const idx = AAC_RATES.indexOf(sampleRate);
  return new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (channels << 3)]);
}

function isSupportedAac(config: AudioEncoderConfig | AudioDecoderConfig): boolean {
  return config.codec === "mp4a.40.2" && (config.sampleRate === 48000 || config.sampleRate === 44100) && config.numberOfChannels >= 1 && config.numberOfChannels <= 2;
}

export class FakeAudioEncoder extends EventTarget {
  static async isConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport> {
    return { supported: isSupportedAac(config), config: { ...config } };
  }

  state: CodecState = "unconfigured";
  encodeQueueSize = 0;
  readonly flavor: "chromium" | "webkit";
  readonly delay: number;
  readonly configureCalls: AudioEncoderConfig[] = [];
  /** Input frames received since configure (before the WebKit drop). */
  inputFrames = 0;
  private readonly output: EncodedAudioChunkOutputCallback;
  private readonly onError: WebCodecsErrorCallback;
  private config: AudioEncoderConfig | null = null;
  private out: Float32Array[] = [];
  private outLen = 0;
  private emitted = 0;
  private dropLeft = 0;
  private firstTs: number | null = null;
  private needMeta = false;
  private generation = 0;

  constructor(init: AudioEncoderInit) {
    super();
    if (typeof init?.output !== "function" || typeof init?.error !== "function") throw new TypeError("callbacks required");
    this.output = init.output;
    this.onError = init.error;
    const s = mockState();
    this.flavor = s.audioFlavor;
    this.delay = s.audioDelay + (s.audioFlavor === "webkit" ? AAC_FRAME : 0);
    s.audioEncoders.push(this);
  }

  configure(config: AudioEncoderConfig): void {
    if (this.state === "closed") throw invalidState("AudioEncoder is closed");
    if (!isSupportedAac(config)) throw new DOMException("Unsupported", "NotSupportedError");
    this.configureCalls.push({ ...config });
    this.config = { ...config };
    this.state = "configured";
    this.generation++;
    this.out = Array.from({ length: config.numberOfChannels }, () => new Float32Array(1 << 16));
    this.outLen = this.delay;
    this.emitted = 0;
    this.inputFrames = 0;
    this.dropLeft = this.flavor === "webkit" ? AAC_FRAME : 0;
    this.firstTs = null;
    this.needMeta = true;
  }

  encode(data: FakeAudioData): void {
    if (this.state !== "configured") throw invalidState(`AudioEncoder is ${this.state}`);
    if (!(data instanceof FakeAudioData) || data.__closed) throw new TypeError("AudioData is closed");
    const cfg = this.config!;
    if (data.sampleRate !== cfg.sampleRate || data.numberOfChannels !== cfg.numberOfChannels) {
      throw new DOMException("Input does not match the config", "DataError");
    }
    this.firstTs ??= data.timestamp;
    this.inputFrames += data.numberOfFrames;
    let planes = data.__planes;
    if (this.dropLeft > 0) {
      const drop = Math.min(this.dropLeft, data.numberOfFrames);
      this.dropLeft -= drop;
      planes = planes.map((p) => p.subarray(drop));
    }
    this.append(planes);
    this.encodeQueueSize++;
    const gen = this.generation;
    queueMicrotask(() => {
      if (gen !== this.generation) return;
      this.encodeQueueSize--;
      this.emitReady(false);
    });
  }

  flush(): Promise<void> {
    if (this.state !== "configured") return Promise.reject(invalidState(`AudioEncoder is ${this.state}`));
    const gen = this.generation;
    return new Promise((resolve, reject) => {
      queueMicrotask(() => {
        queueMicrotask(() => {
          if (gen !== this.generation) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          this.emitReady(true);
          resolve();
        });
      });
    });
  }

  reset(): void {
    this.generation++;
    this.state = "unconfigured";
    this.encodeQueueSize = 0;
  }

  close(): void {
    this.generation++;
    this.state = "closed";
    this.encodeQueueSize = 0;
  }

  /** Test hook: closes the encoder with an error. */
  fail(error: DOMException = new DOMException("Audio encoder failure", "EncodingError")): void {
    if (this.state === "closed") return;
    this.close();
    this.onError(error);
  }

  private append(planes: Float32Array[]): void {
    const n = planes[0].length;
    if (this.outLen + n > this.out[0].length) {
      let size = this.out[0].length;
      while (size < this.outLen + n) size *= 2;
      this.out = this.out.map((p) => {
        const q = new Float32Array(size);
        q.set(p.subarray(0, this.outLen));
        return q;
      });
    }
    for (let c = 0; c < this.out.length; c++) this.out[c].set(planes[c], this.outLen);
    this.outLen += n;
  }

  private emitReady(final: boolean): void {
    const cfg = this.config!;
    if (final && this.outLen % AAC_FRAME !== 0) this.append(this.out.map(() => new Float32Array(AAC_FRAME - (this.outLen % AAC_FRAME))));
    while ((this.emitted + 1) * AAC_FRAME <= this.outLen) {
      const i = this.emitted++;
      const channels = cfg.numberOfChannels;
      const bytes = new Uint8Array(8 + AAC_FRAME * channels * 2);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, FAKE_AAC_MAGIC);
      view.setUint32(4, AAC_FRAME);
      for (let f = 0; f < AAC_FRAME; f++) {
        for (let c = 0; c < channels; c++) {
          const v = this.out[c][i * AAC_FRAME + f];
          view.setInt16(8 + (f * channels + c) * 2, Math.max(-32768, Math.min(32767, Math.round(v * 32767))), true);
        }
      }
      const chunk = new FakeEncodedAudioChunk({
        type: "key",
        timestamp: (this.firstTs ?? 0) + Math.round((i * AAC_FRAME * 1e6) / cfg.sampleRate),
        duration: Math.round((AAC_FRAME * 1e6) / cfg.sampleRate),
        data: bytes,
      });
      let meta: EncodedAudioChunkMetadata | undefined;
      if (this.needMeta) {
        this.needMeta = false;
        meta = {
          decoderConfig: {
            codec: cfg.codec,
            sampleRate: cfg.sampleRate,
            numberOfChannels: cfg.numberOfChannels,
            description: this.flavor === "webkit" ? WEBKIT_AAC_ESDS.slice() : realAsc(cfg.sampleRate, cfg.numberOfChannels),
          },
        };
      }
      this.output(chunk as unknown as EncodedAudioChunk, meta);
    }
  }
}

/** Parses a 2-byte AAC AudioSpecificConfig. Returns null for anything else (for example esds bytes). */
function parseAsc(desc: Uint8Array): { objectType: number; sampleRate: number; channels: number } | null {
  if (desc.byteLength < 2) return null;
  const objectType = desc[0] >> 3;
  const freqIndex = ((desc[0] & 0x07) << 1) | (desc[1] >> 7);
  const channels = (desc[1] >> 3) & 0x0f;
  if (objectType !== 2 || freqIndex >= AAC_RATES.length || channels === 0) return null;
  return { objectType, sampleRate: AAC_RATES[freqIndex], channels };
}

export class FakeAudioDecoder extends EventTarget {
  static async isConfigSupported(config: AudioDecoderConfig): Promise<AudioDecoderSupport> {
    return { supported: isSupportedAac(config), config: { ...config } };
  }

  state: CodecState = "unconfigured";
  decodeQueueSize = 0;
  readonly configureCalls: AudioDecoderConfig[] = [];
  private readonly output: AudioDataOutputCallback;
  private readonly onError: WebCodecsErrorCallback;
  private config: AudioDecoderConfig | null = null;
  private generation = 0;

  constructor(init: AudioDecoderInit) {
    super();
    if (typeof init?.output !== "function" || typeof init?.error !== "function") throw new TypeError("callbacks required");
    this.output = init.output;
    this.onError = init.error;
    mockState().audioDecoders.push(this);
  }

  configure(config: AudioDecoderConfig): void {
    if (this.state === "closed") throw invalidState("AudioDecoder is closed");
    this.configureCalls.push({ ...config });
    this.config = { ...config };
    this.state = "configured";
    this.generation++;
    const desc = config.description ? toBytes(config.description) : new Uint8Array(0);
    const asc = parseAsc(desc);
    const lenient = mockState().decoderAcceptsEsds && desc.byteLength > 2;
    const valid = asc !== null && asc.sampleRate === config.sampleRate && asc.channels === config.numberOfChannels;
    if (!valid && !lenient) {
      const gen = this.generation;
      queueMicrotask(() => {
        if (gen !== this.generation || this.state === "closed") return;
        this.state = "closed";
        this.onError(new DOMException("Invalid AudioSpecificConfig", "NotSupportedError"));
      });
    }
  }

  decode(chunk: FakeEncodedAudioChunk): void {
    if (this.state !== "configured") throw invalidState(`AudioDecoder is ${this.state}`);
    const bytes = new Uint8Array(chunk.byteLength);
    chunk.copyTo(bytes);
    const view = new DataView(bytes.buffer);
    const gen = this.generation;
    this.decodeQueueSize++;
    queueMicrotask(() => {
      if (gen !== this.generation || this.state !== "configured") return;
      this.decodeQueueSize--;
      if (bytes.byteLength < 8 || view.getUint32(0) !== FAKE_AAC_MAGIC) {
        this.state = "closed";
        this.onError(new DOMException("Corrupt packet", "EncodingError"));
        return;
      }
      const frames = view.getUint32(4);
      const channels = this.config!.numberOfChannels;
      const planes = Array.from({ length: channels }, () => new Float32Array(frames));
      for (let f = 0; f < frames; f++) {
        for (let c = 0; c < channels; c++) planes[c][f] = view.getInt16(8 + (f * channels + c) * 2, true) / 32768;
      }
      this.output(new FakeAudioData({ planes, sampleRate: this.config!.sampleRate, timestamp: chunk.timestamp }) as unknown as AudioData);
    });
  }

  flush(): Promise<void> {
    if (this.state !== "configured") return Promise.reject(invalidState(`AudioDecoder is ${this.state}`));
    return new Promise((resolve) => queueMicrotask(() => queueMicrotask(() => resolve())));
  }

  reset(): void {
    this.generation++;
    this.state = "unconfigured";
  }

  close(): void {
    this.generation++;
    this.state = "closed";
  }
}

// ---------------------------------------------------------------------------
// Install and uninstall
// ---------------------------------------------------------------------------

const GLOBAL_NAMES = [
  "VideoEncoder",
  "VideoFrame",
  "EncodedVideoChunk",
  "AudioEncoder",
  "AudioData",
  "AudioDecoder",
  "EncodedAudioChunk",
  "OffscreenCanvas",
] as const;

/** Installs the fakes on globalThis. Each class is present unless its option is false. */
export function installWebCodecsMock(options: WebCodecsMockOptions = {}): WebCodecsMock {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const name of GLOBAL_NAMES) saved.set(name, Object.getOwnPropertyDescriptor(g, name));

  const s: MockState = {
    video: { ...defaultVideoBehavior(), ...options.video },
    videoEncoders: [],
    audioEncoders: [],
    audioDecoders: [],
    canvases: [],
    openFrames: new Set(),
    audioFlavor: options.audioEncoderFlavor ?? "chromium",
    audioDelay: options.audioEncoderDelay ?? 2114,
    decoderAcceptsEsds: options.audioDecoderAcceptsEsds ?? false,
  };
  state = s;

  const plan: Record<(typeof GLOBAL_NAMES)[number], [boolean | undefined, unknown]> = {
    VideoEncoder: [options.videoEncoder, FakeVideoEncoder],
    VideoFrame: [options.videoFrame, FakeVideoFrame],
    EncodedVideoChunk: [options.encodedVideoChunk, FakeEncodedVideoChunk],
    AudioEncoder: [options.audioEncoder, FakeAudioEncoder],
    AudioData: [options.audioData, FakeAudioData],
    AudioDecoder: [options.audioDecoder, FakeAudioDecoder],
    EncodedAudioChunk: [options.encodedAudioChunk, FakeEncodedAudioChunk],
    OffscreenCanvas: [options.offscreenCanvas, FakeOffscreenCanvas],
  };
  for (const name of GLOBAL_NAMES) {
    const [present, value] = plan[name];
    if (present === false) delete g[name];
    else Object.defineProperty(g, name, { configurable: true, writable: true, value });
  }

  return {
    get videoEncoders() {
      return s.videoEncoders;
    },
    get audioEncoders() {
      return s.audioEncoders;
    },
    get audioDecoders() {
      return s.audioDecoders;
    },
    get canvases() {
      return s.canvases;
    },
    video: s.video,
    openFrames: () => s.openFrames.size,
    uninstall() {
      for (const name of GLOBAL_NAMES) {
        const d = saved.get(name);
        if (d) Object.defineProperty(g, name, d);
        else delete g[name];
      }
      if (state === s) state = null;
    },
  };
}

/** Makes an RGBA test picture: every pixel carries the given byte in R, G and B. */
export function rgbaPixels(width: number, height: number, value = 128): ArrayBuffer {
  const buf = new Uint8Array(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = value;
    buf[i + 1] = value;
    buf[i + 2] = value;
    buf[i + 3] = 255;
  }
  return buf.buffer;
}
