import { describe, expect, it } from "vitest";
import type { ClockAnchor, PcmBatch } from "../../../protocol";
import {
  MIX_BLOCK_FRAMES,
  Mixer,
  SEAM_FADE_FRAMES,
  STALL_MS,
  antiAliasTaps,
  fadeCurve,
  hermite4,
  type MixBlock,
} from "../audio/mixer";
import { StreamClock } from "../audio/clock";

const SR = 48000;

/**
 * A simulated tap stream. Its AudioContext clock runs at (1 + drift) against
 * the page clock. The worklet posts a 2048-frame batch when the context time
 * reaches the end of the batch. The main thread takes an anchor every 250 ms,
 * with currentTime quantized to 128-frame render quanta.
 */
class SimStream {
  readonly id: string;
  readonly sr: number;
  readonly drift: number;
  /** Page time (ms) at which the context time was ctxStartSec. */
  readonly startPerf: number;
  readonly ctxStartSec: number;
  /** Realm clock offset: realm now() = page now() - offset. */
  readonly realmOffsetMs: number;
  private nextBatch = 0;
  private nextAnchorPerf: number;
  alive = true;
  signal: (frame: number) => number;

  constructor(o: {
    id: string;
    sr?: number;
    drift?: number;
    startPerf: number;
    ctxStartSec?: number;
    realmOffsetMs?: number;
    signal: (frame: number) => number;
  }) {
    this.id = o.id;
    this.sr = o.sr ?? SR;
    this.drift = o.drift ?? 0;
    this.startPerf = o.startPerf;
    this.ctxStartSec = o.ctxStartSec ?? 0;
    this.realmOffsetMs = o.realmOffsetMs ?? 0;
    this.signal = o.signal;
    this.nextAnchorPerf = o.startPerf;
    this.nextBatch = Math.ceil((this.ctxStartSec * this.sr) / 2048);
  }

  ctxAt(perf: number): number {
    return this.ctxStartSec + ((perf - this.startPerf) / 1000) * (1 + this.drift);
  }

  /** Page time at which the stream plays its frame n (the truth the mixer must find). */
  perfOfFrame(n: number): number {
    return this.startPerf + ((n / this.sr - this.ctxStartSec) * 1000) / (1 + this.drift);
  }

  /** Delivers every batch and anchor due at page time `perf`. */
  pump(perf: number, mixer: Mixer, jitterMs = 0.4): void {
    if (!this.alive) return;
    while (this.nextAnchorPerf <= perf) {
      const p = this.nextAnchorPerf;
      const quantum = Math.floor((this.ctxAt(p) * this.sr) / 128) * 128;
      const jitter = (Math.sin(p * 12.9898) * 43758.5453) % 1;
      const anchor: ClockAnchor = {
        t: "anchor",
        streamId: this.id,
        perfMs: p + jitter * jitterMs - this.realmOffsetMs,
        ctxTimeSec: quantum / this.sr,
        timeOriginOffsetMs: this.realmOffsetMs,
        state: "running",
      };
      mixer.anchor(anchor);
      this.nextAnchorPerf += 250;
    }
    const framesNow = Math.floor(this.ctxAt(perf) * this.sr);
    while ((this.nextBatch + 1) * 2048 <= framesNow) {
      const first = this.nextBatch * 2048;
      const pcm = new Int16Array(2048 * 2);
      for (let f = 0; f < 2048; f++) {
        const v = Math.round(this.signal(first + f) * 32767);
        pcm[f * 2] = v;
        pcm[f * 2 + 1] = v;
      }
      const batch: PcmBatch = { t: "pcm", streamId: this.id, firstFrame: first, sampleRate: this.sr, data: pcm.buffer };
      mixer.pushPcm(batch);
      this.nextBatch++;
    }
  }
}

/** A Gaussian pulse centered on every multiple of `every` frames. */
function pulses(every: number, amp = 0.8, sigma = 6) {
  return (frame: number) => {
    const d = ((frame + every / 2) % every) - every / 2;
    return Math.abs(d) > 40 ? 0 : amp * Math.exp(-(d * d) / (2 * sigma * sigma));
  };
}

/** Finds pulse peaks in the left channel across blocks: local maxima above the threshold, at least 1000 frames apart. */
class PeakFinder {
  readonly peaks: Array<{ frame: number; value: number }> = [];
  constructor(private readonly threshold = 0.3) {}
  push(blocks: MixBlock[]): this {
    for (const b of blocks) {
      for (let f = 0; f < MIX_BLOCK_FRAMES; f++) {
        const v = b.data[f * 2];
        if (v < this.threshold) continue;
        const frame = b.startFrame + f;
        const last = this.peaks[this.peaks.length - 1];
        if (last && frame - last.frame < 1000) {
          if (v > last.value) {
            last.frame = frame;
            last.value = v;
          }
        } else this.peaks.push({ frame, value: v });
      }
    }
    return this;
  }
}

function findPeaks(blocks: MixBlock[]): Array<{ frame: number; value: number }> {
  return new PeakFinder().push(blocks).peaks;
}

function expectContiguous(blocks: MixBlock[], from = 0): void {
  blocks.forEach((b, i) => expect(b.startFrame).toBe(from + i * MIX_BLOCK_FRAMES));
}

/** Runs the page clock from `from` to `to` in `tick` ms steps, pumping streams and rendering. */
function run(mixer: Mixer, streams: SimStream[], from: number, to: number, tick = 20, onBlocks?: (b: MixBlock[]) => void): MixBlock[] {
  const all: MixBlock[] = [];
  for (let t = from; t <= to; t += tick) {
    for (const s of streams) s.pump(t + 2, mixer);
    const out = mixer.render(t);
    if (onBlocks) onBlocks(out);
    else all.push(...out);
  }
  return all;
}

describe("hermite4", () => {
  it("passes through the two middle points", () => {
    expect(hermite4(1, 2, 3, 4, 0)).toBe(2);
    expect(hermite4(1, 2, 3, 4, 1)).toBeCloseTo(3, 12);
  });

  it("reproduces a straight line exactly", () => {
    for (const t of [0.1, 0.25, 0.5, 0.9]) expect(hermite4(-1, 0, 1, 2, t)).toBeCloseTo(t, 12);
  });

  it("reproduces a quadratic exactly (third-order Hermite)", () => {
    const q = (x: number) => 3 * x * x - 2 * x + 1;
    for (const t of [0.2, 0.5, 0.8]) expect(hermite4(q(-1), q(0), q(1), q(2), t)).toBeCloseTo(q(t), 10);
  });
});

describe("fadeCurve", () => {
  it("runs from 0 to 1 and is symmetric", () => {
    expect(fadeCurve(-1)).toBe(0);
    expect(fadeCurve(0)).toBe(0);
    expect(fadeCurve(0.5)).toBeCloseTo(0.5, 12);
    expect(fadeCurve(1)).toBe(1);
    expect(fadeCurve(0.25) + fadeCurve(0.75)).toBeCloseTo(1, 12);
  });
});

describe("anti-alias low-pass (streams above 50 kHz)", () => {
  /** |H(f)| of an FIR at frequency f for a given sample rate. */
  function gain(h: Float32Array, f: number, sr: number): number {
    let re = 0;
    let im = 0;
    for (let k = 0; k < h.length; k++) {
      re += h[k] * Math.cos((2 * Math.PI * f * k) / sr);
      im -= h[k] * Math.sin((2 * Math.PI * f * k) / sr);
    }
    return Math.hypot(re, im);
  }

  it("is a symmetric, odd-length, unity-gain low-pass that is flat to 19 kHz and gone from 24 kHz", () => {
    for (const sr of [88200, 96000, 192000]) {
      const h = antiAliasTaps(sr);
      expect(h.length % 2).toBe(1);
      for (let k = 0; k < h.length; k++) expect(h[k]).toBeCloseTo(h[h.length - 1 - k], 7);
      expect(h.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(gain(h, 1000, sr)).toBeCloseTo(1, 3);
      expect(gain(h, 16000, sr)).toBeGreaterThan(0.995);
      for (const f of [24000, 28000, 35000, 44000]) expect(gain(h, f, sr)).toBeLessThan(1e-3);
    }
    expect(antiAliasTaps(96000).length).toBe(97);
  });

  function toneRms(antiAlias: boolean, freq: number): { rms: number; peak: number } {
    const m = new Mixer({ antiAlias });
    m.setTimeline("live", 1000);
    const s = new SimStream({ id: "hi", sr: 96000, startPerf: 1000, signal: (f) => 0.5 * Math.sin((2 * Math.PI * freq * f) / 96000) });
    const blocks = run(m, [s], 1000, 3000).slice(20);
    let sum = 0;
    let n = 0;
    let peak = 0;
    for (const b of blocks) {
      for (let f = 0; f < MIX_BLOCK_FRAMES; f++) {
        const v = b.data[f * 2];
        sum += v * v;
        n++;
        peak = Math.max(peak, Math.abs(v));
      }
    }
    return { rms: Math.sqrt(sum / n), peak };
  }

  it("removes a 30 kHz tone from a 96 kHz stream instead of folding it to 18 kHz", () => {
    expect(toneRms(true, 30000).rms).toBeLessThan(2e-3);
    // Control: without the filter, Hermite folds the tone into the audible band.
    expect(toneRms(false, 30000).rms).toBeGreaterThan(0.02);
  });

  it("passes a 1 kHz tone from a 96 kHz stream at full level", () => {
    expect(toneRms(true, 1000).peak).toBeCloseTo(0.5, 2);
  });

  it("takes out the filter delay, so a 96 kHz stream stays on time", () => {
    const m = new Mixer();
    m.setTimeline("live", 1000);
    const s = new SimStream({ id: "hi", sr: 96000, startPerf: 1000, signal: pulses(96000, 0.8, 12) });
    const peaks = findPeaks(run(m, [s], 1000, 7000));
    expect(peaks.length).toBeGreaterThanOrEqual(5);
    for (const p of peaks) expect(Math.abs(p.frame - Math.round(p.frame / SR) * SR)).toBeLessThan(24);
  });
});

describe("StreamClock", () => {
  it("learns a 50 ppm drift from jittery anchors", () => {
    const c = new StreamClock();
    const drift = 50e-6;
    for (let i = 0; i < 400; i++) {
      const perf = 1000 + i * 250;
      const ctx = Math.floor(((i * 0.25 * (1 + drift)) * SR) / 128) * 128 / SR;
      c.anchor(perf + ((i * 7919) % 11) / 20 - 0.25, ctx);
    }
    // The rate is right to 20 ppm. The offset filter absorbs what is left, so the timing stays exact.
    expect(Math.abs(c.rate - 1 / (1 + drift))).toBeLessThan(20e-6);
    expect(c.resyncs).toBe(1);
  });

  it("resets on a jump and ignores a context that does not move", () => {
    const c = new StreamClock();
    c.anchor(1000, 0);
    c.anchor(1250, 0.25);
    c.anchor(1500, 0.25); // suspended: context frozen
    expect(c.resyncs).toBe(1);
    c.anchor(9000, 0.5); // resumed much later
    expect(c.resyncs).toBe(2);
    expect(c.perfAtCtx(0.5)).toBeCloseTo(9000, 6);
  });

  it("treats a context clock that goes back as a new context", () => {
    const c = new StreamClock();
    c.anchor(1000, 5);
    c.anchor(1250, 5.25);
    c.anchor(1500, 0.1);
    expect(c.resyncs).toBe(2);
    expect(c.ctxAtPerf(1500)).toBeCloseTo(0.1, 9);
  });
});

describe("Mixer", () => {
  it("synthesizes real-time silence for a live timeline with no audio", () => {
    const m = new Mixer();
    m.setTimeline("live", 1000);
    expect(m.render(999)).toEqual([]);
    const blocks = m.render(1000 + 500);
    // 500 ms minus the 30 ms latency margin, in whole blocks.
    expect(blocks.length).toBe(Math.floor((0.47 * SR) / MIX_BLOCK_FRAMES));
    expectContiguous(blocks);
    expect(blocks.every((b) => b.data.every((v) => v === 0))).toBe(true);
    const more = m.render(1000 + 1000);
    expectContiguous(more, blocks.length * MIX_BLOCK_FRAMES);
  });

  it("renders nothing before the first live command", () => {
    const m = new Mixer();
    expect(m.render(5000)).toEqual([]);
  });

  it(
    "tracks a 50 ppm clock drift for 10 minutes with no jump and a contiguous count",
    () => {
      const m = new Mixer();
      m.setTimeline("live", 1000);
      const s = new SimStream({ id: "page", drift: 50e-6, startPerf: 500, ctxStartSec: 3, signal: pulses(SR) });
      let nextStart = 0;
      let blocks = 0;
      const finder = new PeakFinder();
      run(m, [s], 1000, 1000 + 600_000, 20, (out) => {
        for (const b of out) {
          expect(b.startFrame).toBe(nextStart);
          nextStart += MIX_BLOCK_FRAMES;
          blocks++;
        }
        finder.push(out);
      });
      // The truth: the pulse at stream frame n plays at page time perfOfFrame(n).
      const errors = finder.peaks.map((p) => {
        const n = Math.round(s.ctxAt(1000 + (p.frame / SR) * 1000)) * SR;
        return p.frame - ((s.perfOfFrame(n) - 1000) / 1000) * SR;
      });
      // 10 minutes of output, minus the latency and watermark margin.
      expect(blocks).toBeGreaterThan(Math.floor((599.9 * SR) / MIX_BLOCK_FRAMES));
      expect(errors.length).toBeGreaterThan(590);
      // Skip the lock-in second. Every later pulse lands within 0.5 ms of the truth (the plan allows 5 ms).
      const settled = errors.slice(2);
      expect(Math.max(...settled.map(Math.abs))).toBeLessThan(24);
      // One resync: the first lock. Drift never forced a jump.
      expect(m.stats.resyncs).toBe(1);
      expect(m.stats.underrunFrames).toBe(0);
    },
    60_000,
  );

  it("resamples a 44.1 kHz stream onto the 48 kHz timeline at the right times", () => {
    const m = new Mixer();
    m.setTimeline("live", 1000);
    const s = new SimStream({ id: "page", sr: 44100, startPerf: 1000, signal: pulses(44100) });
    const blocks = run(m, [s], 1000, 11_000);
    expectContiguous(blocks);
    const peaks = findPeaks(blocks);
    expect(peaks.length).toBeGreaterThanOrEqual(9);
    for (const p of peaks) {
      const nearestSecond = Math.round(p.frame / SR);
      expect(Math.abs(p.frame - nearestSecond * SR)).toBeLessThan(24);
    }
  });

  it("places an iframe stream by its realm time origin", () => {
    const m = new Mixer();
    m.setTimeline("live", 1000);
    // The iframe realm started 700 ms after the page. Its now() is 700 ms behind.
    const iframe = new SimStream({ id: "iframe", startPerf: 1000, realmOffsetMs: 700, signal: pulses(SR) });
    const blocks = run(m, [iframe], 1000, 6000);
    const peaks = findPeaks(blocks);
    expect(peaks.length).toBeGreaterThanOrEqual(4);
    for (const p of peaks) expect(Math.abs(p.frame - Math.round(p.frame / SR) * SR)).toBeLessThan(24);
  });

  it("gives a wrong answer if the realm offset is dropped (control for the test above)", () => {
    const m = new Mixer();
    m.setTimeline("live", 1000);
    // A realm that started 700 ms before the page. Without the offset, its audio lands 700 ms late.
    const s = new SimStream({ id: "iframe", startPerf: 1000, realmOffsetMs: -700, signal: pulses(SR) });
    // Deliver the same anchors without the offset field.
    const original = m.anchor.bind(m);
    m.anchor = (a) => original({ ...a, timeOriginOffsetMs: 0 });
    const peaks = findPeaks(run(m, [s], 1000, 6000));
    expect(peaks.length).toBeGreaterThanOrEqual(3);
    for (const p of peaks) expect(Math.abs(p.frame - Math.round(p.frame / SR) * SR)).toBeGreaterThan(1000);
  });

  it("mixes two streams with clamping", () => {
    const m = new Mixer();
    m.setTimeline("live", 1000);
    const a = new SimStream({ id: "a", startPerf: 1000, signal: () => 0.7 });
    const b = new SimStream({ id: "b", startPerf: 1000, signal: () => 0.7 });
    const blocks = run(m, [a, b], 1000, 3000);
    const late = blocks.slice(-10);
    expect(late.every((blk) => blk.data.every((v) => v === 1))).toBe(true);
  });

  it("never stalls on a stream that stops delivering, and zero-fills it", () => {
    const m = new Mixer();
    m.setTimeline("live", 1000);
    const keep = new SimStream({ id: "keep", startPerf: 1000, signal: pulses(SR) });
    const dies = new SimStream({ id: "dies", startPerf: 1000, signal: () => 0.1 });
    const before = run(m, [keep, dies], 1000, 4000);
    dies.alive = false; // the realm unloads with no message
    const after = run(m, [keep, dies], 4020, 9000);
    expectContiguous([...before, ...after]);
    const lastFrame = after[after.length - 1].startFrame + MIX_BLOCK_FRAMES;
    // The mix keeps up with real time (minus latency), not frozen at 4 s.
    expect(lastFrame / SR).toBeGreaterThan(7.9);
    // The dead stream is zero-filled: away from the pulses of the other stream, late blocks are silent.
    const tail = after.slice(-60);
    let leaks = 0;
    for (const b of tail) {
      for (let f = 0; f < MIX_BLOCK_FRAMES; f++) {
        const frame = b.startFrame + f;
        const toPulse = Math.abs(frame - Math.round(frame / SR) * SR);
        if (toPulse > 100 && b.data[f * 2] !== 0) leaks++;
      }
    }
    expect(leaks).toBe(0);
    expect(findPeaks(after).length).toBeGreaterThanOrEqual(4);
    expect(m.stats.underrunFrames).toBeGreaterThan(0);
    expect(m.stats.underrunFrames).toBeLessThan(((STALL_MS + 1200) / 1000) * SR);
  });

  it("drops a suspended stream from the watermark at once", () => {
    const m = new Mixer();
    m.setTimeline("live", 1000);
    const s = new SimStream({ id: "s", startPerf: 1000, signal: () => 0.2 });
    run(m, [s], 1000, 3000);
    const at = m.nextFrame;
    s.alive = false;
    m.anchor({ t: "anchor", streamId: "s", perfMs: 3000, ctxTimeSec: 2, timeOriginOffsetMs: 0, state: "suspended" });
    const blocks = m.render(3100);
    // With the stream suspended, the mix runs to now minus the latency margin.
    const end = blocks.length ? blocks[blocks.length - 1].startFrame + MIX_BLOCK_FRAMES : at;
    expect(end).toBeGreaterThanOrEqual(Math.floor((2.07 * SR) / MIX_BLOCK_FRAMES) * MIX_BLOCK_FRAMES);
    expect(m.stats.contributing).toBe(0);
  });

  it("removes a pause with fades and keeps the count contiguous", () => {
    const m = new Mixer();
    m.setTimeline("live", 1000);
    const tone = new SimStream({ id: "t", startPerf: 1000, signal: () => 0.5 });
    const blocks: MixBlock[] = [];
    blocks.push(...run(m, [tone], 1000, 3000, 10));
    m.setTimeline("paused", 3000);
    blocks.push(...run(m, [tone], 3010, 5000, 10));
    m.setTimeline("live", 5000);
    blocks.push(...run(m, [tone], 5010, 7000, 10));
    expectContiguous(blocks);
    const out = new Float32Array(blocks.length * MIX_BLOCK_FRAMES);
    blocks.forEach((b, i) => {
      for (let f = 0; f < MIX_BLOCK_FRAMES; f++) out[i * MIX_BLOCK_FRAMES + f] = b.data[f * 2];
    });
    const seam = 2 * SR; // 2 s of live audio before the pause
    // The paused 2 s are gone: total output is about 4 s of live time, not 6.
    expect(out.length / SR).toBeLessThan(4.1);
    expect(out[seam - SEAM_FADE_FRAMES - 10]).toBeCloseTo(0.5, 2);
    expect(out[seam - 1]).toBeCloseTo(0, 3);
    expect(out[seam]).toBeCloseTo(0, 3);
    expect(out[seam + SEAM_FADE_FRAMES + 250]).toBeCloseTo(0.5, 2);
    // The fades are smooth: no sample-to-sample step larger than a 8 ms raised cosine allows.
    let maxStep = 0;
    for (let f = seam - 2 * SEAM_FADE_FRAMES; f < seam + 2 * SEAM_FADE_FRAMES; f++) maxStep = Math.max(maxStep, Math.abs(out[f + 1] - out[f]));
    expect(maxStep).toBeLessThan(0.01);
    expect(m.stats.lateSeams).toBe(0);
  });

  it("renders up to the pause point while paused, so a clip taken in the pause menu is complete", () => {
    const m = new Mixer();
    m.setTimeline("live", 1000);
    const s = new SimStream({ id: "s", startPerf: 1000, signal: () => 0.2 });
    run(m, [s], 1000, 2500, 10);
    m.setTimeline("paused", 2500);
    run(m, [s], 2510, 4000, 10);
    const pauseFrame = 1.5 * SR;
    expect(m.nextFrame).toBe(Math.floor(pauseFrame / MIX_BLOCK_FRAMES) * MIX_BLOCK_FRAMES);
  });

  it("counts a pause that arrives after its fade-out was rendered", () => {
    const m = new Mixer({ minLatencyMs: 0 });
    m.setTimeline("live", 1000);
    m.render(3000);
    m.setTimeline("paused", 2500);
    expect(m.stats.lateSeams).toBe(1);
  });

  it("zero-fills a gap between batches and counts it", () => {
    const m = new Mixer();
    m.setTimeline("live", 1000);
    m.anchor({ t: "anchor", streamId: "g", perfMs: 1000, ctxTimeSec: 0, timeOriginOffsetMs: 0, state: "running" });
    const batch = (first: number): PcmBatch => ({ t: "pcm", streamId: "g", firstFrame: first, sampleRate: SR, data: new Int16Array(4096).fill(1000).buffer });
    m.pushPcm(batch(0));
    m.pushPcm(batch(4096));
    expect(m.stats.gapFrames).toBe(2048);
  });

  it("ignores malformed batches", () => {
    const m = new Mixer();
    m.pushPcm({ t: "pcm", streamId: "x", firstFrame: 0, sampleRate: 0, data: new ArrayBuffer(8) });
    m.pushPcm({ t: "pcm", streamId: "x", firstFrame: 0, sampleRate: SR, data: new ArrayBuffer(6) });
    expect(m.stats.streams).toBe(0);
  });
});
