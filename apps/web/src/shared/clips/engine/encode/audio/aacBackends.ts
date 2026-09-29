/**
 * AAC encoder backends.
 *
 * native: AudioEncoder (mp4a.40.2, 48 kHz, 2 channels, 128 kbps). It needs
 * AudioData to feed it, so a device with AudioEncoder but no AudioData uses
 * the WASM backend.
 *
 * wasm: our own WebAssembly build of the FFmpeg AAC-LC encoder (aacenc in
 * libavcodec, LGPL-2.1-or-later). scripts/clips/aac-wasm builds it from a
 * pinned FFmpeg source tarball in a pinned Emscripten image, and the site
 * serves that exact source under /licenses. The module is one ES module file
 * with the WASM inside (AAC_WASM_MODULE_PATH). The encode worker imports it
 * only when this backend starts, so a device with native AAC never loads it.
 * One module instance serves every stream of the worker.
 *
 * The WASM encoder runs in the encode worker itself. It encodes in slices of
 * at most WASM_SLICE_MS, with a yield between slices, so a long backlog never
 * blocks the worker's frame intake. Packets come out between the slices, the
 * same way as AudioEncoder output, so the session's flow control applies.
 *
 * Neither backend uses the encoder's own AudioSpecificConfig. Clips always
 * carry the rebuilt one (WebKit 302253).
 */

import { AUDIO_BITRATE, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from "../../../protocol";
import {
  AAC_FRAME,
  MAX_BACKLOG_FRAMES,
  PRIMING_CONSTANTS,
  type AacBackend,
  type AacBackendFactory,
  type AacKind,
  type AacSink,
} from "./aac";

export const NATIVE_AAC_CONFIG: AudioEncoderConfig = {
  codec: "mp4a.40.2",
  sampleRate: AUDIO_SAMPLE_RATE,
  numberOfChannels: AUDIO_CHANNELS,
  bitrate: AUDIO_BITRATE,
};

/** True when this realm can run the native backend. */
export async function nativeAacSupported(): Promise<boolean> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return false;
  try {
    return (await AudioEncoder.isConfigSupported(NATIVE_AAC_CONFIG)).supported === true;
  } catch {
    return false;
  }
}

function planarData(left: Float32Array, right: Float32Array): Float32Array<ArrayBuffer> {
  const data = new Float32Array(left.length * 2);
  data.set(left);
  data.set(right, left.length);
  return data;
}

export async function createNativeBackend(sink: AacSink): Promise<AacBackend> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") {
    throw new Error("AudioEncoder or AudioData is not available");
  }
  const support = await AudioEncoder.isConfigSupported(NATIVE_AAC_CONFIG);
  if (!support.supported) throw new Error("AAC-LC 48 kHz stereo is not supported");
  let failed = false;
  let frames = 0;
  let packets = 0;
  const enc = new AudioEncoder({
    output: (chunk) => {
      packets++;
      const data = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(data);
      sink.packet(data);
    },
    error: (e) => {
      if (failed) return;
      failed = true;
      sink.error(e);
    },
  });
  enc.configure(NATIVE_AAC_CONFIG);
  return {
    kind: "native",
    encode(left, right) {
      // Frames fed minus frames that came out as packets: what the encoder still holds.
      if (frames - packets * AAC_FRAME > MAX_BACKLOG_FRAMES) throw new Error("native AAC encoder is not keeping up");
      const audio = new AudioData({
        format: "f32-planar",
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfFrames: left.length,
        numberOfChannels: AUDIO_CHANNELS,
        timestamp: Math.round((frames * 1e6) / AUDIO_SAMPLE_RATE),
        data: planarData(left, right),
      });
      frames += left.length;
      try {
        enc.encode(audio);
      } finally {
        audio.close();
      }
    },
    async flush() {
      if (enc.state === "configured") await enc.flush();
    },
    close() {
      if (enc.state !== "closed") enc.close();
    },
  };
}

// ---------------------------------------------------------------------------
// WASM backend
// ---------------------------------------------------------------------------

/** Where the site serves the module (apps/web/public/clips/aac). */
export const AAC_WASM_MODULE_PATH = "/clips/aac/ffmpeg-aac-enc.mjs";

/**
 * The bridge interface this code uses (AAC_BRIDGE_ABI in
 * scripts/clips/aac-wasm/bridge.c). A module with a different number is
 * refused, so an old cached module cannot run with new code.
 */
export const AAC_WASM_BRIDGE_ABI = 1;

/** Longest time one encode slice runs before the worker gets control back. */
export const WASM_SLICE_MS = 4;

/**
 * The exports of the module that scripts/clips/aac-wasm/bridge.c makes.
 * The heap views change when the memory grows. Read them again after every
 * call into the module.
 */
export interface AacWasmModule {
  readonly HEAPU8: Uint8Array;
  readonly HEAPF32: Float32Array;
  _aac_bridge_abi(): number;
  /** Returns an encoder pointer, or 0 when FFmpeg refuses the settings. */
  _aac_open(channels: number, sampleRate: number, bitrate: number): number;
  _aac_frame_size(ctx: number): number;
  _aac_initial_padding(ctx: number): number;
  /** Returns the address of one channel plane of the next frame, or 0. */
  _aac_input(ctx: number, channel: number): number;
  /** Sends the frame. The planes hold `samples` real samples; the rest becomes silence. */
  _aac_send(ctx: number, samples: number): number;
  /** Returns the size of the next packet, 0 when none is ready, or a negative error code. */
  _aac_receive(ctx: number): number;
  _aac_packet(ctx: number): number;
  _aac_flush(ctx: number): number;
  _aac_close(ctx: number): void;
}

/** Makes (or gives again) a started module instance. */
export type AacWasmLoader = () => Promise<AacWasmModule>;

/**
 * Imports the module at `url` and starts one instance of it.
 * Throws when the file has no factory or has a different bridge version.
 */
export async function instantiateAacWasm(url: string): Promise<AacWasmModule> {
  // The URL is known only at run time. The comments stop the bundlers from
  // trying to resolve it, so the browser loads the file with a native import.
  const imported = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url)) as {
    default?: unknown;
  };
  if (typeof imported.default !== "function") throw new Error(`${url} has no module factory`);
  const mod = (await (imported.default as () => Promise<AacWasmModule>)()) as AacWasmModule;
  const abi = typeof mod._aac_bridge_abi === "function" ? mod._aac_bridge_abi() : null;
  if (abi !== AAC_WASM_BRIDGE_ABI) {
    throw new Error(`the AAC module at ${url} has bridge version ${abi}, not ${AAC_WASM_BRIDGE_ABI}`);
  }
  return mod;
}

/**
 * The full URL of the module for this realm. In the encode worker, the base
 * is the worker script URL, so the path resolves on the site's own origin.
 * Throws when the realm has no location.
 */
export function aacWasmUrl(): string {
  const base = (globalThis as { location?: { href?: string } }).location?.href;
  if (!base) throw new Error("no page or worker location to load the AAC module from");
  return new URL(AAC_WASM_MODULE_PATH, base).href;
}

export interface SharedAacWasm {
  /** Gives the shared instance. The first call starts it. */
  load: AacWasmLoader;
  /** Stops giving out `mod` (its memory can be broken after a trap). The next load starts a new instance. */
  retire(mod: AacWasmModule): void;
}

/**
 * One module instance for many streams. A load that fails is forgotten, so
 * the next stream tries again.
 */
export function sharedAacWasm(make: AacWasmLoader): SharedAacWasm {
  let current: { promise: Promise<AacWasmModule>; module: AacWasmModule | null } | null = null;
  return {
    load() {
      if (current) return current.promise;
      const entry: { promise: Promise<AacWasmModule>; module: AacWasmModule | null } = {
        promise: Promise.resolve().then(make),
        module: null,
      };
      current = entry;
      entry.promise.then(
        (mod) => {
          entry.module = mod;
        },
        () => {
          if (current === entry) current = null;
        },
      );
      return entry.promise;
    },
    retire(mod) {
      if (current?.module === mod) current = null;
    },
  };
}

/** The worker's shared instance of the module under AAC_WASM_MODULE_PATH. */
const workerAacWasm = sharedAacWasm(() => instantiateAacWasm(aacWasmUrl()));

/** The default loader: one instance per worker, made on first use. */
export const loadSharedAacWasm: AacWasmLoader = () => workerAacWasm.load();

/** The default retire hook of the worker's shared instance. */
export const retireAacWasm = (mod: AacWasmModule): void => workerAacWasm.retire(mod);

/** A negative return code from FFmpeg. The module memory is still sound. */
class FfmpegError extends Error {
  constructor(what: string, code: number) {
    super(`${what} failed with FFmpeg error ${code}`);
    this.name = "FfmpegError";
  }
}

export interface WasmBackendOptions {
  /** Gives the module instance. Default: loadSharedAacWasm. */
  load?: AacWasmLoader;
  /** Called with an instance that trapped. Default: retireAacWasm. */
  retire?: (mod: AacWasmModule) => void;
  /** Runs `fn` after the worker handles its other work. Default: setTimeout(fn, 0). */
  schedule?: (fn: () => void) => void;
  /** Longest time of one encode slice, in milliseconds. Default WASM_SLICE_MS. */
  sliceMs?: number;
  /** Clock in milliseconds. Default performance.now. */
  now?: () => number;
}

type WasmState = "open" | "flushing" | "done" | "failed" | "closed";

export async function createWasmBackend(sink: AacSink, options: WasmBackendOptions = {}): Promise<AacBackend> {
  const load = options.load ?? loadSharedAacWasm;
  const retire = options.retire ?? retireAacWasm;
  const mod = await load();
  let ctx = 0;
  let frameSize = 0;
  let padding = 0;
  try {
    ctx = mod._aac_open(AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, AUDIO_BITRATE);
    if (ctx) {
      frameSize = mod._aac_frame_size(ctx);
      padding = mod._aac_initial_padding(ctx);
    }
  } catch (e) {
    if (isTrap(e)) retire(mod);
    throw e;
  }
  if (!ctx) throw new Error("the WASM AAC encoder refused AAC-LC 48 kHz stereo at 128 kbps");
  // The session's timestamps assume these two numbers (plan 3a). A module that differs is refused.
  if (frameSize !== AAC_FRAME || padding !== PRIMING_CONSTANTS.wasm) {
    try {
      mod._aac_close(ctx);
    } catch (e) {
      if (isTrap(e)) retire(mod);
    }
    throw new Error(
      `the WASM AAC encoder has frame size ${frameSize} and delay ${padding}, not ${AAC_FRAME} and ${PRIMING_CONSTANTS.wasm}`,
    );
  }
  return new WasmAacBackend(mod, ctx, sink, {
    retire,
    schedule: options.schedule ?? ((fn) => void setTimeout(fn, 0)),
    sliceMs: options.sliceMs ?? WASM_SLICE_MS,
    now: options.now ?? (() => performance.now()),
  });
}

/**
 * True for an error that leaves the module memory unsafe: a WebAssembly trap
 * (abort, memory access out of bounds, unreachable code), or a RangeError from
 * a call stack overflow or a bad heap address.
 */
function isTrap(e: unknown): boolean {
  return (typeof WebAssembly !== "undefined" && e instanceof WebAssembly.RuntimeError) || e instanceof RangeError;
}

interface Chunk {
  left: Float32Array;
  right: Float32Array;
  /** Frames of this chunk already moved to the frame buffer. */
  at: number;
}

class WasmAacBackend implements AacBackend {
  readonly kind = "wasm" as const;
  private state: WasmState = "open";
  private readonly queue: Chunk[] = [];
  private queued = 0;
  /** One frame of input, filled from the queue. */
  private readonly frameL = new Float32Array(AAC_FRAME);
  private readonly frameR = new Float32Array(AAC_FRAME);
  private framed = 0;
  private scheduled = false;
  private idleWaiters: (() => void)[] = [];
  /** False after aac_close, or after a trap (the memory can be broken). */
  private ctxLive = true;

  constructor(
    private readonly mod: AacWasmModule,
    private readonly ctx: number,
    private readonly sink: AacSink,
    private readonly o: {
      retire: (mod: AacWasmModule) => void;
      schedule: (fn: () => void) => void;
      sliceMs: number;
      now: () => number;
    },
  ) {}

  encode(left: Float32Array, right: Float32Array): void {
    if (this.state === "failed") throw new Error("WASM AAC encoder failed");
    if (this.state !== "open") throw new Error(`WASM AAC encoder is ${this.state}`);
    if (left.length !== right.length) throw new RangeError("left and right have different lengths");
    if (this.queued > MAX_BACKLOG_FRAMES) throw new Error("WASM AAC encoder is not keeping up");
    if (left.length === 0) return;
    // Copies: the caller can use its arrays again after this call.
    this.queue.push({ left: left.slice(), right: right.slice(), at: 0 });
    this.queued += left.length;
    this.kick();
  }

  async flush(): Promise<void> {
    if (this.state !== "open") return;
    this.state = "flushing";
    if (this.queue.length > 0) {
      await new Promise<void>((resolve) => {
        this.idleWaiters.push(resolve);
        this.kick();
      });
    }
    if (this.state !== "flushing") return;
    try {
      // A short last frame is padded with silence (aac_send does it).
      if (this.framed > 0) this.sendFrame(this.framed);
      if (this.state !== "flushing") return;
      const ret = this.mod._aac_flush(this.ctx);
      if (ret < 0) throw new FfmpegError("aac_flush", ret);
      this.receive();
    } catch (e) {
      this.fail(e);
      return;
    }
    if (this.state === "flushing") this.state = "done";
  }

  close(): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.dropQueue();
    this.closeCtx();
  }

  // ---------------------------------------------------------------------------

  private kick(): void {
    if (this.scheduled || this.queue.length === 0) return;
    this.scheduled = true;
    this.o.schedule(() => this.slice());
  }

  /** Encodes queued frames for at most sliceMs, then yields. */
  private slice(): void {
    this.scheduled = false;
    if (this.state !== "open" && this.state !== "flushing") return;
    const started = this.o.now();
    try {
      while (this.queue.length > 0) {
        this.fillFrame();
        if (this.framed < AAC_FRAME) continue;
        this.sendFrame(AAC_FRAME);
        if (this.state !== "open" && this.state !== "flushing") return;
        if (this.o.now() - started >= this.o.sliceMs) break;
      }
    } catch (e) {
      this.fail(e);
      return;
    }
    if (this.queue.length > 0) this.kick();
    else this.wakeIdle();
  }

  /** Moves queued frames into the frame buffer until it is full or the queue is empty. */
  private fillFrame(): void {
    const chunk = this.queue[0];
    const n = Math.min(AAC_FRAME - this.framed, chunk.left.length - chunk.at);
    this.frameL.set(chunk.left.subarray(chunk.at, chunk.at + n), this.framed);
    this.frameR.set(chunk.right.subarray(chunk.at, chunk.at + n), this.framed);
    this.framed += n;
    chunk.at += n;
    this.queued -= n;
    if (chunk.at === chunk.left.length) this.queue.shift();
  }

  /** Sends the frame buffer (its first `samples` samples are real audio) and passes on the packets. */
  private sendFrame(samples: number): void {
    const mod = this.mod;
    const l = mod._aac_input(this.ctx, 0);
    const r = mod._aac_input(this.ctx, 1);
    if (!l || !r) throw new FfmpegError("aac_input", -1);
    // Read the heap view after the calls: an allocation can grow the memory.
    const heap = mod.HEAPF32;
    heap.set(this.frameL.subarray(0, samples), l >>> 2);
    heap.set(this.frameR.subarray(0, samples), r >>> 2);
    this.framed = 0;
    const ret = mod._aac_send(this.ctx, samples);
    if (ret < 0) throw new FfmpegError("aac_send", ret);
    this.receive();
  }

  /** Passes every ready packet to the sink. The sink can close this backend. */
  private receive(): void {
    for (;;) {
      const size = this.mod._aac_receive(this.ctx);
      if (size === 0) return;
      if (size < 0) throw new FfmpegError("aac_receive", size);
      const at = this.mod._aac_packet(this.ctx);
      const data = this.mod.HEAPU8.slice(at, at + size).buffer;
      this.sink.packet(data);
      if (this.state !== "open" && this.state !== "flushing") return;
    }
  }

  private fail(e: unknown): void {
    if (this.state === "failed" || this.state === "closed") return;
    this.state = "failed";
    this.dropQueue();
    if (isTrap(e)) {
      // The module memory is not safe to use again. The next stream gets a new instance.
      this.ctxLive = false;
      this.o.retire(this.mod);
    } else {
      this.closeCtx();
    }
    this.sink.error(e);
  }

  private closeCtx(): void {
    if (!this.ctxLive) return;
    this.ctxLive = false;
    try {
      this.mod._aac_close(this.ctx);
    } catch (e) {
      if (isTrap(e)) this.o.retire(this.mod);
    }
  }

  private dropQueue(): void {
    this.queue.length = 0;
    this.queued = 0;
    this.framed = 0;
    this.wakeIdle();
  }

  private wakeIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }
}

/** The factory the worker uses: the real backend for each kind. */
export const createAacBackend: AacBackendFactory = (kind: AacKind, sink: AacSink) =>
  kind === "native" ? createNativeBackend(sink) : createWasmBackend(sink);
