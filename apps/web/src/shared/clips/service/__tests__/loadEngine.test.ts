// @vitest-environment node
/**
 * Engine selection (plan 5): tier M or V gets the MediaRecorder engine with
 * the probe's report; every other tier gets the WebCodecs engine, whose
 * prepare() reuses the probe and whose later arms probe again.
 */
import { describe, expect, it, vi } from "vitest";
import type { CapabilityReport } from "../../runtime/capabilities";
import type { CaptureEngine } from "../engine";
import { loadCaptureEngine, probeOnceFrom } from "../loadEngine";

function report(tier: "W" | "W+" | "M" | "V" | "none", fingerprint = "first"): CapabilityReport {
  return { caps: { tier }, fingerprint } as unknown as CapabilityReport;
}

const engine = (name: string) => ({ name }) as unknown as CaptureEngine;

describe("loadCaptureEngine", () => {
  it.each(["M", "V"] as const)("tier %s: the MediaRecorder engine, with the probe's report", async (tier) => {
    const probe = vi.fn(async () => report(tier));
    const loadRecorderEngine = vi.fn(async () => engine("recorder"));
    const loadHostEngine = vi.fn(async () => engine("host"));
    const chosen = await loadCaptureEngine({ probe, loadRecorderEngine, loadHostEngine });
    expect(chosen).toEqual({ name: "recorder" });
    expect(loadRecorderEngine).toHaveBeenCalledWith(report(tier));
    expect(loadHostEngine).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it.each(["W", "W+", "none"] as const)("tier %s: the WebCodecs engine", async (tier) => {
    const probe = vi.fn(async () => report(tier));
    const loadRecorderEngine = vi.fn(async () => engine("recorder"));
    let given: ((options: { force?: boolean }) => Promise<CapabilityReport>) | null = null;
    const loadHostEngine = vi.fn(async (p: (options: { force?: boolean }) => Promise<CapabilityReport>) => {
      given = p;
      return engine("host");
    });
    expect(await loadCaptureEngine({ probe, loadRecorderEngine, loadHostEngine })).toEqual({ name: "host" });
    expect(loadRecorderEngine).not.toHaveBeenCalled();
    // prepare() gets the same report without a second probe.
    expect(await given!({})).toEqual(report(tier));
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("a probe that fails fails the load (the service then shows no clip button)", async () => {
    await expect(loadCaptureEngine({ probe: async () => Promise.reject(new Error("no window")) })).rejects.toThrow("no window");
  });
});

describe("probeOnceFrom", () => {
  it("gives the kept report once, then probes for real; a forced probe always probes", async () => {
    const real = vi.fn(async (options: { force?: boolean }) => report("W", options.force ? "forced" : "again"));
    const probe = probeOnceFrom(report("W"), real);
    expect((await probe({})).fingerprint).toBe("first");
    expect(real).not.toHaveBeenCalled();
    expect((await probe({})).fingerprint).toBe("again");
    expect((await probe({ force: true })).fingerprint).toBe("forced");
    const forcedFirst = probeOnceFrom(report("W"), real);
    expect((await forcedFirst({ force: true })).fingerprint).toBe("forced");
    // The kept report is gone after a forced probe.
    expect((await forcedFirst({})).fingerprint).toBe("again");
  });
});
