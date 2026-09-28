import { describe, expect, it } from "vitest";

import {
  BREAKER_ITEM_PREFIX,
  BREAKER_WINDOW_MS,
  CLEAN_SESSIONS_TO_RESET,
  CrashBreaker,
  TAB_LOCK_PREFIX,
  verdictFor,
} from "../breaker";
import { FakeLockManager, settleLocks } from "./fakeLocks";

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

function world() {
  const locks = new FakeLockManager();
  const storage = new MemoryStorage();
  let now = 1_000_000;
  const tab = (id: string) => new CrashBreaker({ storage, locks: locks.client(id), now: () => now, tabLock: `${TAB_LOCK_PREFIX}${id}` });
  return {
    locks,
    storage,
    tab,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** A tab that starts capturing the game and then dies. */
async function crashOnce(w: ReturnType<typeof world>, id: string, gameId = "breakout") {
  const b = w.tab(id);
  await b.begin(gameId);
  b.setCapturing(gameId, true);
  w.locks.crash(id);
  await settleLocks();
}

describe("crash-loop breaker", () => {
  it("starts clean, with the tab lock held for the tab's life", async () => {
    const w = world();
    const b = w.tab("a");
    expect(await b.begin("breakout")).toEqual({ state: "ok", startLevel: 0, crashes: 0 });
    expect(w.locks.holderOf(`${TAB_LOCK_PREFIX}a`)).toBe("a");
  });

  it("counts a marker whose tab lock is gone as a crash, and starts one rung lower", async () => {
    const w = world();
    await crashOnce(w, "dead");
    expect(await w.tab("b").begin("breakout")).toEqual({ state: "lower", startLevel: 1, crashes: 1 });
  });

  it("never counts the marker of a live tab, even while it captures", async () => {
    const w = world();
    const live = w.tab("live");
    await live.begin("breakout");
    live.setCapturing("breakout", true);
    expect(await w.tab("b").begin("breakout")).toEqual({ state: "ok", startLevel: 0, crashes: 0 });
    // The live tab's marker stays for later checks.
    const record = JSON.parse(w.storage.getItem(`${BREAKER_ITEM_PREFIX}breakout`)!);
    expect(record.open).toHaveLength(1);
  });

  it("does not count a tab that died while hidden or paused (not capturing)", async () => {
    const w = world();
    const b = w.tab("bg");
    await b.begin("breakout");
    b.setCapturing("breakout", true);
    b.setCapturing("breakout", false);
    w.locks.crash("bg");
    await settleLocks();
    expect((await w.tab("c").begin("breakout")).state).toBe("ok");
  });

  it("does not count a clean end or a pagehide", async () => {
    const w = world();
    const b = w.tab("a");
    await b.begin("breakout");
    b.setCapturing("breakout", true);
    b.end("breakout");
    w.locks.crash("a");
    const c = w.tab("c");
    await c.begin("snake");
    c.setCapturing("snake", true);
    c.endAll();
    c.releaseTabLock();
    await settleLocks();
    expect((await w.tab("d").begin("breakout")).state).toBe("ok");
    expect((await w.tab("e").begin("snake")).state).toBe("ok");
  });

  it("disables the game after two crashes in 7 days, per game", async () => {
    const w = world();
    await crashOnce(w, "x1");
    await w.tab("check").begin("breakout");
    await crashOnce(w, "x2");
    expect(await w.tab("y").begin("breakout")).toEqual({ state: "disabled", startLevel: 0, crashes: 2 });
    expect((await w.tab("z").begin("snake")).state).toBe("ok");
  });

  it("forgets crashes older than 7 days", async () => {
    const w = world();
    await crashOnce(w, "x1");
    await w.tab("check").begin("breakout");
    await crashOnce(w, "x2");
    w.advance(BREAKER_WINDOW_MS + 1);
    expect((await w.tab("y").begin("breakout")).state).toBe("ok");
  });

  it("clears the crashes after five clean sessions, counted from the last crash", async () => {
    const w = world();
    await crashOnce(w, "x1");
    await w.tab("check").begin("breakout");
    await crashOnce(w, "x2");
    for (let i = 0; i < CLEAN_SESSIONS_TO_RESET - 1; i++) {
      const b = w.tab(`clean${i}`);
      expect((await b.begin("breakout")).state).toBe("disabled");
      b.end("breakout");
    }
    const last = w.tab("clean-last");
    expect((await last.begin("breakout")).state).toBe("disabled");
    last.end("breakout");
    expect((await w.tab("after").begin("breakout")).state).toBe("ok");
    expect(w.storage.getItem(`${BREAKER_ITEM_PREFIX}breakout`)).toBeNull();
  });

  it("restarts the clean count at a new crash", async () => {
    const w = world();
    await crashOnce(w, "x1");
    for (let i = 0; i < CLEAN_SESSIONS_TO_RESET - 1; i++) {
      const b = w.tab(`c${i}`);
      await b.begin("breakout");
      b.end("breakout");
    }
    await crashOnce(w, "x2");
    const b = w.tab("next");
    expect((await b.begin("breakout")).state).toBe("disabled");
    b.end("breakout");
    expect((await w.tab("again").begin("breakout")).state).toBe("disabled");
  });

  it("is off without Web Locks: it never calls a live tab a crash", async () => {
    const storage = new MemoryStorage();
    const a = new CrashBreaker({ storage, locks: null, now: () => 1 });
    await a.begin("breakout");
    a.setCapturing("breakout", true);
    const b = new CrashBreaker({ storage, locks: null, now: () => 2 });
    expect((await b.begin("breakout")).state).toBe("ok");
  });

  it("survives a broken stored value and a storage that throws", async () => {
    const w = world();
    w.storage.setItem(`${BREAKER_ITEM_PREFIX}breakout`, "{not json");
    expect((await w.tab("a").begin("breakout")).state).toBe("ok");
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const b = new CrashBreaker({ storage: throwing, locks: new FakeLockManager().client("t"), now: () => 1 });
    expect((await b.begin("breakout")).state).toBe("ok");
    expect(() => b.setCapturing("breakout", true)).not.toThrow();
  });

  it("releases the tab lock at pagehide and takes it again at pageshow", async () => {
    const w = world();
    const b = w.tab("a");
    await b.begin("breakout");
    b.releaseTabLock();
    await settleLocks();
    expect(w.locks.holderOf(`${TAB_LOCK_PREFIX}a`)).toBeNull();
    expect(await b.holdTabLock()).toBe(true);
    expect(w.locks.holderOf(`${TAB_LOCK_PREFIX}a`)).toBe("a");
  });

  it("maps a crash count to a verdict", () => {
    expect(verdictFor(0)).toEqual({ state: "ok", startLevel: 0, crashes: 0 });
    expect(verdictFor(1)).toEqual({ state: "lower", startLevel: 1, crashes: 1 });
    expect(verdictFor(3)).toEqual({ state: "disabled", startLevel: 0, crashes: 3 });
  });
});
