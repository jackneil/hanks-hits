/**
 * The lab's service loader (lab/labService.ts) does the same load as
 * ClipProvider: the clips flag first, then the service, and only when the
 * flag turns capture on (plan 4.1). The service module is counted, so a
 * test sees whether its dynamic import ran at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => ({ verdict: { mode: "on", capture: true } as { mode: string; capture: boolean } }));
vi.mock("../../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config")>();
  return { ...actual, loadClipsVerdict: vi.fn(async () => flag.verdict) };
});

const loads = vi.hoisted(() => ({ service: 0, engine: 0, started: { name: "the tab's service" } }));
vi.mock("../../service/ClipService", () => {
  loads.service++;
  return { startClipService: vi.fn(() => loads.started) };
});

// ?aac=wasm: the engine loader and the probe, counted and faked.
const engine = vi.hoisted(() => ({ made: { name: "the capture engine" }, probeOptions: [] as unknown[] }));
vi.mock("../../service/loadEngine", () => {
  loads.engine++;
  return { loadCaptureEngine: vi.fn(async () => engine.made) };
});
vi.mock("../../runtime/capabilities", () => ({
  probeCapabilityReport: vi.fn(async (options: unknown) => {
    engine.probeOptions.push(options);
    return {
      caps: { tier: "W", audioEncoderAac: true, videoEncoderH264: true },
      audio: { aac: true, reason: null, description: "native" },
      video: { ok: true },
    };
  }),
}));

beforeEach(() => {
  vi.resetModules();
  loads.service = 0;
  loads.engine = 0;
  engine.probeOptions = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadLabService", () => {
  it("returns null and never loads the service while the flag is off", async () => {
    flag.verdict = { mode: "off", capture: false };
    const { loadLabService } = await import("../labService");
    await expect(loadLabService()).resolves.toBeNull();
    expect(loads.service).toBe(0);
  });

  it("starts the tab's clip service when the flag turns capture on", async () => {
    flag.verdict = { mode: "on", capture: true };
    const { loadLabService } = await import("../labService");
    await expect(loadLabService()).resolves.toBe(loads.started);
    expect(loads.service).toBe(1);
    const { startClipService } = await import("../../service/ClipService");
    expect(startClipService).toHaveBeenCalledTimes(1);
  });

  it("dogfood mode for a visitor who is not in the dogfood list: no capture, no service", async () => {
    flag.verdict = { mode: "dogfood", capture: false };
    const { loadLabService } = await import("../labService");
    await expect(loadLabService()).resolves.toBeNull();
    expect(loads.service).toBe(0);
  });
});

describe("?aac=wasm (loadLabServiceWasmAac)", () => {
  it("picks the loader from the lab options", async () => {
    const { labServiceLoader, loadLabService, loadLabServiceWasmAac } = await import("../labService");
    expect(labServiceLoader({ aac: "auto" })).toBe(loadLabService);
    expect(labServiceLoader({ aac: "wasm" })).toBe(loadLabServiceWasmAac);
  });

  it("starts the service with an engine whose every probe masks native AAC (tier W+, WASM AAC in the worker)", async () => {
    flag.verdict = { mode: "on", capture: true };
    const { loadLabServiceWasmAac } = await import("../labService");
    await expect(loadLabServiceWasmAac()).resolves.toBe(loads.started);
    const { startClipService } = await import("../../service/ClipService");
    const deps = vi.mocked(startClipService).mock.calls[0][0] as { loadEngine: () => Promise<unknown> };
    // The engine loads only when the service asks for it (a game registers a canvas).
    expect(loads.engine).toBe(0);
    await expect(deps.loadEngine()).resolves.toBe(engine.made);
    const { loadCaptureEngine } = await import("../../service/loadEngine");
    const probe = vi.mocked(loadCaptureEngine).mock.calls[0][0]!.probe!;
    for (const options of [{}, { force: true }]) {
      const report = await probe(options);
      expect(report.caps).toMatchObject({ tier: "W+", audioEncoderAac: false, videoEncoderH264: true });
      expect(report.audio.aac).toBe(false);
    }
    expect(engine.probeOptions).toEqual([{}, { force: true }]);
  });

  it("loads nothing while the flag is off", async () => {
    flag.verdict = { mode: "off", capture: false };
    const { loadLabServiceWasmAac } = await import("../labService");
    await expect(loadLabServiceWasmAac()).resolves.toBeNull();
    expect(loads.service).toBe(0);
    expect(loads.engine).toBe(0);
  });

  it("wasmAacOnly keeps tiers M and V, and only W becomes W+", async () => {
    const { wasmAacOnly } = await import("../labService");
    const base = { caps: { tier: "M", audioEncoderAac: false }, audio: { aac: false, reason: null, description: "none" } } as never;
    expect(wasmAacOnly(base).caps.tier).toBe("M");
    const plus = { caps: { tier: "W+", audioEncoderAac: false }, audio: { aac: false, reason: null, description: "none" } } as never;
    expect(wasmAacOnly(plus).caps.tier).toBe("W+");
  });
});
