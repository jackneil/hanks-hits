/**
 * The no-worse-than-master proof of part B1 of #26i (the sync-time fix).
 *
 * The same cells run on two versions of the code:
 * - master: scripts/legacy-saves/no-worse.sh unpacks the src of master
 *   (ROLLBACK_COMMIT in src/__tests__/rollback-safety.test.ts) and runs
 *   scripts/legacy-saves/no-worse-master.test.ts against it. That run makes
 *   the inputs, runs every cell, and writes
 *   src/__tests__/fixtures/no-worse-master.json;
 * - this checkout: src/__tests__/no-worse-than-master.test.tsx runs every
 *   cell with the same inputs, and holds the result to the bar: the
 *   kid-visible values that this checkout loses are a subset of the values
 *   that master loses, in every cell.
 *
 * Why a recorded run and not a copy of master's code: a copy of master's
 * useAuthSync and its 33 stores would be a second code tree in src, with its
 * own lint, types and imports. The recorded run uses master's REAL code
 * (git archive of the commit), as the rollback proof does
 * (scripts/legacy-saves/rollback.sh). The fixture records the inputs, so both
 * runs use the same progress, and it records a hash of this file and of the
 * fake server: a change to either without a new master run fails the test.
 *
 * This file runs inside both src trees. It imports app code only through
 * "@/..." (master's or this checkout's, per run), and only modules that
 * master has too. It imports its siblings by relative paths.
 *
 * The cells, per synced store:
 * - deploy (the wave-3 deploy matrix): a save of the old code (the 86a1fe0
 *   format and master's 904bc09 format), played or untouched, on a device
 *   where this account synced before; the account row missing, older,
 *   newer, or untouched (the defaults with a page-load time).
 * - guestLots: a guest with a lot of play on this device signs in to an
 *   account with a little progress.
 * - blankOutage: a signed-in kid on a blank device; the first GET fails for
 *   10 minutes, and the kid plays; then the server is back.
 * - inFlight: an untouched device; the kid plays while the first GET is in
 *   flight (a fast and a slow GET; one change, or a lot of play).
 * - tab: a second tab saves newer progress; then the kid plays on in this
 *   (stale) tab.
 * - ownerSwitch: kid A's page; another tab signs in as kid B; kid A plays on.
 * - gap: a device of the old code that signed out after #8pr (the sign-out
 *   broadcast key), then the same account signs in again.
 *
 * A kid-visible value is a leaf of the progress (a number, a string, a
 * list item) that differs from the store's defaults: what the kid earned or
 * made (a score, coins, an unlock, a drawing, a pet, a journey). The time
 * keys, the settings, the screen state and the clocks are not progress
 * (NOT_PROGRESS below, chosen here from what each game shows, not from the
 * code under test). A value of a source (the account's row, the device's
 * progress) is lost when the account's final row does not hold it and no
 * other source holds the same value at the same place (the last-write rule
 * keeps one of two different values; that is not a loss of this code). A
 * numeric improvement counts as kept only when the reviewed field table
 * defines its direction. Wallets and other state require exact equality.
 *
 * The inputs pass the server schema of master: a save that master's server
 * refuses (and the server of this checkout takes, part B0) would compare
 * the schemas, not the sync code.
 */
import { vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { useAuthSync, __unsafeResetForeignPurgeLockForTests } from "@/shared/hooks/useAuthSync";
import { PROGRESS_OWNER_KEY, SIGNOUT_BROADCAST_KEY } from "@/lib/storage-keys";
import { validateProgress } from "@/lib/progress-schemas";
import { PROGRESS_FIELD_RULES, type FieldDirection } from "@/lib/progress-field-rules";
import { installAudioMock } from "@/__tests__/audio-mock";
import { createProgressServer } from "../fake-progress-server";
import { SYNCED_STORES, type SyncedStoreEntry } from "../synced-stores";
import { DRIVERS, pick, seeded, type Rng } from "../store-drivers";
import legacy86a1fe0 from "../fixtures/legacy-saves.json";
import legacy904bc09 from "../fixtures/legacy-saves-904bc09.json";

type Progress = Record<string, unknown>;

export type Session = {
  current: { data: null | { user: { id: string } }; status: string };
};

export const FORMATS = ["86a1fe0", "904bc09"] as const;
export type Format = (typeof FORMATS)[number];
const DEVICES = ["played", "untouched"] as const;
type Device = (typeof DEVICES)[number];
const ROWS = ["missing", "older", "newer", "untouched"] as const;
type RowKind = (typeof ROWS)[number];

const LEGACY: Record<Format, Record<string, Record<string, unknown>>> = {
  "86a1fe0": legacy86a1fe0.saves as unknown as Record<string, Record<string, unknown>>,
  "904bc09": legacy904bc09.saves as unknown as Record<string, Record<string, unknown>>,
};

/** The progress of one store that both runs use (made by master's code). */
export type StoreInputs = {
  /** getProgress() of a store with nothing saved. */
  defaults: Progress;
  /** Real progress: player actions from the defaults (the account's). */
  account: Progress;
  /** One real player change from the defaults (an account with little progress). */
  little: Progress;
  /** A lot of play: 400 player actions from the defaults (a guest's). */
  guest: Progress;
  /** The localStorage save that master's store wrote after the guest's play. */
  guestRaw: string;
  /** getProgress() after a page load of each legacy save. */
  device: Record<Format, Record<Device, Progress>>;
};
export type Inputs = Record<string, StoreInputs>;

export type CellResult = {
  /** The lost kid-visible values (see leafId), sorted. */
  lost: string[];
  /** POSTs and beacons that reached the server. */
  posts: number;
  /** POSTs that the server refused. */
  rejected: number;
  debug?: { sources: Record<string, Progress>; final: Progress | null };
};

export type Family =
  | "deploy"
  | "guestLots"
  | "blankOutage"
  | "inFlightFast"
  | "inFlightSlow"
  | "tab"
  | "ownerSwitch"
  | "gap";

export type Cell = {
  id: string;
  family: Family;
  appId: string;
  /** True when an untouched device or a second tab is involved (the bar: strictly fewer losses). */
  untouchedOrTab: boolean;
  run: (ctx: Ctx, inputs: StoreInputs) => Promise<CellResult>;
};

type Ctx = {
  session: Session;
  server: ReturnType<typeof createProgressServer>;
};

// ---------------------------------------------------------------------------
// The loss measure
// ---------------------------------------------------------------------------

/** Keys that hold a time, not a kid's progress (at any depth). */
const TIME_KEYS = new Set(["lastModified", "updatedAt", "lastTick"]);

/**
 * Keys (at any depth) that are not a kid's progress: settings (the sound,
 * a difficulty, a control mode, the game or vehicle that is picked), the
 * screen that shows, and clocks that run by themselves (the pet's needs,
 * the ride's world clock and place). The unlocks, counters, wallets,
 * items, pets and journeys stay in the measure.
 */
const NOT_PROGRESS: Record<string, readonly string[]> = {
  "*": ["settings", "soundEnabled", "musicEnabled"],
  asteroids: ["difficulty"],
  checkers: ["difficulty", "variant", "gameMode"],
  chess: ["difficulty", "gameMode", "playerColor"],
  "endless-runner": ["selectedCharacter"],
  "four-wheeler-3d": ["rider", "position", "heading", "parked", "timeOfDay", "day", "weather"],
  "hill-climb": ["leanSensitivity", "currentVehicleId", "currentStageId"],
  "memory-match": ["difficulty", "theme"],
  "monster-truck": ["currentTruckId"],
  "oregon-trail": ["gamePhase"],
  quoridor: ["difficulty", "gameMode"],
  snake: ["speed", "wraparoundWalls", "controlMode"],
  "joke-generator": ["lastCategory"],
  weather: ["units"],
  "virtual-pet": ["hunger", "happiness", "energy", "cleanliness", "lastChecked"],
};

function skipped(appId: string): Set<string> {
  return new Set([...TIME_KEYS, ...NOT_PROGRESS["*"], ...(NOT_PROGRESS[appId] ?? [])]);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined && !TIME_KEYS.has(key))
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A short, stable id of a leaf: long leaves end in a hash of the full text. */
function leafId(text: string): string {
  if (text.length <= 160) return text;
  return `${text.slice(0, 120)}#${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

/**
 * The leaves of a progress: `path=value` for a value, `path[]=item` for a
 * list item. Keys in `skip` (at any depth) are left out.
 */
export function leaves(value: unknown, skip: ReadonlySet<string> = TIME_KEYS, path = "", out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) out.add(leafId(`${path}[]=${stableJson(item)}`));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (skip.has(key) || child === undefined) continue;
      leaves(child, skip, path ? `${path}.${key}` : key, out);
    }
  } else if (isTime(value)) {
    // A date (epoch ms, such as the time of an unlock) is a time: only its place counts.
    out.add(`${path}=<time>`);
  } else if (value !== undefined) {
    out.add(leafId(`${path}=${JSON.stringify(value)}`));
  }
  return out;
}


/** A number that is a date in epoch ms (2017 to 2100). */
function isTime(value: unknown): boolean {
  return typeof value === "number" && value > 1.5e12 && value < 4.1e12;
}

/** The place (path) of a lost value id: `kid:coins=5` -> `coins`, `kid:items[]=...` -> `items`. */
export function placeOf(id: string): string {
  const leaf = id.slice(id.indexOf(":") + 1);
  const list = leaf.indexOf("[]=");
  const value = leaf.indexOf("=");
  return leaf.slice(0, list >= 0 && list < value ? list : value);
}

/** The places where `progress` holds a kid-visible value that differs from the defaults. */
export function changedPlaces(appId: string, progress: Progress, defaults: Progress): Set<string> {
  const skip = skipped(appId);
  const base = leaves(defaults, skip);
  const out = new Set<string>();
  for (const leaf of leaves(progress, skip)) if (!base.has(leaf)) out.add(placeOf(`x:${leaf}`));
  return out;
}

/**
 * The kid-visible values of `sources` that `final` lost: a leaf of a source
 * that differs from the defaults, that no other source (and no progress in
 * `older`: an older line of play) holds, and that `final` does not hold.
 * Each id starts with the source's name.
 */
export function lostValues(
  appId: string,
  sources: Record<string, Progress>,
  final: Progress | null | undefined,
  defaults: Progress,
  older: readonly Progress[] = []
): string[] {
  const skip = skipped(appId);
  const base = leaves(defaults, skip);
  for (const progress of older) leaves(progress, skip, "", base);
  const have = leaves(final ?? {}, skip);
  const numbers = new Map<string, number>();
  for (const leaf of have) {
    const value = Number(leaf.slice(leaf.indexOf("=") + 1));
    if (!leaf.includes("[]=") && Number.isFinite(value)) numbers.set(placeOf(`x:${leaf}`), value);
  }
  /** An improvement only for a field whose reviewed direction permits it. */
  const improved = (leaf: string) => {
    if (leaf.includes("[]=")) return false;
    const place = placeOf(`x:${leaf}`);
    const value = Number(leaf.slice(leaf.indexOf("=") + 1));
    const now = numbers.get(place);
    if (!Number.isFinite(value) || now === undefined) return false;
    const table = (PROGRESS_FIELD_RULES as Record<string, Record<string, FieldDirection>>)[appId] ?? {};
    const path = place.split(".");
    const direction = Object.entries(table).find(([pattern, spec]) => {
      const parts = pattern.split(".");
      return (parts.length === path.length || (spec.subtree && parts.length < path.length)) &&
        parts.every((part, i) => part === "*" || part === path[i]);
    })?.[1].rule;
    if (direction === "max") return now >= value;
    if (direction === "minPositive") return now > 0 && (value <= 0 || now <= value);
    if (direction === "earliest") return now <= value;
    return false;
  };
  const all = Object.fromEntries(Object.entries(sources).map(([name, progress]) => [name, leaves(progress, skip)]));
  const out: string[] = [];
  for (const [name, mine] of Object.entries(all)) {
    for (const leaf of mine) {
      if (base.has(leaf) || have.has(leaf) || improved(leaf)) continue;
      if (Object.entries(all).some(([other, theirs]) => other !== name && theirs.has(leaf))) continue;
      out.push(`${name}:${leaf}`);
    }
  }
  return out.sort();
}

/** True when two progress values hold the same kid-visible values (the times aside). */
export function sameValues(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

/** The hash of the code that both runs share: a change needs a new master run. */
export function harnessHash(): string {
  const hash = createHash("sha256");
  for (const file of ["no-worse/harness.ts", "fake-progress-server.ts", "fixtures/legacy-saves.json", "fixtures/legacy-saves-904bc09.json"]) {
    hash.update(readFileSync(join(__dirname, "..", file)));
  }
  return hash.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Pages, sessions and the clock
// ---------------------------------------------------------------------------

const at = (iso: string | number) => vi.setSystemTime(new Date(iso));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const progressNow = (entry: SyncedStoreEntry) => clone(entry.store.getState().getProgress()) as Progress;
const withTime = (entry: SyncedStoreEntry, progress: Progress, time: number): Progress => ({
  ...clone(progress),
  [entry.timeKey]: time,
});

/** Lets the fake timers run for `ms`, in steps of `step` (React effects run between steps). */
async function settle(ms: number, step = 250) {
  for (let left = ms; left > 0; left -= step) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(step, left));
    });
  }
}

function signIn(session: Session, id: string) {
  session.current = { data: { user: { id } }, status: "authenticated" };
}

const mount = (entry: SyncedStoreEntry) =>
  renderHook(() =>
    useAuthSync({
      appId: entry.appId as ValidAppId,
      localStorageKey: entry.key,
      getState: () => entry.store.getState().getProgress() as AppProgressData,
      setState: (data) => entry.store.getState().setProgress(data as never),
      debounceMs: 1_000,
    })
  );

/** A page load: the store's defaults, then its save on disk. */
async function loadPage(entry: SyncedStoreEntry) {
  const saved = localStorage.getItem(entry.key);
  entry.reset();
  if (saved === null) localStorage.removeItem(entry.key);
  else localStorage.setItem(entry.key, saved);
  await entry.store.persist.rehydrate();
}

/** The kid's play, as a store change with the time of now (the same progress in both runs). */
function play(entry: SyncedStoreEntry, progress: Progress) {
  act(() => {
    entry.store.getState().setProgress(withTime(entry, progress, Date.now()) as never);
  });
}

function putRow(ctx: Ctx, user: string, appId: string, data: Progress) {
  ctx.server.rows.set(`${user}:${appId}`, { data: clone(data) as AppProgressData, updatedAt: new Date() });
}

function result(
  ctx: Ctx,
  appId: string,
  sources: Record<string, Progress>,
  final: Progress | null | undefined,
  inputs: StoreInputs,
  older: readonly Progress[] = []
): CellResult {
  return {
    lost: lostValues(appId, sources, final, inputs.defaults, older),
    posts: ctx.server.posts.length,
    rejected: ctx.server.rejected.length,
    // NO_WORSE_DEBUG=1: the sources and the final row too (to read a failure).
    ...(process.env.NO_WORSE_DEBUG ? { debug: { sources, final: final ?? null } } : {}),
  };
}

const reloadSpy = vi.fn();
const originalLocation = typeof window === "undefined" ? undefined : window.location;

/** Before each cell: a clean device, a clean server, no session. */
export function beforeCell(ctx: Ctx) {
  localStorage.clear();
  ctx.server.reset();
  installAudioMock();
  __unsafeResetForeignPurgeLockForTests();
  ctx.session.current = { data: null, status: "unauthenticated" };
  ctx.server.install(vi.stubGlobal);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  reloadSpy.mockReset();
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: { ...originalLocation, reload: reloadSpy },
  });
  for (const entry of SYNCED_STORES) entry.reset();
}

/** After each cell. */
export function afterCell() {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", { writable: true, configurable: true, value: originalLocation });
  for (const entry of SYNCED_STORES) entry.reset();
  localStorage.clear();
}

// ---------------------------------------------------------------------------
// The inputs (master's run makes them; the fixture keeps them)
// ---------------------------------------------------------------------------

/**
 * Actions that a kid reaches only in some states (the game calls them).
 * The drivers call every action at random, and an action out of its state
 * can make progress that no kid makes (master's Dino Runner counted a run
 * from time 0 when its game-over came before a start).
 */
const ONLY_WHEN: Record<string, Record<string, (state: Record<string, unknown>) => boolean>> = {
  "dino-runner": { gameOver: (state) => state.gameState === "playing" },
};

/** Player actions of the store's driver, from the defaults. Stops when `done` says so. */
function drive(entry: SyncedStoreEntry, seed: number, maxSteps: number, done: (step: number, progress: Progress) => boolean): Progress {
  const rng: Rng = seeded(seed);
  const steps = Object.entries(DRIVERS[entry.appId].steps).filter(([, step]) => !step.kind || step.kind === "player");
  let out = progressNow(entry);
  for (let i = 0; i < maxSteps; i++) {
    const [name, step] = pick(rng, steps);
    const state = entry.store.getState();
    const allowed = ONLY_WHEN[entry.appId]?.[name];
    try {
      if (typeof state[name] === "function" && (!allowed || allowed(state)))
        state[name](...(step.args ? step.args(rng, state) : []));
    } catch {
      // An action that needs a game in progress, or one that this code does not have.
    }
    vi.advanceTimersByTime(1_000);
    out = progressNow(entry);
    if (done(i, out)) break;
  }
  return out;
}

/**
 * Progress from `make` (with seed, seed + 1, ...) that the server of this
 * run takes: the first try whose progress passes validateProgress.
 */
function valid(entry: SyncedStoreEntry, seed: number, make: (seed: number) => Progress): Progress {
  let reason = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    entry.reset();
    localStorage.clear();
    const progress = make(seed + attempt * 1_000);
    // Each cell gives the progress its own time: check it with the time of now.
    const check = validateProgress(entry.appId as ValidAppId, withTime(entry, progress, Date.now()));
    if (check.success) return progress;
    reason = String(check.error).slice(0, 200);
  }
  throw new Error(`${entry.appId}: no seed made progress that the server takes (${reason})`);
}

/** Makes the inputs with the code of this run (master's run calls it). */
export async function makeInputs(): Promise<Inputs> {
  const out: Inputs = {};
  for (const [index, entry] of SYNCED_STORES.entries()) {
    localStorage.clear();
    entry.reset();
    at("2026-08-01T10:00:00Z");
    const defaults = progressNow(entry);
    const touched = (progress: Progress) => !sameValues(progress, defaults);

    const account = valid(entry, 7000 + index, (seed) => {
      at("2026-08-01T10:00:00Z");
      return drive(entry, seed, 400, (step, progress) => step > 60 && touched(progress));
    });
    const little = valid(entry, 8000 + index, (seed) => {
      at("2026-08-02T10:00:00Z");
      return drive(entry, seed, 400, (_step, progress) => touched(progress));
    });
    // The guest plays the day of the sign-in, before it.
    const guest = valid(entry, 9000 + index, (seed) => {
      at("2026-10-20T12:00:00Z");
      return drive(entry, seed, 400, () => false);
    });
    const guestRaw = localStorage.getItem(entry.key);
    if (guestRaw === null) throw new Error(`${entry.appId}: the guest's play wrote no save`);

    const device = {} as Record<Format, Record<Device, Progress>>;
    for (const format of FORMATS) {
      device[format] = {} as Record<Device, Progress>;
      for (const kind of DEVICES) {
        localStorage.clear();
        localStorage.setItem(entry.key, JSON.stringify(LEGACY[format][entry.appId][kind]));
        at("2026-10-20T13:00:00Z");
        await loadPage(entry);
        device[format][kind] = progressNow(entry);
      }
    }
    entry.reset();
    localStorage.clear();
    out[entry.appId] = { defaults, account, little, guest, guestRaw, device };
  }
  return out;
}

// ---------------------------------------------------------------------------
// The cells
// ---------------------------------------------------------------------------

const T = (iso: string) => Date.parse(iso);

function deployCell(entry: SyncedStoreEntry, format: Format, device: Device, rowKind: RowKind): Cell {
  return {
    id: `deploy ${format} ${entry.appId} device=${device} row=${rowKind}`,
    family: "deploy",
    appId: entry.appId,
    untouchedOrTab: device === "untouched" || rowKind === "untouched",
    async run(ctx, inputs) {
      localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");
      localStorage.setItem(entry.key, JSON.stringify(LEGACY[format][entry.appId][device]));
      at("2026-10-20T13:00:00Z");
      await loadPage(entry);
      let row: Progress | null = null;
      if (rowKind === "older") row = withTime(entry, inputs.account, T("2026-08-15T10:00:00Z"));
      else if (rowKind === "newer") row = withTime(entry, inputs.account, T("2026-10-20T12:00:00Z"));
      else if (rowKind === "untouched") row = withTime(entry, inputs.defaults, T("2026-10-15T10:00:00Z"));
      if (row) putRow(ctx, "user-1", entry.appId, row);
      signIn(ctx.session, "user-1");
      const view = mount(entry);
      await settle(6_000);
      view.unmount();
      const sources: Record<string, Progress> = {};
      if (device === "played") sources.device = inputs.device[format].played;
      if (row && rowKind !== "untouched") sources.account = row;
      return result(ctx, entry.appId, sources, ctx.server.row(entry.appId) as Progress | undefined, inputs);
    },
  };
}

function guestLotsCell(entry: SyncedStoreEntry): Cell {
  return {
    id: `guestLots ${entry.appId}`,
    family: "guestLots",
    appId: entry.appId,
    untouchedOrTab: false,
    async run(ctx, inputs) {
      const account = withTime(entry, inputs.little, T("2026-10-19T11:00:00Z"));
      putRow(ctx, "user-1", entry.appId, account);
      // A guest's save on this device (no account synced here): the guest
      // played at 12:00, and signs in at 13:00.
      localStorage.setItem(entry.key, inputs.guestRaw);
      at("2026-10-20T13:00:00Z");
      await loadPage(entry);
      signIn(ctx.session, "user-1");
      const view = mount(entry);
      await settle(6_000);
      view.unmount();
      return result(ctx, entry.appId, { account, guest: inputs.guest }, ctx.server.row(entry.appId) as Progress | undefined, inputs);
    },
  };
}

function blankOutageCell(entry: SyncedStoreEntry): Cell {
  return {
    id: `blankOutage ${entry.appId}`,
    family: "blankOutage",
    appId: entry.appId,
    untouchedOrTab: false,
    async run(ctx, inputs) {
      const account = withTime(entry, inputs.account, T("2026-10-19T11:00:00Z"));
      putRow(ctx, "user-1", entry.appId, account);
      localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");
      at("2026-10-20T13:00:00Z");
      await loadPage(entry);
      ctx.server.net.failGets = 1_000_000;
      signIn(ctx.session, "user-1");
      let view = mount(entry);
      await settle(60_000, 1_000);
      play(entry, inputs.guest);
      await settle(9 * 60_000, 1_000);
      ctx.server.net.failGets = 0;
      await settle(60_000, 1_000);
      view.unmount();
      // The next page load.
      await loadPage(entry);
      view = mount(entry);
      await settle(6_000);
      view.unmount();
      return result(ctx, entry.appId, { account, guest: inputs.guest }, ctx.server.row(entry.appId) as Progress | undefined, inputs);
    },
  };
}

/**
 * The kid plays on an untouched device while the first GET is in flight.
 * - "fast": the GET takes 300 ms and the kid makes one change at 100 ms.
 * - "slow": the GET takes 1.5 s and the kid plays at 400 ms (one change, or
 *   a lot of play). master's saves do not wait for the first sync, so its
 *   1 s poller sends the play before the sync does.
 */
function inFlightCell(entry: SyncedStoreEntry, speed: "fast" | "slow", amount: "little" | "lots"): Cell {
  return {
    id: `inFlight ${speed} ${amount} ${entry.appId}`,
    family: speed === "fast" ? "inFlightFast" : "inFlightSlow",
    appId: entry.appId,
    // This device becomes touched during GET; it must match normal LWW.
    untouchedOrTab: false,
    async run(ctx, inputs) {
      const account = withTime(entry, inputs.account, T("2026-10-20T11:00:00Z"));
      putRow(ctx, "user-1", entry.appId, account);
      localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");
      at("2026-10-20T13:00:00Z");
      await loadPage(entry);
      ctx.server.net.getDelayMs = speed === "fast" ? 300 : 1_500;
      signIn(ctx.session, "user-1");
      const view = mount(entry);
      await settle(speed === "fast" ? 100 : 400, speed === "fast" ? 100 : 250);
      const kid = amount === "little" ? inputs.little : inputs.guest;
      play(entry, kid);
      await settle(8_000);
      view.unmount();
      return result(ctx, entry.appId, { account, kid }, ctx.server.row(entry.appId) as Progress | undefined, inputs);
    },
  };
}

function tabCell(entry: SyncedStoreEntry): Cell {
  return {
    id: `tab ${entry.appId}`,
    family: "tab",
    appId: entry.appId,
    untouchedOrTab: true,
    async run(ctx, inputs) {
      // This tab synced the account's progress at 12:00.
      at("2026-10-20T12:00:00Z");
      const start = withTime(entry, inputs.account, Date.now());
      putRow(ctx, "user-1", entry.appId, start);
      localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");
      entry.store.getState().setProgress(clone(start) as never);
      await loadPage(entry);
      signIn(ctx.session, "user-1");
      const view = mount(entry);
      await settle(3_000);
      // 12:30: another tab of this device saves newer progress and uploads it.
      at("2026-10-20T12:30:00Z");
      const theirs = withTime(entry, inputs.guest, Date.now());
      const mine = progressNow(entry);
      const other = { raw: null as string | null };
      act(() => {
        entry.store.getState().setProgress(clone(theirs) as never);
        other.raw = localStorage.getItem(entry.key);
        entry.store.getState().setProgress(mine as never);
      });
      const written = other.raw;
      if (written === null) throw new Error(`${entry.appId}: the other tab wrote no save`);
      putRow(ctx, "user-1", entry.appId, theirs);
      act(() => {
        localStorage.setItem(entry.key, written);
        window.dispatchEvent(new StorageEvent("storage", { key: entry.key, newValue: written }));
      });
      // 12:40: the kid plays on in this tab.
      at("2026-10-20T12:40:00Z");
      play(entry, progressNow(entry));
      await settle(6_000);
      view.unmount();
      // The start is the older line of play: only the other tab's newer values must stay.
      return result(ctx, entry.appId, { other: theirs }, ctx.server.row(entry.appId) as Progress | undefined, inputs, [start]);
    },
  };
}

function ownerSwitchCell(entry: SyncedStoreEntry): Cell {
  return {
    id: `ownerSwitch ${entry.appId}`,
    family: "ownerSwitch",
    appId: entry.appId,
    untouchedOrTab: true,
    async run(ctx, inputs) {
      const kidB = withTime(entry, inputs.account, T("2026-10-20T11:00:00Z"));
      putRow(ctx, "user-B", entry.appId, kidB);
      // Kid A's device: kid A's progress, synced.
      at("2026-10-20T11:30:00Z");
      const kidA = withTime(entry, inputs.guest, Date.now());
      putRow(ctx, "user-A", entry.appId, kidA);
      localStorage.setItem(PROGRESS_OWNER_KEY, "user-A");
      entry.store.getState().setProgress(clone(kidA) as never);
      at("2026-10-20T12:00:00Z");
      await loadPage(entry);
      signIn(ctx.session, "user-A");
      const view = mount(entry);
      await settle(3_000);
      // Another tab signs in as kid B (the login page does not sign out first).
      signIn(ctx.session, "user-B");
      view.rerender();
      await settle(500);
      // Kid A plays on at this page; then the page goes.
      at("2026-10-20T12:05:00Z");
      play(entry, progressNow(entry));
      await settle(4_000);
      await act(async () => {
        await view.result.current.forceSync();
      });
      window.dispatchEvent(new Event("beforeunload"));
      view.unmount();
      await settle(500);
      return result(ctx, entry.appId, { kidB }, ctx.server.row(entry.appId, "user-B") as Progress | undefined, inputs);
    },
  };
}

function gapCell(entry: SyncedStoreEntry): Cell {
  return {
    id: `gap ${entry.appId}`,
    family: "gap",
    appId: entry.appId,
    untouchedOrTab: false,
    async run(ctx, inputs) {
      // The old code's played save after a sign-out on the old code (it
      // keeps the owner key and writes the broadcast key).
      localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");
      localStorage.setItem(SIGNOUT_BROADCAST_KEY, String(T("2026-08-25T10:00:00Z")));
      localStorage.setItem(entry.key, JSON.stringify(LEGACY["86a1fe0"][entry.appId].played));
      const account = withTime(entry, inputs.account, T("2026-08-20T10:00:00Z"));
      putRow(ctx, "user-1", entry.appId, account);
      at("2026-10-20T13:00:00Z");
      await loadPage(entry);
      signIn(ctx.session, "user-1");
      const view = mount(entry);
      await settle(6_000);
      view.unmount();
      return result(ctx, entry.appId, { device: inputs.device["86a1fe0"].played, account }, ctx.server.row(entry.appId) as Progress | undefined, inputs);
    },
  };
}

/** Every cell, in a fixed order. */
export function allCells(): Cell[] {
  const out: Cell[] = [];
  for (const format of FORMATS) {
    for (const entry of SYNCED_STORES) {
      for (const device of DEVICES) for (const row of ROWS) out.push(deployCell(entry, format, device, row));
    }
  }
  for (const entry of SYNCED_STORES) {
    out.push(
      guestLotsCell(entry),
      blankOutageCell(entry),
      inFlightCell(entry, "fast", "little"),
      inFlightCell(entry, "slow", "little"),
      inFlightCell(entry, "slow", "lots"),
      tabCell(entry),
      ownerSwitchCell(entry),
      gapCell(entry)
    );
  }
  return out;
}

export function createContext(session: Session): Ctx {
  return { session, server: createProgressServer(session) };
}
