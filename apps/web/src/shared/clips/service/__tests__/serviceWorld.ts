/**
 * The ClipService test world: the real service with a fake engine, fake
 * locks, a fake session bus and an in-memory library. ClipService.test.ts
 * and the press-path integration tests share it.
 */
import { expect, vi } from "vitest";

import type { ClipRecord } from "../../protocol";
import { CrashBreaker, TAB_LOCK_PREFIX } from "../breaker";
import { ClipService, type ServiceIo } from "../ClipService";
import type { AttachedGame, ClipActionResult, ClipLibraryApi, GameAttachment, PressOutcome } from "../contract";
import type { SessionBusLike } from "../ioClient";
import { Lifecycle, type LifecycleEnv } from "../lifecycle";
import { FakeLockManager } from "./fakeLocks";
import { FakeEngine, recordFor } from "./fakeEngine";

/** A stored record part of a recording (the id and the kind change). */
export function recordOf(meta: Parameters<typeof recordFor>[0], id: string): ClipRecord {
  return recordFor({ ...meta, id, kind: "record" });
}

/** A fast owner key (the real one hashes with SubtleCrypto, which fake timers cannot drive). */
export async function keyOf(userId: string | null): Promise<string> {
  if (!userId) return "guest";
  let hex = "";
  for (const ch of userId) hex += ch.charCodeAt(0).toString(16);
  return `u_${hex.padEnd(20, "0").slice(0, 20)}`;
}

export class MemoryStorage {
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

/** The session bus (registry.ts) as a test double. */
export class FakeBus implements SessionBusLike {
  latest: { userId: string | null } | null = null;
  readonly listeners = new Set<(userId: string | null) => void>();
  current() {
    return this.latest;
  }
  subscribe(listener: (userId: string | null) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish(userId: string | null) {
    this.latest = { userId };
    for (const l of [...this.listeners]) l(userId);
  }
}

export interface World {
  service: ClipService;
  engine: FakeEngine;
  rows: Map<string, ClipRecord>;
  library: ClipLibraryApi & { markWatched: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  io: ServiceIo & { update: ReturnType<typeof vi.fn>; setOwnerKey: ReturnType<typeof vi.fn>; resolveOwner: ReturnType<typeof vi.fn> };
  locks: FakeLockManager;
  storage: MemoryStorage;
  doc: EventTarget & { visibilityState: DocumentVisibilityState; focused: boolean; hasFocus(): boolean };
  win: EventTarget;
  userId: { value: string | null };
  /** Set to make the session read fail (offline). */
  offline: { value: boolean };
  bus: FakeBus;
  shared: File[];
  paused: number;
}

const services: ClipService[] = [];

/** Dispose every service that makeWorld made (call in afterEach). */
export function disposeWorlds(): void {
  services.splice(0).forEach((s) => s.dispose());
}

export function makeWorld(options: { closesOnHide?: boolean; tab?: string } = {}): World {
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
    resolveOwner: vi.fn(async () => ({ key: "guest", confirmed: true })),
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
  const offline = { value: false };
  const bus = new FakeBus();
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
    readUserId: async () => {
      if (offline.value) throw new TypeError("offline");
      return userId.value;
    },
    ownerKeyFor: keyOf,
    sessionBus: bus,
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
  Object.assign(world, { service, engine, rows, library, io, locks, storage, doc, win, userId, offline, bus, shared });
  services.push(service);
  return world;
}

export const flush = () => vi.advanceTimersByTimeAsync(0);

export function gameAttachment(w: World, extra: Partial<GameAttachment> = {}): GameAttachment {
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
export async function ready(w: World): Promise<AttachedGame> {
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

export function press(w: World, holdMs: number, info: { moved?: boolean; cancelled?: boolean } = {}): PressOutcome {
  const token = w.service.beginPress();
  if (!token) throw new Error("no press token");
  vi.advanceTimersByTime(holdMs);
  return w.service.endPress(token, { upAtMs: Date.now(), moved: info.moved ?? false, cancelled: info.cancelled });
}

export async function resultOf(outcome: PressOutcome): Promise<ClipActionResult> {
  if (outcome.kind !== "clip" && outcome.kind !== "extend") throw new Error(`no result for ${outcome.kind}`);
  return outcome.result;
}
