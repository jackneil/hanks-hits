import { describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  PROGRESS_SUM_KEY,
  PROGRESS_TIME_MARKER,
  defineUntouchedProgress,
  foldGuestProgress,
  foldProgress,
  isLegacyUntouchedRow,
  isMarkedSave,
  isUntouchedProgress,
  markSaved,
  markSavedWithSum,
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
  defaults: { beats: [] as Array<{ id: string; name: string }>, tags: [] as string[], coins: 0, highScore: 0, phase: "title", lastModified: 0 },
  ignore: ["phase"],
  lists: { beats: { id: "id", max: 3 }, tags: { max: 10 } },
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

describe("foldGuestProgress", () => {
  const account = {
    beats: [{ id: "a", name: "Account beat" }],
    tags: ["x"],
    coins: 500,
    highScore: 7,
    phase: "travel",
    lastModified: 1_000,
  };

  it("keeps the account's progress, folds the device's records in, and adds the items that the device made", () => {
    const guest = {
      beats: [{ id: "g", name: "Guest beat" }],
      tags: ["x", "y"],
      coins: 3,
      highScore: 12,
      phase: "title",
      lastModified: 5_000,
    };
    expect(foldGuestProgress("drum-machine", account, guest)).toEqual({
      beats: [
        { id: "a", name: "Account beat" },
        { id: "g", name: "Guest beat" },
      ],
      tags: ["x", "y"],
      coins: 500,
      highScore: 12,
      phase: "travel",
      lastModified: 1_000,
    });
  });

  it("an item that both hold stays once (the account's copy), and the list never passes the schema's bound", () => {
    const full = { ...account, beats: [{ id: "a", name: "A" }, { id: "b", name: "B" }] };
    const guest = { ...account, beats: [{ id: "a", name: "A, renamed" }, { id: "c", name: "C" }, { id: "d", name: "D" }] };
    expect(foldGuestProgress("drum-machine", full, guest).beats).toEqual([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ]);
  });

  it("an account list that is missing counts as empty", () => {
    const { beats: _beats, ...noBeats } = account;
    void _beats;
    const guest = { ...account, beats: [{ id: "g", name: "G" }] };
    const folded = foldGuestProgress("drum-machine", noBeats, guest) as Record<string, unknown>;
    expect(folded.beats).toEqual([{ id: "g", name: "G" }]);
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
  const makeStore = (name: string) => {
    const store = create<Flat>()(
      persist(
        (set) => ({ highScore: 0, lastModified: 0, bump: () => set((s) => ({ highScore: s.highScore + 1 })) }),
        {
          name,
          merge: settleOnLoad(flat),
          partialize: (state) => markSaved({ highScore: state.highScore, lastModified: state.lastModified }),
        }
      )
    );
    persistSettledSave(store, flat);
    return store;
  };

  it("writes a settled save once, so that a save with no time keeps one time across loads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
      localStorage.setItem("settle-test", JSON.stringify({ state: { highScore: 4 }, version: 0 }));
      const store = makeStore("settle-test");
      expect(store.getState().lastModified).toBe(Date.parse("2026-10-05T12:00:00Z"));
      expect(isMarkedSave(JSON.parse(localStorage.getItem("settle-test")!).state)).toBe(true);
      // The next load, two days later and with no change: the same time.
      vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
      await store.persist.rehydrate();
      expect(store.getState().lastModified).toBe(Date.parse("2026-10-05T12:00:00Z"));
    } finally {
      vi.useRealTimers();
      localStorage.removeItem("settle-test");
    }
  });

  it("writes nothing for a save of this code", () => {
    const raw = JSON.stringify({ state: markSaved({ highScore: 4, lastModified: 77 }), version: 0 });
    localStorage.setItem("settle-test-2", raw);
    const store = makeStore("settle-test-2");
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
