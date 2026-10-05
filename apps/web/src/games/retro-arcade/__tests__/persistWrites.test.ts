import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("Retro Arcade metadata persistence", () => {
  it("skips transient loading saves but persists ROM changes without uploaded files", async () => {
    const { useRetroArcadeStore: store } = await import("../lib/store");
    const { ownerBoundProgress: authority } =
      await import("@/lib/owner-bound-progress");
    await authority.updateSession("unauthenticated");
    await authority.whenHydrated("retro-arcade-progress");
    store.setState({});
    const saved = () =>
      JSON.parse(authority.readScoped("retro-arcade-progress")!).state;
    const writes = vi.spyOn(localStorage, "setItem");
    for (let update = 0; update < 120; update++)
      store.getState().setLoading(update % 2 === 0);
    expect(writes).toHaveBeenCalledTimes(0);
    const file = new File(["synthetic-rom"], "test.nes");
    store
      .getState()
      .addCustomRom({
        id: "test-rom",
        name: "Test ROM",
        system: "nes",
        addedAt: 100,
        file,
      });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(saved().customRoms).toEqual([
      { id: "test-rom", name: "Test ROM", system: "nes", addedAt: 100 },
    ]);
    expect(store.getState().customRoms[0].file).toBe(file);
    writes.mockClear();
    for (let update = 0; update < 120; update++)
      store.getState().setLoading(update % 2 === 0);
    expect(writes).toHaveBeenCalledTimes(0);

    store
      .getState()
      .addCustomRom({
        id: "test-rom",
        name: "Renamed ROM",
        system: "nes",
        addedAt: 200,
        file,
      });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(saved().customRoms).toEqual([
      { id: "test-rom", name: "Renamed ROM", system: "nes", addedAt: 200 },
    ]);
    store.getState().removeCustomRom("test-rom");
    expect(writes).toHaveBeenCalledTimes(2);
    expect(saved().customRoms).toEqual([]);
    store.getState().addFavorite("test-favorite");
    expect(saved().favorites).toContain("test-favorite");
  });
});
