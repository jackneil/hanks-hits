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
