import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushMicrotasks, installWebCodecsMock, type WebCodecsMock } from "@/__tests__/webcodecs-mock";
import {
  AAC_FRAME,
  AacPacketRing,
  AacSession,
  PRE_PAD_FRAMES,
  PRIMING_CONSTANTS,
  PcmRing,
  buildAudioSpecificConfig,
  clipAudioConfig,
  type AacBackend,
  type AacBackendFactory,
  type AacKind,
  type AacSink,
  type AudioPacket,
} from "../audio/aac";
import { createAacBackend, createNativeBackend, nativeAacSupported } from "../audio/aacBackends";
import { calibrationChirp, canCalibrate, locateChirp, measurePriming } from "../audio/priming";

const SR = 48000;

function bytesOf(src: unknown): number[] {
  if (ArrayBuffer.isView(src)) return Array.from(new Uint8Array(src.buffer, src.byteOffset, src.byteLength));
  if (src instanceof ArrayBuffer) return Array.from(new Uint8Array(src));
  return [];
}

// ---------------------------------------------------------------------------
// A scripted backend: a delay line of Q samples, one packet per 1024 samples.
// Packet data is the left channel as Int16, so a test can play the ring back.
// ---------------------------------------------------------------------------

class DelayLineBackend implements AacBackend {
  readonly kind: AacKind;
  readonly inputs: Float32Array[] = [];
  private out: number[];
  private emitted = 0;
  closed = false;
  dead = false;

  constructor(kind: AacKind, private readonly sink: AacSink, readonly delay: number) {
    this.kind = kind;
    this.out = new Array(delay).fill(0);
  }

  encode(left: Float32Array): void {
    if (this.dead) throw new Error("dead");
    this.inputs.push(left.slice());
    for (const v of left) this.out.push(v);
    this.emit(false);
  }

  async flush(): Promise<void> {
    await Promise.resolve();
    this.emit(true);
  }

  close(): void {
    this.closed = true;
  }

  /** Dies like a hardware encoder: the samples it held are lost. */
  die(): void {
    this.dead = true;
    this.sink.error(new DOMException("boom", "EncodingError"));
  }

  private emit(final: boolean): void {
    if (final) while (this.out.length % AAC_FRAME !== 0) this.out.push(0);
    while ((this.emitted + 1) * AAC_FRAME <= this.out.length) {
      const i = this.emitted++;
      const pcm = new Int16Array(AAC_FRAME);
      for (let k = 0; k < AAC_FRAME; k++) pcm[k] = Math.round(this.out[i * AAC_FRAME + k] * 32767);
      this.sink.packet(pcm.buffer);
    }
  }
}

function scriptedFactory(delays: Partial<Record<AacKind, number>> = {}, opts: { failCreate?: AacKind[] } = {}) {
  const made: DelayLineBackend[] = [];
  const factory: AacBackendFactory = async (kind, sink) => {
    await Promise.resolve();
    if (opts.failCreate?.includes(kind)) throw new Error(`${kind} cannot load`);
    const b = new DelayLineBackend(kind, sink, delays[kind] ?? PRIMING_CONSTANTS[kind]);
    made.push(b);
    return b;
  };
  return { factory, made };
}

/** The test signal: a slow ramp, so every frame index has its own value. */
const signal = (frame: number) => ((frame % 20_000) - 10_000) / 20_000;

function writeBlocks(pcm: PcmRing, fromFrame: number, blocks: number): void {
  for (let b = 0; b < blocks; b++) {
    const start = fromFrame + b * 1024;
    const data = new Float32Array(2048);
    for (let f = 0; f < 1024; f++) {
      data[f * 2] = signal(start + f);
      data[f * 2 + 1] = -signal(start + f);
    }
    pcm.write(start, data);
  }
}

/** Plays the ring back: frame -> sample value, from each packet's own timestamp. */
function playback(packets: readonly AudioPacket[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of packets) {
    const s = new Int16Array(p.data);
    for (let k = 0; k < AAC_FRAME; k++) out.set(p.tsFrames + k, s[k] / 32767);
  }
  return out;
}

function expectContiguous(packets: readonly AudioPacket[]): void {
  for (let i = 1; i < packets.length; i++) expect(packets[i].tsFrames - packets[i - 1].tsFrames).toBe(AAC_FRAME);
}

function expectFaithful(packets: readonly AudioPacket[], from: number, to: number): void {
  const played = playback(packets);
  let checked = 0;
  let worst = 0;
  for (let f = from; f < to; f++) {
    const v = played.get(f);
    if (v === undefined) continue;
    worst = Math.max(worst, Math.abs(v - signal(f)));
    checked++;
  }
  expect(worst).toBeLessThan(1e-4);
  expect(checked).toBeGreaterThan((to - from) * 0.9);
}

function session(o: { kinds?: AacKind[]; delays?: Partial<Record<AacKind, number>>; failCreate?: AacKind[]; now?: () => number } = {}) {
  const pcm = new PcmRing(62);
  const ring = new AacPacketRing(62);
  const errors: string[] = [];
  const teed: AudioPacket[] = [];
  const { factory, made } = scriptedFactory(o.delays, { failCreate: o.failCreate });
  const priming: Partial<Record<AacKind, number>> = {};
  for (const [k, v] of Object.entries(o.delays ?? {})) priming[k as AacKind] = v;
  const s = new AacSession({
    kinds: o.kinds ?? ["native", "wasm"],
    primingSamples: priming,
    createBackend: factory,
    pcm,
    ring,
    onPacket: (p) => teed.push(p),
    onError: (code, detail) => errors.push(`${code}: ${detail}`),
    now: o.now,
  });
  return { s, pcm, ring, errors, made, teed };
}

// ---------------------------------------------------------------------------

describe("AudioSpecificConfig", () => {
  it("is 0x11 0x90 for AAC-LC 48 kHz stereo (plan 3a: ASC 1190)", () => {
    expect(Array.from(buildAudioSpecificConfig(48000, 2))).toEqual([0x11, 0x90]);
    expect(Array.from(buildAudioSpecificConfig(44100, 1))).toEqual([0x12, 0x08]);
    expect(() => buildAudioSpecificConfig(47000, 2)).toThrow(RangeError);
    expect(() => buildAudioSpecificConfig(48000, 0)).toThrow(RangeError);
  });

  it("is what every clip carries, never the encoder's description", () => {
    const c = clipAudioConfig();
    expect(c).toMatchObject({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2 });
    expect(Array.from(new Uint8Array(c.description))).toEqual([0x11, 0x90]);
    expect(clipAudioConfig().description).not.toBe(c.description);
  });
});

describe("PcmRing", () => {
  it("stores Int16 and reads back, with silence outside what it holds", () => {
    const r = new PcmRing(1);
    expect(r.read(0, 4)).toEqual(new Int16Array(8));
    r.write(100, new Float32Array([0.5, -0.5, 1, -1, 2, -2]));
    expect(r.startFrame).toBe(100);
    expect(r.endFrame).toBe(103);
    // Math.round takes -16383.5 to -16383; values past full scale clamp.
    expect(Array.from(r.read(99, 5))).toEqual([0, 0, 16384, -16383, 32767, -32767, 32767, -32768, 0, 0]);
    expect(r.bytes).toBe(12);
  });

  it("fills a gap with silence and wraps around its capacity", () => {
    const r = new PcmRing(0.001); // 48 frames
    r.write(0, new Float32Array(40 * 2).fill(0.25));
    r.write(50, new Float32Array(30 * 2).fill(0.5));
    expect(r.startFrame).toBe(80 - 48);
    expect(r.endFrame).toBe(80);
    const got = r.read(32, 48);
    expect(got[0]).toBe(8192); // frame 32: first write
    expect(got[(45 - 32) * 2]).toBe(0); // frame 45: the gap
    expect(got[(79 - 32) * 2]).toBe(16384); // frame 79: second write
    r.write(10_000, new Float32Array(2).fill(0.25));
    expect(r.startFrame).toBe(10_000);
    r.clear();
    expect(r.endFrame).toBeNull();
  });

  it("ignores a block it already holds", () => {
    const r = new PcmRing(1);
    r.write(0, new Float32Array(20).fill(0.5));
    r.write(0, new Float32Array(20).fill(-0.5));
    expect(r.read(0, 1)[0]).toBe(16384);
  });
});

describe("AacPacketRing", () => {
  it("keeps a time window, tracks the watermark and bytes", () => {
    const ring = new AacPacketRing(1); // 48000 frames
    for (let i = 0; i < 200; i++) ring.push({ tsFrames: i * AAC_FRAME - 3138, data: new ArrayBuffer(10), stream: 1 });
    expect(ring.endFrame).toBe(200 * AAC_FRAME - 3138);
    expect(ring.endFrame - ring.startFrame).toBeGreaterThanOrEqual(48000);
    expect(ring.endFrame - ring.startFrame).toBeLessThan(48000 + AAC_FRAME);
    expect(ring.bytes).toBe(ring.size * 10);
    expect(ring.packets[0].tsFrames).toBe(ring.startFrame);
    ring.clear();
    expect(ring.endFrame).toBe(-Infinity);
    expect(ring.size).toBe(0);
  });

  it("stays compact over a long session", () => {
    const ring = new AacPacketRing(0.1);
    for (let i = 0; i < 20_000; i++) ring.push({ tsFrames: i * AAC_FRAME, data: new ArrayBuffer(1), stream: 1 });
    expect(ring.size).toBeLessThan(10);
    expect(ring.packets).toHaveLength(ring.size);
  });
});

describe("AacSession", () => {
  it("pre-pads 1024 frames of silence and stamps packets from its own counter", async () => {
    const t = session({ delays: { native: 2114 } });
    writeBlocks(t.pcm, 0, 100);
    t.s.pump();
    await flushMicrotasks();
    const b = t.made[0];
    expect(b.inputs[0]).toEqual(new Float32Array(PRE_PAD_FRAMES));
    const packets = t.ring.packets;
    // D = 2114 + 1024: the first packet starts 3138 frames before the first real frame.
    expect(packets[0].tsFrames).toBe(-3138);
    expectContiguous(packets);
    expectFaithful(packets, 0, 100 * 1024 - 4096);
    expect(t.teed).toHaveLength(packets.length);
  });

  it("splices a restart after a flush with no gap, no overlap and no lost audio", async () => {
    const t = session({ delays: { native: 2114 } });
    writeBlocks(t.pcm, 0, 50);
    t.s.pump();
    await flushMicrotasks();
    await t.s.closeStream(); // iOS hidden
    const before = t.ring.endFrame;
    expect(before).toBeLessThanOrEqual(50 * 1024);
    writeBlocks(t.pcm, 50 * 1024, 50);
    t.s.pump();
    await flushMicrotasks();
    expect(t.made).toHaveLength(2);
    // The new stream began early, with real audio from the PCM ring, not silence.
    const second = t.made[1];
    expect(second.inputs[1][0]).not.toBe(0);
    const packets = t.ring.packets;
    expectContiguous(packets);
    expect(new Set(packets.map((p) => p.stream))).toEqual(new Set([1, 2]));
    expectFaithful(packets, 0, 100 * 1024 - 4096);
  });

  it("splices a restart after an encoder error that lost its tail", async () => {
    const t = session({ delays: { native: 2114 } });
    writeBlocks(t.pcm, 0, 40);
    t.s.pump();
    await flushMicrotasks();
    t.made[0].die();
    // A restartable AAC failure has its own code, so it never counts against video.
    expect(t.errors).toHaveLength(1);
    expect(t.errors[0]).toMatch(/^audio-encoder-error/);
    writeBlocks(t.pcm, 40 * 1024, 40);
    t.s.pump();
    await flushMicrotasks();
    const packets = t.ring.packets;
    expectContiguous(packets);
    expectFaithful(packets, 0, 80 * 1024 - 4096);
  });

  it("keeps the grid when the backend kind (and its delay) changes", async () => {
    const t = session({ delays: { native: 2114, wasm: 1024 } });
    writeBlocks(t.pcm, 0, 30);
    t.s.pump();
    await flushMicrotasks();
    for (let i = 0; i < 3; i++) {
      t.made[t.made.length - 1].die();
      writeBlocks(t.pcm, (30 + i * 5) * 1024, 5);
      t.s.pump();
      await flushMicrotasks();
    }
    expect(t.s.kind).toBe("wasm");
    expect(t.made[t.made.length - 1].kind).toBe("wasm");
    writeBlocks(t.pcm, 45 * 1024, 30);
    t.s.pump();
    await flushMicrotasks();
    const packets = t.ring.packets;
    expectContiguous(packets);
    expectFaithful(packets, 0, 75 * 1024 - 4096);
    expect(t.s.primingSamples).toBe(1024);
  });

  it("moves to the next kind at once when a backend cannot load, and disables audio when none can", async () => {
    const t = session({ failCreate: ["native"] });
    writeBlocks(t.pcm, 0, 10);
    t.s.pump();
    await flushMicrotasks();
    expect(t.s.kind).toBe("wasm");
    t.s.pump();
    await flushMicrotasks();
    expect(t.ring.size).toBeGreaterThan(0);

    const none = session({ kinds: ["native"], failCreate: ["native"] });
    writeBlocks(none.pcm, 0, 10);
    none.s.pump();
    await flushMicrotasks();
    expect(none.s.enabled).toBe(false);
    expect(none.errors.pop()).toMatch(/^audio-encoder-missing/);
    none.s.pump();
    await flushMicrotasks();
    expect(none.made).toHaveLength(0);
  });

  it("disables audio when there is no backend at all", () => {
    const t = session({ kinds: [] });
    expect(t.s.enabled).toBe(false);
    expect(t.errors[0]).toMatch(/^audio-encoder-missing/);
  });

  it("forgets failures outside the 10 s window", async () => {
    let clock = 0;
    const t = session({ now: () => clock });
    writeBlocks(t.pcm, 0, 5);
    t.s.pump();
    await flushMicrotasks();
    for (let i = 0; i < 4; i++) {
      clock += 6000;
      t.made[t.made.length - 1].die();
      writeBlocks(t.pcm, (5 + i) * 1024, 1);
      t.s.pump();
      await flushMicrotasks();
    }
    expect(t.s.kind).toBe("native");
    expect(t.s.stats.failures).toBe(4);
  });

  it("starts a fresh first stream after a purge", async () => {
    const t = session();
    writeBlocks(t.pcm, 0, 20);
    t.s.pump();
    await flushMicrotasks();
    t.s.purge();
    t.ring.clear();
    t.pcm.clear();
    writeBlocks(t.pcm, 100 * 1024, 20);
    t.s.pump();
    await flushMicrotasks();
    expect(t.made[0].closed).toBe(true);
    expect(t.ring.packets[0].tsFrames).toBe(100 * 1024 - (PRIMING_CONSTANTS.native + PRE_PAD_FRAMES));
    expectFaithful(t.ring.packets, 100 * 1024, 120 * 1024 - 4096);
  });

  it("starts no new stream while the old one flushes, then splices on the flushed end", async () => {
    const t = session();
    writeBlocks(t.pcm, 0, 20);
    t.s.pump();
    await flushMicrotasks();
    const b = t.made[0];
    let releaseFlush: () => void = () => {};
    b.flush = () => new Promise<void>((resolve) => (releaseFlush = () => { (b as unknown as { emit(f: boolean): void }).emit(true); resolve(); }));
    const closing = t.s.closeStream();
    writeBlocks(t.pcm, 20 * 1024, 5);
    t.s.pump(); // the audio timer fires during the flush
    await flushMicrotasks();
    expect(t.made).toHaveLength(1);
    releaseFlush();
    await closing;
    t.s.pump();
    await flushMicrotasks();
    expect(t.made).toHaveLength(2);
    expectContiguous(t.ring.packets);
    expectFaithful(t.ring.packets, 0, 25 * 1024 - 4096);
  });

  it("drops the flush tail and the splice when a purge lands during the flush", async () => {
    const t = session();
    writeBlocks(t.pcm, 0, 20);
    t.s.pump();
    await flushMicrotasks();
    const b = t.made[0];
    let releaseFlush: () => void = () => {};
    b.flush = () => new Promise<void>((resolve) => (releaseFlush = () => { (b as unknown as { emit(f: boolean): void }).emit(true); resolve(); }));
    const closing = t.s.closeStream();
    t.s.purge();
    t.ring.clear();
    t.pcm.clear();
    releaseFlush();
    await closing;
    expect(t.ring.size).toBe(0); // no old-owner packet reached the emptied ring
    writeBlocks(t.pcm, 50 * 1024, 10);
    t.s.pump();
    await flushMicrotasks();
    // A fresh first stream, not a splice onto the purged audio.
    expect(t.ring.packets[0].tsFrames).toBe(50 * 1024 - (PRIMING_CONSTANTS.native + PRE_PAD_FRAMES));
  });

  it("does not feed a backend that is still loading, and catches up when it is ready", async () => {
    const t = session();
    writeBlocks(t.pcm, 0, 5);
    t.s.pump(); // starts loading
    writeBlocks(t.pcm, 5 * 1024, 5);
    t.s.pump(); // still loading: nothing to feed yet
    await flushMicrotasks();
    const fed = t.made[0].inputs.reduce((n, x) => n + x.length, 0);
    expect(fed).toBe(PRE_PAD_FRAMES + 10 * 1024);
  });

  it("closes a stream that is still loading without leaking its backend", async () => {
    const t = session();
    writeBlocks(t.pcm, 0, 5);
    t.s.pump();
    await t.s.closeStream();
    await flushMicrotasks();
    expect(t.made[0].closed).toBe(true);
    t.s.pump();
    await flushMicrotasks();
    // The next stream starts where the unfinished one would have started.
    expect(t.ring.packets[0].tsFrames).toBe(-(PRIMING_CONSTANTS.native + PRE_PAD_FRAMES));
  });
});

describe("priming calibration", () => {
  it("finds a known delay in a decoded chirp", () => {
    const chirp = calibrationChirp();
    const decoded = new Float32Array(20_000);
    decoded.set(chirp, 4096 + 3138);
    expect(locateChirp(decoded)).toMatchObject({ delay: 3138 });
    expect(locateChirp(decoded)!.score).toBeCloseTo(1, 6);
  });

  it("returns null for silence or noise", () => {
    expect(locateChirp(new Float32Array(20_000))).toBeNull();
    const noise = new Float32Array(20_000);
    let x = 1;
    for (let i = 0; i < noise.length; i++) {
      x = (x * 16807) % 2147483647;
      noise[i] = (x / 2147483647 - 0.5) * 0.4;
    }
    expect(locateChirp(noise)).toBeNull();
  });
});

describe("native AAC backend (WebCodecs fakes)", () => {
  let mock: WebCodecsMock;
  afterEach(() => mock.uninstall());

  describe.each(["chromium", "webkit"] as const)("%s AudioEncoder", (flavor) => {
    beforeEach(() => {
      mock = installWebCodecsMock({ audioEncoderFlavor: flavor });
    });

    it("measures the priming as 2114 samples (plan 3a), whatever the encoder's description", async () => {
      expect(canCalibrate()).toBe(true);
      const p = await measurePriming((sink) => createNativeBackend(sink));
      expect(p).toBe(2114);
      // The decoder got the rebuilt ASC, never the esds bytes WebKit returns.
      expect(mock.audioDecoders.length).toBeGreaterThan(0);
      for (const d of mock.audioDecoders) expect(bytesOf(d.configureCalls[0].description)).toEqual([0x11, 0x90]);
    });

    it("gives packets whose timestamps line up with the input, end to end", async () => {
      const priming = (await measurePriming((sink) => createNativeBackend(sink)))!;
      const pcm = new PcmRing(62);
      const ring = new AacPacketRing(62);
      const s = new AacSession({
        kinds: ["native"],
        primingSamples: { native: priming },
        createBackend: (_k, sink) => createNativeBackend(sink),
        pcm,
        ring,
        onError: () => {},
      });
      writeBlocks(pcm, 0, 40);
      s.pump();
      await flushMicrotasks();
      writeBlocks(pcm, 40 * 1024, 40);
      s.pump();
      await flushMicrotasks();
      expectContiguous(ring.packets);
      // Decode each packet with the fake decoder and compare with the input at the packet's own time.
      const decoded: Float32Array[] = [];
      const dec = new AudioDecoder({ output: (a) => {
        const plane = new Float32Array(a.numberOfFrames);
        a.copyTo(plane, { planeIndex: 0, format: "f32-planar" });
        decoded.push(plane);
        a.close();
      }, error: () => {} });
      dec.configure({ codec: "mp4a.40.2", sampleRate: SR, numberOfChannels: 2, description: buildAudioSpecificConfig(SR, 2) });
      for (const p of ring.packets) dec.decode(new EncodedAudioChunk({ type: "key", timestamp: 0, data: p.data }));
      await dec.flush();
      await flushMicrotasks();
      let checked = 0;
      let worst = 0;
      ring.packets.forEach((p, i) => {
        for (let k = 0; k < AAC_FRAME; k++) {
          const frame = p.tsFrames + k;
          if (frame < 0 || frame >= 78 * 1024) continue;
          worst = Math.max(worst, Math.abs(decoded[i][k] - signal(frame)));
          checked++;
        }
      });
      expect(worst).toBeLessThan(1e-3);
      expect(checked).toBeGreaterThan(70 * 1024);
    });
  });

  it("returns null when AudioDecoder is missing (iOS before 26), so the caller uses the constant", async () => {
    mock = installWebCodecsMock({ audioDecoder: false });
    expect(canCalibrate()).toBe(false);
    expect(await measurePriming((sink) => createNativeBackend(sink))).toBeNull();
  });

  it("reports native AAC as unsupported without AudioData (Safari before 26)", async () => {
    mock = installWebCodecsMock({ audioData: false });
    expect(await nativeAacSupported()).toBe(false);
    await expect(createAacBackend("native", { packet: () => {}, error: () => {} })).rejects.toThrow(/AudioData/);
  });

  it("reports the encoder error once through the sink", async () => {
    mock = installWebCodecsMock();
    const errors: unknown[] = [];
    const b = await createNativeBackend({ packet: () => {}, error: (e) => errors.push(e) });
    mock.audioEncoders[0].fail();
    mock.audioEncoders[0].fail();
    expect(errors).toHaveLength(1);
    b.close();
  });
});
