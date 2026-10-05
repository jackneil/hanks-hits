import { beforeAll, describe, expect, it } from "vitest";
import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { VALID_APP_IDS } from "@hank-neil/db/schema";
import { persistedStores } from "@/__tests__/persisted-store-fixtures";
import { validateProgress } from "@/lib/progress-schemas";
import { PROGRESS_FIELD_RULES } from "@/lib/progress-field-rules";
import { PROGRESS_CONFLICT_POLICIES } from "../progressConflictPolicy";
import { mergeProgressConflict } from "../progressConflict";

const defaults = new Map<ValidAppId, AppProgressData>();
const clone = <T>(data: T): T => JSON.parse(JSON.stringify(data));
const initial = (appId: ValidAppId) => clone(defaults.get(appId)!);
const merged = (appId: ValidAppId, base: AppProgressData, local: AppProgressData, remote: AppProgressData) => {
  const result = mergeProgressConflict(appId, base, local, remote);
  expect(result.kind).toBe("merged");
  if (result.kind !== "merged") throw new Error(`Unexpected conflict: ${result.paths.join(", ")}`);
  expect(validateProgress(appId, result.data).success).toBe(true);
  return result.data;
};
const artwork = (id: string, editedAt = "2026-01-01T00:00:00Z") => ({
  id, name: id, thumbnail: "data:image/png;base64,AA==", dataUrl: "data:image/png;base64,AA==",
  createdAt: "2026-01-01T00:00:00Z", editedAt,
});

beforeAll(async () => {
  for (const entry of persistedStores) {
    const store = await entry.load();
    const id = (entry.file.startsWith("shared/") ? "achievements" : entry.file.split("/")[1]) as ValidAppId;
    defaults.set(id, clone(store.getState().getProgress()) as unknown as AppProgressData);
  }
});

describe("revision conflict policy", () => {
  it("requires an explicit policy for every registered app", () => {
    expect(Object.keys(PROGRESS_CONFLICT_POLICIES).sort()).toEqual([...VALID_APP_IDS].sort());
    expect([...defaults.keys()].sort()).toEqual([...VALID_APP_IDS].sort());
  });
  it.each(VALID_APP_IDS)("preserves schema-valid unchanged %s progress", (id) => {
    const base = initial(id);
    const checked = validateProgress(id, base);
    expect(checked.success).toBe(true);
    if (checked.success) expect(merged(id, base, base, base)).toEqual(checked.data);
  });
  it("keeps both independent settings from the real drawing progress shape", () => {
    const base = initial("drawing-app");
    const settings = base.settings as Record<string, unknown>;
    const local = { ...base, settings: { ...settings, showGrid: !settings.showGrid }, lastModified: 20 };
    const remote = { ...base, settings: { ...settings, soundEnabled: !settings.soundEnabled }, lastModified: 10 };
    const result = merged("drawing-app", base, local, remote);
    expect(result.settings).toEqual({ ...settings, showGrid: !settings.showGrid, soundEnabled: !settings.soundEnabled });
    expect(result.lastModified).toBe(20);
    expect(base.settings).toEqual(settings);
  });
  it("folds reviewed nested records and independent unlocked ids", () => {
    const base = initial("platformer");
    const level = { completed: true, starsCollected: 1, bestTime: 20, coinsCollected: 3 };
    const local = { ...base, levels: { "level.with.dots": level }, totalStars: 3 };
    const remote = { ...base, levels: { "level.with.dots": { ...level, starsCollected: 2, bestTime: 30 }, next: level }, totalStars: 2 };
    const out = merged("platformer", base, local, remote);
    expect(out.levels).toEqual({ "level.with.dots": { ...level, starsCollected: 2 }, next: level });
    expect(out.totalStars).toBe(3);
  });
  it("keeps an earned level when the other device removes its parent entry", () => {
    const level = { completed: true, starsCollected: 2, bestTime: 20, coinsCollected: 3 };
    const base = { ...initial("platformer"), levels: { A: level } };
    const remote = { ...base, levels: {} };
    expect(merged("platformer", base, base, remote).levels).toEqual({ A: level });
    expect(merged("platformer", base, remote, base).levels).toEqual({ A: level });
  });
  it("honors a newly reviewed atomic subtree without a duplicate policy entry", () => {
    // Simulate extending the existing field table: its subtree contract must be
    // sufficient even when a maintainer has not added a cross-field group.
    const table = PROGRESS_FIELD_RULES.trivia;
    table.settings = { rule: "neither", subtree: true, why: "A test of the reviewed subtree contract." };
    try {
      const base = initial("trivia");
      const settings = base.settings as Record<string, unknown>;
      const local = { ...base, settings: { ...settings, soundEnabled: !settings.soundEnabled } };
      const remote = { ...base, settings: { ...settings, difficulty: settings.difficulty === "4yo" ? "8yo" : "4yo" } };
      expect(mergeProgressConflict("trivia", base, local, remote)).toEqual({ kind: "conflict", paths: ["settings"] });
    } finally {
      delete table.settings;
    }
  });
  it("keeps the earliest trophy and safely treats inherited property names as data", () => {
    const base = initial("achievements");
    const local = { ...base, unlocked: JSON.parse('{"trophy":10,"constructor":4}') };
    const remote = { ...base, unlocked: JSON.parse('{"trophy":20,"toString":8}') };
    const out = merged("achievements", base, local, remote);
    expect(out.unlocked).toEqual(JSON.parse('{"trophy":10,"constructor":4,"toString":8}'));
    expect(Object.getPrototypeOf(out.unlocked)).toBe(Object.prototype);
  });
  it("does not silently discard keys that schema parsing would strip", () => {
    const base = initial("achievements");
    const local = { ...base, unlocked: JSON.parse('{"__proto__":10}') };
    expect(mergeProgressConflict("achievements", base, local, base)).toEqual({ kind: "conflict", paths: ["$schema"] });
    expect(Object.hasOwn(local.unlocked as object, "__proto__")).toBe(true);
  });
  it("merges added items and preserves an acknowledged one-sided deletion", () => {
    const base = { ...initial("drawing-app"), savedArtworks: [artwork("old")] };
    const local = { ...base, savedArtworks: [artwork("mine")] };
    const remote = { ...base, savedArtworks: [artwork("old"), artwork("theirs")] };
    expect(merged("drawing-app", base, local, remote).savedArtworks).toEqual([artwork("theirs"), artwork("mine")]);
  });
  it("selects the newer edit of one artwork without losing another artwork", () => {
    const old = artwork("same");
    const base = { ...initial("drawing-app"), savedArtworks: [old] };
    const a = { ...old, dataUrl: "local", editedAt: "2026-01-03T00:00:00Z" };
    const b = { ...old, dataUrl: "remote", editedAt: "2026-01-02T00:00:00Z" };
    const out = merged("drawing-app", base, { ...base, savedArtworks: [a] }, { ...base, savedArtworks: [b, artwork("extra")] });
    expect(out.savedArtworks).toEqual([a, artwork("extra")]);
  });
  it("keeps a newly added drawing at the front for the store's eviction order", () => {
    const old = artwork("old");
    const recent = { ...artwork("new"), createdAt: "2026-01-02T00:00:00Z" };
    const base = { ...initial("drawing-app"), savedArtworks: [old] };
    const local = { ...base, savedArtworks: [recent, old] };
    expect(merged("drawing-app", base, local, base).savedArtworks).toEqual([recent, old]);
  });
  it("preserves originals by refusing delete-versus-edit and tied edit clocks", () => {
    const old = artwork("same");
    const base = { ...initial("drawing-app"), savedArtworks: [old] };
    const edited = { ...base, savedArtworks: [{ ...old, dataUrl: "edited" }] };
    for (const local of [{ ...base, savedArtworks: [] }, { ...base, savedArtworks: [{ ...old, dataUrl: "different" }] }]) {
      expect(mergeProgressConflict("drawing-app", base, local, edited)).toEqual({ kind: "conflict", paths: ["savedArtworks"] });
    }
  });
  it("does not silently truncate two independently full drawing galleries", () => {
    const base = { ...initial("drawing-app"), savedArtworks: [] };
    const gallery = (prefix: string) => Array.from({ length: 20 }, (_, i) => artwork(`${prefix}${i}`));
    const local = { ...base, savedArtworks: gallery("a") }, remote = { ...base, savedArtworks: gallery("b") };
    expect(mergeProgressConflict("drawing-app", base, local, remote)).toEqual({ kind: "conflict", paths: ["savedArtworks"] });
    expect(local.savedArtworks).toHaveLength(20);
    expect(remote.savedArtworks).toHaveLength(20);
  });
  it("rejects duplicate identities even if the schema allows them", () => {
    const base = initial("drawing-app");
    const duplicate = { ...base, savedArtworks: [artwork("same"), artwork("same")] };
    expect(mergeProgressConflict("drawing-app", base, duplicate, duplicate).kind).toBe("conflict");
  });
  it("merges removable favorites without resurrecting the removed game", () => {
    const base = { ...initial("retro-arcade"), favorites: ["old", "keep"] };
    const local = { ...base, favorites: ["keep", "local"] };
    const remote = { ...base, favorites: ["old", "keep", "remote"] };
    expect(merged("retro-arcade", base, local, remote).favorites).toEqual(["keep", "remote", "local"]);
  });
  it("uses a real rating edit timestamp rather than the whole blob timestamp", () => {
    const base = { ...initial("joke-generator"), ratings: [{ jokeId: "j", rating: "funny", ratedAt: 1 }] };
    const local = { ...base, ratings: [{ jokeId: "j", rating: "funny", ratedAt: 4 }], lastModified: 5 };
    const remote = { ...base, ratings: [{ jokeId: "j", rating: "not-funny", ratedAt: 3 }], lastModified: 10 };
    expect(merged("joke-generator", base, local, remote).ratings).toEqual(local.ratings);
  });
  it("keeps a purchase coherent while merging an independent setting", () => {
    const base: AppProgressData = { ...initial("hill-climb"), coins: 1000 };
    const local = { ...base, coins: 200, unlockedVehicles: ["jeep", "truck"] };
    const remote = { ...base, soundEnabled: !base.soundEnabled };
    const out = merged("hill-climb", base, local, remote);
    expect(out.coins).toBe(200);
    expect(out.unlockedVehicles).toEqual(local.unlockedVehicles);
    expect(out.soundEnabled).toBe(remote.soundEnabled);
  });
  it.each(["hill-climb", "monster-truck", "cookie-clicker", "endless-runner", "virtual-pet", "four-wheeler-3d"] as const)(
    "never invents a combined wallet for %s", id => {
      const wallet = id === "cookie-clicker" ? "cookies" : id === "endless-runner" ? "totalCoins" : id === "four-wheeler-3d" ? "money" : "coins";
      const base = { ...initial(id), [wallet]: 100 };
      const result = mergeProgressConflict(id, base, { ...base, [wallet]: 20 }, { ...base, [wallet]: 30 });
      expect(result.kind).toBe("conflict");
      expect(base[wallet]).toBe(100);
    },
  );
  it("does not splice days and supplies from different journeys", () => {
    const base = initial("oregon-trail");
    expect(mergeProgressConflict("oregon-trail", base, { ...base, currentDay: 4 }, { ...base, milesTraveled: 200 }).kind).toBe("conflict");
  });
  it("does not confuse a beat creation time with a revision timestamp", () => {
    const beat = { id: "beat", name: "old", kitId: "standard", bpm: 120, pattern: {}, createdAt: "2026-01-01T00:00:00Z" };
    const base = { ...initial("drum-machine"), savedBeats: [beat] };
    const left = { ...base, savedBeats: [{ ...beat, name: "local" }] };
    const right = { ...base, savedBeats: [{ ...beat, bpm: 160, createdAt: "2026-01-02T00:00:00Z" }] };
    expect(mergeProgressConflict("drum-machine", base, left, right)).toEqual({ kind: "conflict", paths: ["savedBeats"] });
  });
  it("refuses invalid progress without returning an uploadable result", () => {
    const base = initial("snake");
    expect(mergeProgressConflict("snake", base, { ...base, highScore: -1 }, base)).toEqual({ kind: "conflict", paths: ["$schema"] });
  });
});
