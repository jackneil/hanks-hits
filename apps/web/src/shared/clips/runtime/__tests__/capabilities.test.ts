import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPS_CACHE_ITEM,
  CACHE_MAX_AGE_MS,
  chooseVideoEncoder,
  fnv1a,
  memoryClassFor,
  probeCapabilities,
  probeCapabilityReport,
  probeWebGL2Readback,
  quickProbes,
  selectTier,
  type CapabilityReport,
  type ProbeGlobals,
  type ProbeOptions,
  type WorkerLike,
} from "../capabilities";
import { runProbe, type ProbeEnv, type ProbeRequest, type ProbeResponse } from "../capabilityProbe";
import { allCodecs, FakeAudioData, FakeOpfs, FakeVideoFrame, makeAudioEncoder, makeVideoEncoder } from "./probeFakes";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1";

function workerEnv(overrides: Partial<ProbeEnv> = {}): ProbeEnv {
  const fs = new FakeOpfs();
  return {
    scope: "worker",
    VideoEncoder: makeVideoEncoder({ codecs: allCodecs(), hardware: true, software: true, portrait: true }),
    VideoFrame: FakeVideoFrame as unknown as typeof VideoFrame,
    AudioEncoder: makeAudioEncoder("webkit"),
    AudioData: FakeAudioData as unknown as typeof AudioData,
    AudioDecoder: function AudioDecoder() {},
    getDirectory: () => fs.getDirectory(),
    timeoutMs: 50,
    ...overrides,
  };
}

/** A worker double that runs the real probe code against fakes. */
class FakeWorker implements WorkerLike {
  static started = 0;
  onmessage: ((event: MessageEvent<ProbeResponse>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  constructor(
    private readonly env: ProbeEnv,
    private readonly mode: "ok" | "error" | "hang" = "ok",
  ) {
    FakeWorker.started++;
  }
  postMessage(request: ProbeRequest): void {
    if (this.mode === "hang") return;
    if (this.mode === "error") {
      setTimeout(() => this.onerror?.(new Event("error")), 0);
      return;
    }
    void runProbe(this.env, request).then((report) =>
      this.onmessage?.({ data: { t: "probe-result", report } } as MessageEvent<ProbeResponse>),
    );
  }
  terminate(): void {
    this.terminated = true;
  }
}

function makeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

function iphoneGlobals(overrides: Partial<ProbeGlobals> = {}): ProbeGlobals {
  return {
    navigator: {
      userAgent: IPHONE_UA,
      platform: "iPhone",
      maxTouchPoints: 5,
      canShare: (data) => data.files.every((f) => f.type === "video/mp4"),
    },
    Worker: function Worker() {},
    WebAssembly: {},
    VideoEncoder: function VideoEncoder() {},
    VideoFrame: function VideoFrame() {},
    AudioEncoder: function AudioEncoder() {},
    AudioData: function AudioData() {},
    AudioDecoder: function AudioDecoder() {},
    MediaRecorder: { isTypeSupported: (t: string) => t.startsWith("video/mp4") },
    File,
    matchMedia: () => ({ matches: true }),
    document: {
      createElement: () =>
        ({
          width: 0,
          height: 0,
          getContext: () => ({
            fenceSync: () => ({}),
            clientWaitSync: () => 0,
            getBufferSubData: () => undefined,
            PIXEL_PACK_BUFFER: 0x88eb,
            getExtension: () => ({ loseContext: () => undefined }),
          }),
        }) as unknown as HTMLCanvasElement,
    },
    ...overrides,
  };
}

function options(extra: Partial<ProbeOptions> = {}, env = workerEnv()): ProbeOptions {
  return {
    globals: iphoneGlobals(),
    createWorker: () => new FakeWorker(env),
    measureHz: async () => 60,
    storage: makeStorage(),
    now: () => 1_000_000,
    ...extra,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("memoryClassFor (plan 6.5, 3a)", () => {
  it("uses deviceMemory on Chromium", () => {
    expect(memoryClassFor({ deviceMemory: 1, audioEncoderPresent: true })).toBe("low");
    expect(memoryClassFor({ deviceMemory: 2, audioEncoderPresent: true })).toBe("low");
    expect(memoryClassFor({ deviceMemory: 4, audioEncoderPresent: true })).toBe("mid");
    expect(memoryClassFor({ deviceMemory: 8, audioEncoderPresent: true })).toBe("high");
  });
  it("puts an iPhone with AudioEncoder in mid, an older iPhone in low", () => {
    expect(memoryClassFor({ platform: "iPhone", audioEncoderPresent: true })).toBe("mid");
    expect(memoryClassFor({ platform: "iPhone", audioEncoderPresent: false })).toBe("low");
  });
  it("puts every iPad in low, including iPadOS that reports MacIntel", () => {
    expect(memoryClassFor({ platform: "iPad", audioEncoderPresent: true })).toBe("low");
    expect(memoryClassFor({ platform: "MacIntel", maxTouchPoints: 5, audioEncoderPresent: true })).toBe("low");
  });
  it("puts unknown touch devices in low and unknown desktops in mid", () => {
    expect(memoryClassFor({ platform: "Linux armv8l", coarsePointer: true, audioEncoderPresent: false })).toBe("low");
    expect(memoryClassFor({ platform: "MacIntel", maxTouchPoints: 0, audioEncoderPresent: true })).toBe("mid");
  });
});

describe("selectTier (plan 5)", () => {
  const base = {
    worker: true,
    videoEncoderH264: true,
    audioEncoderAac: true,
    webAssembly: true,
    mediaRecorderMp4: true,
    mediaRecorderWebm: true,
  };
  it("W, W+, M, V and none", () => {
    expect(selectTier(base)).toBe("W");
    expect(selectTier({ ...base, audioEncoderAac: false })).toBe("W+");
    expect(selectTier({ ...base, videoEncoderH264: false })).toBe("M");
    expect(selectTier({ ...base, videoEncoderH264: false, mediaRecorderMp4: false })).toBe("V");
    expect(
      selectTier({ ...base, videoEncoderH264: false, mediaRecorderMp4: false, mediaRecorderWebm: false }),
    ).toBe("none");
  });
  it("needs a worker for W, and WebAssembly for W+", () => {
    expect(selectTier({ ...base, worker: false })).toBe("M");
    expect(selectTier({ ...base, audioEncoderAac: false, webAssembly: false })).toBe("M");
  });
});

describe("quick probes", () => {
  it("reads presence, MediaRecorder types, canShare and memory class", () => {
    const q = quickProbes(iphoneGlobals());
    expect(q).toEqual({
      worker: true,
      webAssembly: true,
      videoEncoder: true,
      videoFrame: true,
      audioEncoder: true,
      audioData: true,
      audioDecoder: true,
      mediaRecorderMp4: true,
      mediaRecorderWebm: false,
      shareFiles: true,
      memoryClass: "mid",
    });
  });
  it("survives throwing APIs and missing objects", () => {
    const q = quickProbes({
      navigator: {
        canShare: () => {
          throw new Error("no");
        },
      },
      MediaRecorder: {
        isTypeSupported: () => {
          throw new Error("no");
        },
      },
      File,
      matchMedia: () => {
        throw new Error("no");
      },
    });
    expect(q.shareFiles).toBe(false);
    expect(q.mediaRecorderMp4).toBe(false);
    expect(q.worker).toBe(false);
    expect(q.memoryClass).toBe("mid");
    expect(quickProbes({}).shareFiles).toBe(false);
  });
  it("checks WebGL2 async readback support and releases the context", () => {
    const lose = vi.fn();
    const withGl = iphoneGlobals({
      document: {
        createElement: () =>
          ({
            getContext: () => ({
              fenceSync: () => ({}),
              clientWaitSync: () => 0,
              getBufferSubData: () => undefined,
              PIXEL_PACK_BUFFER: 0x88eb,
              getExtension: () => ({ loseContext: lose }),
            }),
          }) as unknown as HTMLCanvasElement,
      },
    });
    expect(probeWebGL2Readback(withGl)).toBe(true);
    expect(lose).toHaveBeenCalledTimes(1);
    const noGl = iphoneGlobals({
      document: { createElement: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement },
    });
    expect(probeWebGL2Readback(noGl)).toBe(false);
    expect(probeWebGL2Readback({})).toBe(false);
  });
});

describe("probeCapabilityReport", () => {
  it("returns the contract's Capabilities for a W-tier iPhone", async () => {
    const caps = await probeCapabilities(options());
    expect(caps).toEqual({
      tier: "W",
      videoEncoderH264: true,
      h264Levels: ["1f", "20", "28"],
      hardwareEncoder: true,
      audioEncoderAac: true,
      audioData: true,
      audioDecoder: true,
      mediaRecorderMp4: true,
      mediaRecorderWebm: false,
      webgl2AsyncReadback: true,
      opfsSyncAccess: true,
      shareFiles: true,
      memoryClass: "mid",
      displayHz: 60,
    });
  });

  it("caches under a hash of the quick probes and the user agent, and re-probes on a change", async () => {
    const storage = makeStorage();
    FakeWorker.started = 0;
    const first = await probeCapabilityReport(options({ storage }));
    expect(first.fromCache).toBe(false);
    expect(storage.map.has(CAPS_CACHE_ITEM)).toBe(true);
    const second = await probeCapabilityReport(options({ storage }));
    expect(second.fromCache).toBe(true);
    expect(FakeWorker.started).toBe(1);
    expect(second.caps).toEqual(first.caps);
    // A browser update changes the user agent: probe again.
    const updated = iphoneGlobals({ navigator: { userAgent: IPHONE_UA + " X", platform: "iPhone" } });
    const third = await probeCapabilityReport(options({ storage, globals: updated }));
    expect(third.fromCache).toBe(false);
    expect(third.fingerprint).not.toBe(first.fingerprint);
    expect(FakeWorker.started).toBe(2);
  });

  it("probes again after 7 days, and when forced", async () => {
    const storage = makeStorage();
    FakeWorker.started = 0;
    await probeCapabilityReport(options({ storage, now: () => 0 }));
    await probeCapabilityReport(options({ storage, now: () => CACHE_MAX_AGE_MS - 1 }));
    expect(FakeWorker.started).toBe(1);
    await probeCapabilityReport(options({ storage, now: () => CACHE_MAX_AGE_MS + 1 }));
    expect(FakeWorker.started).toBe(2);
    const forced = await probeCapabilityReport(options({ storage, now: () => CACHE_MAX_AGE_MS + 2, force: true }));
    expect(forced.fromCache).toBe(false);
    expect(FakeWorker.started).toBe(3);
  });

  it("ignores a corrupt cache entry", async () => {
    const storage = makeStorage();
    storage.map.set(CAPS_CACHE_ITEM, "{not json");
    const r = await probeCapabilityReport(options({ storage }));
    expect(r.fromCache).toBe(false);
  });

  it("runs the probe in window scope when the worker fails, and does not cache that", async () => {
    const storage = makeStorage();
    const failures: string[] = [];
    const fallback = vi.fn((req: ProbeRequest) => runProbe({ ...workerEnv(), scope: "window" }, req));
    const r = await probeCapabilityReport(
      options({
        storage,
        createWorker: () => new FakeWorker(workerEnv(), "error"),
        fallbackProbe: fallback,
        onWorkerFailure: (why) => failures.push(why),
      }),
    );
    expect(r.probeScope).toBe("window");
    expect(r.caps.videoEncoderH264).toBe(true);
    // OPFS sync handles only exist in a worker.
    expect(r.caps.opfsSyncAccess).toBe(false);
    expect(failures).toEqual(["worker error"]);
    expect(storage.map.has(CAPS_CACHE_ITEM)).toBe(false);
  });

  it("falls back when the worker cannot start or never answers", async () => {
    vi.useFakeTimers();
    const fallback = (req: ProbeRequest) => runProbe({ ...workerEnv(), scope: "window" }, req);
    const hung = new FakeWorker(workerEnv(), "hang");
    const pending = probeCapabilityReport(options({ createWorker: () => hung, fallbackProbe: fallback, workerTimeoutMs: 1000 }));
    await vi.advanceTimersByTimeAsync(1500);
    const r = await pending;
    expect(r.probeScope).toBe("window");
    expect(hung.terminated).toBe(true);
    vi.useRealTimers();
    const none = await probeCapabilityReport(options({ createWorker: () => null, fallbackProbe: fallback }));
    expect(none.probeScope).toBe("window");
    const throws = await probeCapabilityReport(
      options({
        createWorker: () => {
          throw new Error("bundler");
        },
        fallbackProbe: fallback,
      }),
    );
    expect(throws.probeScope).toBe("window");
  });

  it("uses 60 Hz when the display rate cannot be measured (hidden tab)", async () => {
    vi.useFakeTimers();
    const pending = probeCapabilityReport(options({ measureHz: () => new Promise(() => undefined) }));
    await vi.advanceTimersByTimeAsync(2500);
    expect((await pending).caps.displayHz).toBe(60);
  });

  it("reports the measured display rate", async () => {
    const caps = await probeCapabilities(options({ measureHz: async () => 120 }));
    expect(caps.displayHz).toBe(120);
  });

  it("gives tier W+ when native AAC is missing (older Safari), M when H.264 encode fails", async () => {
    const wPlus = await probeCapabilities(options({}, workerEnv({ AudioEncoder: undefined })));
    expect(wPlus.tier).toBe("W+");
    const m = await probeCapabilities(
      options({}, workerEnv({ VideoEncoder: makeVideoEncoder({ codecs: new Set(), hardware: true, software: true, portrait: true }) })),
    );
    expect(m.tier).toBe("M");
    expect(m.videoEncoderH264).toBe(false);
  });

  it("works with storage turned off", async () => {
    const r = await probeCapabilityReport(options({ storage: null }));
    expect(r.fromCache).toBe(false);
  });
});

describe("chooseVideoEncoder (plan 5.1)", () => {
  async function reportFor(env = workerEnv()): Promise<CapabilityReport> {
    return probeCapabilityReport(options({}, env));
  }

  it("hardware, tall, 30 fps 2D: 720x1280 High 3.1 at 2 Mbps, quality latency", async () => {
    const plan = chooseVideoEncoder(await reportFor(), { width: 720, height: 1280, targetFps: 30, orientation: "tall" }, "2d");
    expect(plan).toEqual({
      video: {
        codec: "avc1.64001f",
        width: 720,
        height: 1280,
        bitrate: 2_000_000,
        framerate: 30,
        latencyMode: "quality",
        hardwareAcceleration: "prefer-hardware",
      },
      rotation: 0,
      software: false,
    });
  });

  it("60 fps when level 3.2 probe-encoded, at 3.5 Mbps", async () => {
    const plan = chooseVideoEncoder(await reportFor(), { width: 1280, height: 720, targetFps: 60, orientation: "wide" }, "2d");
    expect(plan?.video).toMatchObject({ codec: "avc1.640020", framerate: 60, bitrate: 3_500_000, width: 1280, height: 720 });
  });

  it("30 fps when level 3.2 did not encode", async () => {
    const env = workerEnv({
      VideoEncoder: makeVideoEncoder({ codecs: allCodecs(["1f", "28"]), hardware: true, software: true, portrait: true }),
    });
    const plan = chooseVideoEncoder(await reportFor(env), { width: 1280, height: 720, targetFps: 60, orientation: "wide" }, "2d");
    expect(plan?.video.framerate).toBe(30);
  });

  it("software only: one size step down and at most 30 fps", async () => {
    const env = workerEnv({
      VideoEncoder: makeVideoEncoder({ codecs: allCodecs(), hardware: false, software: true, portrait: true }),
    });
    const plan = chooseVideoEncoder(await reportFor(env), { width: 720, height: 1280, targetFps: 60, orientation: "tall" }, "2d");
    expect(plan).toMatchObject({ software: true, rotation: 0 });
    expect(plan?.video).toMatchObject({ width: 540, height: 960, framerate: 30, hardwareAcceleration: "no-preference" });
    expect(plan?.video.bitrate).toBeGreaterThanOrEqual(1_000_000);
  });

  it("rotates into a landscape coded frame when portrait is rejected", async () => {
    const env = workerEnv({
      VideoEncoder: makeVideoEncoder({ codecs: allCodecs(), hardware: true, software: true, portrait: false }),
    });
    const plan = chooseVideoEncoder(await reportFor(env), { width: 720, height: 1280, targetFps: 30, orientation: "tall" }, "3d");
    expect(plan).toMatchObject({ rotation: 90 });
    expect(plan?.video).toMatchObject({ width: 1280, height: 720, bitrate: 3_000_000 });
  });

  it("returns null without a WebCodecs H.264 encoder", async () => {
    const env = workerEnv({ VideoEncoder: undefined });
    expect(chooseVideoEncoder(await reportFor(env), { width: 720, height: 1280, targetFps: 30, orientation: "tall" }, "2d")).toBeNull();
  });
});

describe("fnv1a", () => {
  it("is stable and spreads", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    expect(fnv1a("hello")).not.toBe(fnv1a("hellp"));
  });
});
