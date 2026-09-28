/**
 * Audio mixer (plan 6.4 and 6.4.1).
 *
 * Input: PcmBatch messages from each tap stream (the page bus, each iframe
 * realm), and a ClockAnchor for each stream every 250 ms.
 * Output: contiguous 1024-frame blocks of 48 kHz stereo on the capture
 * timeline. Output frame k is capture time k / 48000 s, the same clock as the
 * video timestamps.
 *
 * For each stream:
 * - StreamClock maps its context time to page time (production time, with
 *   timeOriginOffsetMs for iframe realms).
 * - A phase-locked resampler reads the stream at the position the clock gives.
 *   Its step is the nominal ratio divided by the learned clock rate. A PI loop
 *   removes what is left, so drift never becomes a timestamp jump.
 * - 4-point Hermite interpolation converts to 48 kHz. Hermite does not
 *   low-pass, so a stream above 50 kHz (a 96 kHz desktop audio interface)
 *   first goes through a Kaiser-windowed sinc low-pass. Without it, content
 *   from 24 to 48 kHz (oscillator harmonics) folds into audible aliasing. The
 *   filter's group delay is taken out, so timing stays exact.
 * - A watermark: the mix waits for a running stream's data, but never for a
 *   stream that is suspended, interrupted, closed or unloaded. A stream whose
 *   data is older than the stall limit stops holding the mix and its missing
 *   span is zero-filled.
 *
 * Pauses are removed in the PCM domain: the timeline skips the paused span,
 * and the output fades out before each pause point and in after it
 * (8 ms raised cosine). The output counter never skips a frame.
 */

import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, type ClockAnchor, type PcmBatch } from "../../../protocol";
import { CaptureTimeline } from "../timeline";
import { StreamClock } from "./clock";

export const MIX_BLOCK_FRAMES = 1024;
/** Output fade on each side of a pause point: 8 ms (plan: 5-10 ms). */
export const SEAM_FADE_FRAMES = 384;
/** Per-stream fade-in after a stream starts or resyncs: 5 ms. */
export const STREAM_FADE_FRAMES = 240;
/** Newest audio the mix renders while live, so a pause message can arrive before its fade is due. */
export const MIN_LATENCY_MS = 30;
/** A running stream whose data is older than this stops holding the mix. */
export const STALL_MS = 250;
/** A running stream whose data is older than this is treated as gone (no underrun count). */
export const LOST_MS = 1000;

const SR = AUDIO_SAMPLE_RATE;
const BUFFER_FRAMES = 1 << 17; // 2.7 s at 48 kHz
const MASK = BUFFER_FRAMES - 1;
/** Frames the resampler read position may lead its target by. */
const GUARD_FRAMES = 32;
/** A target further than this from the read position is a jump, not drift. */
const HARD_RESYNC_SEC = 0.02;
const KP = 0.1;
const KI = 0.0025;
const MAX_CORRECTION = 0.005;
/** Web Audio render quantum in frames. */
const RENDER_QUANTUM = 128;

export interface MixBlock {
  /** Output frame index of the first frame (a multiple of 1024). */
  startFrame: number;
  /** Interleaved stereo, 2048 values in [-1, 1]. */
  data: Float32Array;
}

export interface MixerStats {
  streams: number;
  /** Streams that are running and delivering audio now. */
  contributing: number;
  /** Zero-filled frames of running streams (missing or late data). */
  underrunFrames: number;
  /** Frames lost inside PcmBatch gaps. */
  gapFrames: number;
  /** Pause points that arrived too late for their fade-out. */
  lateSeams: number;
  /** Resampler resyncs (starts, resumes, jumps). */
  resyncs: number;
}

/** 4-point, 3rd-order Hermite interpolation between x0 and x1 at t in [0, 1). */
export function hermite4(xm1: number, x0: number, x1: number, x2: number, t: number): number {
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * t + c2) * t + c1) * t + x0;
}

/** Raised cosine from 0 (x <= 0) to 1 (x >= 1). */
export function fadeCurve(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

const frameToUs = (frame: number) => (frame * 1e6) / SR;
const usToFrame = (us: number) => Math.floor((us * SR) / 1e6);

/** Streams faster than this get the anti-alias low-pass before Hermite. */
export const ANTI_ALIAS_ABOVE_HZ = 50_000;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 64; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

/**
 * Taps of a Kaiser-windowed sinc low-pass (beta 8, about 80 dB of stopband)
 * with its -6 dB point at 21.5 kHz. The length grows with the input rate, so
 * the transition band stays about 5 kHz wide: flat to 19 kHz, gone from 24 kHz.
 * The length is odd, so the group delay is a whole number of frames.
 */
export function antiAliasTaps(sampleRate: number): Float32Array {
  const n = Math.ceil((96 * sampleRate) / 96000) | 1;
  const m = (n - 1) / 2;
  const fc = 21500 / sampleRate;
  const beta = 8;
  const i0b = besselI0(beta);
  const h = new Float32Array(n);
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const x = k - m;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const r = x / m;
    h[k] = (sinc * besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r)))) / i0b;
    sum += h[k];
  }
  for (let k = 0; k < n; k++) h[k] /= sum;
  return h;
}

/** Stereo FIR low-pass with a history that carries across batches. */
class AntiAlias {
  readonly delay: number;
  private readonly h: Float32Array;
  private readonly n: number;
  // Each history is stored twice, so a window never wraps.
  private readonly l: Float32Array;
  private readonly r: Float32Array;
  private p = 0;

  constructor(sampleRate: number) {
    this.h = antiAliasTaps(sampleRate);
    this.n = this.h.length;
    this.delay = (this.n - 1) / 2;
    this.l = new Float32Array(this.n * 2);
    this.r = new Float32Array(this.n * 2);
  }

  reset(): void {
    this.l.fill(0);
    this.r.fill(0);
    this.p = 0;
  }

  /** Takes one input frame. Writes the output for the frame `delay` frames earlier into out[0], out[1]. */
  push(xl: number, xr: number, out: Float32Array): void {
    const n = this.n;
    this.p = this.p === 0 ? n - 1 : this.p - 1;
    this.l[this.p] = this.l[this.p + n] = xl;
    this.r[this.p] = this.r[this.p + n] = xr;
    let sl = 0;
    let sr = 0;
    const h = this.h;
    const l = this.l;
    const r = this.r;
    for (let k = 0, i = this.p; k < n; k++, i++) {
      sl += h[k] * l[i];
      sr += h[k] * r[i];
    }
    out[0] = sl;
    out[1] = sr;
  }
}

class MixStream {
  readonly id: string;
  sampleRate = 0;
  state: ClockAnchor["state"] = "running";
  readonly clock = new StreamClock();
  private left = new Float32Array(BUFFER_FRAMES);
  private right = new Float32Array(BUFFER_FRAMES);
  bufStart = 0;
  writeEnd = 0;
  /** First frame of the current run of data. Frames before it are not an underrun. */
  runStart = 0;
  hasData = false;
  gapFrames = 0;
  // Resampler state.
  pos = 0;
  integ = 0;
  rsLocked = false;
  resyncs = 0;
  fade = 0;

  /** Input (unfiltered) frame end. writeEnd trails it by the filter delay. */
  private inEnd = 0;
  private aa: AntiAlias | null = null;
  private readonly aaOut = new Float32Array(2);
  private readonly antiAlias: boolean;

  constructor(id: string, antiAlias: boolean) {
    this.id = id;
    this.antiAlias = antiAlias;
  }

  /** Sets the stream rate. A new rate is a new context: the buffer starts over. */
  setRate(sampleRate: number): void {
    this.sampleRate = sampleRate;
    this.aa = this.antiAlias && sampleRate > ANTI_ALIAS_ABOVE_HZ ? new AntiAlias(sampleRate) : null;
    this.resetBuffer();
  }

  /** Writes Int16 interleaved stereo that starts at stream frame `first`. */
  write(first: number, pcm: Int16Array): void {
    const frames = Math.floor(pcm.length / AUDIO_CHANNELS);
    if (frames <= 0) return;
    const delay = this.aa?.delay ?? 0;
    if (!this.hasData || first < this.inEnd - BUFFER_FRAMES || first > this.inEnd + BUFFER_FRAMES) {
      // First data, or a jump the buffer cannot bridge (a new context): start over.
      this.inEnd = first;
      this.bufStart = first - delay;
      this.writeEnd = first - delay;
      this.runStart = first - delay;
      this.hasData = true;
      this.rsLocked = false;
      this.aa?.reset();
    }
    if (first > this.inEnd) {
      // A lost batch: silence keeps the filter history and the frame count continuous.
      this.gapFrames += first - this.inEnd;
      for (let f = this.inEnd; f < first; f++) this.put(f, 0, 0);
    }
    for (let f = Math.max(0, this.inEnd - first); f < frames; f++) this.put(first + f, pcm[f * 2] / 32768, pcm[f * 2 + 1] / 32768);
    this.bufStart = Math.max(this.bufStart, this.writeEnd - BUFFER_FRAMES);
  }

  /** Stores one input frame, through the low-pass when the stream needs it. */
  private put(frame: number, l: number, r: number): void {
    let at = frame;
    if (this.aa) {
      this.aa.push(l, r, this.aaOut);
      l = this.aaOut[0];
      r = this.aaOut[1];
      at = frame - this.aa.delay;
    }
    const i = at & MASK;
    this.left[i] = l;
    this.right[i] = r;
    this.inEnd = frame + 1;
    this.writeEnd = at + 1;
  }

  resetBuffer(): void {
    this.hasData = false;
    this.rsLocked = false;
    this.bufStart = 0;
    this.writeEnd = 0;
    this.inEnd = 0;
  }

  /** Running, with a clock line and data. */
  get usable(): boolean {
    return this.state === "running" && this.clock.locked && this.hasData && this.sampleRate > 0;
  }

  /** Page time of the newest frame the Hermite window can read. */
  watermarkPerf(): number {
    return this.clock.perfAtCtx((this.writeEnd - 3) / this.sampleRate);
  }

  /**
   * Adds this stream to out[offset .. offset + frames), steering the read
   * position to the clock target at the segment start. Returns the number of
   * frames that had no data.
   */
  renderInto(out: Float32Array, offset: number, frames: number, perfAtStart: number, forceResync: boolean): number {
    const ratio = this.sampleRate / SR / this.clock.rate;
    const target = this.clock.ctxAtPerf(perfAtStart) * this.sampleRate;
    const err = target - this.pos;
    let step: number;
    if (!this.rsLocked || forceResync || Math.abs(err) > this.sampleRate * HARD_RESYNC_SEC) {
      this.pos = target;
      this.rsLocked = true;
      this.resyncs++;
      this.fade = STREAM_FADE_FRAMES;
      step = ratio * (1 + this.integ);
    } else {
      // Normalize per block, so a short segment next to a seam gets no larger correction.
      const norm = MIX_BLOCK_FRAMES * ratio;
      this.integ = clamp(this.integ + (KI * err) / norm, MAX_CORRECTION);
      step = ratio * (1 + clamp(this.integ + (KP * err) / norm, MAX_CORRECTION));
    }
    const L = this.left;
    const R = this.right;
    let missing = 0;
    for (let f = 0; f < frames; f++) {
      const x = this.pos;
      const i = Math.floor(x);
      if (i - 1 < this.bufStart || i + 2 >= this.writeEnd) {
        if (i >= this.runStart) missing++;
      } else {
        const t = x - i;
        const a = (i - 1) & MASK;
        const b = i & MASK;
        const c = (i + 1) & MASK;
        const d = (i + 2) & MASK;
        let g = 1;
        if (this.fade > 0) {
          g = fadeCurve(1 - this.fade / STREAM_FADE_FRAMES);
          this.fade--;
        }
        const o = (offset + f) * 2;
        out[o] += g * hermite4(L[a], L[b], L[c], L[d], t);
        out[o + 1] += g * hermite4(R[a], R[b], R[c], R[d], t);
      }
      this.pos += step;
    }
    return missing;
  }
}

/**
 * currentTime read on the main thread moves in whole render quanta of 128
 * frames, so a read is on average half a quantum early (1.3 ms at 48 kHz).
 * When the reading sits on a quantum boundary, add half a quantum. Before the
 * first batch the rate is unknown, so the reading is used as it is.
 */
export function unbiasedCtxSec(ctxSec: number, sampleRate: number): number {
  if (!(sampleRate > 0)) return ctxSec;
  const frames = ctxSec * sampleRate;
  const off = frames - Math.round(frames / RENDER_QUANTUM) * RENDER_QUANTUM;
  return Math.abs(off) < 0.5 ? ctxSec + RENDER_QUANTUM / 2 / sampleRate : ctxSec;
}

function clamp(v: number, limit: number): number {
  return v < -limit ? -limit : v > limit ? limit : v;
}

export interface MixerOptions {
  timeline?: CaptureTimeline;
  /** Low-pass streams above 50 kHz before Hermite. Default true. Off only to show why it exists. */
  antiAlias?: boolean;
  minLatencyMs?: number;
  stallMs?: number;
  lostMs?: number;
}

export class Mixer {
  readonly timeline: CaptureTimeline;
  private readonly minLatencyMs: number;
  private readonly stallMs: number;
  private readonly lostMs: number;
  private readonly antiAlias: boolean;
  private readonly streams = new Map<string, MixStream>();
  private next = 0;
  private underrun = 0;
  private lateSeamCount = 0;
  private contributingNow = 0;

  constructor(options: MixerOptions = {}) {
    this.timeline = options.timeline ?? new CaptureTimeline();
    this.minLatencyMs = options.minLatencyMs ?? MIN_LATENCY_MS;
    this.stallMs = options.stallMs ?? STALL_MS;
    this.lostMs = options.lostMs ?? LOST_MS;
    this.antiAlias = options.antiAlias ?? true;
  }

  /** Next output frame the mixer will render. Everything before it is final. */
  get nextFrame(): number {
    return this.next;
  }

  get stats(): MixerStats {
    let gaps = 0;
    let resyncs = 0;
    for (const s of this.streams.values()) {
      gaps += s.gapFrames;
      resyncs += s.resyncs;
    }
    return {
      streams: this.streams.size,
      contributing: this.contributingNow,
      underrunFrames: this.underrun,
      gapFrames: gaps,
      lateSeams: this.lateSeamCount,
      resyncs,
    };
  }

  /** Applies a timeline command and counts a pause that came too late for its fade-out. */
  setTimeline(state: "live" | "paused", atPerfMs: number): boolean {
    const changed = this.timeline.set(state, atPerfMs);
    if (changed && state === "paused") {
      const pauseFrame = usToFrame(this.timeline.captureUsAtPerf(atPerfMs));
      if (pauseFrame - SEAM_FADE_FRAMES < this.next) this.lateSeamCount++;
    }
    return changed;
  }

  anchor(a: ClockAnchor): void {
    const s = this.stream(a.streamId);
    s.state = a.state;
    if (a.state === "running") s.clock.anchor(a.perfMs + a.timeOriginOffsetMs, unbiasedCtxSec(a.ctxTimeSec, s.sampleRate));
    else s.rsLocked = false;
    if (a.state === "closed") s.resetBuffer();
  }

  pushPcm(batch: PcmBatch): void {
    if (!(batch.sampleRate > 0) || !(batch.data instanceof ArrayBuffer) || batch.data.byteLength % 4 !== 0) return;
    const s = this.stream(batch.streamId);
    if (s.sampleRate !== batch.sampleRate) s.setRate(batch.sampleRate);
    s.write(batch.firstFrame, new Int16Array(batch.data));
  }

  /** Renders every whole block that is ready at page time nowPerfMs. */
  render(nowPerfMs: number): MixBlock[] {
    const tl = this.timeline;
    if (!tl.started) return [];
    const nowCapUs = tl.captureUsAtPerf(nowPerfMs);
    // While paused, no audio can arrive before the pause point, so no margin is needed.
    const limitUs = tl.live ? nowCapUs - this.minLatencyMs * 1000 : nowCapUs;
    let end = usToFrame(limitUs);
    const stallPerf = nowPerfMs - this.stallMs;
    let contributing = 0;
    for (const s of this.streams.values()) {
      if (!s.usable) continue;
      const w = s.watermarkPerf();
      if (w < stallPerf) continue;
      contributing++;
      const wOut = usToFrame(tl.captureUsAtPerf(w)) - GUARD_FRAMES;
      if (wOut < end) end = wOut;
    }
    this.contributingNow = contributing;
    const blocks: MixBlock[] = [];
    while (this.next + MIX_BLOCK_FRAMES <= end) {
      blocks.push(this.renderBlock(this.next, nowPerfMs));
      this.next += MIX_BLOCK_FRAMES;
    }
    return blocks;
  }

  private stream(id: string): MixStream {
    let s = this.streams.get(id);
    if (!s) {
      s = new MixStream(id, this.antiAlias);
      this.streams.set(id, s);
    }
    return s;
  }

  private renderBlock(k0: number, nowPerfMs: number): MixBlock {
    const tl = this.timeline;
    const k1 = k0 + MIX_BLOCK_FRAMES;
    const data = new Float32Array(MIX_BLOCK_FRAMES * 2);
    const seams = tl
      .pausePointsBetween(frameToUs(k0 - SEAM_FADE_FRAMES), frameToUs(k1 + SEAM_FADE_FRAMES))
      .map((us) => Math.round((us * SR) / 1e6));
    const cuts = [k0, ...seams.filter((f) => f > k0 && f < k1), k1].sort((a, b) => a - b);
    const lostPerf = nowPerfMs - this.lostMs;

    for (let c = 0; c + 1 < cuts.length; c++) {
      const a = cuts[c];
      const b = cuts[c + 1];
      if (b <= a) continue;
      const perfA = tl.perfAtCaptureUs(frameToUs(a));
      const atSeam = seams.includes(a);
      for (const s of this.streams.values()) {
        if (!s.usable || s.watermarkPerf() < lostPerf) continue;
        this.underrun += s.renderInto(data, a - k0, b - a, perfA, atSeam);
      }
    }

    for (const s of seams) {
      for (let f = Math.max(k0, s - SEAM_FADE_FRAMES); f < Math.min(k1, s); f++) {
        const g = fadeCurve((s - f - 1) / SEAM_FADE_FRAMES);
        data[(f - k0) * 2] *= g;
        data[(f - k0) * 2 + 1] *= g;
      }
      for (let f = Math.max(k0, s); f < Math.min(k1, s + SEAM_FADE_FRAMES); f++) {
        const g = fadeCurve((f - s) / SEAM_FADE_FRAMES);
        data[(f - k0) * 2] *= g;
        data[(f - k0) * 2 + 1] *= g;
      }
    }

    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      data[i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
    return { startFrame: k0, data };
  }
}
