import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RETRO_ARCADE_STORAGE_VERSION,
  useRetroArcadeStore,
  type RetroArcadeProgress,
} from "../lib/store";

import { ownerBoundProgress } from "@/lib/owner-bound-progress";

beforeAll(async () => {
  await ownerBoundProgress.updateSession("unauthenticated");
  await ownerBoundProgress.whenHydrated("retro-arcade-progress");
});

describe("Retro Arcade store favorites", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
    useRetroArcadeStore.setState({
      currentSystem: null,
      currentRom: null,
      currentRomName: null,
      isPlaying: false,
      isLoading: false,
      restartNonce: 0,
      favorites: [],
      recentlyPlayed: [],
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
      currentRom: "/roms/game.sfc",
      currentRomName: "Game",
      isPlaying: true,
      restartNonce: 0,
      favorites: ["snes-alpha"],
    });

    useRetroArcadeStore.getState().restartGame();

    const state = useRetroArcadeStore.getState();
    expect(state.isPlaying).toBe(true);
    expect(state.restartNonce).toBe(1);
    expect(state.favorites).toEqual(["snes-alpha"]);
  });

  it("keeps an uploaded file (never a URL) so the kid can play it again after the game stops", () => {
    const file = new Blob([new Uint8Array([1, 2, 3])]);
    const store = useRetroArcadeStore.getState();
    store.addCustomRom({ id: "rom-1", name: "hank.nes", system: "nes", addedAt: 1, file });
    store.startGame(file, "hank.nes", "nes");
    expect(useRetroArcadeStore.getState().currentRom).toBe(file);

    useRetroArcadeStore.getState().stopGame();

    const state = useRetroArcadeStore.getState();
    expect(state.isPlaying).toBe(false);
    expect(state.currentRom).toBeNull();
    expect(state.customRoms[0].file).toBe(file);
    // The store makes no object URL, so it has none to revoke.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("never persists or syncs the uploaded file", () => {
    const file = new Blob([new Uint8Array([1, 2, 3])]);
    useRetroArcadeStore.getState().addCustomRom({ id: "rom-1", name: "hank.nes", system: "nes", addedAt: 1, file });
    expect(useRetroArcadeStore.getState().getProgress().customRoms).toEqual([
      { id: "rom-1", name: "hank.nes", system: "nes", addedAt: 1 },
    ]);
    const persisted = JSON.parse(ownerBoundProgress.readScoped("retro-arcade-progress") ?? "{}");
    expect(persisted.state.customRoms).toEqual([{ id: "rom-1", name: "hank.nes", system: "nes", addedAt: 1 }]);
  });

  it("keeps one entry for each ROM name on a console when the kid uploads it again", () => {
    const store = useRetroArcadeStore.getState();
    const first = new Blob([new Uint8Array([1])]);
    const again = new Blob([new Uint8Array([1])]);
    store.addCustomRom({ id: "nes-hank.nes-1", name: "hank.nes", system: "nes", addedAt: 1, file: first });
    store.addCustomRom({ id: "gb-hank.nes-2", name: "hank.nes", system: "gb", addedAt: 2 });
    store.addCustomRom({ id: "nes-hank.nes-3", name: "hank.nes", system: "nes", addedAt: 3, file: again });

    const roms = useRetroArcadeStore.getState().customRoms;
    expect(roms.map((rom) => rom.id)).toEqual(["nes-hank.nes-3", "gb-hank.nes-2"]);
    expect(roms[0].file).toBe(again);
  });
});

describe("Retro Arcade store: a cloud pull keeps the uploaded files of this visit", () => {
  const cloud = (customRoms: RetroArcadeProgress["customRoms"]): RetroArcadeProgress => ({
    favorites: [],
    recentlyPlayed: [],
    customRoms,
    stats: { totalPlayTime: 0, gamesPlayed: 0, favoriteSystem: "", lastPlayedAt: 0 },
    settings: { volume: 0.5, autoSaveOnExit: true, showTouchControls: true },
    lastModified: 1_790_000_000_000,
  });

  beforeEach(() => {
    localStorage.clear();
    useRetroArcadeStore.setState({ customRoms: [] });
  });

  it("keeps the file of each ROM that the cloud list names (same id)", () => {
    const file = new Blob([new Uint8Array([1, 2, 3])]);
    useRetroArcadeStore.getState().addCustomRom({ id: "n64-demo.n64-1", name: "demo.n64", system: "n64", addedAt: 1, file });

    useRetroArcadeStore.getState().setProgress(cloud([{ id: "n64-demo.n64-1", name: "demo.n64", system: "n64", addedAt: 1 }]));

    const roms = useRetroArcadeStore.getState().customRoms;
    expect(roms).toHaveLength(1);
    // Without the file, "Your ROMs" shows the entry as Expired.
    expect(roms[0].file).toBe(file);
  });

  it("gives a file uploaded again in this visit to the cloud entry of the same game", () => {
    // The cloud still has the id of an earlier upload of the same name.
    const file = new Blob([new Uint8Array([4])]);
    useRetroArcadeStore.getState().addCustomRom({ id: "gb-tetris.gb-2", name: "tetris.gb", system: "gb", addedAt: 2, file });

    useRetroArcadeStore.getState().setProgress(cloud([{ id: "gb-tetris.gb-1", name: "tetris.gb", system: "gb", addedAt: 1 }]));

    const roms = useRetroArcadeStore.getState().customRoms;
    expect(roms.map((rom) => rom.id)).toEqual(["gb-tetris.gb-1"]);
    expect(roms[0].file).toBe(file);
  });

  it("keeps an upload of this visit that the cloud does not list yet, and adds the cloud entries", () => {
    const file = new Blob([new Uint8Array([5])]);
    useRetroArcadeStore.getState().addCustomRom({ id: "nes-new.nes-3", name: "new.nes", system: "nes", addedAt: 3, file });

    useRetroArcadeStore.getState().setProgress(cloud([{ id: "snes-old.sfc-1", name: "old.sfc", system: "snes", addedAt: 1 }]));

    const roms = useRetroArcadeStore.getState().customRoms;
    expect(roms.map((rom) => rom.id)).toEqual(["nes-new.nes-3", "snes-old.sfc-1"]);
    expect(roms[0].file).toBe(file);
    // A ROM from another device has no file here: it shows as Expired.
    expect(roms[1].file).toBeUndefined();
  });

  it("drops an entry without a file that the cloud list does not name", () => {
    useRetroArcadeStore.setState({ customRoms: [{ id: "gba-gone.gba-1", name: "gone.gba", system: "gba", addedAt: 1 }] });

    useRetroArcadeStore.getState().setProgress(cloud([]));

    expect(useRetroArcadeStore.getState().customRoms).toEqual([]);
  });

  it("still never syncs or persists a file after the merge", () => {
    const file = new Blob([new Uint8Array([6])]);
    useRetroArcadeStore.getState().addCustomRom({ id: "n64-demo.n64-1", name: "demo.n64", system: "n64", addedAt: 1, file });

    useRetroArcadeStore.getState().setProgress(cloud([{ id: "n64-demo.n64-1", name: "demo.n64", system: "n64", addedAt: 1 }]));

    expect(useRetroArcadeStore.getState().getProgress().customRoms).toEqual([
      { id: "n64-demo.n64-1", name: "demo.n64", system: "n64", addedAt: 1 },
    ]);
    const persisted = JSON.parse(ownerBoundProgress.readScoped("retro-arcade-progress") ?? "{}");
    expect(persisted.state.customRoms).toEqual([{ id: "n64-demo.n64-1", name: "demo.n64", system: "n64", addedAt: 1 }]);
  });
});

describe("Retro Arcade store: save states left the progress", () => {
  const legacyProgress = {
    favorites: ["snes-Super Mario World"],
    recentlyPlayed: [{ gameId: "gb-tetris.gb", name: "tetris.gb", system: "gb", lastPlayed: 5 }],
    // What the old message code stored: an empty string for each save.
    saveStates: {
      "gb-tetris.gb": { autoSave: "", lastSaved: 5 },
      "snes-Super Mario World": { slot1: "", autoSave: "AAAA", lastSaved: 6 },
    },
    customRoms: [{ id: "gb-tetris.gb-1", name: "tetris.gb", system: "gb", addedAt: 1 }],
    stats: { totalPlayTime: 12, gamesPlayed: 3, favoriteSystem: "gb", lastPlayedAt: 5 },
    settings: { volume: 0.5, autoSaveOnExit: true, showTouchControls: true },
    lastModified: 1_790_000_000_000,
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it("never puts save states in the progress that goes to the cloud", () => {
    const progress = useRetroArcadeStore.getState().getProgress();
    expect(progress).not.toHaveProperty("saveStates");
  });

  it("drops the saveStates field of old cloud progress and keeps the rest", () => {
    useRetroArcadeStore.getState().setProgress(legacyProgress as RetroArcadeProgress);
    const state = useRetroArcadeStore.getState();
    expect(state).not.toHaveProperty("saveStates");
    expect(state.getProgress()).not.toHaveProperty("saveStates");
    expect(state.favorites).toEqual(["snes-Super Mario World"]);
    expect(state.stats.gamesPlayed).toBe(3);
    expect(state.lastModified).toBe(1_790_000_000_000);
  });

  it("loads old localStorage data (version 0) without error and removes its saveStates", async () => {
    localStorage.setItem(
      "retro-arcade-progress",
      JSON.stringify({ state: legacyProgress, version: 0 })
    );
    vi.resetModules();
    const { useRetroArcadeStore: freshStore } = await import("../lib/store");
    const { ownerBoundProgress: freshAuthority } = await import("@/lib/owner-bound-progress");
    await freshAuthority.updateSession("unauthenticated");
    await freshAuthority.whenHydrated("retro-arcade-progress");

    const state = freshStore.getState();
    expect(state).not.toHaveProperty("saveStates");
    expect(state.favorites).toEqual(["snes-Super Mario World"]);
    expect(state.customRoms).toEqual(legacyProgress.customRoms);

    // The namespace gets the migrated value; legacy recovery bytes stay intact.
    expect(JSON.parse(localStorage.getItem("retro-arcade-progress")!).state).toHaveProperty("saveStates");
    const stored = JSON.parse(freshAuthority.readScoped("retro-arcade-progress") ?? "{}");
    expect(stored.version).toBe(RETRO_ARCADE_STORAGE_VERSION);
    expect(stored.state).not.toHaveProperty("saveStates");
    expect(stored.state.favorites).toEqual(["snes-Super Mario World"]);
  });

  it("writes no saveStates field to localStorage", () => {
    useRetroArcadeStore.getState().addFavorite("gb-tetris.gb");
    const stored = JSON.parse(ownerBoundProgress.readScoped("retro-arcade-progress") ?? "{}");
    expect(stored.state).not.toHaveProperty("saveStates");
    expect(JSON.stringify(stored)).not.toMatch(/saveState/);
  });
});
