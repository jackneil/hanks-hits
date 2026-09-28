/**
 * Crash-loop breaker (plan 7).
 *
 * If capture makes a game crash its tab (out of memory, a GPU reset, a kid
 * who force-quits a frozen page), the next visit must not crash again. So:
 *
 * - Each tab holds a Web Lock ("hh-clips-tab:<random>") for its lifetime.
 *   The browser releases it when the tab dies, however it dies.
 * - While a tab captures a game, localStorage holds a marker for that game
 *   with the tab's lock name.
 * - When a session starts, each marker whose lock is gone is a tab that died
 *   while it captured: one crash. A marker whose lock is still held belongs
 *   to a live tab and is left alone.
 * - The marker says "not capturing" while the tab is hidden or the game is
 *   paused (plan 7.1: capture is suspended then). iOS kills background tabs
 *   to save memory, and that is not a capture crash.
 * - A clean end (the game unmounts, or the page is hidden for good with
 *   pagehide) removes the marker.
 * - One crash in 7 days: the game starts one rung lower. Two crashes in 7
 *   days: clips are off for that game ("disabled", reason "breaker"). Five
 *   clean sessions after the last crash clear the crashes.
 *
 * Without Web Locks, a dead tab cannot be told from a live one, so no marker
 * ever counts as a crash (the breaker is off, never falsely on).
 *
 * bfcache: a page that holds a Web Lock cannot enter Chrome's back/forward
 * cache, so the tab lock is released at pagehide and taken again at pageshow.
 */

import { holdLock, randomId, type LockHold, type WebLocksLike } from "./webLocks";

export const BREAKER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const CRASHES_TO_DISABLE = 2;
export const CLEAN_SESSIONS_TO_RESET = 5;
export const BREAKER_ITEM_PREFIX = "hh-clips-breaker.v1:";
export const TAB_LOCK_PREFIX = "hh-clips-tab:";

export type BreakerState = "ok" | "lower" | "disabled";

export interface BreakerVerdict {
  state: BreakerState;
  /** Governor start level: 1 (one rung lower) after one crash, else 0. */
  startLevel: number;
  /** Crashes in the last 7 days. */
  crashes: number;
}

interface Marker {
  lock: string;
  startedAt: number;
  capturing: boolean;
}

interface BreakerRecord {
  crashes: number[];
  clean: number;
  open: Marker[];
}

export interface BreakerEnv {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  locks: WebLocksLike | null;
  now: () => number;
  /** The tab lock name. Default: a new random one. */
  tabLock?: string;
}

function emptyRecord(): BreakerRecord {
  return { crashes: [], clean: 0, open: [] };
}

function isRecord(value: unknown): value is BreakerRecord {
  const v = value as Partial<BreakerRecord> | null;
  return (
    !!v &&
    Array.isArray(v.crashes) &&
    v.crashes.every((c) => typeof c === "number" && Number.isFinite(c)) &&
    typeof v.clean === "number" &&
    Array.isArray(v.open) &&
    v.open.every((m) => !!m && typeof m.lock === "string" && typeof m.startedAt === "number" && typeof m.capturing === "boolean")
  );
}

export function verdictFor(crashes: number): BreakerVerdict {
  if (crashes >= CRASHES_TO_DISABLE) return { state: "disabled", startLevel: 0, crashes };
  if (crashes === 1) return { state: "lower", startLevel: 1, crashes };
  return { state: "ok", startLevel: 0, crashes };
}

export class CrashBreaker {
  readonly tabLock: string;
  private hold: LockHold | null = null;
  /** Games this tab has a marker for (so pagehide can end them). */
  private readonly active = new Set<string>();

  constructor(private readonly env: BreakerEnv) {
    this.tabLock = env.tabLock ?? `${TAB_LOCK_PREFIX}${randomId()}`;
  }

  /** Takes the tab lock (at start and at pageshow). Resolves when it is held. */
  async holdTabLock(): Promise<boolean> {
    if (!this.env.locks) return false;
    if (!this.hold) {
      const hold = holdLock(this.env.locks, this.tabLock);
      this.hold = hold;
      void hold.lost.then(() => {
        if (this.hold === hold) this.hold = null;
      });
    }
    return this.hold.granted;
  }

  /** Lets go of the tab lock (pagehide, so the page can enter the bfcache). */
  releaseTabLock(): void {
    this.hold?.release();
    this.hold = null;
  }

  /**
   * Starts a session of gameId: turns markers of dead tabs into crashes and
   * says how capture starts. Call it before capture starts.
   */
  async begin(gameId: string): Promise<BreakerVerdict> {
    await this.holdTabLock();
    const record = this.read(gameId);
    const now = this.env.now();
    if (this.env.locks && record.open.length > 0) {
      let held: Set<string> | null = null;
      try {
        const snapshot = await this.env.locks.query();
        held = new Set((snapshot.held ?? []).map((l) => l.name ?? ""));
      } catch {
        held = null;
      }
      if (held) {
        const live = held;
        const kept: Marker[] = [];
        for (const marker of record.open) {
          if (marker.lock === this.tabLock) continue;
          if (live.has(marker.lock)) {
            kept.push(marker);
            continue;
          }
          if (marker.capturing) {
            record.crashes.push(marker.startedAt);
            record.clean = 0;
          }
        }
        record.open = kept;
      }
    } else {
      record.open = record.open.filter((m) => m.lock !== this.tabLock);
    }
    record.crashes = record.crashes.filter((at) => now - at < BREAKER_WINDOW_MS && at <= now);
    if (record.crashes.length === 0) record.clean = 0;
    this.write(gameId, record);
    return verdictFor(record.crashes.length);
  }

  /** This tab captures gameId now (true), or has stopped for a while (false: hidden, paused). */
  setCapturing(gameId: string, capturing: boolean): void {
    const record = this.read(gameId);
    const mine = record.open.find((m) => m.lock === this.tabLock);
    if (mine) {
      if (mine.capturing === capturing) return;
      mine.capturing = capturing;
      if (capturing) mine.startedAt = this.env.now();
    } else {
      if (!capturing) return;
      record.open.push({ lock: this.tabLock, startedAt: this.env.now(), capturing: true });
    }
    this.active.add(gameId);
    this.write(gameId, record);
  }

  /** The session of gameId ended cleanly. Counts it toward the reset. */
  end(gameId: string): void {
    const record = this.read(gameId);
    record.open = record.open.filter((m) => m.lock !== this.tabLock);
    if (record.crashes.length > 0) {
      record.clean += 1;
      if (record.clean >= CLEAN_SESSIONS_TO_RESET) {
        record.crashes = [];
        record.clean = 0;
      }
    }
    this.active.delete(gameId);
    this.write(gameId, record);
  }

  /** pagehide: every open session of this tab ends cleanly (the page did not crash). */
  endAll(): void {
    for (const gameId of [...this.active]) this.end(gameId);
  }

  /** The verdict now, without looking for crashes (for a snapshot). */
  current(gameId: string): BreakerVerdict {
    const now = this.env.now();
    return verdictFor(this.read(gameId).crashes.filter((at) => now - at < BREAKER_WINDOW_MS && at <= now).length);
  }

  private key(gameId: string): string {
    return `${BREAKER_ITEM_PREFIX}${gameId}`;
  }

  private read(gameId: string): BreakerRecord {
    try {
      const raw = this.env.storage?.getItem(this.key(gameId));
      if (!raw) return emptyRecord();
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : emptyRecord();
    } catch {
      return emptyRecord();
    }
  }

  private write(gameId: string, record: BreakerRecord): void {
    try {
      if (record.crashes.length === 0 && record.open.length === 0) this.env.storage?.removeItem(this.key(gameId));
      else this.env.storage?.setItem(this.key(gameId), JSON.stringify(record));
    } catch {
      // Storage full or blocked: the breaker cannot remember, so it stays off.
    }
  }
}
