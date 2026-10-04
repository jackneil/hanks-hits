import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { validateProgress } from "@/lib/progress-schemas";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  const { localWords } = await import("@/lib/local-words");
  const { ownerBoundProgress } = await import("@/lib/owner-bound-progress");
  const { useDrawingStore: store } = await import("../lib/store");
  localWords.install();
  await ownerBoundProgress.updateSession("unauthenticated");
  await ownerBoundProgress.whenHydrated("drawing-app-progress");
  const lease = localWords.captureLease()!;
  await localWords.prepare("drawing-app", lease);
  return { store, localWords, ownerBoundProgress, lease };
}

describe("Drawing app device-only gallery", () => {
  it("saves actual artwork bytes locally while excluding the gallery from both progress projections", async () => {
    const { store, localWords, lease } = await setup();
    const id = store.getState().saveArtwork("data:image/png;base64,private", "Rainbow");
    const progress = store.getState().getProgress();
    expect(progress.savedArtworks).toBeUndefined();
    expect(validateProgress("drawing-app", progress).success).toBe(true);
    expect(store.persist.getOptions().partialize?.(store.getState())).not.toHaveProperty("savedArtworks");
    expect(localWords.read("drawing-app", lease)).toContainEqual(expect.objectContaining({
      entityKey: JSON.stringify(["artwork", id]), value: expect.objectContaining({ name: "Rainbow", dataUrl: "data:image/png;base64,private" }),
    }));
  });

  it("keeps the local gallery through absent, blank, and historical cloud galleries", async () => {
    const { store } = await setup();
    const id = store.getState().saveArtwork("data:image/png;base64,private", "Rainbow");
    const original = store.getState().getArtwork(id)!;
    const progress = store.getState().getProgress();
    for (const savedArtworks of [undefined, [], [{ ...original, id: "remote", name: "Old remote gallery" }]]) {
      store.getState().setProgress({ ...progress, savedArtworks });
      expect(store.getState().savedArtworks).toEqual([original]);
    }
  });

  it("explicit deletion retains a null record and never repopulates from progress", async () => {
    const { store, localWords, lease } = await setup();
    const id = store.getState().saveArtwork("data:image/png;base64,private", "Rainbow");
    const original = store.getState().getArtwork(id)!;
    store.getState().deleteArtwork(id);
    store.getState().setProgress({ ...store.getState().getProgress(), savedArtworks: [original] });
    expect(store.getState().savedArtworks).toEqual([]);
    expect(localWords.read("drawing-app", lease)).toContainEqual(expect.objectContaining({ entityKey: JSON.stringify(["artwork", id]), value: null }));
  });

  it("a thumbnail completion carries its original lease and cannot write into a later owner", async () => {
    const images: { onload: (() => void) | null }[] = [];
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 400; height = 400; src = "";
      constructor() { images.push(this); }
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,thumbnail");
    const { store, localWords, ownerBoundProgress, lease } = await setup();
    store.getState().saveArtwork("data:image/png;base64,private", "Rainbow");
    ownerBoundProgress.revoke();
    images[0].onload?.();
    await Promise.resolve();
    expect(store.getState().savedArtworks).toEqual([]);
    expect(localWords.read("drawing-app", lease)).toEqual([]);
  });
});
