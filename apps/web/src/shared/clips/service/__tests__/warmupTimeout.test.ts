import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CAPTURE_LOCK } from "../lifecycle";
import { EngineSwitch } from "../loadEngine";
import { FakeEngine } from "./fakeEngine";
import { disposeWorlds, flush, gameAttachment, makeWorld, press } from "./serviceWorld";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { disposeWorlds(); vi.useRealTimers(); });

async function warming(options: Parameters<typeof makeWorld>[0] = {}) {
  const w = makeWorld(options);
  const game = w.service.attach(gameAttachment(w));
  await flush();
  const off = game.registerCanvas(document.createElement("canvas"));
  return { ...w, game, off };
}
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const rested = { button: "resting", engine: "resting", reason: "warmup-timeout", bufferedSec: 0 };

describe("bounded encoder warm-up", () => {
  it.each([false, true])("rests at 15 seconds without output (bridge=%s), then explicitly retries", async (bridge) => {
    const w = await warming();
    await advance(10_000);
    if (bridge) w.engine.emit({ t: "no-output" });
    await advance(4_999);
    expect(w.service.getSnapshot().button).toBe("warming");
    await advance(1);
    expect(w.service.getSnapshot()).toMatchObject(rested);
    expect(w.engine.disarms).toBe(1);
    expect(w.engine.canvases.size).toBe(0);
    expect(press(w, 10)).toEqual({ kind: "menu" });
    w.engine.emit({ t: "output" });
    w.engine.emit({ t: "encoder-error", fatal: true });
    w.game.registerCanvas(document.createElement("canvas"));
    await advance(30_000);
    expect(w.service.getSnapshot()).toMatchObject(rested);
    expect(w.engine.canvases.size).toBe(0);
    w.service.wake();
    expect(w.engine.canvases.size).toBe(2);
    expect(w.engine.halted).toBe(false);
    expect(w.service.getSnapshot().button).toBe("warming");
    w.engine.emit({ t: "output" });
    w.engine.play(5);
    await advance(30_000);
    expect(w.service.getSnapshot().button).toBe("ready");
    expect(w.engine.disarms).toBe(1);
  });

  it("gives each explicit retry a fresh, bounded budget", async () => {
    const w = await warming();
    await advance(15_000);
    w.service.wake();
    await advance(14_999);
    expect(w.service.getSnapshot().button).toBe("warming");
    await advance(1);
    expect(w.service.getSnapshot()).toMatchObject(rested);
    expect(w.engine.disarms).toBe(2);
  });

  it("retries a pre-session stall whose disarm emits no reset, with no leaked registration", async () => {
    const w = await warming();
    vi.spyOn(w.engine, "disarm").mockImplementation(() => { w.engine.disarms++; w.engine.halted = true; });
    await advance(15_000);
    expect(w.engine.canvases.size).toBe(0);
    w.service.wake();
    expect(w.service.getSnapshot().button).toBe("warming");
    expect(w.engine.canvases.size).toBe(1);
    await advance(14_999);
    expect(w.engine.disarms).toBe(1);
    await advance(1);
    expect(w.service.getSnapshot()).toMatchObject(rested);
    expect(w.engine.canvases.size).toBe(0);
    expect(w.engine.disarms).toBe(2);
  });

  it("keeps the retry-required reason when another tab takes capture after timeout", async () => {
    const w = await warming();
    await advance(15_000);
    void w.locks.client("other").request(CAPTURE_LOCK, { steal: true }, () => new Promise(() => undefined)).catch(() => undefined);
    await flush();
    expect(w.service.getSnapshot()).toMatchObject({ button: "suspended", reason: "warmup-timeout" });
    const clip = vi.spyOn(w.engine, "clip");
    expect(press(w, 10)).toEqual({ kind: "menu" });
    expect(clip).not.toHaveBeenCalled();
    w.service.wake();
    await advance(60_000);
    expect(w.engine.disarms).toBe(1);
    expect(w.engine.paused.has("other-tab")).toBe(true);
  });

  it.each(["break", "hidden"] as const)("does not charge time while %s", async (reason) => {
    const w = await warming();
    const pause = (value: boolean) => {
      if (reason === "break") w.game.setAtBreak(value);
      else {
        w.doc.visibilityState = value ? "hidden" : "visible";
        w.doc.dispatchEvent(new Event("visibilitychange"));
      }
    };
    await advance(6_000);
    pause(true);
    await advance(60_000);
    expect(w.engine.disarms).toBe(0);
    pause(false);
    await flush();
    await advance(8_999);
    expect(w.engine.disarms).toBe(0);
    await advance(1);
    expect(w.service.getSnapshot()).toMatchObject(rested);
  });

  it("does not charge time while another tab owns capture", async () => {
    const w = await warming();
    await advance(6_000);
    let release!: () => void;
    void w.locks.client("other").request(CAPTURE_LOCK, { steal: true }, () => new Promise<void>((done) => { release = done; })).catch(() => undefined);
    await flush();
    await advance(60_000);
    expect(w.engine.disarms).toBe(0);
    release();
    w.doc.dispatchEvent(new Event("visibilitychange"));
    w.win.dispatchEvent(new Event("focus"));
    await flush();
    expect(w.engine.paused.has("other-tab")).toBe(false);
    await advance(8_999);
    expect(w.engine.disarms).toBe(0);
    await advance(1);
    expect(w.service.getSnapshot()).toMatchObject(rested);
  });

  it("does not charge a bfcache restore while the owner read is pending", async () => {
    const w = await warming();
    await advance(6_000);
    w.offline.value = true;
    w.win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    await advance(60_000);
    expect(w.engine.disarms).toBe(0);
    expect(w.engine.paused.has("owner")).toBe(true);
    w.offline.value = false;
    w.doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(w.engine.paused.has("owner")).toBe(false);
    await advance(8_999);
    expect(w.engine.disarms).toBe(0);
    await advance(1);
    expect(w.service.getSnapshot()).toMatchObject(rested);
  });

  it("refuses capture actions and preserves retry while exporting an existing saved clip", async () => {
    const w = await warming();
    await advance(15_000);
    expect(await w.service.clipLast()).toMatchObject({ ok: false, reason: "warmup-timeout" });
    expect(await w.service.startRecording()).toMatchObject({ ok: false, reason: "warmup-timeout" });
    expect(await w.service.takePicture()).toMatchObject({ ok: false, reason: "warmup-timeout" });
    expect(w.engine.recordings).toHaveLength(0);
    await w.service.runExport(async () => "saved-file");
    await advance(3_000);
    expect(w.service.getSnapshot()).toMatchObject(rested);
    w.service.wake();
    expect(w.engine.canvases.size).toBe(1);
  });

  it("cancels on first output and leaves normal governor rest/wake intact", async () => {
    const w = await warming();
    await advance(14_999);
    w.engine.emit({ t: "output" });
    w.engine.play(5);
    await advance(60_000);
    expect(w.engine.disarms).toBe(0);
    w.engine.emit({ t: "governor", level: { kind: "resting", k: 0, fps: 0, scale: 0.5, keepSeconds: null }, resting: true });
    expect(w.service.getSnapshot().reason).toBe("resting");
    w.service.wake();
    expect(w.engine.wakes).toBe(1);
  });

  it("resets after source loss, and cancels on detach and dispose", async () => {
    const w = await warming();
    await advance(14_999);
    w.off();
    await advance(30_000);
    expect(w.engine.disarms).toBe(0);
    w.game.registerCanvas(document.createElement("canvas"));
    await advance(14_999);
    expect(w.engine.disarms).toBe(0);
    w.game.detach();
    await advance(1);
    const game = w.service.attach(gameAttachment(w, { appId: "snake" }));
    await flush();
    game.registerCanvas(document.createElement("canvas"));
    const disarms = w.engine.disarms;
    await advance(14_999);
    expect(w.engine.disarms).toBe(disarms);
    w.service.dispose();
    await advance(30_000);
    expect(w.engine.disarms).toBe(disarms);
  });

  it.each([false, true])("does not replay sources into a late engine upgrade; retry before completion=%s", async (retryEarly) => {
    let wrapper!: EngineSwitch;
    const w = await warming({ wrapEngine: (engine) => (wrapper = new EngineSwitch(engine)) });
    const next = new FakeEngine();
    let resolve!: (engine: FakeEngine) => void;
    const pending = wrapper.switchTo(() => new Promise<FakeEngine>((done) => { resolve = done; }));
    await advance(15_000);
    expect(w.service.getSnapshot()).toMatchObject(rested);
    if (retryEarly) w.service.wake();
    resolve(next);
    expect(await pending).toBe(true);
    expect(next.canvases.size).toBe(retryEarly ? 1 : 0);
    if (!retryEarly) {
      expect(w.service.getSnapshot()).toMatchObject(rested);
      w.service.wake();
    }
    expect(next.canvases.size).toBe(1);
    next.emit({ t: "output" });
    next.play(5);
    expect(w.service.getSnapshot().button).toBe("ready");
  });
});
