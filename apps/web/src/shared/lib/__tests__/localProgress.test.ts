import { beforeEach, describe, expect, it, vi } from "vitest";
import type { findLocalProgress as FindLocalProgress } from "../localProgress";
let findLocalProgress: typeof FindLocalProgress;
let owner: typeof import("@/lib/owner-bound-progress").ownerBoundProgress;

describe("findLocalProgress", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.resetModules();
    ({ findLocalProgress } = await import("../localProgress"));
    ({ ownerBoundProgress: owner } = await import("@/lib/owner-bound-progress"));
    await owner.updateSession("unauthenticated");
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

  it("does not guess unknown keys into the account registry", () => {
    window.localStorage.setItem("mystery-kid-game-state", JSON.stringify({ state: { highScore: 9 } }));
    expect(findLocalProgress("mystery-kid")).toBeNull();
  });

  it("hides foreign legacy progress from a guest", () => {
    window.localStorage.setItem("hanks-hits-progress-owner", "account-A");
    window.localStorage.setItem("snake-game-state", JSON.stringify({ state: { highScore: 99 } }));
    expect(findLocalProgress("snake")).toBeNull();
  });

  it("reads its namespace without importing a store, and never a different owner's namespace", async () => {
    const { createOwnerBoundProgress } = await import("@/lib/owner-bound-progress");
    const other = createOwnerBoundProgress();
    await other.updateSession("authenticated", "account-A");
    other.writeScoped("snake-game-state", JSON.stringify({ state: { highScore: 99 } }));
    expect(findLocalProgress("snake")).toBeNull();
    owner.writeScoped("snake-game-state", JSON.stringify({ state: { highScore: 7 } }));
    expect(findLocalProgress("snake")?.progress).toEqual({ highScore: 7 });
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

  it("does not confuse a colliding slug with an exact registered game", () => {
    window.localStorage.setItem("snake-game-state", JSON.stringify({ state: { progress: { highScore: 99 } }, version: 0 }));
    expect(findLocalProgress("snake-game")).toBeNull();
    expect(findLocalProgress("snake")?.progress).toEqual({ highScore: 99 });
  });
});
