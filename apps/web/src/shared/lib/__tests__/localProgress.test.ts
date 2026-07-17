import { beforeEach, describe, expect, it } from "vitest";
import { findLocalProgress } from "../localProgress";

// The shelf's stat line depends on finding progress under whichever key
// convention a game happened to pick. These tests use the REAL key names
// from GAME_STORAGE_KEYS so a convention drift breaks loudly here.

describe("findLocalProgress", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reads a persist envelope with a partialized progress field", () => {
    window.localStorage.setItem(
      "cookie-clicker-storage",
      JSON.stringify({
        state: { progress: { cookies: 42, lastModified: 1 } },
        version: 0,
      })
    );

    expect(findLocalProgress("cookie-clicker")).toEqual({
      cookies: 42,
      lastModified: 1,
    });
  });

  it.each([
    ["2048", "2048-game-state"],
    ["arkanoid", "arkanoid-state"],
    ["checkers", "checkers-progress"],
    ["monster-truck", "monster-truck-save"],
    ["chess", "hank-chess-state"],
    ["platformer", "hank-platformer-progress"],
    ["weather", "weather-app-progress"],
  ])("finds %s progress under its real key %s", (appId, key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({ state: { progress: { highScore: 7 } }, version: 0 })
    );

    expect(findLocalProgress(appId)).toEqual({ highScore: 7 });
  });

  it("falls back to the whole persisted state when progress is not nested", () => {
    window.localStorage.setItem(
      "snake-game-state",
      JSON.stringify({ state: { highScore: 12, gamesPlayed: 3 }, version: 0 })
    );

    expect(findLocalProgress("snake")).toEqual({
      highScore: 12,
      gamesPlayed: 3,
    });
  });

  it("returns null for a never-played game", () => {
    expect(findLocalProgress("brand-new-game")).toBeNull();
  });

  it("returns null instead of throwing on corrupt JSON", () => {
    window.localStorage.setItem("snake-game-state", "{not json");
    expect(findLocalProgress("snake")).toBeNull();
  });

  it("returns null for non-object payloads", () => {
    window.localStorage.setItem("snake-game-state", JSON.stringify("hi"));
    window.localStorage.setItem("2048-game-state", JSON.stringify([1, 2]));
    expect(findLocalProgress("snake")).toBeNull();
    expect(findLocalProgress("2048")).toBeNull();
  });
});
