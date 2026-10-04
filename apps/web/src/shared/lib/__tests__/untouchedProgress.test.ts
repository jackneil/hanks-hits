import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ownerBoundProgress, bindPersistedStore } from "@/lib/owner-bound-progress";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
import {
  PROGRESS_SUM_KEY,
  PROGRESS_TIME_MARKER,
  addListItems,
  defineUntouchedProgress,
  foldProgress,
  isLegacyUntouchedRow,
  isMarkedSave,
  isUntouchedProgress,
  listItemKeys,
  markSaved,
  markSavedWithSum,
  newListItems,
  persistSettledSave,
  progressFromSave,
  progressSum,
  settleOnLoad,
  settleSave,
} from "../untouchedProgress";

// Test-only rules, under app ids that no store uses in this file's module graph.
const nested = defineUntouchedProgress("2048", {
  defaults: { highScore: 0, seen: [] as string[], views: 0, settings: { sound: true }, lastModified: 0 },
  ignore: ["settings"],
  within: { views: (value) => typeof value === "number" && value <= 1 },
});
const flat = defineUntouchedProgress("snake", {
  layout: "flat",
  defaults: { highScore: 0, lastModified: 0 },
});
const listed = defineUntouchedProgress("drum-machine", {
  layout: "flat",
  defaults: { beats: [] as Array<{ id: string; name: string; at?: string }>, tags: [] as string[], coins: 0, highScore: 0, phase: "title", lastModified: 0 },
  ignore: ["phase"],
  lists: { beats: { id: "id", max: 3, order: "newestLast", time: "at" }, tags: { max: 10, order: "newestLast" } },
});
// A list that adds at the start and drops its oldest at the end (the drawing app).
defineUntouchedProgress("drawing-app", {
  layout: "flat",
  defaults: { art: [] as Array<{ id: string; at: number }>, lastModified: 0 },
  lists: { art: { id: "id", max: 3, order: "newestFirst", time: "at" } },
});

describe("isUntouchedProgress", () => {
  it("a key that the progress does not hold counts as its default (a row of an older version)", () => {
    expect(isUntouchedProgress("2048", { highScore: 0, views: 0, settings: { sound: true }, lastModified: 5 })).toBe(true);
    expect(isUntouchedProgress("2048", { highScore: 0, lastModified: 5 })).toBe(true);
    expect(isUntouchedProgress("2048", { highScore: 1, lastModified: 5 })).toBe(false);
  });

  it("an ignored setting never makes progress touched; a `within` counter only past its bound", () => {
    expect(isUntouchedProgress("2048", { highScore: 0, settings: { sound: false }, views: 1 })).toBe(true);
    expect(isUntouchedProgress("2048", { highScore: 0, views: 2 })).toBe(false);
  });
});

describe("isLegacyUntouchedRow", () => {
  it("every untouched row, whatever its time (the new code never uploads one): a rollback, a late deploy and a wrong clock all write new times", () => {
    for (const time of [Date.UTC(2026, 7, 18), Date.UTC(2026, 9, 17), Date.UTC(2027, 0, 1), Date.UTC(2020, 0, 1)]) {
      expect(isLegacyUntouchedRow("2048", { highScore: 0, lastModified: time })).toBe(true);
      expect(isLegacyUntouchedRow("2048", { highScore: 0, settings: { sound: false }, lastModified: time })).toBe(true);
    }
    expect(isLegacyUntouchedRow("2048", { highScore: 0 })).toBe(true);
    expect(isLegacyUntouchedRow("2048", { highScore: 9, lastModified: 1 })).toBe(false);
    expect(isLegacyUntouchedRow("2048", { highScore: 0, views: 2, lastModified: Date.UTC(2027, 0, 1) })).toBe(false);
    expect(isLegacyUntouchedRow("unknown-app", { lastModified: 1 })).toBe(false);
  });
});

describe("foldProgress", () => {
  it("keeps the base and its time, and folds the other side's records in", () => {
    const base = { highScore: 5, gamesPlayed: 1, unlockedThings: ["a"], coins: 3, lastModified: 100 };
    const other = { highScore: 9, gamesPlayed: 4, unlockedThings: ["b"], coins: 50, lastModified: 900 };
    expect(foldProgress("2048", base, other)).toEqual({
      highScore: 9,
      gamesPlayed: 4,
      unlockedThings: ["a", "b"],
      coins: 3,
      lastModified: 100,
    });
  });
});

describe("list items (F4, F5, F6 of part B1)", () => {
  afterEach(() => vi.restoreAllMocks());

  const account = {
    beats: [{ id: "a", name: "Account beat", at: "2026-10-20T10:00:00.000Z" }],
    tags: ["x"],
    coins: 500,
    highScore: 7,
    phase: "travel",
    lastModified: 1_000,
  };

  it("newListItems: the items that no known progress holds, per list", () => {
    const device = {
      ...account,
      beats: [...account.beats, { id: "b", name: "Saved beat" }, { id: "c", name: "New beat" }],
      tags: ["x", "y"],
    };
    const saved = { ...account, beats: [...account.beats, { id: "b", name: "Saved beat" }] };
    expect(newListItems("drum-machine", device, [listItemKeys("drum-machine", saved)])).toEqual({
      beats: [{ id: "c", name: "New beat" }],
      tags: ["y"],
    });
    expect(newListItems("drum-machine", device, [listItemKeys("drum-machine", device)])).toEqual({});
    expect(newListItems("2048", { highScore: 3 }, [])).toEqual({});
  });

  it("addListItems: adds the new items, keeps the base's own copy of an item that both hold, and keeps the base's other fields and time", () => {
    const out = addListItems("drum-machine", account, {
      beats: [
        { id: "a", name: "A, renamed" },
        { id: "g", name: "Guest beat", at: "2026-10-20T11:00:00.000Z" },
      ],
      tags: ["y"],
    });
    expect(out).toEqual({
      ...account,
      beats: [account.beats[0], { id: "g", name: "Guest beat", at: "2026-10-20T11:00:00.000Z" }],
      tags: ["x", "y"],
    });
    expect(addListItems("drum-machine", account, {})).toBe(account);
  });

  it("addListItems: a list that is missing counts as empty", () => {
    const { beats: _beats, ...noBeats } = account;
    void _beats;
    const out = addListItems("drum-machine", noBeats as typeof account, { beats: [{ id: "g", name: "G" }] });
    expect(out.beats).toEqual([{ id: "g", name: "G" }]);
  });

  it("addListItems: a full list keeps its newest items by their time, as the store's own eviction does, and logs the drop without values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const full = {
      ...account,
      beats: [
        { id: "a", name: "A", at: "2026-10-20T10:00:00.000Z" },
        { id: "b", name: "B", at: "2026-10-20T10:05:00.000Z" },
        { id: "c", name: "C", at: "2026-10-20T10:10:00.000Z" },
      ],
    };
    // One item newer than all, and one older than all: the two oldest go.
    const out = addListItems("drum-machine", full, {
      beats: [
        { id: "n", name: "Newest", at: "2026-10-20T12:00:00.000Z" },
        { id: "o", name: "Oldest", at: "2026-10-20T09:00:00.000Z" },
      ],
    });
    expect(out.beats.map((beat) => beat.id)).toEqual(["b", "c", "n"]);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("drum-machine.beats");
    expect(line).toContain("2 older item(s)");
    expect(line).not.toMatch(/Newest|Oldest|"A"|B,/);
  });

  it("addListItems: a list that adds at the start keeps its newest items at the start, and drops the oldest at the end", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = { art: [{ id: "c", at: 30 }, { id: "b", at: 20 }, { id: "a", at: 10 }], lastModified: 5 };
    const out = addListItems("drawing-app", base, { art: [{ id: "x", at: 25 }] });
    expect(out.art).toEqual([{ id: "c", at: 30 }, { id: "x", at: 25 }, { id: "b", at: 20 }]);
  });

  it("addListItems: a list with no item time keeps the base's order and adds at the store's end", () => {
    const out = addListItems("drum-machine", { ...account, tags: ["x", "z"] }, { tags: ["y"] });
    expect(out.tags).toEqual(["x", "z", "y"]);
  });
});

describe("the sum of a save (a rollback to the old code)", () => {
  it("skips the time and the ignored fields, and does not depend on the order of the keys", () => {
    const saved = { beats: [], tags: ["x"], coins: 5, highScore: 1, phase: "title", lastModified: 10 };
    const same = { lastModified: 99, phase: "travel", highScore: 1, coins: 5, tags: ["x"], beats: [] };
    expect(progressSum(listed, same)).toBe(progressSum(listed, saved));
    expect(progressSum(listed, { ...saved, coins: 6 })).not.toBe(progressSum(listed, saved));
  });

  it("a save that the old code changed after this code saved it gets the old rule's time; an unchanged one keeps its time", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    try {
      const saved = markSavedWithSum(listed, { beats: [], tags: [], coins: 5, highScore: 1, phase: "title", lastModified: 10 });
      expect(isMarkedSave(saved)).toBe(true);
      expect(saved[PROGRESS_SUM_KEY as keyof typeof saved]).toBe(progressSum(listed, saved));
      // This code's save, or the old code's rewrite that changed only a phase.
      expect(settleSave(saved, listed)).toEqual({ beats: [], tags: [], coins: 5, highScore: 1, phase: "title", lastModified: 10 });
      expect(settleSave({ ...saved, phase: "travel" }, listed)).toMatchObject({ phase: "travel", lastModified: 10 });
      // The old code played on and kept this code's marker and time.
      expect(settleSave({ ...saved, coins: 40 }, listed)).toMatchObject({ coins: 40, lastModified: Date.now() });
      // ... and an old-code change back to the defaults is untouched.
      expect(settleSave({ ...saved, coins: 0, highScore: 0 }, listed)).toMatchObject({ lastModified: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("persistSettledSave", () => {
  type Flat = { highScore: number; lastModified: number; bump: () => void };
  const makeStore = async (name: string) => {
    const store = create<Flat>()(
      persist(
        (set) => ({ highScore: 0, lastModified: 0, bump: () => set((s) => ({ highScore: s.highScore + 1 })) }),
        {
          name,
          storage: createOwnerPersistStorage(name, "snake"),
          skipHydration: true,
          merge: settleOnLoad(flat),
          partialize: (state) => markSaved({ highScore: state.highScore, lastModified: state.lastModified }),
        }
      )
    );
    bindPersistedStore(name, store.persist);
    persistSettledSave(store, flat);
    await ownerBoundProgress.updateSession("unauthenticated");
    await ownerBoundProgress.whenHydrated(name);
    return store;
  };

  it("writes a settled save once, so that a save with no time keeps one time across loads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
      localStorage.setItem("settle-test", JSON.stringify({ state: { highScore: 4 }, version: 0 }));
      const store = await makeStore("settle-test");
      expect(store.getState().lastModified).toBe(Date.parse("2026-10-05T12:00:00Z"));
      expect(isMarkedSave(JSON.parse(ownerBoundProgress.readScoped("settle-test")!).state)).toBe(true);
      // The next load, two days later and with no change: the same time.
      vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
      await store.persist.rehydrate();
      expect(store.getState().lastModified).toBe(Date.parse("2026-10-05T12:00:00Z"));
    } finally {
      vi.useRealTimers();
      localStorage.removeItem("settle-test");
    }
  });

  it("writes nothing for a save of this code", async () => {
    const raw = JSON.stringify({ state: markSaved({ highScore: 4, lastModified: 77 }), version: 0 });
    localStorage.setItem("settle-test-2", raw);
    const store = await makeStore("settle-test-2");
    expect(store.getState().lastModified).toBe(77);
    expect(localStorage.getItem("settle-test-2")).toBe(raw);
    localStorage.removeItem("settle-test-2");
  });
});

describe("saves", () => {
  it("a save of the new code keeps its time; an older save gets its real time", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    try {
      const marked = markSaved({ progress: { highScore: 0, lastModified: 777 } });
      expect(settleSave(marked, nested)).toEqual({ progress: { highScore: 0, lastModified: 777 } });
      expect(settleSave({ progress: { highScore: 0, lastModified: 777 } }, nested)).toEqual({
        progress: { highScore: 0, lastModified: 0 },
      });
      expect(settleSave({ progress: { highScore: 3, lastModified: 777 } }, nested)).toEqual({
        progress: { highScore: 3, lastModified: 777 },
      });
      expect(settleSave({ highScore: 3 }, flat)).toEqual({ highScore: 3, lastModified: Date.now() });
    } finally {
      vi.useRealTimers();
    }
  });

  it("progressFromSave reads the progress without the marker", () => {
    expect(progressFromSave("snake", { highScore: 2, lastModified: 5, [PROGRESS_TIME_MARKER]: 1 })).toEqual({
      highScore: 2,
      lastModified: 5,
    });
    expect(progressFromSave("unknown-app", { highScore: 2 })).toBeNull();
  });
});
