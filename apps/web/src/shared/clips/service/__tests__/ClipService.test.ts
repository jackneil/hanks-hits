import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClipRecord } from "../../protocol";
import { CrashBreaker, TAB_LOCK_PREFIX } from "../breaker";
import {
  ClipService,
  FAILURES_TO_DISABLE,
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
  type ClipActionResult,
  type ClipLibraryApi,
  type GameAttachment,
  type PressOutcome,
} from "../contract";
import { EngineFailure } from "../engine";
import { CAPTURE_LOCK, Lifecycle, RESUME_GRACE_MS, type LifecycleEnv } from "../lifecycle";
import { ERROR_MS, MADE_MS, RECOVERING_QUIET_MS, SOURCE_LOST_GRACE_MS } from "../machine";
import { FakeLockManager } from "./fakeLocks";
import { FakeEngine } from "./fakeEngine";

/** A fast owner key (the real one hashes with SubtleCrypto, which fake timers cannot drive). */
async function keyOf(userId: string | null): Promise<string> {
  if (!userId) return "guest";
  let hex = "";
  for (const ch of userId) hex += ch.charCodeAt(0).toString(16);
  return `u_${hex.padEnd(20, "0").slice(0, 20)}`;
}

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

interface World {
  service: ClipService;
  engine: FakeEngine;
  rows: Map<string, ClipRecord>;
  library: ClipLibraryApi & { markWatched: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  io: ServiceIo & { update: ReturnType<typeof vi.fn>; setOwnerKey: ReturnType<typeof vi.fn> };
  locks: FakeLockManager;
  storage: MemoryStorage;
  doc: EventTarget & { visibilityState: DocumentVisibilityState; focused: boolean; hasFocus(): boolean };
  win: EventTarget;
  userId: { value: string | null };
  shared: File[];
  paused: number;
}

const services: ClipService[] = [];

function makeWorld(options: { closesOnHide?: boolean; tab?: string } = {}): World {
  const engine = new FakeEngine();
  const rows = new Map<string, ClipRecord>();
  const baseClip = engine.clipResult;
  engine.clipResult = async (request) => {
    const made = await baseClip(request);
    rows.set(made.record.id, made.record);
    return made;
  };
  const library = {
    list: async () => [...rows.values()],
    file: async () => new File([], "x"),
    setKept: async () => undefined,
    markWatched: vi.fn(async () => undefined),
    remove: vi.fn(async (id: string) => {
      rows.delete(id);
    }),
    usage: async () => ({ bytes: 0, budget: 1, count: rows.size }),
    subscribe: () => () => undefined,
  };
  const io = {
    libraryApi: () => library,
    ownerKey: async () => "guest",
    setOwnerKey: vi.fn(),
    update: vi.fn(async (id: string, patch: Partial<ClipRecord>) => ({ ...(rows.get(id) as ClipRecord), ...patch })),
  };
  const locks = new FakeLockManager();
  const tab = options.tab ?? "t1";
  const storage = new MemoryStorage();
  const doc = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
    focused: true,
    hasFocus(): boolean {
      return this.focused;
    },
  });
  const win = new EventTarget();
  const now = () => Date.now();
  const lifecycle = new Lifecycle({
    doc: doc as unknown as LifecycleEnv["doc"],
    win: win as unknown as LifecycleEnv["win"],
    locks: locks.client(tab),
    now,
  });
  const breaker = new CrashBreaker({ storage, locks: locks.client(tab), now, tabLock: `${TAB_LOCK_PREFIX}${tab}` });
  const userId = { value: null as string | null };
  const shared: File[] = [];
  const world = { paused: 0 } as World;
  const service = new ClipService({
    loadEngine: async () => engine,
    io: io as unknown as ServiceIo,
    breaker,
    lifecycle,
    now,
    wallNow: now,
    host: () => "hankshits.com",
    readUserId: async () => userId.value,
    ownerKeyFor: keyOf,
    closesEncoderWhenHidden: options.closesOnHide ?? false,
    shareEnv: {
      navigator: {
        share: async (data: ShareData) => {
          shared.push(...(data.files ?? []));
        },
        canShare: () => true,
      },
      log: () => undefined,
    },
    log: () => undefined,
  });
  Object.assign(world, { service, engine, rows, library, io, locks, storage, doc, win, userId, shared });
  services.push(service);
  return world;
}

const flush = () => vi.advanceTimersByTimeAsync(0);

function gameAttachment(w: World, extra: Partial<GameAttachment> = {}): GameAttachment {
  return {
    appId: "breakout",
    gameName: "Breakout",
    emoji: "🧱",
    canPause: true,
    pause: () => {
      w.paused++;
    },
    ...extra,
  };
}

/** Attaches Breakout, registers its canvas, and plays until the button is Ready. */
async function ready(w: World): Promise<AttachedGame> {
  const game = w.service.attach(gameAttachment(w));
  await flush();
  game.setAtBreak(false);
  game.runPhase("start");
  game.registerCanvas(document.createElement("canvas"));
  w.engine.emit({ t: "output" });
  w.engine.play(5);
  await flush();
  expect(w.service.getSnapshot().button).toBe("ready");
  return game;
}

function press(w: World, holdMs: number, info: { moved?: boolean; cancelled?: boolean } = {}): PressOutcome {
  const token = w.service.beginPress();
  if (!token) throw new Error("no press token");
  vi.advanceTimersByTime(holdMs);
  return w.service.endPress(token, { upAtMs: Date.now(), moved: info.moved ?? false, cancelled: info.cancelled });
}

async function resultOf(outcome: PressOutcome): Promise<ClipActionResult> {
  if (outcome.kind !== "clip" && outcome.kind !== "extend") throw new Error(`no result for ${outcome.kind}`);
  return outcome.result;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  services.splice(0).forEach((s) => s.dispose());
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
    expect(w.service.getSnapshot()).toMatchObject({ button: "warming", reason: "warming", appId: "breakout", atBreak: true });
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

  it("a cancelled press commits nothing", async () => {
    const w = makeWorld();
    await ready(w);
    expect(press(w, 100, { cancelled: true })).toEqual({ kind: "ignored", reason: "cancelled" });
    await flush();
    expect(w.engine.clipRequests).toHaveLength(0);
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

describe("the tab singleton", () => {
  it("is null until started, the same object after, and null again after a reset", () => {
    expect(getClipService()).toBeNull();
    const w = makeWorld();
    w.service.dispose();
    const started = startClipService({
      loadEngine: async () => new FakeEngine(),
      io: {
        libraryApi: () => ({}) as ClipLibraryApi,
        ownerKey: async () => "guest",
        setOwnerKey: () => undefined,
        update: async () => ({}) as ClipRecord,
      } as unknown as ServiceIo,
    });
    expect(started).not.toBeNull();
    expect(getClipService()).toBe(started);
    expect(startClipService()).toBe(started);
    resetClipServiceForTests();
    expect(getClipService()).toBeNull();
  });
});
