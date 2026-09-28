import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAudioDecoder, flushMicrotasks, installWebCodecsMock, type WebCodecsMock } from "@/__tests__/webcodecs-mock";
import {
  AAC_FRAME,
  AAC_STALL_MS,
  AacPacketRing,
  AacSession,
  BACKEND_START_MS,
  BEHIND_FRAMES,
  BEHIND_MS,
  FAILURE_WINDOW_MS,
  FEED_AHEAD_FRAMES,
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
import { calibrationChirp, canCalibrate, locateChirp, measurePriming, plausiblePriming } from "../audio/priming";

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
  private credit = 0;
  closed = false;
  dead = false;
  /** Takes input but puts out nothing and reports no error (a hung encoder). */
  hang = false;
  /**
   * Below 1, packets come out only through work() (the test's clock), at this
   * share of real time: an encoder too slow for the device.
   */
  rate = 1;

  /**
   * lookahead: frames the encoder needs past a packet's end before it puts
   * the packet out (a real encoder's MDCT window and block-switch lookahead).
   */
  constructor(
    kind: AacKind,
    private readonly sink: AacSink,
    readonly delay: number,
    private readonly lookahead = 0,
  ) {
    this.kind = kind;
    this.out = new Array(delay).fill(0);
  }

  encode(left: Float32Array): void {
    if (this.dead) throw new Error("dead");
    this.inputs.push(left.slice());
    for (const v of left) this.out.push(v);
    if (!this.hang && this.rate >= 1) this.emit(false);
  }

  /** A slow encoder works through `frames` of real time. */
  work(frames: number): void {
    this.credit += (frames * this.rate) / AAC_FRAME;
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
    if (this.hang) return;
    if (final) while (this.out.length % AAC_FRAME !== 0) this.out.push(0);
    const need = final ? 0 : this.lookahead;
    while ((this.emitted + 1) * AAC_FRAME + need <= this.out.length) {
      if (!final && this.rate < 1) {
        if (this.credit < 1) return;
        this.credit--;
      }
      const i = this.emitted++;
      const pcm = new Int16Array(AAC_FRAME);
      for (let k = 0; k < AAC_FRAME; k++) pcm[k] = Math.round(this.out[i * AAC_FRAME + k] * 32767);
      this.sink.packet(pcm.buffer);
    }
  }
}

/** Frames of real audio a backend got (its input minus the pre-pad), for a stream that starts at frame 0. */
const fedOf = (b: DelayLineBackend) => b.inputs.reduce((n, x) => n + x.length, 0) - PRE_PAD_FRAMES;

function scriptedFactory(delays: Partial<Record<AacKind, number>> = {}, opts: { failCreate?: AacKind[]; lookahead?: number; rate?: number } = {}) {
  const made: DelayLineBackend[] = [];
  const factory: AacBackendFactory = async (kind, sink) => {
    await Promise.resolve();
    if (opts.failCreate?.includes(kind)) throw new Error(`${kind} cannot load`);
    const b = new DelayLineBackend(kind, sink, delays[kind] ?? PRIMING_CONSTANTS[kind], opts.lookahead);
    if (opts.rate !== undefined) b.rate = opts.rate;
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

function session(
  o: {
    kinds?: AacKind[];
    delays?: Partial<Record<AacKind, number>>;
    failCreate?: AacKind[];
    now?: () => number;
    flushTimeoutMs?: number;
    lookahead?: number;
    rate?: number;
  } = {},
) {
  const pcm = new PcmRing(62);
  const ring = new AacPacketRing(62);
  const errors: string[] = [];
  const teed: AudioPacket[] = [];
  const { factory, made } = scriptedFactory(o.delays, { failCreate: o.failCreate, lookahead: o.lookahead, rate: o.rate });
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
    flushTimeoutMs: o.flushTimeoutMs,
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

  it("forgets failures outside the 60 s window, which is longer than every detection time", async () => {
    let clock = 0;
    const t = session({ now: () => clock });
    writeBlocks(t.pcm, 0, 5);
    t.s.pump();
    await flushMicrotasks();
    for (let i = 0; i < 4; i++) {
      clock += FAILURE_WINDOW_MS / 2 + 1000;
      t.made[t.made.length - 1].die();
      writeBlocks(t.pcm, (5 + i) * 1024, 1);
      t.s.pump();
      await flushMicrotasks();
    }
    expect(t.s.kind).toBe("native");
    expect(t.s.stats.failures).toBe(4);
    // Three failures 10 s apart (a stall is detected in 2 s, a slow encoder in 10 s) do switch.
    const u = session({ now: () => clock });
    writeBlocks(u.pcm, 0, 5);
    u.s.pump();
    await flushMicrotasks();
    for (let i = 0; i < 3; i++) {
      clock += 10_000;
      u.made[u.made.length - 1].die();
      writeBlocks(u.pcm, (5 + i) * 1024, 1);
      u.s.pump();
      await flushMicrotasks();
    }
    expect(u.s.kind).toBe("wasm");
  });

  it("catches up a 12 s backlog when the backend is ready late, with no failure (flow control)", async () => {
    // The real native backend (fake AudioEncoder): packets come out asynchronously, and the backend
    // refuses more than MAX_BACKLOG_FRAMES outstanding. A synchronous feed of the whole backlog would trip it.
    const mock = installWebCodecsMock();
    try {
      let clock = 0;
      let ready: () => void = () => {};
      const gate = new Promise<void>((r) => (ready = r));
      const pcm = new PcmRing(62);
      const ring = new AacPacketRing(62);
      const errors: string[] = [];
      const s = new AacSession({
        kinds: ["native"],
        primingSamples: { native: 2114 },
        createBackend: async (_k, sink) => {
          await gate;
          return createNativeBackend(sink);
        },
        pcm,
        ring,
        onError: (code, detail) => errors.push(`${code}: ${detail}`),
        now: () => clock,
      });
      writeBlocks(pcm, 0, 1);
      s.pump(); // starts loading
      // 12 s of play while the backend loads (the audio timer pumps every 40 ms).
      for (let b = 1; b < 563; b++) {
        writeBlocks(pcm, b * 1024, 1);
        if (b % 2 === 0) {
          clock += 40;
          s.pump();
        }
      }
      expect(pcm.endFrame! / SR).toBeGreaterThan(12);
      ready();
      await flushMicrotasks();
      // Play on: each tick feeds at most FEED_AHEAD_FRAMES past the packets that came out.
      for (let i = 0; i < 60; i++) {
        clock += 40;
        writeBlocks(pcm, (563 + i * 2) * 1024, 2);
        s.pump();
        await flushMicrotasks();
      }
      expect(errors).toEqual([]);
      expect(s.enabled).toBe(true);
      expect(mock.audioEncoders).toHaveLength(1);
      expectContiguous(ring.packets);
      expect(ring.packets[0].tsFrames).toBe(-(2114 + PRE_PAD_FRAMES));
      // The whole backlog is encoded: the watermark is close behind the newest audio.
      expect(pcm.endFrame! - ring.endFrame).toBeLessThan(FEED_AHEAD_FRAMES);
    } finally {
      mock.uninstall();
    }
  });

  it("fails a stream whose encoder stops putting out packets, and splices a new one", async () => {
    let clock = 0;
    const t = session({ delays: { native: 2114 }, now: () => clock });
    writeBlocks(t.pcm, 0, 20);
    t.s.pump();
    await flushMicrotasks();
    const hung = t.made[0];
    hung.hang = true; // takes input, gives nothing, reports no error
    for (let i = 0; i < 60 && t.made.length === 1; i++) {
      clock += 40;
      writeBlocks(t.pcm, (20 + i * 2) * 1024, 2);
      t.s.pump();
      await flushMicrotasks();
    }
    expect(t.errors).toHaveLength(1);
    expect(t.errors[0]).toMatch(/^audio-encoder-error: .*no packet for/);
    expect(hung.closed).toBe(true);
    // Detected about AAC_STALL_MS after the work inside passed STALL_LAG_FRAMES.
    expect(clock).toBeLessThan(AAC_STALL_MS + 1000);
    for (let i = 0; i < 20; i++) {
      clock += 40;
      writeBlocks(t.pcm, (140 + i * 2) * 1024, 2);
      t.s.pump();
      await flushMicrotasks();
    }
    expectContiguous(t.ring.packets);
    expect(t.made).toHaveLength(2);
  });

  it("does not call a paused stream stalled: little work inside is lookahead", async () => {
    let clock = 0;
    const t = session({ delays: { native: 2114 }, now: () => clock });
    writeBlocks(t.pcm, 0, 20);
    t.s.pump();
    await flushMicrotasks();
    t.made[0].hang = true;
    for (let i = 0; i < 200; i++) {
      clock += 40; // 8 s of pause: no new audio
      t.s.pump();
    }
    expect(t.errors).toEqual([]);
  });

  it("does not take a frozen worker (no pumps for seconds) as a stall", async () => {
    let clock = 0;
    const t = session({ delays: { native: 2114 }, now: () => clock });
    writeBlocks(t.pcm, 0, 20);
    t.s.pump();
    await flushMicrotasks();
    t.made[0].hang = true;
    writeBlocks(t.pcm, 20 * 1024, 20);
    clock += 30_000; // the tab was frozen
    t.s.pump();
    expect(t.errors).toEqual([]);
  });

  it("fails an encoder that cannot keep up with real time, but not one that is catching up", async () => {
    let clock = 0;
    const slow = session({ delays: { native: 2114 }, now: () => clock });
    writeBlocks(slow.pcm, 0, 2);
    slow.s.pump();
    await flushMicrotasks();
    // The encoder works at half real time: the backlog grows, it never shrinks. Packets keep coming, so it is no stall.
    const b = slow.made[0];
    b.rate = 0.5;
    let at = 2;
    let behindAt: number | null = null;
    for (let i = 0; i < 1000 && slow.errors.length === 0; i++) {
      clock += 40;
      writeBlocks(slow.pcm, at * 1024, 2);
      at += 2;
      b.work(2048);
      slow.s.pump();
      await flushMicrotasks();
      // The feed comes in 8192-frame chunks, so the backlog saws around the limit before it stays above it.
      if (slow.pcm.endFrame! - fedOf(b) > BEHIND_FRAMES) behindAt ??= clock;
      else behindAt = null;
    }
    expect(slow.errors).toEqual([expect.stringMatching(/^audio-encoder-error: .*cannot keep up/)]);
    // Detected BEHIND_MS after the backlog passed BEHIND_FRAMES.
    expect(clock - behindAt!).toBeGreaterThanOrEqual(BEHIND_MS);
    expect(clock - behindAt!).toBeLessThan(BEHIND_MS + 200);

    // An encoder at twice real time with a 32 s backlog takes about 25 s to catch up. The backlog
    // stays above BEHIND_FRAMES for longer than BEHIND_MS, but it keeps shrinking, so it is left alone.
    clock = 0;
    const late = session({ delays: { native: 2114 }, now: () => clock, rate: 0.5 });
    writeBlocks(late.pcm, 0, 1500); // 32 s of audio before the first pump
    late.s.pump();
    await flushMicrotasks();
    const fast = late.made[0];
    let longest = 0;
    let since: number | null = null;
    for (let i = 0; i < 800; i++) {
      clock += 40;
      writeBlocks(late.pcm, (1500 + i * 2) * 1024, 2);
      fast.work(8192); // 4096 frames of encoding per 2048 frames of new audio
      late.s.pump();
      await flushMicrotasks();
      const backlog = late.pcm.endFrame! - fedOf(fast);
      if (backlog > BEHIND_FRAMES) longest = Math.max(longest, clock - (since ??= clock));
      else since = null;
    }
    expect(longest).toBeGreaterThan(BEHIND_MS);
    expect(late.errors).toEqual([]);
    expect(late.pcm.endFrame! - late.ring.endFrame).toBeLessThan(BEHIND_FRAMES);
  });

  it("moves on from a backend that is not ready in BACKEND_START_MS, but lets the last kind take its time", async () => {
    let clock = 0;
    const pcm = new PcmRing(62);
    const ring = new AacPacketRing(62);
    const errors: string[] = [];
    let wasmReady: (b: AacBackend) => void = () => {};
    const made: DelayLineBackend[] = [];
    const s = new AacSession({
      kinds: ["native", "wasm"],
      primingSamples: {},
      createBackend: (kind, sink) => {
        if (kind === "native") return new Promise<AacBackend>(() => {}); // a hung init
        return new Promise<AacBackend>((resolve) => {
          wasmReady = () => {
            const b = new DelayLineBackend("wasm", sink, PRIMING_CONSTANTS.wasm);
            made.push(b);
            resolve(b);
          };
        });
      },
      pcm,
      ring,
      onError: (code, detail) => errors.push(`${code}: ${detail}`),
      now: () => clock,
    });
    writeBlocks(pcm, 0, 5);
    s.pump();
    // The audio timer pumps every 40 ms while the backend loads.
    while (clock < BACKEND_START_MS - 40) {
      clock += 40;
      s.pump();
    }
    expect(errors).toEqual([]);
    clock += 80;
    s.pump();
    expect(s.kind).toBe("wasm");
    expect(errors).toEqual([expect.stringMatching(/^audio-encoder-error: .*native.*not ready/)]);
    s.pump(); // starts loading the WASM encoder
    // A slow first load of the WASM chunk (30 s on a poor network) is no failure: it is the last kind.
    for (let i = 0; i < 750; i++) {
      clock += 40;
      writeBlocks(pcm, (5 + i) * 1024, 1);
      s.pump();
    }
    expect(s.enabled).toBe(true);
    expect(errors).toHaveLength(1);
    wasmReady(null as unknown as AacBackend);
    await flushMicrotasks();
    for (let i = 0; i < 40; i++) {
      clock += 40;
      s.pump();
      await flushMicrotasks();
    }
    expectContiguous(ring.packets);
    expect(ring.packets[0].tsFrames).toBe(-(PRIMING_CONSTANTS.wasm + PRE_PAD_FRAMES));
    expect(ring.endFrame).toBeGreaterThan(700 * 1024);
  });

  it("closes a backend whose flush never ends, and still splices gapless", async () => {
    const t = session({ delays: { native: 2114 }, flushTimeoutMs: 20 });
    writeBlocks(t.pcm, 0, 20);
    t.s.pump();
    await flushMicrotasks();
    const b = t.made[0];
    b.flush = () => new Promise<void>(() => {});
    const started = Date.now();
    await t.s.closeStream();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(b.closed).toBe(true);
    expect(t.errors).toEqual([expect.stringMatching(/^audio-encoder-error: .*flush did not finish/)]);
    writeBlocks(t.pcm, 20 * 1024, 20);
    t.s.pump();
    await flushMicrotasks();
    expectContiguous(t.ring.packets);
    expectFaithful(t.ring.packets, 0, 40 * 1024 - 4096);
  });

  it("starts no stream while suspended (iOS hidden), and splices on resume with no lost audio", async () => {
    const t = session({ delays: { native: 2114 } });
    writeBlocks(t.pcm, 0, 20);
    t.s.pump();
    await flushMicrotasks();
    await t.s.suspend();
    expect(t.made[0].closed).toBe(true);
    // The mixer keeps writing the tail before the pause point; the audio timer keeps pumping.
    writeBlocks(t.pcm, 20 * 1024, 3);
    for (let i = 0; i < 5; i++) {
      t.s.pump();
      await flushMicrotasks();
    }
    expect(t.made).toHaveLength(1);
    expect(t.s.suspended).toBe(true);
    t.s.resume();
    writeBlocks(t.pcm, 23 * 1024, 20);
    t.s.pump();
    await flushMicrotasks();
    expect(t.made).toHaveLength(2);
    expectContiguous(t.ring.packets);
    expectFaithful(t.ring.packets, 0, 43 * 1024 - 4096);
  });

  it("drops the packets a flush made from its silence padding, so no kept packet saw past the fed audio", async () => {
    // A real AAC packet at ts has its MDCT window on [ts, ts + 2048) and the encoder looks 1024 further.
    // The delay line cannot show the aliasing itself; this backend checks the rule the splice needs.
    const t = session({ delays: { native: 2114 }, lookahead: 2 * AAC_FRAME });
    writeBlocks(t.pcm, 0, 30);
    t.s.pump();
    await flushMicrotasks();
    const fed = 30 * 1024;
    await t.s.closeStream();
    const first = t.ring.packets.filter((p) => p.stream === 1);
    expect(first.length).toBeGreaterThan(20);
    for (const p of first) expect(p.tsFrames + 3 * AAC_FRAME).toBeLessThanOrEqual(fed);
    // The next stream encodes the dropped part again from the PCM ring: nothing is lost.
    writeBlocks(t.pcm, 30 * 1024, 20);
    t.s.pump();
    await flushMicrotasks();
    expectContiguous(t.ring.packets);
    expectFaithful(t.ring.packets, 0, 50 * 1024 - 8192);
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

  it("accepts only priming values an AAC-LC encoder can have, and rejects whole-frame decoder shifts", () => {
    expect(plausiblePriming(2114, 2114)).toBe(2114);
    expect(plausiblePriming(2112, 2114)).toBe(2112);
    expect(plausiblePriming(1600, 2114)).toBe(1600); // an unmeasured platform: the measurement wins
    expect(plausiblePriming(2048, 2114)).toBe(2048);
    expect(plausiblePriming(1024, 2114)).toBe(1024);
    expect(plausiblePriming(1090, 2114)).toBeNull(); // a decoder dropped its first 1024 samples
    expect(plausiblePriming(3138, 2114)).toBeNull(); // a decoder added a frame
    expect(plausiblePriming(1082, 2114)).toBeNull(); // within 16 samples of a whole frame
    expect(plausiblePriming(512, 2114)).toBeNull(); // below one frame: no AAC-LC encoder
    expect(plausiblePriming(5000, 2114)).toBeNull();
    expect(plausiblePriming(null, 2114)).toBeNull();
  });

  it("closes the calibration encoder and decoder when the time limit comes first", async () => {
    const mock = installWebCodecsMock();
    try {
      // An encoder whose flush never ends.
      let closed = 0;
      const hung: AacBackend = { kind: "native", encode: () => {}, flush: () => new Promise<void>(() => {}), close: () => void closed++ };
      expect(await measurePriming(async () => hung, { timeoutMs: 20 })).toBeNull();
      expect(closed).toBe(1);
      // A backend that loads after the time limit is closed when it arrives.
      let late: (b: AacBackend) => void = () => {};
      let lateClosed = 0;
      expect(await measurePriming(() => new Promise<AacBackend>((r) => (late = r)), { timeoutMs: 20 })).toBeNull();
      late({ kind: "native", encode: () => {}, flush: async () => {}, close: () => void lateClosed++ });
      await flushMicrotasks();
      expect(lateClosed).toBe(1);
      // A decoder whose flush never ends.
      const flush = FakeAudioDecoder.prototype.flush;
      FakeAudioDecoder.prototype.flush = () => new Promise<void>(() => {});
      try {
        expect(await measurePriming((sink) => createNativeBackend(sink), { timeoutMs: 50 })).toBeNull();
      } finally {
        FakeAudioDecoder.prototype.flush = flush;
      }
      expect(mock.audioDecoders.length).toBeGreaterThan(0);
      expect(mock.audioDecoders.every((d) => d.state === "closed")).toBe(true);
      expect(mock.audioEncoders.every((e) => e.state === "closed")).toBe(true);
    } finally {
      mock.uninstall();
    }
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
