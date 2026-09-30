/**
 * Integration tests of the real WASM AAC fallback (tier W+).
 *
 * Every test runs the committed module (apps/web/public/clips/aac), which
 * scripts/clips/aac-wasm builds from the pinned FFmpeg source. No fake
 * encoder is involved. Some tests wrap the real module to inject one failure.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  AAC_FRAME,
  AacPacketRing,
  AacSession,
  PRE_PAD_FRAMES,
  PRIMING_CONSTANTS,
  PcmRing,
  SPLICE_MARGIN_FRAMES,
  type AacSink,
} from "../audio/aac";
import {
  AAC_WASM_BRIDGE_ABI,
  AAC_WASM_MODULE_PATH,
  aacWasmUrl,
  createWasmBackend,
  instantiateAacWasm,
  sharedAacWasm,
  type AacWasmModule,
} from "../audio/aacBackends";
import { loadAacWasmFromDisk } from "./aacWasmModule";

const SR = 48000;

function tone(frames: number, from = 0): [Float32Array, Float32Array] {
  const l = new Float32Array(frames);
  for (let i = 0; i < frames; i++) l[i] = 0.3 * Math.sin((2 * Math.PI * 440 * (from + i)) / SR);
  return [l, l.slice()];
}

/** Collects what a backend puts out. */
function collector() {
  const packets: ArrayBuffer[] = [];
  const errors: unknown[] = [];
  const sink: AacSink = { packet: (d) => packets.push(d), error: (e) => errors.push(e) };
  return { packets, errors, sink };
}

/** Packets for `frames` fed frames: FFmpeg's 1024-frame priming, padded to whole packets. */
const expectedPackets = (frames: number) => Math.ceil((frames + PRIMING_CONSTANTS.wasm) / AAC_FRAME);

/** A manual scheduler and clock, so a test can run one encode slice at a time. */
function manualScheduler(msPerNow = 1) {
  const pending: (() => void)[] = [];
  let t = 0;
  return {
    schedule: (fn: () => void) => void pending.push(fn),
    now: () => (t += msPerNow),
    get pending() {
      return pending.length;
    },
    runOne() {
      const fn = pending.shift();
      fn?.();
      return fn !== undefined;
    },
    runAll() {
      let n = 0;
      while (this.runOne()) n++;
      return n;
    },
  };
}

/** The real module with some exports replaced. */
function patched(mod: AacWasmModule, over: Partial<AacWasmModule>): AacWasmModule {
  return new Proxy(mod, {
    get(target, key, receiver) {
      if (key in over) return over[key as keyof AacWasmModule];
      return Reflect.get(target, key, receiver);
    },
  });
}

let mod: AacWasmModule;

beforeAll(async () => {
  mod = await loadAacWasmFromDisk();
});

describe("the AAC WASM module (real build)", () => {
  it("has the bridge version this code expects, a 1024-frame packet and a 1024-frame delay", () => {
    expect(mod._aac_bridge_abi()).toBe(AAC_WASM_BRIDGE_ABI);
    const ctx = mod._aac_open(2, SR, 128000);
    expect(ctx).not.toBe(0);
    expect(mod._aac_frame_size(ctx)).toBe(AAC_FRAME);
    // Plan 3a: the WASM priming is 1024. The decode test in aacWasmDecode.node.test.ts measures it too.
    expect(mod._aac_initial_padding(ctx)).toBe(PRIMING_CONSTANTS.wasm);
    mod._aac_close(ctx);
  });

  it("refuses a sample rate that AAC cannot use", () => {
    expect(mod._aac_open(2, 12345, 128000)).toBe(0);
  });

  it("is served at a fixed path on the site's own origin", () => {
    expect(AAC_WASM_MODULE_PATH).toBe("/clips/aac/ffmpeg-aac-enc.mjs");
    expect(aacWasmUrl()).toBe(new URL(AAC_WASM_MODULE_PATH, window.location.href).href);
  });
});

describe("WASM AAC backend (real module)", () => {
  it("streams raw AAC packets as it goes, one per 1024 frames, and flushes the rest", async () => {
    const { packets, errors, sink } = collector();
    const backend = await createWasmBackend(sink, { load: async () => mod });
    expect(backend.kind).toBe("wasm");
    const frames = 5 * SR;
    for (let at = 0; at < frames; at += 8192) {
      const n = Math.min(8192, frames - at);
      backend.encode(...tone(n, at));
    }
    // Wait for the encode slices without a flush: packets must already be flowing.
    const deadline = Date.now() + 20_000;
    while (packets.length < 100 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(packets.length).toBeGreaterThanOrEqual(100);
    await backend.flush();
    backend.close();
    expect(errors).toEqual([]);
    expect(packets.length).toBe(expectedPackets(frames));
    for (const p of packets) {
      const b = new Uint8Array(p);
      expect(b.byteLength).toBeGreaterThan(0);
      // Raw AAC, never ADTS (an ADTS frame starts with the 0xFFF sync word).
      expect(b.byteLength >= 2 && b[0] === 0xff && (b[1] & 0xf0) === 0xf0).toBe(false);
    }
    // 128 kbps: about 683 bytes per 1024-frame packet on average.
    const avg = packets.reduce((n, p) => n + p.byteLength, 0) / packets.length;
    expect(avg).toBeGreaterThan(300);
    expect(avg).toBeLessThan(1100);
  });

  it("encodes in time slices and gives the worker back between them", async () => {
    const { packets, errors, sink } = collector();
    // Each clock read moves 1 ms, so a 4 ms slice sends a few frames only.
    const s = manualScheduler(1);
    const backend = await createWasmBackend(sink, { load: async () => mod, schedule: s.schedule, now: s.now, sliceMs: 4 });
    const frames = 2 * SR;
    backend.encode(...tone(frames));
    // encode() only queues: nothing is encoded in the caller's task.
    expect(packets).toHaveLength(0);
    expect(s.pending).toBe(1);
    s.runOne();
    const afterOne = packets.length;
    expect(afterOne).toBeGreaterThan(0);
    expect(afterOne).toBeLessThan(8);
    // The slice scheduled the next one because work is left.
    expect(s.pending).toBe(1);
    const slices = s.runAll();
    expect(slices).toBeGreaterThan(10);
    expect(errors).toEqual([]);
    // Every whole frame is out except the encoder's one-frame lookahead. The partial frame waits.
    expect(packets.length).toBe(Math.floor(frames / AAC_FRAME) - 1);
    const flushed = backend.flush();
    s.runAll();
    await flushed;
    expect(packets.length).toBe(expectedPackets(frames));
    backend.close();
  });

  it("pads a short last frame with silence at the flush", async () => {
    const { packets, errors, sink } = collector();
    const backend = await createWasmBackend(sink, { load: async () => mod });
    backend.encode(...tone(1500));
    await backend.flush();
    backend.close();
    expect(errors).toEqual([]);
    // 1024 + 476 padded to 1024: two frames in, plus the delay packet.
    expect(packets.length).toBe(expectedPackets(1500));
    expect(packets.length).toBe(3);
  });

  it("gives no packet for a flush with no audio", async () => {
    const { packets, errors, sink } = collector();
    const backend = await createWasmBackend(sink, { load: async () => mod });
    await backend.flush();
    backend.close();
    expect(errors).toEqual([]);
    expect(packets).toEqual([]);
  });

  it("refuses audio after a flush and after a close", async () => {
    const { sink } = collector();
    const a = await createWasmBackend(sink, { load: async () => mod });
    await a.flush();
    expect(() => a.encode(...tone(1024))).toThrow(/done/);
    a.close();
    expect(() => a.encode(...tone(1024))).toThrow(/closed/);
    const b = await createWasmBackend(sink, { load: async () => mod });
    expect(() => b.encode(new Float32Array(4), new Float32Array(5))).toThrow(RangeError);
    b.close();
  });

  it("copies the caller's arrays, so the caller can change them after encode()", async () => {
    const run = async (reuse: boolean) => {
      const { packets, sink } = collector();
      const backend = await createWasmBackend(sink, { load: async () => mod });
      const [l, r] = tone(4096);
      backend.encode(l, r);
      if (reuse) {
        l.fill(0);
        r.fill(0);
      }
      await backend.flush();
      backend.close();
      return packets.map((p) => Array.from(new Uint8Array(p)).join(","));
    };
    expect(await run(true)).toEqual(await run(false));
  });

  it("stops at once when the sink closes the backend during a slice", async () => {
    const packets: ArrayBuffer[] = [];
    const errors: unknown[] = [];
    const s = manualScheduler(0);
    let closeCalls = 0;
    const closing = patched(mod, {
      _aac_close: (ctx: number) => {
        closeCalls++;
        mod._aac_close(ctx);
      },
    });
    const backend = await createWasmBackend(
      {
        packet: (d) => {
          packets.push(d);
          backend.close();
        },
        error: (e) => errors.push(e),
      },
      { load: async () => closing, schedule: s.schedule, now: s.now },
    );
    backend.encode(...tone(SR));
    s.runAll();
    expect(packets).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(closeCalls).toBe(1);
    // A second close does nothing.
    backend.close();
    expect(closeCalls).toBe(1);
  });

  it("fails once on an FFmpeg error code, closes the encoder and keeps the module", async () => {
    const { packets, errors, sink } = collector();
    const retired: AacWasmModule[] = [];
    let closed = 0;
    const broken = patched(mod, {
      _aac_receive: () => -22,
      _aac_close: (ctx: number) => {
        closed++;
        mod._aac_close(ctx);
      },
    });
    const backend = await createWasmBackend(sink, { load: async () => broken, retire: (m) => retired.push(m) });
    backend.encode(...tone(8192));
    await backend.flush();
    expect(packets).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/aac_receive failed with FFmpeg error -22/);
    expect(closed).toBe(1);
    expect(retired.length).toBe(0);
    expect(() => backend.encode(...tone(1024))).toThrow(/failed/);
    backend.close();
    expect(closed).toBe(1);
  });

  it("fails once on a trap, retires the instance and never touches its memory again", async () => {
    const { errors, sink } = collector();
    const retired: AacWasmModule[] = [];
    let sends = 0;
    let closes = 0;
    const trapping = patched(mod, {
      _aac_send: (ctx: number, n: number) => {
        if (++sends === 3) throw new WebAssembly.RuntimeError("unreachable");
        return mod._aac_send(ctx, n);
      },
      _aac_close: () => {
        closes++;
      },
    });
    const backend = await createWasmBackend(sink, { load: async () => trapping, retire: (m) => retired.push(m) });
    backend.encode(...tone(8 * 1024));
    await backend.flush();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(WebAssembly.RuntimeError);
    expect(retired.length === 1 && retired[0] === trapping).toBe(true);
    backend.close();
    expect(closes).toBe(0);
  });

  it("refuses a module whose encoder delay is not the 1024 frames the session uses", async () => {
    let closed = 0;
    const other = patched(mod, {
      _aac_initial_padding: () => 2048,
      _aac_close: (ctx: number) => {
        closed++;
        mod._aac_close(ctx);
      },
    });
    await expect(createWasmBackend(collector().sink, { load: async () => other })).rejects.toThrow(/frame size 1024 and delay 2048, not 1024 and 1024/);
    expect(closed).toBe(1);
  });

  it("rejects when the module refuses to open, and retires an instance that traps at open", async () => {
    const refusing = patched(mod, { _aac_open: () => 0 });
    await expect(createWasmBackend(collector().sink, { load: async () => refusing })).rejects.toThrow(/refused/);
    const retired: AacWasmModule[] = [];
    const trapping = patched(mod, {
      _aac_open: () => {
        throw new WebAssembly.RuntimeError("memory access out of bounds");
      },
    });
    await expect(
      createWasmBackend(collector().sink, { load: async () => trapping, retire: (m) => retired.push(m) }),
    ).rejects.toThrow(/out of bounds/);
    expect(retired.length === 1 && retired[0] === trapping).toBe(true);
  });

  it("feeds an AacSession with contiguous packets on the WASM grid", async () => {
    const pcm = new PcmRing(62);
    const ring = new AacPacketRing(62);
    const errors: string[] = [];
    const s = new AacSession({
      kinds: ["wasm"],
      primingSamples: {},
      createBackend: (_k, sink) => createWasmBackend(sink, { load: async () => mod }),
      pcm,
      ring,
      onError: (code, detail) => errors.push(`${code}: ${detail}`),
    });
    for (let b = 0; b < 200; b++) {
      const [l] = tone(1024, b * 1024);
      const data = new Float32Array(2048);
      for (let f = 0; f < 1024; f++) data[f * 2] = data[f * 2 + 1] = l[f];
      pcm.write(b * 1024, data);
    }
    // The audio timer pumps every tick. Flow control feeds at most 1 s past the packets that came out.
    const deadline = Date.now() + 20_000;
    while (ring.size < 190 && Date.now() < deadline) {
      s.pump();
      await new Promise((r) => setTimeout(r, 20));
    }
    // The encoder gives its packets out in time slices, so the ring can pass
    // 190 between two pumps, before the last pump fed the rest of the PCM
    // (a closed stream flushes only what it was fed; the next stream encodes
    // the rest again). One more pump feeds the rest: 1 s of feed-ahead is
    // more than the 10 240 frames left. Without it the test failed on a busy
    // machine with the ring at exactly 190 packets.
    s.pump();
    await s.closeStream();
    expect(errors).toEqual([]);
    const packets = ring.packets;
    expect(packets[0].tsFrames).toBe(-(PRIMING_CONSTANTS.wasm + PRE_PAD_FRAMES));
    for (let i = 1; i < packets.length; i++) expect(packets[i].tsFrames - packets[i - 1].tsFrames).toBe(AAC_FRAME);
    // The flush keeps only packets whose window (and lookahead) saw real audio, so the ring
    // ends SPLICE_MARGIN_FRAMES or a little more before the fed audio. A next stream encodes that part again.
    expect(ring.endFrame).toBeLessThanOrEqual(200 * 1024 - SPLICE_MARGIN_FRAMES);
    expect(ring.endFrame).toBeGreaterThan(200 * 1024 - SPLICE_MARGIN_FRAMES - 2 * AAC_FRAME);
  });
});

describe("module loading", () => {
  const fixture = (name: string) => pathToFileURL(path.join(__dirname, "fixtures", name)).href;

  it("refuses a module with another bridge version (an old cached file)", async () => {
    await expect(instantiateAacWasm(fixture("aacWasmOldAbi.mjs"))).rejects.toThrow(/bridge version 0, not 1/);
  });

  it("refuses a file with no module factory", async () => {
    await expect(instantiateAacWasm(fixture("aacWasmNoFactory.mjs"))).rejects.toThrow(/no module factory/);
  });

  it("rejects when the file is missing", async () => {
    await expect(instantiateAacWasm(fixture("missing.mjs"))).rejects.toThrow();
  });

  it("shares one instance, forgets a failed load, and starts a new instance after a retire", async () => {
    let made = 0;
    let failNext = true;
    const shared = sharedAacWasm(async () => {
      made++;
      if (failNext) {
        failNext = false;
        throw new Error("404");
      }
      return loadAacWasmFromDisk();
    });
    await expect(shared.load()).rejects.toThrow("404");
    const a = await shared.load();
    const b = await shared.load();
    // Identity checks as booleans: a failure message must not print a module (its heap is megabytes).
    expect(a === b).toBe(true);
    expect(made).toBe(2);
    // A retire of another instance changes nothing.
    shared.retire(mod);
    expect((await shared.load()) === a).toBe(true);
    shared.retire(a);
    const c = await shared.load();
    expect(c === a).toBe(false);
    expect(made).toBe(3);
    // Two instances have separate memory: both encode.
    const ca = a._aac_open(2, SR, 128000);
    const cc = c._aac_open(2, SR, 128000);
    expect(ca).not.toBe(0);
    expect(cc).not.toBe(0);
    a._aac_close(ca);
    c._aac_close(cc);
  });
});
