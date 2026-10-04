import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";

beforeEach(() => { vi.resetModules(); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("owner storage preserves the original hydration contract", () => {
  it("normalizes timestamp-less progress at source read, not after delayed auth", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    const { ownerBoundProgress: authority } = await import("../index");
    const { createOwnerPersistStorage } = await import("../persistStorage");
    const { defineUntouchedProgress, settleOnLoad, markSaved, persistSettledSave } = await import("@/shared/lib/untouchedProgress");
    const rule = defineUntouchedProgress("snake", { layout: "flat", defaults: { highScore: 0, lastModified: 0 } });
    const original = JSON.stringify({ state: { highScore: 9 }, version: 0 });
    localStorage.setItem("snake-game-state", original);
    const store = createStore<{ highScore: number; lastModified: number }>()(persist(
      () => ({ highScore: 0, lastModified: 0 }),
      {
        name: "snake-game-state", skipHydration: true,
        storage: createOwnerPersistStorage("snake-game-state", "snake"),
        merge: settleOnLoad(rule), partialize: markSaved,
      },
    ));
    authority.bindPersistedStore("snake-game-state", store.persist);
    persistSettledSave(store, rule);
    expect(store.persist.hasHydrated()).toBe(false);
    expect(store.getState().highScore).toBe(0);
    vi.setSystemTime(9_000);
    await authority.updateSession("unauthenticated");
    await authority.whenHydrated("snake-game-state");
    expect(store.getState()).toEqual({ highScore: 9, lastModified: 1_000 });
    expect(JSON.parse(authority.readScoped("snake-game-state")!).state.lastModified).toBe(1_000);
    expect(localStorage.getItem("snake-game-state")).toBe(original);
    vi.setSystemTime(90_000);
    await store.persist.rehydrate();
    expect(store.getState().lastModified).toBe(1_000);
  });

  it("suppresses frame writes while keeping every flat field and version change", async () => {
    const { ownerBoundProgress: authority } = await import("../index");
    const { createOwnerPersistStorage } = await import("../persistStorage");
    const store = createStore<{ score: number; wallet: number; frame: number }>()(persist(
      () => ({ score: 0, wallet: 0, frame: 0 }),
      {
        name: "snake-game-state", skipHydration: true,
        storage: createOwnerPersistStorage("snake-game-state", "snake"),
        partialize: ({ score, wallet }) => ({ score, wallet }),
      },
    ));
    authority.bindPersistedStore("snake-game-state", store.persist);
    await authority.updateSession("unauthenticated");
    await authority.whenHydrated("snake-game-state");
    const writes = vi.spyOn(localStorage, "setItem");
    store.setState({ score: 1 });
    for (let frame = 1; frame <= 120; frame++) store.setState({ frame });
    expect(writes).toHaveBeenCalledTimes(1);
    store.setState({ wallet: 9 });
    expect(writes).toHaveBeenCalledTimes(2);
    store.persist.setOptions({ version: 2 });
    store.setState({ frame: 121 });
    expect(writes).toHaveBeenCalledTimes(3);
    expect(JSON.parse(authority.readScoped("snake-game-state")!)).toEqual({ state: { score: 1, wallet: 9 }, version: 2 });
  });
});
