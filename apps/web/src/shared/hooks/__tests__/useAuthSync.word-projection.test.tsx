import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { extractProgressWords, stripProgressWords } from "@/lib/progress-words";
import { PROGRESS_STORAGE_KEYS } from "@/lib/owner-bound-progress/keys";
import { useAuthSync, __unsafeResetForeignPurgeLockForTests } from "../useAuthSync";

const authority = vi.hoisted(() => ({ snapshot: { status: "ready", ownerKey: "owner-A", generation: 1 }, lease: { ownerKey: "owner-A", generation: 1 } }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: { user: { id: "A" } } }) }));
vi.mock("@/shared/lib/achievements", () => ({ reportProgressToAchievements: vi.fn() }));
vi.mock("@/lib/owner-bound-progress", () => ({ ownerBoundProgress: {
  subscribe: () => () => {}, getSnapshot: () => authority.snapshot, captureLease: () => authority.lease,
  isCurrent: () => true, matchesSession: () => true, isHydrated: () => true,
  whenHydrated: async () => {}, readEvidence: () => ({ markerReadable: true, raw: "existing", loadAt: 100 }),
  readScoped: () => null, listGuestCandidates: () => [], isScopedStorageEvent: () => false,
} }));
const fixtures: Array<[ValidAppId, Record<string, unknown>]> = [
  ["oregon-trail", { journeyId: "j", leaderName: "Alice", party: [{ id: "m0", name: "Bob", health: 90 }], milesTraveled: 25 }],
  ["weather", { savedLocations: [{ name: "Town", latitude: 3, longitude: 4 }], lastLocation: { name: "Town", latitude: 3, longitude: 4 }, units: "fahrenheit" }],
  ["toy-finder", { wishlistItems: [{ toyId: "t", notes: "Private note", priority: "high" }] }],
  ["drawing-app", { savedArtworks: [{ id: "a", name: "Art", dataUrl: "data:image/png;base64,abc" }], totalDrawings: 2 }],
  ["drum-machine", { savedBeats: [{ id: "b", name: "Song", bpm: 90 }], totalBeats: 2 }],
  ["virtual-pet", { pet: { name: "Fluffy", speciesId: "cat", bornAt: "date", happiness: 80 }, settings: { petName: "Fluffy" } }],
  ["four-wheeler-3d", { adventure: { outfit: { text: "Racer" }, feeders: [{ id: "f", label: "Home", food: 30 }] }, highScore: 10 }],
];
let fetcher: ReturnType<typeof vi.fn>, beacon: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); __unsafeResetForeignPurgeLockForTests();
  fetcher = vi.fn(async (_url, init?: RequestInit) => ({ ok: true, status: 200,
    json: async () => init?.method === "POST" ? { updatedAt: new Date(100).toISOString() } : { data: null, lastSyncedAt: null } }));
  vi.stubGlobal("fetch", fetcher); beacon = vi.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); });
}

describe("every cloud path projects personal fields", () => {
  it.each(fixtures)("%s strips initial/forced HTTP and pagehide/unmount beacons without altering play", async (appId, personal) => {
    let progress = { ...personal, lastModified: 100 } as AppProgressData;
    const view = renderHook(() => useAuthSync({ appId, localStorageKey: PROGRESS_STORAGE_KEYS[appId], getState: () => progress, setState: value => { progress = value; } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(view.result.current.synced).toBe(true);
    progress = { ...personal, lastModified: 200 } as AppProgressData;
    await act(async () => { await view.result.current.forceSync(); });
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    for (const [, init] of posts) {
      const { data } = JSON.parse(init!.body as string);
      expect(extractProgressWords(appId, data).fields).toEqual([]);
      expect(data).toEqual(stripProgressWords(appId, { ...personal, lastModified: data.lastModified }));
    }
    // Label-only changes do not create another autosave loop.
    const changedWords = JSON.parse(JSON.stringify(progress), (_key, value) => typeof value === "string"
      && ["Alice", "Fluffy", "Song", "Town", "Private note", "Racer", "Art"].includes(value) ? "Other" : value);
    progress = changedWords;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    progress = { ...personal, lastModified: 300 } as AppProgressData;
    window.dispatchEvent(new Event("pagehide"));
    view.unmount();
    expect(beacon).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    for (const [, blob] of beacon.mock.calls) {
      const payload = JSON.parse(await blobText(blob));
      expect(payload.data).toEqual(stripProgressWords(appId, progress));
      expect(payload.expectedOwnerId).toBe("A");
    }
  });
});
