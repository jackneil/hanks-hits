import { IDBFactory } from "fake-indexeddb";
import { vi } from "vitest";
import type { WordAppId } from "@/lib/local-words";

/** Load frozen bytes through the real owner, preservation, and word runtime. */
export async function loadWordFixture(appId: WordAppId, key: string, raw: string) {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  localStorage.setItem(key, raw);
  const { localWords } = await import("@/lib/local-words");
  const { ownerBoundProgress: authority } = await import("@/lib/owner-bound-progress");
  const { LocalWordsDatabase } = await import("@/lib/local-words/database");
  localWords.install();
  const { syncedStore, SYNCED_STORES } = await import("./synced-stores");
  await authority.updateSession("unauthenticated");
  await Promise.all(SYNCED_STORES.map(entry => authority.whenHydrated(entry.key)));
  const lease = localWords.captureLease()!;
  await localWords.prepare(appId, lease);
  const database = new LocalWordsDatabase();
  try {
    const words = await database.readWords(lease.ownerKey, appId);
    const sources = [
      ...await database.listSources(lease.ownerKey),
      ...await database.listCommittedSources(lease.ownerKey),
    ].filter(source => source.appId === appId);
    return { entry: syncedStore(appId), authority, words, sources };
  } finally { database.close(); }
}
