/**
 * Continuous AAC-LC encoding of the mix (plan 5, 6.4 and 6.5).
 *
 * The mixer writes 48 kHz stereo blocks into the PCM ring. The AAC session
 * reads the PCM ring and feeds an encoder backend: the native AudioEncoder
 * (mp4a.40.2, 48 kHz, 2 channels, 128 kbps), or the WASM encoder from
 * @mediabunny/aac-encoder where native AAC is missing (tier W+).
 *
 * Timestamps come from our own sample counter, never from the encoder:
 * - At every configure, 1024 frames of silence go in first (Safari drops the
 *   first 1024 samples, plan section 5).
 * - The priming P is the encoder delay without that pad (2114 native on
 *   iOS 27 and macOS, 1024 for the FFmpeg WASM encoder, plan 3a).
 * - With D = P + 1024, packet i of a stream whose first real frame is k2
 *   holds the audio of frames [k2 - D + 1024 i, k2 - D + 1024 (i + 1)).
 *   That frame index is the packet timestamp. It already includes the -P
 *   shift of plan 6.4.
 *
 * The AudioSpecificConfig is always rebuilt (WebKit 302253 returns esds box
 * bytes as the description). The encoder's own description is never used.
 *
 * A restart (encoder error, reclaim, iOS hidden) is gapless. The new stream
 * starts earlier with real audio from the PCM ring (pre-roll), on a packet
 * grid that meets the old grid at the splice point. The ring keeps old
 * packets before the splice and new packets from it, so the packet line is
 * always contiguous and never overlaps.
 */

import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, type ClipPackets } from "../../../protocol";

export const AAC_FRAME = 1024;
/** Silence fed at every configure (plan section 5). */
export const PRE_PAD_FRAMES = 1024;
/** Encoder delay without the pre-pad, used when AudioDecoder cannot measure it (plan 3a). */
export const PRIMING_CONSTANTS = { native: 2114, wasm: 1024 } as const;

export type AacKind = keyof typeof PRIMING_CONSTANTS;

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** Builds the 2-byte AudioSpecificConfig for AAC-LC (ISO 14496-3, 1.6.2.1). */
export function buildAudioSpecificConfig(sampleRate: number, channels: number): Uint8Array {
  const idx = AAC_RATES.indexOf(sampleRate);
  if (idx < 0) throw new RangeError(`No AAC frequency index for ${sampleRate} Hz`);
  if (!(channels >= 1 && channels <= 7)) throw new RangeError(`Bad AAC channel count ${channels}`);
  return new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (channels << 3)]);
}

/** The audio config every clip carries: always the rebuilt ASC. */
export function clipAudioConfig(): NonNullable<ClipPackets["audioConfig"]> {
  return {
    codec: "mp4a.40.2",
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfChannels: AUDIO_CHANNELS,
    description: buildAudioSpecificConfig(AUDIO_SAMPLE_RATE, AUDIO_CHANNELS).slice().buffer,
  };
}

export const frameToUs = (frame: number) => Math.round((frame * 1e6) / AUDIO_SAMPLE_RATE);
export const AAC_FRAME_US = frameToUs(AAC_FRAME);

// ---------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------

export interface AudioPacket {
  /** Output frame of the first decoded sample (the -P shift is included). */
  tsFrames: number;
  /** Raw AAC access unit. Owned by the ring. Copy before a transfer. */
  data: ArrayBuffer;
  /** Encoder stream number. A new stream starts after each restart. */
  stream: number;
}

/** AAC packets in timestamp order, 1024 frames each, with no gaps and no overlaps. */
export class AacPacketRing {
  private list: AudioPacket[] = [];
  private head = 0;
  private totalBytes = 0;
  private readonly keepFrames: number;

  constructor(keepSeconds: number) {
    this.keepFrames = Math.ceil(keepSeconds * AUDIO_SAMPLE_RATE);
  }

  /** Adds the newest packet. Keeps the fewest old packets that still cover keepSeconds. */
  push(p: AudioPacket): void {
    this.list.push(p);
    this.totalBytes += p.data.byteLength;
    const keepFrom = p.tsFrames + AAC_FRAME - this.keepFrames;
    while (this.head < this.list.length - 1 && this.list[this.head + 1].tsFrames <= keepFrom) {
      this.totalBytes -= this.list[this.head].data.byteLength;
      this.head++;
    }
    if (this.head > 1024 && this.head * 2 > this.list.length) {
      this.list = this.list.slice(this.head);
      this.head = 0;
    }
  }

  /** Packets, oldest first. Do not change them. */
  get packets(): readonly AudioPacket[] {
    return this.head === 0 ? this.list : this.list.slice(this.head);
  }

  get size(): number {
    return this.list.length - this.head;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  /** End frame of the newest packet: the AAC watermark. -Infinity when empty. */
  get endFrame(): number {
    const last = this.list[this.list.length - 1];
    return this.size > 0 && last ? last.tsFrames + AAC_FRAME : -Infinity;
  }

  get startFrame(): number {
    return this.size > 0 ? this.list[this.head].tsFrames : Infinity;
  }

  clear(): void {
    this.list = [];
    this.head = 0;
    this.totalBytes = 0;
  }
}

/** Int16 interleaved stereo ring of the mix, indexed by output frame. */
export class PcmRing {
  readonly capacityFrames: number;
  private readonly buf: Int16Array;
  private start = 0;
  private end = 0;
  private empty = true;

  constructor(seconds: number) {
    this.capacityFrames = Math.ceil(seconds * AUDIO_SAMPLE_RATE);
    this.buf = new Int16Array(this.capacityFrames * AUDIO_CHANNELS);
  }

  /** First frame held, or null when empty. */
  get startFrame(): number | null {
    return this.empty ? null : this.start;
  }

  /** One past the last frame held, or null when empty. */
  get endFrame(): number | null {
    return this.empty ? null : this.end;
  }

  get bytes(): number {
    return this.empty ? 0 : (this.end - this.start) * AUDIO_CHANNELS * 2;
  }

  /** Appends interleaved float stereo that starts at `startFrame`. A gap is filled with silence. */
  write(startFrame: number, interleaved: Float32Array): void {
    const frames = Math.floor(interleaved.length / AUDIO_CHANNELS);
    if (frames === 0) return;
    if (this.empty) {
      this.start = startFrame;
      this.end = startFrame;
      this.empty = false;
    }
    if (startFrame + frames <= this.end) return;
    if (startFrame > this.end) {
      if (startFrame - this.end >= this.capacityFrames) {
        this.start = startFrame;
        this.end = startFrame;
      } else {
        for (let f = this.end; f < startFrame; f++) {
          const i = (f % this.capacityFrames) * 2;
          this.buf[i] = 0;
          this.buf[i + 1] = 0;
        }
        this.end = startFrame;
      }
    }
    for (let f = this.end - startFrame; f < frames; f++) {
      const i = ((startFrame + f) % this.capacityFrames) * 2;
      this.buf[i] = toInt16(interleaved[f * 2]);
      this.buf[i + 1] = toInt16(interleaved[f * 2 + 1]);
    }
    this.end = startFrame + frames;
    this.start = Math.max(this.start, this.end - this.capacityFrames);
  }

  /** Reads frames [from, from + frames) as Int16 interleaved. Frames the ring does not hold are silence. */
  read(from: number, frames: number): Int16Array {
    const out = new Int16Array(frames * AUDIO_CHANNELS);
    if (this.empty) return out;
    const a = Math.max(from, this.start);
    const b = Math.min(from + frames, this.end);
    for (let f = a; f < b; f++) {
      const i = (f % this.capacityFrames) * 2;
      const o = (f - from) * 2;
      out[o] = this.buf[i];
      out[o + 1] = this.buf[i + 1];
    }
    return out;
  }

  clear(): void {
    this.empty = true;
    this.start = 0;
    this.end = 0;
  }
}

function toInt16(v: number): number {
  const s = Math.round(v * 32767);
  return s > 32767 ? 32767 : s < -32768 ? -32768 : s;
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

/** Receives the raw AAC access units of one backend, in order. */
export interface AacSink {
  packet(data: ArrayBuffer): void;
  error(error: unknown): void;
}

/**
 * Most audio a backend may hold unencoded. A device that cannot encode AAC in
 * real time fails the stream instead of growing memory without limit.
 */
export const MAX_BACKLOG_FRAMES = 10 * AUDIO_SAMPLE_RATE;

/** One encoder stream. Feed planar float frames; packets come out through the sink. */
export interface AacBackend {
  readonly kind: AacKind;
  encode(left: Float32Array, right: Float32Array): void;
  /** Encodes what is left (padded with silence) and resolves when every packet is out. */
  flush(): Promise<void>;
  close(): void;
}

export type AacBackendFactory = (kind: AacKind, sink: AacSink) => Promise<AacBackend>;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

interface Stream {
  id: number;
  kind: AacKind;
  /** D: encoder delay plus the pre-pad. */
  delay: number;
  /** First real frame fed. */
  k2: number;
  /** Next frame to feed. */
  fed: number;
  /** Packets received. */
  index: number;
  /** Drop packets before this frame (the splice with the previous stream). */
  cut: number;
  /** Drop packets at or after this frame (set when the stream ends). */
  endCut: number;
  /** End frame of the last packet this stream put in the ring. */
  lastEnd: number | null;
  backend: AacBackend | null;
  state: "starting" | "running" | "ending" | "dead";
}

export interface AacSessionOptions {
  /** Backends to try, in order. A kind that fails often moves to the next one. */
  kinds: AacKind[];
  /** Priming P per kind, without the pre-pad. */
  primingSamples: Partial<Record<AacKind, number>>;
  createBackend: AacBackendFactory;
  pcm: PcmRing;
  ring: AacPacketRing;
  /** Each packet that enters the ring (for the Record tee). */
  onPacket?: (p: AudioPacket) => void;
  onError: (code: "audio-encoder-missing" | "audio-encoder-error", detail: string) => void;
  /** Clock for the failure window, in milliseconds. */
  now?: () => number;
}

export interface AacSessionStats {
  kind: AacKind | null;
  streams: number;
  failures: number;
  disabled: boolean;
  packets: number;
}

/** Failures of one kind inside this window move the session to the next kind. */
const FAILURE_WINDOW_MS = 10_000;
const FAILURES_TO_SWITCH = 3;
/** Frames per encode call. */
const FEED_CHUNK = 8192;

export class AacSession {
  private readonly o: AacSessionOptions;
  private readonly now: () => number;
  private kindIndex = 0;
  private stream: Stream | null = null;
  private streamIds = 0;
  /** Where the next stream splices on: the end of the audio already in the ring. */
  private splice: number | null = null;
  /** Where a first stream starts when no splice exists yet. */
  private firstFrame: number | null = null;
  private failureTimes: number[] = [];
  private failures = 0;
  private disabled = false;
  private packets = 0;
  /** A stream that is flushing. No new stream starts until it is done. */
  private closing: { stream: Stream; done: Promise<void> } | null = null;

  constructor(options: AacSessionOptions) {
    this.o = options;
    this.now = options.now ?? (() => performance.now());
    if (options.kinds.length === 0) this.disable("no AAC encoder is available");
  }

  get kind(): AacKind | null {
    return this.disabled ? null : (this.o.kinds[this.kindIndex] ?? null);
  }

  /** P of the current kind, without the pre-pad. */
  get primingSamples(): number {
    const k = this.kind ?? this.o.kinds[0] ?? "native";
    return this.o.primingSamples[k] ?? PRIMING_CONSTANTS[k];
  }

  get enabled(): boolean {
    return !this.disabled;
  }

  get stats(): AacSessionStats {
    return { kind: this.kind, streams: this.streamIds, failures: this.failures, disabled: this.disabled, packets: this.packets };
  }

  /** Feeds every PCM frame that is ready. Starts a stream when none is running. */
  pump(): void {
    // While a stream flushes, its splice point is not known yet. The next pump after the flush starts the new stream.
    if (this.disabled || this.closing) return;
    const pcmEnd = this.o.pcm.endFrame;
    if (pcmEnd === null) return;
    if (!this.stream) {
      this.startStream();
      return;
    }
    const st = this.stream;
    if (st.state !== "running" || !st.backend) return;
    try {
      while (st.fed < pcmEnd) {
        const n = Math.min(FEED_CHUNK, pcmEnd - st.fed);
        const [left, right] = planar(this.o.pcm.read(st.fed, n));
        st.fed += n;
        st.backend.encode(left, right);
      }
    } catch (e) {
      this.failStream(st, e);
    }
  }

  /** Flushes and closes the current stream (iOS hidden). The next pump splices a new one. */
  async closeStream(): Promise<void> {
    if (this.closing) return this.closing.done;
    const st = this.stream;
    if (!st) return;
    this.stream = null;
    const backend = st.backend;
    if (st.state === "starting" || !backend) {
      st.state = "dead";
      this.keepStartOf(st);
      return;
    }
    st.endCut = gridFloor(st, st.fed);
    st.state = "ending";
    const done = (async () => {
      try {
        await backend.flush();
      } catch {
        // A failed flush loses only the tail. The splice below uses what reached the ring.
      }
      safeCloseBackend(backend);
      // A purge or an error during the flush already settled this stream.
      if (st.state === "dead") return;
      st.state = "dead";
      // Splice on what really reached the ring. A failed flush can leave it short of the end cut.
      this.setSpliceFrom(st, st.lastEnd);
    })();
    this.closing = { stream: st, done };
    try {
      await done;
    } finally {
      this.closing = null;
    }
  }

  /** Ends the stream without a splice and forgets the audio position (owner purge). */
  purge(): void {
    // A flushing stream's tail is the old owner's audio: drop it.
    if (this.closing) this.closing.stream.state = "dead";
    const st = this.stream;
    this.stream = null;
    if (st) {
      st.state = "dead";
      if (st.backend) safeCloseBackend(st.backend);
    }
    this.splice = null;
    this.firstFrame = null;
  }

  close(): void {
    this.purge();
    this.disabled = true;
  }

  // ---------------------------------------------------------------------------

  private startStream(): void {
    const kind = this.o.kinds[this.kindIndex];
    const delay = (this.o.primingSamples[kind] ?? PRIMING_CONSTANTS[kind]) + PRE_PAD_FRAMES;
    let k2: number;
    let cut: number;
    if (this.splice !== null) {
      // Pre-roll: start early enough that the packet at the splice has one real packet before it,
      // on a grid that passes through the splice point.
      cut = this.splice;
      const j = Math.ceil((delay + AAC_FRAME) / AAC_FRAME);
      k2 = cut + delay - AAC_FRAME * j;
    } else {
      k2 = this.firstFrame ?? this.o.pcm.startFrame ?? 0;
      cut = -Infinity;
    }
    const st: Stream = { id: ++this.streamIds, kind, delay, k2, fed: k2, index: 0, cut, endCut: Infinity, lastEnd: null, backend: null, state: "starting" };
    this.stream = st;
    const sink: AacSink = {
      packet: (data) => this.onPacket(st, data),
      error: (e) => this.failStream(st, e),
    };
    this.o.createBackend(kind, sink).then(
      (backend) => {
        if (this.stream !== st || st.state !== "starting") {
          safeCloseBackend(backend);
          return;
        }
        st.backend = backend;
        st.state = "running";
        try {
          const pad = new Float32Array(PRE_PAD_FRAMES);
          backend.encode(pad, pad.slice());
        } catch (e) {
          this.failStream(st, e);
          return;
        }
        this.pump();
      },
      (e) => this.failStream(st, e, true),
    );
  }

  private onPacket(st: Stream, data: ArrayBuffer): void {
    if (st.state === "dead" || st.state === "starting") return;
    const ts = st.k2 - st.delay + AAC_FRAME * st.index++;
    if (ts < st.cut || ts >= st.endCut) return;
    const p: AudioPacket = { tsFrames: ts, data, stream: st.id };
    st.lastEnd = ts + AAC_FRAME;
    this.packets++;
    this.o.ring.push(p);
    this.o.onPacket?.(p);
  }

  private failStream(st: Stream, e: unknown, creation = false): void {
    if (st.state === "dead") return;
    const wasCurrent = this.stream === st;
    st.state = "dead";
    if (st.backend) safeCloseBackend(st.backend);
    if (wasCurrent) this.stream = null;
    this.setSpliceFrom(st, st.lastEnd);
    this.failures++;
    const t = this.now();
    this.failureTimes = this.failureTimes.filter((x) => t - x < FAILURE_WINDOW_MS);
    this.failureTimes.push(t);
    const detail = `AAC ${st.kind} encoder: ${describe(e)}`;
    if (creation || this.failureTimes.length >= FAILURES_TO_SWITCH) {
      this.failureTimes = [];
      this.kindIndex++;
      if (this.kindIndex >= this.o.kinds.length) {
        this.disable(detail);
        return;
      }
    }
    this.o.onError("audio-encoder-error", detail);
  }

  /** After a stream ends, the next one splices at `end`, or restarts where this one started. */
  private setSpliceFrom(st: Stream, end: number | null): void {
    if (end !== null) this.splice = end;
    else if (Number.isFinite(st.cut)) this.splice = st.cut;
    else this.keepStartOf(st);
  }

  private keepStartOf(st: Stream): void {
    if (this.splice === null) this.firstFrame = st.k2;
  }

  private disable(detail: string): void {
    this.disabled = true;
    this.o.onError("audio-encoder-missing", detail);
  }
}

/** Largest packet timestamp on the stream's grid at or before `frame`. */
function gridFloor(st: Stream, frame: number): number {
  const base = st.k2 - st.delay;
  return base + AAC_FRAME * Math.floor((frame - base) / AAC_FRAME);
}

function planar(pcm: Int16Array): [Float32Array, Float32Array] {
  const n = pcm.length / 2;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = pcm[i * 2] / 32768;
    right[i] = pcm[i * 2 + 1] / 32768;
  }
  return [left, right];
}

function safeCloseBackend(b: AacBackend): void {
  try {
    b.close();
  } catch {
    // The backend is already gone.
  }
}

function describe(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const err = e as { name?: string; message?: string };
    return `${err.name ?? "Error"}: ${err.message ?? ""}`;
  }
  return String(e);
}
