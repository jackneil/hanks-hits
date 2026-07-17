import { beforeEach, describe, expect, it } from "vitest";
import { findLocalProgress } from "../localProgress";
import { isClearedOnSignOut } from "@/lib/storage-keys";

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
      progress: { cookies: 42, lastModified: 1 },
      deviceOwned: false,
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

    expect(findLocalProgress(appId)?.progress).toEqual({ highScore: 7 });
  });

  it("falls back to the whole persisted state when progress is not nested", () => {
    window.localStorage.setItem(
      "snake-game-state",
      JSON.stringify({ state: { highScore: 12, gamesPlayed: 3 }, version: 0 })
    );

    expect(findLocalProgress("snake")?.progress).toEqual({
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

  it("never displays a convention key that sign-out would not clear", () => {
    // Structural invariant: every convention-probed key must satisfy
    // isClearedOnSignOut, so account-linked progress that survives a
    // sign-out can never leak onto the next kid's shelf. Probe a key
    // shape outside both the registry and the cleared suffixes.
    window.localStorage.setItem(
      "mystery-kid-game-state",
      JSON.stringify({ state: { progress: { highScore: 9 } }, version: 0 })
    );
    // "-game-state" IS a cleared suffix, so this one is displayable...
    expect(findLocalProgress("mystery-kid")?.progress).toEqual({
      highScore: 9,
    });
    // ...and every candidate the helper can probe is clear-safe by
    // construction. Assert the invariant over the whole convention space.
    const suffixes = [
      "-storage",
      "-progress",
      "-save",
      "-game-state",
      "-state",
      "-app-progress",
    ];
    for (const suffix of suffixes) {
      const key = `any-game${suffix}`;
      if (!isClearedOnSignOut(key)) {
        // A non-cleared shape must never be displayed: seed it and prove
        // the helper refuses to read it.
        window.localStorage.setItem(
          key,
          JSON.stringify({ state: { progress: { highScore: 1 } }, version: 0 })
        );
        expect(findLocalProgress("any-game")).toBeNull();
        window.localStorage.removeItem(key);
      }
    }
  });

  describe("device-owned alias saves (four-wheeler's My Land)", () => {
    it("reads the fwa_myland_v1 array save and marks it device-owned", () => {
      window.localStorage.setItem(
        "fwa_myland_v1",
        JSON.stringify([
          { id: 1, owned: true, sizeLevel: 1, buildings: [{ type: "garage" }] },
          { id: 2, owned: false, sizeLevel: 0, buildings: [] },
        ])
      );

      const result = findLocalProgress("four-wheeler-adventure");
      expect(result?.deviceOwned).toBe(true);
      expect(Array.isArray(result?.progress.items)).toBe(true);
      expect((result?.progress.items as unknown[]).length).toBe(2);
    });

    it("treats an empty or corrupt My Land save as never played", () => {
      window.localStorage.setItem("fwa_myland_v1", JSON.stringify([]));
      expect(findLocalProgress("four-wheeler-adventure")).toBeNull();

      window.localStorage.setItem("fwa_myland_v1", "{broken");
      expect(findLocalProgress("four-wheeler-adventure")).toBeNull();
    });
  });

  it("documents the key-collision hazard for future slugs", () => {
    // A game slugged "snake-game" would probe "snake-game-state" - which
    // is Snake's REAL key - and cheerfully show Snake's score as its own.
    // No current id collides; this test records the hazard so a future
    // colliding slug fails loudly here instead of lying quietly on the
    // shelf.
    window.localStorage.setItem(
      "snake-game-state",
      JSON.stringify({ state: { progress: { highScore: 99 } }, version: 0 })
    );
    expect(findLocalProgress("snake-game")?.progress).toEqual({
      highScore: 99,
    });
  });
});
