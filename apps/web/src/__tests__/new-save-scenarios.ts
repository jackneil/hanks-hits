/**
 * Saves that the new store code writes, for the rollback proof
 * (src/__tests__/rollback-safety.test.ts).
 *
 * For each synced store: an untouched save (a screen change wrote it), and
 * a played save: the played progress of fixtures/legacy-saves.json (a real
 * save of each game, from the old store code), loaded into the new store
 * and stamped by a player's change. A few stores get more saves (the
 * `extra` saves of the legacy fixture).
 *
 * scripts/legacy-saves/rollback.sh writes them to fixtures/new-saves.json
 * and then loads their INNER payloads with the older store code. This proves
 * payload compatibility only. A deploy rollback must retain the v2 namespace
 * reader/writer; old code does not discover these envelopes at legacy keys.
 */
import type { AppProgressData } from "@hank-neil/db/schema";
import { vi } from "vitest";
import type { SyncedStoreEntry } from "@/__tests__/synced-stores";
import type { ownerBoundProgress } from "@/lib/owner-bound-progress";
import legacy from "@/__tests__/fixtures/legacy-saves.json";

type Save = { state: Record<string, unknown>; version: number };
type LegacySaves = Record<string, Record<string, Save | string>>;

/** The time of the player's change in every played save. */
export const NEW_SAVE_PLAY_TIME = Date.UTC(2026, 9, 3, 12, 0, 0);

export type NewSave = {
  /** The inner Zustand envelope written inside the owner namespace. */
  raw: string;
  /** getProgress() of the new store when it wrote the save. */
  progress: AppProgressData;
};

export type NewSaves = Record<string, { key: string; version: number; saves: Record<string, NewSave> }>;

const SKIP = new Set(["key", "untouched", "automatic", "preference"]);

function capture(entry: SyncedStoreEntry, authority: typeof ownerBoundProgress): NewSave {
  if (!authority.hasDurable(entry.key)) throw new Error(`${entry.appId}: save was not durable`);
  return {
    raw: authority.readScoped(entry.key) ?? "",
    progress: JSON.parse(JSON.stringify(entry.store.getState().getProgress())),
  };
}

/** One fixture is one document: disk exists before adapter construction. */
async function loadDocument(appId: string, key: string, save?: Save) {
  localStorage.clear();
  if (save) localStorage.setItem(key, JSON.stringify(save));
  vi.resetModules();
  const { syncedStore, SYNCED_STORES } = await import("@/__tests__/synced-stores");
  const { ownerBoundProgress: authority } = await import("@/lib/owner-bound-progress");
  await authority.updateSession("unauthenticated");
  await Promise.all(SYNCED_STORES.map(entry => authority.whenHydrated(entry.key)));
  return { entry: syncedStore(appId), authority };
}

/**
 * Writes every scenario with the new stores and returns the saves. The
 * caller fakes Date (NEW_SAVE_PLAY_TIME is the time of each change).
 */
export async function writeNewSaves(): Promise<NewSaves> {
  const saves = legacy.saves as unknown as LegacySaves;
  const out: NewSaves = {};
  for (const [appId, old] of Object.entries(saves)) {
    const key = old.key as string;
    const mine: Record<string, NewSave> = {};

    const initial = await loadDocument(appId, key);
    initial.entry.store.setState({});
    mine.untouched = capture(initial.entry, initial.authority);
    if (localStorage.getItem(key) !== null) throw new Error(`${appId}: wrote the frozen legacy key`);

    for (const [name, save] of Object.entries(old)) {
      if (SKIP.has(name) || typeof save !== "object") continue;
      const { entry, authority } = await loadDocument(appId, key, save);
      // A player's change at NEW_SAVE_PLAY_TIME.
      entry.store.getState().setProgress({
        ...(entry.store.getState().getProgress() as object),
        [entry.timeKey]: NEW_SAVE_PLAY_TIME,
      } as never);
      mine[name] = capture(entry, authority);
      if (localStorage.getItem(key) !== JSON.stringify(save)) throw new Error(`${appId}: changed the frozen legacy save`);
    }

    out[appId] = {
      key,
      version: initial.entry.store.persist.getOptions().version ?? 0,
      saves: mine,
    };
    localStorage.clear();
  }
  return out;
}
