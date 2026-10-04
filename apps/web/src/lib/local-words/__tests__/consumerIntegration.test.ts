import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("real game actions with the device word runtime", () => {
  it("keeps edited names and locations through progress hydration while every progress projection stays word-free", async () => {
    const { localWords } = await import("../index");
    const { ownerBoundProgress: authority } = await import("@/lib/owner-bound-progress");
    const { LocalWordsDatabase } = await import("../database");
    localWords.install();
    const { useDrumMachineStore: drums } = await import("@/apps/drum-machine/lib/store");
    const { useWeatherStore: weather } = await import("@/apps/weather/lib/store");
    const { useVirtualPetStore: pet } = await import("@/apps/virtual-pet/lib/store");
    const { useOregonTrailStore: oregon } = await import("@/games/oregon-trail/lib/store");
    const { useToyFinderStore: toys } = await import("@/apps/toy-finder/lib/store");
    const { CURATED_TOYS } = await import("@/apps/toy-finder/lib/constants");
    const { useDrawingStore: drawing } = await import("@/apps/drawing-app/lib/store");
    const { useFourWheeler3dStore: atv } = await import("@/games/four-wheeler-3d/lib/store");
    const keys = ["drum-machine-state", "weather-app-progress", "virtual-pet-state", "oregon-trail-storage", "toy-finder-progress", "drawing-app-progress", "four-wheeler-3d-game-state"];
    await authority.updateSession("unauthenticated");
    for (const key of keys) {
      await authority.whenHydrated(key);
    }
    const lease = localWords.captureLease()!;
    const apps = ["drum-machine", "weather", "virtual-pet", "oregon-trail", "toy-finder", "drawing-app", "four-wheeler-3d"] as const;
    await Promise.all(apps.map(app => localWords.prepare(app, lease)));
    drums.getState().saveBeat("Private beat name");
    weather.getState().addSavedLocation({ name: "Private location", latitude: 10, longitude: 20 });
    weather.getState().setLastLocation({ name: "Private location", latitude: 10, longitude: 20 });
    pet.getState().renamePet("Private pet name");
    oregon.getState().startGame("Private wagon leader", "banker", ["Private traveler", "Two", "Three", "Four"], "march");
    toys.getState().addToWishlist(CURATED_TOYS[0], "want");
    toys.getState().updateNotes(CURATED_TOYS[0].id, "Private toy note");
    const artworkId = drawing.getState().saveArtwork("data:image/png;base64,privateFixture", "Private artwork");
    atv.getState().updateProgress(progress => ({ ...progress, adventure: {
      ...progress.adventure, outfit: { ...progress.adventure.outfit, text: "Private shirt" },
      feeders: progress.adventure.feeders.map((feeder, index) => index === 0 ? { ...feeder, label: "Private feeder" } : feeder),
    } }));
    const db = new LocalWordsDatabase();
    try {
      await vi.waitFor(async () => {
        for (const app of apps) expect((await db.readWords("guest", app)).length).toBeGreaterThan(0);
      });
      const projections = () => [drums.getState().getProgress(), weather.getState().getProgress(), pet.getState().getProgress(), oregon.getState().getProgress(), toys.getState().getProgress(), drawing.getState().getProgress(), atv.getState().getProgress()];
      expect(JSON.stringify(projections())).not.toContain("Private");
      expect(weather.getState().getProgress()).toMatchObject({ savedLocations: [], lastLocation: null });
      expect(oregon.getState().getProgress().journeyId).toBeTruthy();
      const timestamps = projections().map(progress => progress.lastModified);
      await Promise.all([drums.persist.rehydrate(), weather.persist.rehydrate(), pet.persist.rehydrate(), oregon.persist.rehydrate(), toys.persist.rehydrate(), drawing.persist.rehydrate(), atv.persist.rehydrate()]);
      await vi.waitFor(() => {
        expect(drums.getState().progress.savedBeats[0].name).toBe("Private beat name");
        expect(weather.getState().savedLocations[0].name).toBe("Private location");
        expect(pet.getState().progress.pet.name).toBe("Private pet name");
        expect(oregon.getState().leaderName).toBe("Private wagon leader");
        expect(toys.getState().wishlistItems[0].notes).toBe("Private toy note");
        expect(drawing.getState().savedArtworks[0]).toMatchObject({ id: artworkId, name: "Private artwork", dataUrl: "data:image/png;base64,privateFixture" });
        expect(atv.getState().progress.adventure.outfit.text).toBe("Private shirt");
        expect(atv.getState().progress.adventure.feeders[0].label).toBe("Private feeder");
      });
      expect(projections().map(progress => progress.lastModified)).toEqual(timestamps);
      expect(JSON.stringify(projections())).not.toContain("Private");
      for (const key of keys) {
        expect(authority.readScoped(key)).not.toContain("Private");
      }
      // Personal edits cannot masquerade as newer cloud gameplay.
      pet.getState().renamePet("Private renamed pet");
      weather.getState().addSavedLocation({ name: "Private second place", latitude: 30, longitude: 40 });
      toys.getState().updateNotes(CURATED_TOYS[0].id, "Private changed note");
      atv.getState().updateProgress(progress => ({ ...progress, adventure: { ...progress.adventure,
        outfit: { ...progress.adventure.outfit, text: "Private changed outfit" } } }));
      drawing.getState().updateArtwork(artworkId, "data:image/png;base64,changed");
      expect(projections().map(progress => progress.lastModified)).toEqual(timestamps);
      // Explicit clears must remain durable records, so old source imports
      // cannot silently restore deleted artwork or cleared notes.
      drawing.getState().deleteArtwork(artworkId);
      toys.getState().updateNotes(CURATED_TOYS[0].id, "");
      expect(projections().map(progress => progress.lastModified)).toEqual(timestamps);
      await vi.waitFor(async () => {
        expect((await db.readWords("guest", "drawing-app")).find(word => word.entityKey === JSON.stringify(["artwork", artworkId]))?.value).toBeNull();
        expect((await db.readWords("guest", "toy-finder")).find(word => word.field === "notes")?.value).toBe("");
      });
      await Promise.all([drawing.persist.rehydrate(), toys.persist.rehydrate()]);
      expect(drawing.getState().savedArtworks).toEqual([]);
      expect(toys.getState().wishlistItems[0].notes).toBe("");
      authority.revoke();
      expect(localWords.read("drum-machine", lease)).toEqual([]);
      expect(JSON.stringify([drums.getState().progress.savedBeats, weather.getState().savedLocations, pet.getState().progress.pet.name, oregon.getState().leaderName, toys.getState().wishlistItems, drawing.getState().savedArtworks, atv.getState().progress.adventure])).not.toContain("Private");
      // Hiding an owner must not destroy that owner's durable labels.
      expect((await db.readWords("guest", "drum-machine")).some(word => word.value === "Private beat name")).toBe(true);
    } finally { db.close(); }
  });
});
