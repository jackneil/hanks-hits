import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function legacyJourney() {
  const { createInitialState } = await import("../lib/gameLogic");
  const original = createInitialState("Recovered leader", "banker", ["Recovered one", "Two", "Three", "Four"], "march");
  localStorage.setItem("oregon-trail-storage", JSON.stringify({ version: 1, state: {
    ...original, gameStarted: true, gamePhase: "travel", lastModified: 100,
    supplies: { ...original.supplies, food: 500, oxen: 4, clothing: 4 },
  } }));
  const { localWords } = await import("@/lib/local-words");
  const { ownerBoundProgress } = await import("@/lib/owner-bound-progress");
  const { LocalWordsDatabase } = await import("@/lib/local-words/database");
  const { wordRecoveryActions } = await import("@/shared/lib/localWordRecovery");
  localWords.install();
  const { useOregonTrailStore: store } = await import("../lib/store");
  await ownerBoundProgress.updateSession("unauthenticated");
  await ownerBoundProgress.whenHydrated("oregon-trail-storage");
  const lease = localWords.captureLease()!;
  await localWords.prepare("oregon-trail", lease);
  const source = localWords.candidates("oregon-trail", lease).find(candidate => candidate.sourceKey === "oregon-trail-storage")!;
  expect(source).toBeDefined();
  expect(store.getState().journeyId).toBeUndefined();
  expect(store.getState().leaderName).toBe("Wagon Leader");
  const entered = deferred(), release = deferred();
  const commitSource = LocalWordsDatabase.prototype.commitSource;
  vi.spyOn(LocalWordsDatabase.prototype, "commitSource").mockImplementationOnce(async function (this: InstanceType<typeof LocalWordsDatabase>, ...args) {
    entered.resolve();
    await release.promise;
    return commitSource.apply(this, args);
  });
  const confirm = () => wordRecoveryActions("oregon-trail")!.confirmUnmatched!(source, lease);
  return { store, lease, confirm, entered, release, LocalWordsDatabase };
}

describe("Oregon explicit legacy-name recovery during play", () => {
  it("binds identity before a delayed source commit and keeps the selected names through ordinary travel", async () => {
    const { store, lease, confirm, entered, release, LocalWordsDatabase } = await legacyJourney();
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const confirming = confirm();
    const journeyId = store.getState().journeyId;
    expect(journeyId).toMatch(/^[0-9a-f]{32}$/);
    expect(store.getState().leaderName).toBe("Recovered leader");
    expect(store.getState().party[0].name).toBe("Recovered one");
    await entered.promise;
    const beforeDay = store.getState().currentDay;
    now.mockReturnValue(20_000);
    store.getState().travel();
    expect(store.getState().currentDay).toBe(beforeDay + 1);
    const travelTimestamp = store.getState().lastModified;
    expect(travelTimestamp).toBe(20_000);
    release.resolve();
    expect(await confirming).toBe("durable");
    expect(store.getState().journeyId).toBe(journeyId);
    expect(store.getState().leaderName).toBe("Recovered leader");
    expect(store.getState().party[0].name).toBe("Recovered one");
    expect(store.getState().lastModified).toBe(travelTimestamp);
    const database = new LocalWordsDatabase();
    try {
      expect(await database.readWords(lease.ownerKey, "oregon-trail")).toContainEqual(expect.objectContaining({
        entityKey: JSON.stringify(["journey", journeyId]), field: "leaderName", value: "Recovered leader",
      }));
    } finally { database.close(); }
  });

  it("returns stale when a new journey starts before the old source commit finishes", async () => {
    const { store, lease, confirm, entered, release, LocalWordsDatabase } = await legacyJourney();
    const confirming = confirm();
    const recoveredJourneyId = store.getState().journeyId;
    await entered.promise;
    store.getState().newJourney();
    expect(store.getState().journeyId).toBeUndefined();
    store.getState().startGame("New leader", "farmer", ["New one", "New two", "New three", "New four"], "june");
    const newJourneyId = store.getState().journeyId;
    expect(newJourneyId).toBeTruthy();
    expect(newJourneyId).not.toBe(recoveredJourneyId);
    release.resolve();
    expect(await confirming).toBe("stale");
    expect(store.getState().journeyId).toBe(newJourneyId);
    expect(store.getState().leaderName).toBe("New leader");
    expect(store.getState().party[0].name).toBe("New one");
    const database = new LocalWordsDatabase();
    try {
      await vi.waitFor(async () => {
        const records = await database.readWords(lease.ownerKey, "oregon-trail");
        expect(records).toContainEqual(expect.objectContaining({ entityKey: JSON.stringify(["journey", recoveredJourneyId]), value: "Recovered leader" }));
        expect(records).toContainEqual(expect.objectContaining({ entityKey: JSON.stringify(["journey", newJourneyId]), value: "New leader" }));
      });
    } finally { database.close(); }
  });
});
