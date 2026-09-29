// @vitest-environment node
/**
 * Engine selection (plan 5): tier M or V gets the MediaRecorder engine with
 * the probe's report, inside the engine switch; every other tier gets the
 * WebCodecs engine, whose prepare() reuses the probe and whose later arms
 * probe again. When a fresh probe at a MediaRecorder arm finds tier W or W+
 * (the first probe met a cold or busy encoder), the switch moves the game to
 * the WebCodecs engine: its game, start level, pause reasons and sources.
 */
import { describe, expect, it, vi } from "vitest";
import type { CapabilityReport } from "../../runtime/capabilities";
import type { CaptureEngine, EngineEvent } from "../engine";
import { EngineSwitch, loadCaptureEngine, probeOnceFrom, type TierChange } from "../loadEngine";
import { FakeEngine } from "./fakeEngine";

function report(tier: "W" | "W+" | "M" | "V" | "none", fingerprint = "first"): CapabilityReport {
  return { caps: { tier }, fingerprint } as unknown as CapabilityReport;
}

const engine = (name: string) => ({ name }) as unknown as CaptureEngine;

describe("loadCaptureEngine", () => {
  it.each(["M", "V"] as const)("tier %s: the MediaRecorder engine, with the probe's report, inside the engine switch", async (tier) => {
    const probe = vi.fn(async () => report(tier));
    const recorder = new FakeEngine();
    const loadRecorderEngine = vi.fn(async () => recorder as CaptureEngine);
    const loadHostEngine = vi.fn(async () => engine("host"));
    const chosen = await loadCaptureEngine({ probe, loadRecorderEngine, loadHostEngine });
    expect(chosen).toBeInstanceOf(EngineSwitch);
    expect((chosen as EngineSwitch).current).toBe(recorder);
    expect(loadRecorderEngine).toHaveBeenCalledWith(report(tier), expect.any(Function));
    expect(loadHostEngine).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it.each(["W", "W+", "none"] as const)("tier %s: the WebCodecs engine, with no switch", async (tier) => {
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

  it("the tier change the MediaRecorder engine asks for loads the WebCodecs engine with the fresh report, and moves to it", async () => {
    const recorder = new FakeEngine();
    recorder.prepared = { tier: "M", supported: true };
    const host = new FakeEngine();
    host.prepared = { tier: "W", supported: true };
    let asked: TierChange | null = null;
    let hostProbe: ((options: { force?: boolean }) => Promise<CapabilityReport>) | null = null;
    const chosen = (await loadCaptureEngine({
      probe: async () => report("M"),
      loadRecorderEngine: async (_report, onTierChange) => {
        asked = onTierChange;
        return recorder;
      },
      loadHostEngine: async (p) => {
        hostProbe = p;
        return host;
      },
    })) as EngineSwitch;
    expect(await asked!(report("W", "fresh"))).toBe(true);
    expect(chosen.current).toBe(host);
    expect(recorder.disposed).toBe(true);
    // The WebCodecs engine's prepare() gets the fresh report; its arms probe again.
    expect((await hostProbe!({})).fingerprint).toBe("fresh");
  });
});

describe("EngineSwitch", () => {
  function world() {
    const first = new FakeEngine();
    const engineSwitch = new EngineSwitch(first);
    const events: EngineEvent[] = [];
    engineSwitch.subscribe((event) => events.push(event));
    return { first, engineSwitch, events };
  }

  it("forwards every call to the engine that runs now, and its events to the service", async () => {
    const { first, engineSwitch, events } = world();
    engineSwitch.setGame({ appId: "snake", gameName: "Snake", emoji: "🐍" });
    engineSwitch.setStartLevel(2);
    engineSwitch.setPaused("break", true);
    const canvas = {} as HTMLCanvasElement;
    const unregister = engineSwitch.registerCanvas(canvas);
    expect(first.game?.appId).toBe("snake");
    expect(first.startLevel).toBe(2);
    expect([...first.paused]).toEqual(["break"]);
    expect(first.canvases.has(canvas)).toBe(true);
    first.mediaEnd = 42;
    expect(engineSwitch.mediaEndUs()).toBe(42);
    engineSwitch.purge();
    expect(first.purges).toBe(1);
    expect(events).toContainEqual({ t: "source", present: true });
    unregister();
    expect(first.canvases.size).toBe(0);
  });

  it("moves the game, the start level, the pause reasons and the sources to the new engine, and says so", async () => {
    const { first, engineSwitch, events } = world();
    engineSwitch.setGame({ appId: "snake", gameName: "Snake", emoji: "🐍" });
    engineSwitch.setStartLevel(1);
    engineSwitch.setPaused("hidden", true);
    engineSwitch.setPaused("owner", true);
    engineSwitch.setPaused("owner", false);
    const canvas = {} as HTMLCanvasElement;
    const root = {} as Element;
    const stopCanvas = engineSwitch.registerCanvas(canvas, { targetFps: 60 });
    engineSwitch.autoDiscover(root);
    const next = new FakeEngine();
    next.prepared = { tier: "W+", supported: true };
    expect(await engineSwitch.switchTo(async () => next)).toBe(true);
    expect(engineSwitch.current).toBe(next);
    expect(first.disposed).toBe(true);
    expect(first.canvases.size).toBe(0);
    expect(next.game?.appId).toBe("snake");
    expect(next.startLevel).toBe(1);
    expect([...next.paused]).toEqual(["hidden"]);
    expect(next.canvases.has(canvas)).toBe(true);
    expect(next.canvases.has(root)).toBe(true);
    expect(events).toContainEqual({ t: "tier", tier: "W+" });
    // The old engine says nothing more; the new one is heard.
    const before = events.length;
    first.emit({ t: "output" });
    expect(events).toHaveLength(before);
    next.emit({ t: "output" });
    expect(events.at(-1)).toEqual({ t: "output" });
    // An unregister function from before the switch unregisters from the new engine.
    stopCanvas();
    expect(next.canvases.has(canvas)).toBe(false);
  });

  it("keeps the engine when the new one cannot capture (or does not load), and disposes the new one", async () => {
    const { first, engineSwitch, events } = world();
    const next = new FakeEngine();
    next.prepared = { tier: "W", supported: false };
    expect(await engineSwitch.switchTo(async () => next)).toBe(false);
    expect(engineSwitch.current).toBe(first);
    expect(next.disposed).toBe(true);
    expect(first.disposed).toBe(false);
    expect(await engineSwitch.switchTo(async () => Promise.reject(new Error("no chunk")))).toBe(false);
    expect(events.filter((e) => e.t === "tier")).toEqual([]);
  });

  it("dispose() disposes the engine that runs, and a later switch does nothing", async () => {
    const { first, engineSwitch } = world();
    engineSwitch.dispose();
    expect(first.disposed).toBe(true);
    const next = new FakeEngine();
    expect(await engineSwitch.switchTo(async () => next)).toBe(false);
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
