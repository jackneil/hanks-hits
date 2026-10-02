import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClipRecord } from "../../protocol";
import { CrashBreaker, TAB_LOCK_PREFIX } from "../breaker";
import {
  FAILURES_TO_DISABLE,
  OWNER_RETRY_MS,
  RESULT_POST_ROLL_MS,
  RING_KEEP_MS,
  getClipService,
  resetClipServiceForTests,
  startClipService,
  type ServiceIo,
} from "../ClipService";
import {
  DEFAULT_CLIP_SECONDS,
  EXTEND_WINDOW_MS,
  HIDDEN_SNAPSHOT,
  HOLD_FOR_MENU_MS,
  type AttachedGame,
  type ClipLibraryApi,
} from "../contract";
import { EngineFailure } from "../engine";
import { CAPTURE_LOCK, GUEST_KEEP_MS, RESUME_GRACE_MS } from "../lifecycle";
import { ERROR_MS, MADE_MS, RECOVERING_QUIET_MS, SOURCE_LOST_GRACE_MS } from "../machine";
import { FakeEngine } from "./fakeEngine";
import {
  disposeWorlds,
  flush,
  gameAttachment,
  keyOf,
  makeWorld,
  press,
  ready,
  recordOf,
  resultOf,
  type World,
} from "./serviceWorld";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  disposeWorlds();
  resetClipServiceForTests();
  vi.useRealTimers();
});

describe("snapshots (useSyncExternalStore)", () => {
  it("starts hidden, serves the hidden snapshot to the server, and binds its store methods", () => {
    const w = makeWorld();
    const { subscribe, getSnapshot, getServerSnapshot } = w.service;
    expect(getSnapshot()).toBe(HIDDEN_SNAPSHOT);
    expect(getServerSnapshot()).toBe(HIDDEN_SNAPSHOT);
    const stop = subscribe(() => undefined);
    expect(typeof stop).toBe("function");
    stop();
  });

  it("keeps the same frozen object until a field changes, then bumps the version", async () => {
    const w = makeWorld();
    const heard = vi.fn();
    w.service.subscribe(heard);
    await ready(w);
    const a = w.service.getSnapshot();
    expect(Object.isFrozen(a)).toBe(true);
    w.service.refreshGame();
    w.engine.emit({ t: "buffered", seconds: 5 });
    expect(w.service.getSnapshot()).toBe(a);
    const calls = heard.mock.calls.length;
    w.engine.emit({ t: "buffered", seconds: 6 });
    const b = w.service.getSnapshot();
    expect(b).not.toBe(a);
    expect(b.version).toBe(a.version + 1);
    expect(b.bufferedSec).toBe(6);
    expect(heard.mock.calls.length).toBe(calls + 1);
  });
});

describe("attach and tiers", () => {
  it("shows Warming while the engine loads, then follows the engine", async () => {
    const w = makeWorld();
    w.service.attach(gameAttachment(w));
    // A game plays until a break source (start card, pause menu, its own isPlaying) says otherwise.
    expect(w.service.getSnapshot()).toMatchObject({ button: "warming", reason: "warming", appId: "breakout", atBreak: false });
    await flush();
    expect(w.service.getSnapshot()).toMatchObject({ button: "warming", engine: "idle", tier: "W" });
    expect(w.engine.game?.appId).toBe("breakout");
  });

  it("hides the button with no-tier on a device the engine cannot serve (tiers M and V for now)", async () => {
    const w = makeWorld();
    w.engine.prepared = { tier: "M", supported: false };
    const game = w.service.attach(gameAttachment(w));
    await flush();
    game.registerCanvas(document.createElement("canvas"));
    expect(w.service.getSnapshot()).toMatchObject({ button: "hidden", reason: "no-tier", tier: "M" });
    expect(w.engine.canvases.size).toBe(0);
  });

  it("forwards canvases registered before the engine was ready", async () => {
    const w = makeWorld();
    const game = w.service.attach(gameAttachment(w));
    const off = game.registerCanvas(document.createElement("canvas"));
    expect(w.engine.canvases.size).toBe(0);
    await flush();
    expect(w.engine.canvases.size).toBe(1);
    off();
    expect(w.engine.canvases.size).toBe(0);
  });

  it("detaches: sources go, the button hides, and the ring is kept 5 min, then purged", async () => {
    const w = makeWorld();
    const game = await ready(w);
    game.detach();
    expect(w.service.getSnapshot()).toMatchObject({ button: "hidden", appId: null, engine: "idle" });
    expect(w.engine.canvases.size).toBe(0);
    await vi.advanceTimersByTimeAsync(RING_KEEP_MS - 1);
    expect(w.engine.purges).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.engine.purges).toBe(1);
    expect(w.engine.disarms).toBe(1);
  });

  it("starts a different game from an empty ring: Warming until its own output", async () => {
    const w = makeWorld();
    const first = await ready(w);
    first.detach();
    const second = w.service.attach(gameAttachment(w, { appId: "snake", gameName: "Snake", emoji: "🐍" }));
    await flush();
    second.setAtBreak(false);
    second.registerCanvas(document.createElement("canvas"));
    expect(w.engine.purges).toBe(1);
    expect(w.service.getSnapshot()).toMatchObject({ appId: "snake", engine: "warming", button: "warming" });
    expect(press(w, 100)).toEqual({ kind: "ignored", reason: "warming" });
    w.engine.emit({ t: "output" });
    w.engine.play(3);
    expect(w.service.getSnapshot().button).toBe("ready");
  });

  it("does not hand a canvas to the engine before the breaker allows the game", async () => {
    const w = makeWorld();
    await ready(w);
    w.service.attach(gameAttachment(w, { appId: "snake" })).registerCanvas(document.createElement("canvas"));
    // The engine still has only the first game's canvas until startGame ran.
    expect(w.engine.game?.appId).toBe("breakout");
    expect(w.engine.canvases.size).toBe(0);
    await flush();
    expect(w.engine.game?.appId).toBe("snake");
    expect(w.engine.canvases.size).toBe(1);
  });

  it("keeps the ring when the same game comes back within 5 min", async () => {
    const w = makeWorld();
    const game = await ready(w);
    game.detach();
    await vi.advanceTimersByTimeAsync(60_000);
    const again = w.service.attach(gameAttachment(w));
    await flush();
    await vi.advanceTimersByTimeAsync(RING_KEEP_MS);
    expect(w.engine.purges).toBe(0);
    again.detach();
  });
});

describe("plan 7 transitions driven by the service", () => {
  it("IDLE -> WARMING -> BUFFERING: a source, then output", async () => {
    const w = makeWorld();
    const game = w.service.attach(gameAttachment(w));
    await flush();
    game.setAtBreak(false);
    game.registerCanvas(document.createElement("canvas"));
    expect(w.service.getSnapshot().engine).toBe("warming");
    w.engine.emit({ t: "output" });
    expect(w.service.getSnapshot().engine).toBe("buffering");
  });

  it("WARMING -> BRIDGED -> BUFFERING: no output after 2.5 s, then hardware output", async () => {
    const w = makeWorld();
    const game = w.service.attach(gameAttachment(w));
    await flush();
    game.setAtBreak(false);
    game.registerCanvas(document.createElement("canvas"));
    w.engine.emit({ t: "no-output" });
    expect(w.service.getSnapshot()).toMatchObject({ engine: "bridged", button: "warming" });
    w.engine.emit({ t: "output" });
    expect(w.service.getSnapshot().engine).toBe("buffering");
  });

  it("fills the warming ring over 3 s of footage", async () => {
    const w = makeWorld();
    const game = w.service.attach(gameAttachment(w));
    await flush();
    game.setAtBreak(false);
    game.registerCanvas(document.createElement("canvas"));
    w.engine.emit({ t: "output" });
    w.engine.play(1.5);
    expect(w.service.getSnapshot()).toMatchObject({ button: "warming", warmProgress: 0.5 });
    w.engine.play(1.5);
    expect(w.service.getSnapshot()).toMatchObject({ button: "ready", warmProgress: 1 });
  });

  it("BUFFERING <-> SUSPENDED: hidden and visible (visible pauses keep the encoder)", async () => {
    const w = makeWorld();
    await ready(w);
    w.doc.visibilityState = "hidden";
    w.doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(w.service.getSnapshot()).toMatchObject({ engine: "suspended", button: "suspended", reason: "hidden" });
    expect(w.engine.paused.has("hidden")).toBe(true);
    expect(w.engine.closed).toEqual([]);
    w.doc.visibilityState = "visible";
    w.doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(w.service.getSnapshot().engine).toBe("buffering");
    expect(w.engine.paused.has("hidden")).toBe(false);
  });

  it("closes the encoders at once when hidden on iOS (plan 7.1)", async () => {
    const w = makeWorld({ closesOnHide: true });
    await ready(w);
    w.doc.visibilityState = "hidden";
    w.doc.dispatchEvent(new Event("visibilitychange"));
    expect(w.engine.paused.has("hidden")).toBe(true);
    expect(w.engine.closed).toEqual(["hidden"]);
  });

  it("BUFFERING -> SUSPENDED at a break (start card, pause menu), and back when play resumes", async () => {
    const w = makeWorld();
    const game = await ready(w);
    game.setAtBreak(true);
    expect(w.service.getSnapshot()).toMatchObject({ engine: "suspended", atBreak: true });
    expect(w.engine.paused.has("break")).toBe(true);
    game.setAtBreak(false);
    expect(w.service.getSnapshot()).toMatchObject({ engine: "buffering", atBreak: false });
  });

  it("keeps capturing the result card for the post-roll after a run ends, then suspends", async () => {
    const w = makeWorld();
    const game = await ready(w);
    game.runPhase("end");
    game.setAtBreak(true);
    expect(w.service.getSnapshot().engine).toBe("buffering");
    expect(w.engine.paused.has("break")).toBe(false);
    await vi.advanceTimersByTimeAsync(RESULT_POST_ROLL_MS);
    expect(w.service.getSnapshot().engine).toBe("suspended");
    expect(w.engine.paused.has("break")).toBe(true);
  });

  it("BUFFERING -> SOURCE_LOST -> BUFFERING when the canvas comes back within 1.5 s, with the button unchanged", async () => {
    const w = makeWorld();
    const game = await ready(w);
    const [canvas] = [...w.engine.canvases];
    w.engine.canvases.delete(canvas);
    w.engine.emit({ t: "source", present: false });
    expect(w.service.getSnapshot()).toMatchObject({ engine: "source-lost", button: "ready" });
    expect(w.engine.paused.has("source")).toBe(true);
    await vi.advanceTimersByTimeAsync(SOURCE_LOST_GRACE_MS - 100);
    game.registerCanvas(document.createElement("canvas"));
    expect(w.service.getSnapshot()).toMatchObject({ engine: "buffering", button: "ready" });
    expect(w.engine.paused.has("source")).toBe(false);
  });

  it("SOURCE_LOST -> IDLE after the grace: the ring empties for the kid and warms up again", async () => {
    const w = makeWorld();
    const game = await ready(w);
    const [canvas] = [...w.engine.canvases];
    w.engine.canvases.delete(canvas);
    w.engine.emit({ t: "source", present: false });
    await vi.advanceTimersByTimeAsync(SOURCE_LOST_GRACE_MS);
    expect(w.service.getSnapshot()).toMatchObject({ engine: "idle", button: "source-lost", reason: "source-lost" });
    game.registerCanvas(document.createElement("canvas"));
    expect(w.service.getSnapshot()).toMatchObject({ engine: "buffering", button: "warming", warmProgress: 0 });
    w.engine.play(3);
    expect(w.service.getSnapshot().button).toBe("ready");
  });

  it("BUFFERING -> RECOVERING -> BUFFERING: an encoder error, then a new epoch; the button waits 3 s", async () => {
    const w = makeWorld();
    await ready(w);
    vi.advanceTimersByTime(RESUME_GRACE_MS);
    w.engine.emit({ t: "encoder-error", fatal: false });
    expect(w.service.getSnapshot()).toMatchObject({ engine: "recovering", button: "ready" });
    await vi.advanceTimersByTimeAsync(RECOVERING_QUIET_MS);
    expect(w.service.getSnapshot()).toMatchObject({ button: "recovering", reason: "encoder-error" });
    w.engine.emit({ t: "recovered" });
    expect(w.service.getSnapshot()).toMatchObject({ engine: "buffering", button: "ready" });
  });

  it("RECOVERING -> DISABLED after 4 failures in 60 s", async () => {
    const w = makeWorld();
    await ready(w);
    vi.advanceTimersByTime(RESUME_GRACE_MS);
    for (let i = 0; i < FAILURES_TO_DISABLE - 1; i++) {
      w.engine.emit({ t: "encoder-error", fatal: false });
      w.engine.emit({ t: "recovered" });
      vi.advanceTimersByTime(10_000);
    }
    expect(w.service.getSnapshot().engine).toBe("buffering");
    w.engine.emit({ t: "encoder-error", fatal: false });
    expect(w.service.getSnapshot()).toMatchObject({ engine: "disabled", button: "disabled", reason: "encoder-error" });
    expect(w.engine.disarms).toBe(1);
  });

  it("does not count failures older than 60 s, nor failures right after the page shows again", async () => {
    const w = makeWorld();
    await ready(w);
    vi.advanceTimersByTime(RESUME_GRACE_MS);
    for (let i = 0; i < 6; i++) {
      w.engine.emit({ t: "encoder-error", fatal: false });
      w.engine.emit({ t: "recovered" });
      vi.advanceTimersByTime(25_000);
    }
    expect(w.service.getSnapshot().engine).toBe("buffering");
    // Resume grace: hidden and back, then errors at once.
    w.doc.visibilityState = "hidden";
    w.doc.dispatchEvent(new Event("visibilitychange"));
    w.doc.visibilityState = "visible";
    w.doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    for (let i = 0; i < 6; i++) {
      w.engine.emit({ t: "encoder-error", fatal: false });
      w.engine.emit({ t: "recovered" });
    }
    expect(w.service.getSnapshot().engine).toBe("buffering");
  });

  it("BUFFERING -> RESTING -> BUFFERING: the governor rests capture; wake() is the probe", async () => {
    const w = makeWorld();
    await ready(w);
    w.engine.emit({ t: "governor", level: { kind: "resting", k: 0, fps: 0, scale: 0.5, keepSeconds: null }, resting: true });
    expect(w.service.getSnapshot()).toMatchObject({ engine: "resting", button: "resting", reason: "resting", preRest: true });
    w.service.wake();
    expect(w.engine.wakes).toBe(1);
    expect(w.service.getSnapshot()).toMatchObject({ engine: "buffering", preRest: false });
  });

  it("BUFFERING -> RECORDING -> BUFFERING: Record and Stop", async () => {
    const w = makeWorld();
    await ready(w);
    expect(await w.service.startRecording()).toBeNull();
    expect(w.service.getSnapshot()).toMatchObject({ engine: "recording", button: "recording" });
    w.engine.play(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.service.getSnapshot().recording).toMatchObject({ elapsedSec: 2, stars: 0 });
    const result = await w.service.stopRecording();
    expect(result).toMatchObject({ ok: true, action: "record", record: { kind: "record" } });
    expect(w.service.getSnapshot()).toMatchObject({ engine: "buffering", recording: null, unwatchedClipId: result.ok ? result.record.id : null });
  });

  it("RESTING -> RECORDING -> RESTING: Record at the low-power rung, Stop goes back to resting", async () => {
    const w = makeWorld();
    await ready(w);
    w.engine.emit({ t: "governor", level: { kind: "resting", k: 0, fps: 0, scale: 0.5, keepSeconds: null }, resting: true });
    await w.service.startRecording();
    expect(w.service.getSnapshot()).toMatchObject({ engine: "recording", button: "recording" });
    await w.service.stopRecording();
    expect(w.service.getSnapshot().engine).toBe("resting");
  });

  it("RECORDING -> RESTING on a severe governor decision: the recording goes on", async () => {
    const w = makeWorld();
    await ready(w);
    await w.service.startRecording();
    w.engine.emit({ t: "governor", level: { kind: "resting", k: 0, fps: 0, scale: 0.5, keepSeconds: null }, resting: true });
    expect(w.service.getSnapshot()).toMatchObject({ engine: "resting", button: "recording" });
    expect(w.engine.recordings[0].stopped).toBe(false);
  });

  it("RECORDING -> SUSPENDED when hidden: the recording is finalized and kept", async () => {
    const w = makeWorld();
    await ready(w);
    await w.service.startRecording();
    w.doc.visibilityState = "hidden";
    w.doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(w.service.getSnapshot()).toMatchObject({ engine: "suspended", recording: null });
    expect(w.engine.recordings[0].stopped).toBe(true);
    expect(w.service.getSnapshot().lastResult).toMatchObject({ ok: true, action: "record" });
  });

  it("RECORDING -> RECOVERING on an encoder error: the part is closed and kept", async () => {
    const w = makeWorld();
    await ready(w);
    await w.service.startRecording();
    w.engine.emit({ t: "encoder-error", fatal: false });
    await flush();
    expect(w.service.getSnapshot().engine).toBe("recovering");
    expect(w.engine.recordings[0].stopped).toBe(true);
  });

  it("RECORDING -> SOURCE_LOST when the canvas goes: the part is finalized", async () => {
    const w = makeWorld();
    await ready(w);
    await w.service.startRecording();
    const [canvas] = [...w.engine.canvases];
    w.engine.canvases.delete(canvas);
    w.engine.emit({ t: "source", present: false });
    await flush();
    expect(w.service.getSnapshot().engine).toBe("source-lost");
    expect(w.engine.recordings[0].stopped).toBe(true);
  });

  it("BUFFERING -> EXPORTING -> BUFFERING: an export closes the live encoder and resumes on a new epoch", async () => {
    const w = makeWorld();
    await ready(w);
    let during = "";
    await w.service.runExport(async () => {
      during = w.service.getSnapshot().engine;
      expect(w.service.getSnapshot().button).toBe("exporting");
      expect(w.engine.paused.has("export")).toBe(true);
    });
    expect(during).toBe("exporting");
    expect(w.engine.closed).toEqual(["export"]);
    expect(w.service.getSnapshot().engine).toBe("buffering");
    expect(w.engine.paused.has("export")).toBe(false);
  });

  it("BUFFERING -> IDLE on an owner change that purges (user to another user)", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    await w.service.setSessionUser("kid-2");
    expect(w.engine.purges).toBe(1);
    // Straight on to warm-up again with the new owner's footage only.
    expect(w.service.getSnapshot()).toMatchObject({ engine: "buffering", button: "warming" });
    expect(w.io.setOwnerKey).toHaveBeenLastCalledWith(await keyOf("kid-2"));
  });

  it("IDLE -> DISABLED when the breaker saw two crashes in 7 days", async () => {
    const w = makeWorld();
    for (const dead of ["x1", "x2"]) {
      const other = new CrashBreaker({ storage: w.storage, locks: w.locks.client(dead), now: () => Date.now(), tabLock: `${TAB_LOCK_PREFIX}${dead}` });
      await other.begin("breakout");
      other.setCapturing("breakout", true);
      w.locks.crash(dead);
      await flush();
      // Another tab starts the game and counts the crash.
      const check = new CrashBreaker({ storage: w.storage, locks: w.locks.client(`c-${dead}`), now: () => Date.now(), tabLock: `${TAB_LOCK_PREFIX}c-${dead}` });
      await check.begin("breakout");
    }
    const game = w.service.attach(gameAttachment(w));
    await flush();
    game.registerCanvas(document.createElement("canvas"));
    expect(w.service.getSnapshot()).toMatchObject({ engine: "disabled", button: "disabled", reason: "breaker" });
    expect(w.engine.canvases.size).toBe(0);
  });

  it("starts one rung lower after one crash", async () => {
    const w = makeWorld();
    const other = new CrashBreaker({ storage: w.storage, locks: w.locks.client("x1"), now: () => Date.now(), tabLock: `${TAB_LOCK_PREFIX}x1` });
    await other.begin("breakout");
    other.setCapturing("breakout", true);
    w.locks.crash("x1");
    await flush();
    w.service.attach(gameAttachment(w));
    await flush();
    expect(w.engine.startLevel).toBe(1);
  });

  it("marks the breaker while it captures, and not while suspended", async () => {
    const w = makeWorld();
    const game = await ready(w);
    const key = [...w.storage.items.keys()].find((k) => k.includes("breakout"))!;
    expect(JSON.parse(w.storage.getItem(key)!).open[0].capturing).toBe(true);
    game.setAtBreak(true);
    expect(JSON.parse(w.storage.getItem(key)!).open[0].capturing).toBe(false);
    game.detach();
    expect(w.storage.getItem(key)).toBeNull();
  });

  it("suspends with reason other-tab while another tab holds the capture lock", async () => {
    const w = makeWorld();
    await ready(w);
    const other = w.locks.client("t2");
    // Another tab takes the lock (it holds it until it closes).
    void other.request(CAPTURE_LOCK, { steal: true }, () => new Promise(() => undefined)).catch(() => undefined);
    await flush();
    expect(w.service.getSnapshot()).toMatchObject({ button: "suspended", reason: "other-tab" });
    expect(w.engine.paused.has("other-tab")).toBe(true);
  });
});

describe("tap semantics (plan 11.1)", () => {
  it("a short tap commits a clip of the last 30 s ending where the press began", async () => {
    const w = makeWorld();
    await ready(w);
    w.engine.play(20);
    const token = w.service.beginPress()!;
    expect(token.endAtUs).toBe(25_000_000);
    w.engine.play(1);
    vi.advanceTimersByTime(300);
    const outcome = w.service.endPress(token, { upAtMs: Date.now(), moved: false });
    expect(outcome.kind).toBe("clip");
    const result = await resultOf(outcome);
    expect(result).toMatchObject({ ok: true, action: "clip" });
    expect(w.engine.clipRequests[0]).toMatchObject({ seconds: DEFAULT_CLIP_SECONDS, endAtUs: 25_000_000 });
    expect(w.rows.size).toBe(1);
  });

  it("a 600 ms hold opens the menu and leaves zero new library rows", async () => {
    const w = makeWorld();
    await ready(w);
    const token = w.service.beginPress()!;
    vi.advanceTimersByTime(600);
    const outcome = w.service.endPress(token, { upAtMs: Date.now(), moved: false });
    expect(outcome).toEqual({ kind: "menu" });
    await flush();
    expect(w.engine.clipRequests).toHaveLength(0);
    expect(w.rows.size).toBe(0);
    // The menu row "Clip the last 30 seconds" uses the frozen end of the press.
    w.engine.play(3);
    await w.service.clipLast(30, token);
    expect(w.engine.clipRequests[0]).toMatchObject({ seconds: 30, endAtUs: token.endAtUs });
    expect(w.rows.size).toBe(1);
  });

  it("the hold limit is HOLD_FOR_MENU_MS: 499 ms clips, 500 ms opens the menu", async () => {
    const w = makeWorld();
    await ready(w);
    expect(press(w, HOLD_FOR_MENU_MS - 1).kind).toBe("clip");
    await flush();
    vi.advanceTimersByTime(EXTEND_WINDOW_MS + 1000);
    expect(press(w, HOLD_FOR_MENU_MS).kind).toBe("menu");
  });

  it("a hold that moved still clips", async () => {
    const w = makeWorld();
    await ready(w);
    expect(press(w, 900, { moved: true }).kind).toBe("clip");
  });

  it.each([
    ["a 100 ms", 100],
    ["a 700 ms", 700],
    ["a 499 ms", HOLD_FOR_MENU_MS - 1],
    ["a 500 ms", HOLD_FOR_MENU_MS],
  ])("%s cancelled press commits nothing and lets the token go", async (_label, heldMs) => {
    const w = makeWorld();
    await ready(w);
    w.engine.play(10);
    const before = w.service.getSnapshot();
    const token = w.service.beginPress()!;
    w.engine.play(1);
    vi.advanceTimersByTime(heldMs);
    const outcome = w.service.endPress(token, { upAtMs: Date.now(), moved: false, cancelled: true });
    expect(outcome).toEqual({ kind: "ignored", reason: "cancelled" });
    await flush();
    // Nothing is committed: no clip job, no row, no saving, no result, no chip.
    expect(w.engine.clipRequests).toHaveLength(0);
    expect(w.rows.size).toBe(0);
    const after = w.service.getSnapshot();
    expect(after.button).toBe("ready");
    expect(after.savingProgress).toBeNull();
    expect(after.lastResult).toBe(before.lastResult);
    expect(after.unwatchedClipId).toBeNull();
    // The token is let go: the next tap inside the extend window is a new
    // clip, not an extend of a clip that the cancel never made.
    vi.advanceTimersByTime(1000);
    const next = press(w, 100);
    expect(next.kind).toBe("clip");
    await resultOf(next);
    expect(w.rows.size).toBe(1);
  });

  it("a released token keeps its frozen end for the Capture menu row", async () => {
    const w = makeWorld();
    await ready(w);
    w.engine.play(10);
    const token = w.service.beginPress()!;
    w.engine.play(4);
    expect(w.service.endPress(token, { upAtMs: token.downAtMs, moved: false, cancelled: true }).kind).toBe("ignored");
    await flush();
    expect(w.rows.size).toBe(0);
    await w.service.clipLast(DEFAULT_CLIP_SECONDS, token);
    expect(w.engine.clipRequests).toHaveLength(1);
    expect(w.engine.clipRequests[0]).toMatchObject({ endAtUs: token.endAtUs });
    expect(w.rows.size).toBe(1);
  });

  it("tap, tap within 5 s, then tap after 6 s gives two library rows", async () => {
    const w = makeWorld();
    await ready(w);
    w.engine.play(30);
    const first = await resultOf(press(w, 100));
    vi.advanceTimersByTime(2000);
    w.engine.play(2);
    const secondOutcome = press(w, 100);
    expect(secondOutcome.kind).toBe("extend");
    const second = await resultOf(secondOutcome);
    expect(second).toMatchObject({ ok: true, action: "extend" });
    // The longer clip reaches back to where the first one began.
    const [firstReq, secondReq] = w.engine.clipRequests;
    const firstStart = (firstReq.endAtUs ?? 0) - firstReq.seconds * 1e6;
    expect((secondReq.endAtUs ?? 0) - secondReq.seconds * 1e6).toBeCloseTo(firstStart, -3);
    expect(w.library.remove).toHaveBeenCalledWith(first.ok ? first.record.id : "");
    vi.advanceTimersByTime(6000);
    w.engine.play(6);
    const third = press(w, 100);
    expect(third.kind).toBe("clip");
    await resultOf(third);
    expect(w.rows.size).toBe(2);
  });

  it("ignores a tap while the clip saves (plan 11.3), and extends once it is stored", async () => {
    const w = makeWorld();
    await ready(w);
    w.engine.play(30);
    let release: () => void = () => undefined;
    const base = w.engine.clipResult;
    w.engine.clipResult = async (req) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      w.engine.clipResult = base;
      return base(req);
    };
    const first = press(w, 100);
    expect(w.service.getSnapshot().button).toBe("saving");
    expect(press(w, 100)).toEqual({ kind: "ignored", reason: "busy" });
    release();
    await resultOf(first);
    vi.advanceTimersByTime(1000);
    const second = press(w, 100);
    expect(second.kind).toBe("extend");
    expect(await resultOf(second)).toMatchObject({ ok: true, action: "extend" });
    expect(w.rows.size).toBe(1);
  });

  it("ignores taps while warming, saving or recording, and opens the menu while resting", async () => {
    const w = makeWorld();
    const game = w.service.attach(gameAttachment(w));
    await flush();
    game.setAtBreak(false);
    game.registerCanvas(document.createElement("canvas"));
    expect(press(w, 100)).toEqual({ kind: "ignored", reason: "warming" });
    w.engine.emit({ t: "output" });
    w.engine.play(5);
    let release: () => void = () => undefined;
    const base = w.engine.clipResult;
    w.engine.clipResult = async (req) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return base(req);
    };
    const saving = press(w, 100);
    expect(w.service.getSnapshot().button).toBe("saving");
    expect(press(w, 100)).toEqual({ kind: "ignored", reason: "busy" });
    release();
    await resultOf(saving);
    w.engine.clipResult = base;
    vi.advanceTimersByTime(EXTEND_WINDOW_MS + 1);
    await w.service.startRecording();
    expect(press(w, 100)).toEqual({ kind: "ignored", reason: "busy" });
    await w.service.stopRecording();
    vi.advanceTimersByTime(ERROR_MS);
    w.engine.emit({ t: "governor", level: { kind: "resting", k: 0, fps: 0, scale: 0.5, keepSeconds: null }, resting: true });
    expect(press(w, 100)).toEqual({ kind: "menu" });
  });

  it("shows Made for 1.2 s, then Ready", async () => {
    const w = makeWorld();
    await ready(w);
    await resultOf(press(w, 100));
    expect(w.service.getSnapshot()).toMatchObject({ button: "made", savingProgress: null });
    expect(w.service.getSnapshot().unwatchedClipId).not.toBeNull();
    await vi.advanceTimersByTimeAsync(MADE_MS - 1);
    expect(w.service.getSnapshot().button).toBe("made");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.service.getSnapshot().button).toBe("ready");
  });

  it("shows Error with its reason for 3 s after a failed clip", async () => {
    const w = makeWorld();
    await ready(w);
    w.engine.clipResult = async () => {
      throw new EngineFailure("quota", "full");
    };
    const result = await resultOf(press(w, 100));
    expect(result).toMatchObject({ ok: false, action: "clip", reason: "quota" });
    expect(w.service.getSnapshot()).toMatchObject({ button: "error", reason: "quota", lastResult: result });
    expect(press(w, 100)).toEqual({ kind: "ignored", reason: "quota" });
    await vi.advanceTimersByTimeAsync(ERROR_MS);
    expect(w.service.getSnapshot().button).toBe("ready");
  });

  it("clips the pre-pause footage while suspended", async () => {
    const w = makeWorld();
    const game = await ready(w);
    game.setAtBreak(true);
    expect(w.service.getSnapshot().button).toBe("suspended");
    expect(press(w, 100).kind).toBe("clip");
  });

  it("gives a moment inside the clip its offset from the clip start", async () => {
    const w = makeWorld();
    const game = await ready(w);
    w.engine.play(20);
    game.markMoment({ kind: "new-best", label: "New best", emoji: "🏆", priority: "featured", offsetSec: -2 });
    w.engine.play(1);
    const result = await resultOf(press(w, 100));
    const record = result.ok ? result.record : null;
    // The clip spans 26 - 30 = -4 s (clamped to 0) .. 26 s; the moment is at 23 s.
    expect(record?.moments).toEqual([{ kind: "new-best", label: "New best", emoji: "🏆", priority: "featured", offsetSec: 23 }]);
  });
});

describe("Record, stars, pictures, watched", () => {
  it("puts each star into the recording part it falls in", async () => {
    const w = makeWorld();
    await ready(w);
    await w.service.startRecording();
    w.engine.play(2);
    w.service.addStar();
    w.engine.play(3);
    w.service.addStar();
    expect(w.service.getSnapshot().recording?.stars).toBe(2);
    const result = await w.service.stopRecording();
    expect(result.ok).toBe(true);
    const id = result.ok ? result.record.id : "";
    expect(w.io.update).toHaveBeenCalledWith(id, {
      moments: [
        { kind: "custom", label: "Star", emoji: "⭐", priority: "standard", offsetSec: 2 },
        { kind: "custom", label: "Star", emoji: "⭐", priority: "standard", offsetSec: 5 },
      ],
    });
  });

  it("fails Record with its reason when the engine cannot start it", async () => {
    const w = makeWorld();
    await ready(w);
    w.engine.recordStart = async () => {
      throw new EngineFailure("storage-unavailable", "no library");
    };
    expect(await w.service.startRecording()).toMatchObject({ ok: false, action: "record", reason: "storage-unavailable" });
    expect(w.service.getSnapshot()).toMatchObject({ recording: null, engine: "buffering" });
  });

  it("takes a picture", async () => {
    const w = makeWorld();
    await ready(w);
    const result = await w.service.takePicture();
    expect(result).toMatchObject({ ok: true, action: "picture", record: { kind: "picture", gameId: "breakout" } });
  });

  it("clears the new-clip chip when that clip is watched, and saves the watched flag", async () => {
    const w = makeWorld();
    await ready(w);
    const result = await resultOf(press(w, 100));
    const id = result.ok ? result.record.id : "";
    w.service.markWatched("some-other-clip");
    expect(w.service.getSnapshot().unwatchedClipId).toBe(id);
    w.service.markWatched(id);
    expect(w.service.getSnapshot().unwatchedClipId).toBeNull();
    expect(w.library.markWatched).toHaveBeenCalledWith(id);
  });
});

describe("share, save and names (plan 12)", () => {
  it("pauses a game that can pause, then shares the file synchronously", async () => {
    const w = makeWorld();
    await ready(w);
    const file = new File([new Uint8Array(1)], "a.mp4", { type: "video/mp4" });
    const pending = w.service.share(file);
    expect(w.paused).toBe(1);
    expect(w.shared).toEqual([file]);
    expect(await pending).toEqual({ kind: "shared" });
  });

  it("names a file from the deployment host", () => {
    const w = makeWorld();
    const record = { gameId: "snake", createdAt: new Date(2026, 8, 28, 9, 7).getTime(), mime: "video/mp4" } as ClipRecord;
    expect(w.service.fileNameFor(record)).toBe("hankshits-com-snake-20260928-0907.mp4");
  });
});

describe("owners (plan 7.1)", () => {
  it("keeps a guest run when sign-in completes within 60 s of its end", async () => {
    const w = makeWorld();
    const game = await ready(w);
    game.runPhase("end");
    vi.advanceTimersByTime(30_000);
    await w.service.setSessionUser("kid-1");
    expect(w.engine.purges).toBe(0);
    expect(w.service.getSnapshot().button).toBe("ready");
  });

  it("purges a guest run when sign-in comes later than 60 s", async () => {
    const w = makeWorld();
    const game = await ready(w);
    game.runPhase("end");
    vi.advanceTimersByTime(61_000);
    await w.service.setSessionUser("kid-1");
    expect(w.engine.purges).toBe(1);
  });

  it("purges on sign-out (user to guest)", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    await w.service.setSessionUser(null);
    expect(w.engine.purges).toBe(1);
  });

  it("pauses at a bfcache restore until the owner is read, and purges when it changed", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    w.userId.value = "kid-2";
    const show = new Event("pageshow") as Event & { persisted: boolean };
    Object.defineProperty(show, "persisted", { value: true });
    w.win.dispatchEvent(show);
    expect(w.engine.paused.has("owner")).toBe(true);
    await flush();
    expect(w.engine.purges).toBe(1);
    expect(w.engine.paused.has("owner")).toBe(false);
  });

  it("keeps the ring at a bfcache restore with the same owner", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    w.userId.value = "kid-1";
    const show = new Event("pageshow") as Event & { persisted: boolean };
    Object.defineProperty(show, "persisted", { value: true });
    w.win.dispatchEvent(show);
    await flush();
    expect(w.engine.purges).toBe(0);
    expect(w.service.getSnapshot().button).toBe("ready");
  });
});

describe("breaks and runs", () => {
  it("captures for a game that only registers its canvas (no break source ever speaks)", async () => {
    const w = makeWorld();
    const game = w.service.attach(gameAttachment(w));
    await flush();
    game.registerCanvas(document.createElement("canvas"));
    w.engine.emit({ t: "output" });
    w.engine.play(5);
    expect(w.service.getSnapshot()).toMatchObject({ engine: "buffering", button: "ready", atBreak: false });
    expect(w.engine.paused.has("break")).toBe(false);
  });

  it("parks the engine at detach: no live encoder or audio tap while the ring is kept", async () => {
    const w = makeWorld();
    const game = await ready(w);
    game.detach();
    expect(w.engine.parks).toBe(1);
    // The ring is still there for the same game (no purge, no disarm yet).
    expect(w.engine.purges).toBe(0);
    expect(w.engine.disarms).toBe(0);
  });
});

describe("the run's own clips (plan 11.4, decision D1)", () => {
  /** A first run of 40 s, a restart, and a second run of `seconds` that ended; the result chip's frozen end. */
  async function secondRunOver(seconds: number) {
    const w = makeWorld();
    const game = await ready(w); // the first run starts at 0 and plays 5 s
    w.engine.play(35);
    game.runPhase("end");
    w.engine.play(3); // the post-roll on the result card
    game.runPhase("start");
    const startUs = w.engine.mediaEnd;
    w.engine.play(seconds);
    game.runPhase("end");
    const endUs = w.engine.mediaEnd;
    game.setAtBreak(true);
    await flush();
    const token = w.service.beginPress()!;
    w.service.endPress(token, { upAtMs: token.downAtMs, moved: false, cancelled: true });
    return { w, game, token, startUs, endUs };
  }

  it("a press token carries the latest run's span on the capture timeline", async () => {
    const w = makeWorld();
    const game = await ready(w);
    expect(w.service.beginPress()!.run).toEqual({ startUs: 0, endUs: null });
    w.engine.play(10);
    game.runPhase("end");
    expect(w.service.beginPress()!.run).toEqual({ startUs: 0, endUs: 15e6 });
    w.engine.play(2);
    game.runPhase("start");
    expect(w.service.beginPress()!.run).toEqual({ startUs: 17e6, endUs: null });
  });

  it('"whole" clips exactly the run: from its start (the bound) to its end, never the run before', async () => {
    const { w, token, startUs, endUs } = await secondRunOver(16);
    w.engine.play(5); // the kid stays on the result screen while capture runs on
    const result = await w.service.clipRun(token, "whole");
    expect(result.ok).toBe(true);
    expect(w.engine.clipRequests).toHaveLength(1);
    expect(w.engine.clipRequests[0]).toMatchObject({ seconds: 16, endAtUs: endUs, notBeforeUs: startUs });
    if (result.ok) expect(result.record.durationMs).toBe(16_000);
    expect(w.service.getSnapshot().unwatchedClipId).toBe(result.ok ? result.record.id : null);
  });

  it('"end" clips the last 30 s of a long run, and never reaches before a short run\'s start', async () => {
    const long = await secondRunOver(75);
    await long.w.service.clipRun(long.token, "end");
    expect(long.w.engine.clipRequests[0]).toMatchObject({ seconds: DEFAULT_CLIP_SECONDS, endAtUs: long.endUs, notBeforeUs: long.startUs });
    const short = await secondRunOver(16);
    await short.w.service.clipRun(short.token, "end");
    expect(short.w.engine.clipRequests[0]).toMatchObject({ seconds: 16, endAtUs: short.endUs, notBeforeUs: short.startUs });
  });

  it("ends at the frozen end when the run ended later than the press", async () => {
    const w = makeWorld();
    const game = await ready(w);
    w.engine.play(10);
    const token = w.service.beginPress()!; // the chip's end froze while the run still went on
    w.engine.play(1);
    game.runPhase("end");
    await w.service.clipRun(token, "whole");
    expect(w.engine.clipRequests[0]).toMatchObject({ seconds: 15, endAtUs: 15e6, notBeforeUs: 0 });
  });

  it("a run clip is not the last clip: a clip button tap after it makes a new clip, never an extend", async () => {
    const { w, token } = await secondRunOver(16);
    const run = await w.service.clipRun(token, "whole");
    expect(run.ok).toBe(true);
    const outcome = press(w, 100);
    expect(outcome.kind).toBe("clip");
    await resultOf(outcome);
    expect(w.engine.clipRequests).toHaveLength(2);
    expect(w.rows.size).toBe(2);
  });

  it("fails with warming for a token with no run, and in a state with no footage", async () => {
    const w = makeWorld();
    const game = w.service.attach(gameAttachment(w));
    await flush();
    game.registerCanvas(document.createElement("canvas"));
    w.engine.emit({ t: "output" });
    w.engine.play(20);
    const token = w.service.beginPress()!;
    expect(token.run).toBeNull();
    expect(await w.service.clipRun(token, "whole")).toMatchObject({ ok: false, reason: "warming" });
    expect(w.engine.clipRequests).toHaveLength(0);
  });

  it("a new capture timeline: a run that goes on starts at 0, an ended run's footage is gone", async () => {
    const w = makeWorld();
    const game = await ready(w);
    w.engine.play(10);
    expect(w.service.beginPress()!.run).toEqual({ startUs: 0, endUs: null });
    w.engine.play(4);
    game.runPhase("end");
    game.runPhase("start");
    expect(w.service.beginPress()!.run).toEqual({ startUs: 19e6, endUs: null });
    w.engine.disarm(); // the engine reset: a new timeline at 0, an empty ring
    await flush();
    expect(w.service.beginPress()!.run).toEqual({ startUs: 0, endUs: null });
    w.engine.play(6);
    game.runPhase("end");
    w.engine.disarm();
    await flush();
    expect(w.service.beginPress()!.run).toBeNull();
  });
});

describe("failures before the first output (plan 7: 4 in 60 s)", () => {
  async function warming(w: World): Promise<AttachedGame> {
    const game = w.service.attach(gameAttachment(w));
    await flush();
    game.registerCanvas(document.createElement("canvas"));
    expect(w.service.getSnapshot().engine).toBe("warming");
    vi.advanceTimersByTime(RESUME_GRACE_MS);
    return game;
  }

  it("goes WARMING -> RECOVERING on a failure, and on to BUFFERING at the first output", async () => {
    const w = makeWorld();
    await warming(w);
    w.engine.emit({ t: "encoder-error", fatal: true });
    expect(w.service.getSnapshot().engine).toBe("recovering");
    w.engine.emit({ t: "output" });
    expect(w.service.getSnapshot().engine).toBe("buffering");
  });

  it("reaches DISABLED after 4 fatal failures with no output, stops the engine and lets every source go", async () => {
    const w = makeWorld();
    const game = await warming(w);
    for (let i = 0; i < FAILURES_TO_DISABLE; i++) {
      w.engine.emit({ t: "encoder-error", fatal: true });
      w.engine.emit({ t: "reset" });
      vi.advanceTimersByTime(2000);
    }
    expect(w.service.getSnapshot()).toMatchObject({ engine: "disabled", button: "disabled", reason: "encoder-error" });
    // The engine is off for good: it never arms again for this game.
    expect(w.engine.disarms).toBe(1);
    expect(w.engine.halted).toBe(true);
    expect(w.engine.canvases.size).toBe(0);
    // A new canvas of the same game (a restart) never reaches the engine.
    game.registerCanvas(document.createElement("canvas"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.engine.canvases.size).toBe(0);
    expect(w.engine.halted).toBe(true);
    expect(w.service.getSnapshot().engine).toBe("disabled");
  });

  it("writes 'not capturing' to the breaker marker once capture is disabled", async () => {
    const w = makeWorld();
    await ready(w);
    vi.advanceTimersByTime(RESUME_GRACE_MS);
    const key = [...w.storage.items.keys()].find((k) => k.includes("breakout"))!;
    expect(JSON.parse(w.storage.getItem(key)!).open[0].capturing).toBe(true);
    for (let i = 0; i < FAILURES_TO_DISABLE; i++) {
      w.engine.emit({ t: "encoder-error", fatal: false });
      w.engine.emit({ t: "recovered" });
    }
    expect(w.service.getSnapshot().engine).toBe("disabled");
    // A later death of the tab (an iOS kill in the background) is not a capture crash.
    expect(JSON.parse(w.storage.getItem(key)!).open[0].capturing).toBe(false);
  });

  it("hides the button (no-tier) when the engine finds no encoder for the game's picture", async () => {
    const w = makeWorld();
    await warming(w);
    w.engine.emit({ t: "unavailable", reason: "no-encoder" });
    expect(w.service.getSnapshot()).toMatchObject({ button: "hidden", reason: "no-tier" });
  });

  it("disables capture when the engine gave up after failed arms in a row", async () => {
    const w = makeWorld();
    await warming(w);
    w.engine.emit({ t: "unavailable", reason: "failing" });
    expect(w.service.getSnapshot()).toMatchObject({ engine: "disabled", button: "disabled", reason: "encoder-error" });
  });
});

describe("export while the game is paused (plan 7)", () => {
  it("closes the live encoder from SUSPENDED (the game is at a break), then goes back to the break", async () => {
    const w = makeWorld();
    const game = await ready(w);
    game.setAtBreak(true);
    expect(w.service.getSnapshot().engine).toBe("suspended");
    let during = "";
    await w.service.runExport(async () => {
      during = w.service.getSnapshot().engine;
    });
    expect(during).toBe("exporting");
    expect(w.engine.closed).toEqual(["export"]);
    expect(w.service.getSnapshot().engine).toBe("suspended");
    expect(w.engine.paused.has("export")).toBe(false);
  });

  it("closes it from RESTING too, and from a recording", async () => {
    const w = makeWorld();
    await ready(w);
    w.engine.emit({ t: "governor", level: { kind: "resting", k: 0, fps: 0, scale: 0.5, keepSeconds: null }, resting: true });
    await w.service.runExport(async () => expect(w.service.getSnapshot().engine).toBe("exporting"));
    expect(w.service.getSnapshot().engine).toBe("resting");
    w.engine.emit({ t: "governor", level: { kind: "rung", k: 2, fps: 30, scale: 1, keepSeconds: null }, resting: false });
    await w.service.startRecording();
    await w.service.runExport(async () => expect(w.service.getSnapshot().engine).toBe("exporting"));
    expect(w.service.getSnapshot().engine).toBe("recording");
    expect(w.engine.closed).toEqual(["export", "export"]);
  });

  it("runs the task with nothing to close before capture started", async () => {
    const w = makeWorld();
    w.service.attach(gameAttachment(w));
    await flush();
    await w.service.runExport(async () => expect(w.service.getSnapshot().engine).toBe("idle"));
    expect(w.engine.closed).toEqual([]);
  });
});

describe("Record from a break (pause menu, result chip)", () => {
  it("enters RECORDING when play resumes, and Stop goes back to BUFFERING", async () => {
    const w = makeWorld();
    const game = await ready(w);
    game.setAtBreak(true);
    expect(await w.service.startRecording()).toBeNull();
    expect(w.service.getSnapshot()).toMatchObject({ engine: "suspended", button: "recording" });
    game.setAtBreak(false);
    expect(w.service.getSnapshot()).toMatchObject({ engine: "recording", button: "recording" });
    await w.service.stopRecording();
    expect(w.service.getSnapshot().engine).toBe("buffering");
  });

  it("reports every part of a long recording (never silent), with the failed count", async () => {
    const w = makeWorld();
    await ready(w);
    await w.service.startRecording();
    w.engine.play(200);
    const entry = w.engine.recordings[0];
    const part = (id: string, startUs: number, endUs: number) => ({ record: recordOf(entry.meta, id), startUs, endUs });
    entry.parts = [part(entry.meta.id, 5e6, 90e6), part(`${entry.meta.id}-p2`, 90e6, 170e6), part(`${entry.meta.id}-p3`, 170e6, 205e6)];
    const result = await w.service.stopRecording();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.id).toBe(entry.meta.id);
    expect(result.parts?.map((r) => r.id)).toEqual([entry.meta.id, `${entry.meta.id}-p2`, `${entry.meta.id}-p3`]);
    expect(result.failedParts).toBe(0);
    expect(w.service.getSnapshot().lastResult).toBe(result);
  });
});

describe("extend only replaces a clip it holds all of (plan 11.1)", () => {
  /** An engine clip that the ring bounds: a 30 s ring (every iPad), like the real clip assembler. */
  function ringOf(w: World, ringSec: number) {
    const base = w.engine.clipResult;
    w.engine.clipResult = async (request) => {
      const made = await base(request);
      const ringStartUs = Math.max(0, w.engine.mediaEnd - ringSec * 1e6);
      if (made.startUs >= ringStartUs) return made;
      const record = { ...made.record, durationMs: Math.round((made.endUs - ringStartUs) / 1000) };
      w.rows.set(record.id, record);
      return { ...made, record, startUs: ringStartUs };
    };
  }

  it("keeps both clips when a 30 s ring cannot reach the first clip's start", async () => {
    const w = makeWorld();
    await ready(w);
    ringOf(w, 30);
    w.engine.play(41.3);
    // The first clip: the last 30 s ([16.3, 46.3]).
    const first = await resultOf(press(w, 100));
    vi.advanceTimersByTime(4000);
    w.engine.play(4);
    const second = press(w, 100);
    expect(second.kind).toBe("extend");
    const result = await resultOf(second);
    // The ring starts at 20.3 s now: the longer clip would lose 4 s of the first one.
    expect(result).toMatchObject({ ok: true, action: "clip" });
    expect(w.library.remove).not.toHaveBeenCalled();
    expect(w.rows.size).toBe(2);
    expect(first.ok && w.rows.has(first.record.id)).toBe(true);
    expect(w.service.getSnapshot().unwatchedClipId).toBe(result.ok ? result.record.id : null);
  });

  it("keeps both clips when an encoder recovery cut the new clip to its newest epoch", async () => {
    const w = makeWorld();
    await ready(w);
    w.engine.play(40);
    const first = await resultOf(press(w, 100));
    vi.advanceTimersByTime(2000);
    w.engine.play(2);
    const base = w.engine.clipResult;
    w.engine.clipResult = async (request) => {
      const made = await base(request);
      // The clip assembler starts the clip after a different-avcC epoch (cutToNewestEpoch).
      return { ...made, startUs: made.endUs - 3e6 };
    };
    const result = await resultOf(press(w, 100));
    expect(result).toMatchObject({ ok: true, action: "clip" });
    expect(w.library.remove).not.toHaveBeenCalled();
    expect(first.ok && w.rows.has(first.record.id)).toBe(true);
  });

  it("still replaces the first clip when the ring holds all of it (60 s ring)", async () => {
    const w = makeWorld();
    await ready(w);
    ringOf(w, 60);
    w.engine.play(41.3);
    const first = await resultOf(press(w, 100));
    vi.advanceTimersByTime(4000);
    w.engine.play(4);
    expect(await resultOf(press(w, 100))).toMatchObject({ ok: true, action: "extend" });
    expect(w.library.remove).toHaveBeenCalledWith(first.ok ? first.record.id : "");
    expect(w.rows.size).toBe(1);
  });
});

describe("owner changes never leak a clip to the next player (plan 7.1, 8.1)", () => {
  it("a purge clears the last result, the chip and the made mark", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    await resultOf(press(w, 100));
    expect(w.service.getSnapshot()).toMatchObject({ button: "made" });
    expect(w.service.getSnapshot().lastResult).not.toBeNull();
    await w.service.setSessionUser("kid-2");
    const snap = w.service.getSnapshot();
    expect(snap.lastResult).toBeNull();
    expect(snap.unwatchedClipId).toBeNull();
    expect(snap.button).not.toBe("made");
  });

  it("a clip that finishes after the owner changed is kept for its maker and never shown to the new owner", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    let release: () => void = () => undefined;
    const base = w.engine.clipResult;
    w.engine.clipResult = async (req) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return base(req);
    };
    const outcome = press(w, 100);
    await w.service.setSessionUser("kid-2");
    release();
    const result = await resultOf(outcome);
    expect(result).toMatchObject({ ok: false, reason: "hidden", refused: true });
    // Stored under kid-1 (the meta was made at the press).
    const stored = [...w.rows.values()][0];
    expect(stored.ownerKey).toBe(await keyOf("kid-1"));
    const snap = w.service.getSnapshot();
    expect(snap.lastResult).toBeNull();
    expect(snap.unwatchedClipId).toBeNull();
    expect(snap.button).not.toBe("error");
  });

  it("a recording that stops because of the owner change is kept, and not shown to the new owner", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    await w.service.startRecording();
    w.engine.play(3);
    await w.service.setSessionUser("kid-2");
    await flush();
    expect(w.engine.recordings[0].stopped).toBe(true);
    const snap = w.service.getSnapshot();
    expect(snap.lastResult).toBeNull();
    expect(snap.unwatchedClipId).toBeNull();
  });

  it("refuses clip, Record and picture while the owner is read again after a bfcache restore", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    w.offline.value = true;
    const show = new Event("pageshow") as Event & { persisted: boolean };
    Object.defineProperty(show, "persisted", { value: true });
    w.win.dispatchEvent(show);
    await flush();
    expect(w.engine.paused.has("owner")).toBe(true);
    const before = w.service.getSnapshot();
    expect(press(w, 100)).toEqual({ kind: "ignored", reason: "refused" });
    expect(await w.service.clipLast()).toMatchObject({ ok: false, reason: "hidden", refused: true });
    expect(await w.service.startRecording()).toMatchObject({ ok: false, action: "record", reason: "hidden", refused: true });
    expect(await w.service.takePicture()).toMatchObject({ ok: false, action: "picture", reason: "hidden", refused: true });
    expect(w.engine.clipRequests).toHaveLength(0);
    expect(w.engine.recordings).toHaveLength(0);
    // A refusal changes no snapshot field: no result, no chip, no error.
    const after = w.service.getSnapshot();
    expect(after.lastResult).toBe(before.lastResult);
    expect(after.unwatchedClipId).toBe(before.unwatchedClipId);
    expect(after.button).not.toBe("error");
  });

  it("after an offline bfcache restore it purges once, keeps capture paused, and retries until the owner is read", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    w.offline.value = true;
    const show = new Event("pageshow") as Event & { persisted: boolean };
    Object.defineProperty(show, "persisted", { value: true });
    w.win.dispatchEvent(show);
    await flush();
    expect(w.engine.purges).toBe(1);
    await vi.advanceTimersByTimeAsync(OWNER_RETRY_MS);
    await vi.advanceTimersByTimeAsync(OWNER_RETRY_MS * 2);
    expect(w.engine.purges).toBe(1);
    expect(w.engine.paused.has("owner")).toBe(true);
    // Back online: the retry runs at once, and capture resumes for the same owner.
    w.offline.value = false;
    w.userId.value = "kid-1";
    w.win.dispatchEvent(new Event("online"));
    await flush();
    expect(w.engine.paused.has("owner")).toBe(false);
    expect(w.service.getSnapshot().engine).toBe("buffering");
  });

  it("keeps a known owner when next-auth says 'no session' only because it is offline", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    w.io.setOwnerKey.mockClear();
    w.offline.value = true;
    w.bus.publish(null);
    await flush();
    expect(w.engine.purges).toBe(0);
    expect(w.io.setOwnerKey).not.toHaveBeenCalled();
    // Online, and really signed out: a purge (user to guest).
    w.offline.value = false;
    w.userId.value = null;
    w.bus.publish("kid-1");
    w.bus.publish(null);
    await flush();
    expect(w.engine.purges).toBe(1);
  });
});

describe("the guest-keep rule with no game mounted (plan 7.1)", () => {
  it("keeps the guest ring when a sign-in completes within 60 s of the run's end, with the game detached", async () => {
    const w = makeWorld();
    w.bus.publish(null);
    await flush();
    const game = await ready(w);
    game.runPhase("end");
    // The kid leaves the game for another page: the game unmounts.
    game.detach();
    vi.advanceTimersByTime(30_000);
    // A sign-in completes in another tab (next-auth tells this tab): the
    // session bus hears it, no game is mounted. A sign-in in this tab would
    // leave the page for Google and lose the in-memory ring.
    w.userId.value = "kid-1";
    w.bus.publish("kid-1");
    await flush();
    expect(w.engine.purges).toBe(0);
    // Back to the game 2 minutes later (the ring is kept 5 min): still the same ring.
    vi.advanceTimersByTime(120_000);
    w.service.attach(gameAttachment(w));
    await flush();
    expect(w.engine.purges).toBe(0);
  });

  it("purges the guest ring when the sign-in comes later than 60 s after the run's end", async () => {
    const w = makeWorld();
    w.bus.publish(null);
    await flush();
    const game = await ready(w);
    game.runPhase("end");
    game.detach();
    vi.advanceTimersByTime(GUEST_KEEP_MS + 1000);
    w.userId.value = "kid-1";
    w.bus.publish("kid-1");
    await flush();
    expect(w.engine.purges).toBe(1);
  });
});

describe("the tab singleton", () => {
  it("is null until started, the same object after, and null again after a reset", () => {
    expect(getClipService()).toBeNull();
    const w = makeWorld();
    w.service.dispose();
    const started = startClipService({
      loadEngine: async () => new FakeEngine(),
      io: {
        libraryApi: () => ({}) as ClipLibraryApi,
        resolveOwner: async () => ({ key: "guest", confirmed: true }),
        setOwnerKey: () => undefined,
        update: async () => ({}) as ClipRecord,
      } as unknown as ServiceIo,
      sessionBus: null,
    });
    expect(started).not.toBeNull();
    expect(getClipService()).toBe(started);
    expect(startClipService()).toBe(started);
    resetClipServiceForTests();
    expect(getClipService()).toBeNull();
  });
});

describe("replay granularity (plan 5, tiers M and V)", () => {
  it("is absent until the engine measures it, then the snapshot carries the newest value", async () => {
    const w = makeWorld();
    w.engine.prepared = { tier: "V", supported: true };
    await ready(w);
    expect(w.service.getSnapshot()).not.toHaveProperty("replayGranularitySec");
    expect(w.service.getSnapshot().tier).toBe("V");
    w.engine.emit({ t: "granularity", seconds: 5 });
    const first = w.service.getSnapshot();
    expect(first.replayGranularitySec).toBe(5);
    // The same value makes no new snapshot; a new one does.
    w.engine.emit({ t: "granularity", seconds: 5 });
    expect(w.service.getSnapshot()).toBe(first);
    w.engine.emit({ t: "granularity", seconds: 1 });
    expect(w.service.getSnapshot().replayGranularitySec).toBe(1);
    expect(w.service.getSnapshot().version).toBe(first.version + 1);
  });

  it("is gone after a reset (the next session, perhaps another game, measures its own)", async () => {
    const w = makeWorld();
    w.engine.prepared = { tier: "V", supported: true };
    await ready(w);
    w.engine.emit({ t: "granularity", seconds: 4.5 });
    expect(w.service.getSnapshot().replayGranularitySec).toBe(4.5);
    w.engine.emit({ t: "reset" });
    expect(w.service.getSnapshot()).not.toHaveProperty("replayGranularitySec");
    // The next session's first measure shows again.
    w.engine.emit({ t: "granularity", seconds: 1 });
    expect(w.service.getSnapshot().replayGranularitySec).toBe(1);
  });

  it("a tier change (the engine switch moved to the WebCodecs engine) shows the new tier and drops the old granularity", async () => {
    const w = makeWorld();
    w.engine.prepared = { tier: "M", supported: true };
    await ready(w);
    w.engine.emit({ t: "granularity", seconds: 4.5 });
    w.engine.emit({ t: "tier", tier: "W" });
    const snapshot = w.service.getSnapshot();
    expect(snapshot.tier).toBe("W");
    expect(snapshot).not.toHaveProperty("replayGranularitySec");
  });
});

describe("Record videos saved from last time (plan 8.4 crash recovery)", () => {
  function savedVideo(id: string, ownerKey: string, createdAt: number): ClipRecord {
    return {
      id,
      ownerKey,
      gameId: "breakout",
      kind: "record",
      createdAt,
      durationMs: 42_000,
      width: 1280,
      height: 720,
      fps: 30,
      hasAudio: true,
      mime: "video/mp4",
      bytes: 5000,
      kept: false,
      watched: false,
      storage: "opfs",
      posterDataUrl: "data:,",
      moments: [],
    };
  }

  /** The library hands out each saved video once, like ioClient.takeRecovered. */
  function withSaved(w: World, rows: ClipRecord[]): void {
    let waiting = [...rows];
    w.library.takeRecovered = async () => {
      const taken = waiting;
      waiting = [];
      return taken;
    };
  }

  it("points the new-clip chip at this player's newest video, and gives each video once", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    const kid = await keyOf("kid-1");
    withSaved(w, [savedVideo("rec-old", kid, 10), savedVideo("rec-new", kid, 20)]);
    const taken = await w.service.takeRecovered();
    expect(taken.map((row) => row.id)).toEqual(["rec-old", "rec-new"]);
    expect(w.service.getSnapshot().unwatchedClipId).toBe("rec-new");
    expect(await w.service.takeRecovered()).toEqual([]);
    expect(w.service.getSnapshot().unwatchedClipId).toBe("rec-new");
    // Watching it takes the chip away, as for any clip.
    w.service.markWatched("rec-new");
    expect(w.service.getSnapshot().unwatchedClipId).toBeNull();
  });

  it("gives no chip and no words for another player's video", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    withSaved(w, [savedVideo("rec-other", await keyOf("kid-2"), 10)]);
    expect(await w.service.takeRecovered()).toEqual([]);
    expect(w.service.getSnapshot().unwatchedClipId).toBeNull();
  });

  it("a player change while the list is read gives nothing to the new player", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    const kid = await keyOf("kid-1");
    let release: (rows: ClipRecord[]) => void = () => undefined;
    w.library.takeRecovered = () =>
      new Promise<ClipRecord[]>((resolve) => {
        release = resolve;
      });
    const pending = w.service.takeRecovered();
    await w.service.setSessionUser("kid-2");
    release([savedVideo("rec-1", kid, 10)]);
    expect(await pending).toEqual([]);
    expect(w.service.getSnapshot().unwatchedClipId).toBeNull();
  });

  it("a library with no recovery, or one that fails, gives an empty list and never throws", async () => {
    const w = makeWorld();
    expect(await w.service.takeRecovered()).toEqual([]);
    w.library.takeRecovered = async () => {
      throw new DOMException("gone", "NotFoundError");
    };
    expect(await w.service.takeRecovered()).toEqual([]);
    expect(w.service.getSnapshot().unwatchedClipId).toBeNull();
  });
});
