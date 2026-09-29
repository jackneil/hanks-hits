import { describe, expect, it } from "vitest";

import { validateProgress } from "@/lib/progress-schemas";

/**
 * Retro Arcade save states moved out of the cloud progress (they stay on the
 * device in IndexedDB). Clients from before the change, and rows that they
 * saved, still carry a "saveStates" field. The server must accept those saves
 * and must never store the field again.
 */
const current = {
  favorites: ["snes-Super Mario World"],
  recentlyPlayed: [{ gameId: "gb-tetris.gb", name: "tetris.gb", system: "gb", lastPlayed: 5 }],
  customRoms: [{ id: "gb-tetris.gb-1", name: "tetris.gb", system: "gb", addedAt: 1 }],
  stats: { totalPlayTime: 12, gamesPlayed: 3, favoriteSystem: "gb", lastPlayedAt: 5 },
  settings: { volume: 0.5, autoSaveOnExit: true, showTouchControls: true },
  lastModified: 1_790_000_000_000,
};

describe("retro-arcade progress schema", () => {
  it("accepts progress without save states", () => {
    const result = validateProgress("retro-arcade", current);
    expect(result).toEqual({ success: true, data: current });
  });

  it.each([
    ["empty strings (what the old client stored)", { "gb-tetris.gb": { autoSave: "", lastSaved: 5 } }],
    ["a large base64 string", { "snes-Mario": { slot1: "A".repeat(1_000_000), lastSaved: 6 } }],
    ["an empty record", {}],
    ["a value of the wrong shape", "not a record"],
  ])("accepts an old client's save with saveStates holding %s, and drops the field", (_label, saveStates) => {
    const result = validateProgress("retro-arcade", { ...current, saveStates });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("saveStates");
    expect(result.data).toEqual(current);
  });

  it("rejects any other unknown field", () => {
    const result = validateProgress("retro-arcade", { ...current, coins: 999_999_999 });
    expect(result.success).toBe(false);
  });
});
