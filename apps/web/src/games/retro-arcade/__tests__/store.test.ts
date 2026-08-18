import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRetroArcadeStore } from "../lib/store";

describe("Retro Arcade store favorites", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
    useRetroArcadeStore.setState({
      currentSystem: null,
      currentRomUrl: null,
      currentRomName: null,
      isPlaying: false,
      isLoading: false,
      restartNonce: 0,
      favorites: [],
      recentlyPlayed: [],
      saveStates: {},
      customRoms: [],
      stats: {
        totalPlayTime: 0,
        gamesPlayed: 0,
        favoriteSystem: "",
        lastPlayedAt: 0,
      },
      settings: {
        volume: 0.5,
        autoSaveOnExit: true,
        showTouchControls: true,
      },
      lastModified: Date.now(),
    });
  });

  it("adds favorites once and removes them", () => {
    const store = useRetroArcadeStore.getState();

    store.addFavorite("snes-alpha");
    store.addFavorite("snes-alpha");

    expect(useRetroArcadeStore.getState().favorites).toEqual(["snes-alpha"]);
    expect(useRetroArcadeStore.getState().isFavorite("snes-alpha")).toBe(true);

    useRetroArcadeStore.getState().removeFavorite("snes-alpha");

    expect(useRetroArcadeStore.getState().favorites).toEqual([]);
    expect(useRetroArcadeStore.getState().isFavorite("snes-alpha")).toBe(false);
  });

  it("relaunches the selected ROM without changing saved progress", () => {
    useRetroArcadeStore.setState({
      currentSystem: "snes",
      currentRomUrl: "/roms/game.sfc",
      currentRomName: "Game",
      isPlaying: true,
      restartNonce: 0,
      favorites: ["snes-alpha"],
      saveStates: { "snes-Game": { autoSave: "state", lastSaved: 1 } },
    });

    useRetroArcadeStore.getState().restartGame();

    const state = useRetroArcadeStore.getState();
    expect(state.isPlaying).toBe(true);
    expect(state.restartNonce).toBe(1);
    expect(state.favorites).toEqual(["snes-alpha"]);
    expect(state.saveStates["snes-Game"]?.autoSave).toBe("state");
  });

  it("clears revoked upload blob URLs when stopping a custom ROM", () => {
    useRetroArcadeStore.setState({
      currentSystem: "nes",
      currentRomUrl: "blob:rom-1",
      currentRomName: "hank.nes",
      isPlaying: true,
      customRoms: [
        {
          id: "rom-1",
          name: "hank.nes",
          system: "nes",
          addedAt: 1,
          blobUrl: "blob:rom-1",
        },
      ],
    });

    useRetroArcadeStore.getState().stopGame();

    const state = useRetroArcadeStore.getState();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:rom-1");
    expect(state.isPlaying).toBe(false);
    expect(state.currentRomUrl).toBeNull();
    expect(state.customRoms[0].blobUrl).toBeUndefined();
  });
});
