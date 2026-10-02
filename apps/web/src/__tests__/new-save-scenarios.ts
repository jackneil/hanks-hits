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
 * and then loads them with the store code of an older commit (the master
 * commit before this change): a rollback of the deploy, or a tab that still
 * runs the old code, must load the new saves without losing progress.
 */
import type { AppProgressData } from "@hank-neil/db/schema";
import { SYNCED_STORES, type SyncedStoreEntry } from "@/__tests__/synced-stores";
import legacy from "@/__tests__/fixtures/legacy-saves.json";

type Save = { state: Record<string, unknown>; version: number };
type LegacySaves = Record<string, Record<string, Save | string>>;

/** The time of the player's change in every played save. */
export const NEW_SAVE_PLAY_TIME = Date.UTC(2026, 9, 3, 12, 0, 0);

export type NewSave = {
  /** The localStorage value (JSON) that the new store wrote. */
  raw: string;
  /** getProgress() of the new store when it wrote the save. */
  progress: AppProgressData;
};

export type NewSaves = Record<string, { key: string; version: number; saves: Record<string, NewSave> }>;

const SKIP = new Set(["key", "untouched", "automatic", "preference"]);

function capture(entry: SyncedStoreEntry): NewSave {
  return {
    raw: localStorage.getItem(entry.key) ?? "",
    progress: JSON.parse(JSON.stringify(entry.store.getState().getProgress())),
  };
}

async function loadLegacy(entry: SyncedStoreEntry, save: Save) {
  entry.reset();
  localStorage.setItem(entry.key, JSON.stringify(save));
  await entry.store.persist.rehydrate();
}

/**
 * Writes every scenario with the new stores and returns the saves. The
 * caller fakes Date (NEW_SAVE_PLAY_TIME is the time of each change).
 */
export async function writeNewSaves(): Promise<NewSaves> {
  const saves = legacy.saves as unknown as LegacySaves;
  const out: NewSaves = {};
  for (const entry of SYNCED_STORES) {
    const old = saves[entry.appId];
    const mine: Record<string, NewSave> = {};

    entry.reset();
    localStorage.removeItem(entry.key);
    entry.store.setState({});
    mine.untouched = capture(entry);

    for (const [name, save] of Object.entries(old)) {
      if (SKIP.has(name) || typeof save !== "object") continue;
      await loadLegacy(entry, save);
      // A player's change at NEW_SAVE_PLAY_TIME.
      entry.store.getState().setProgress({
        ...(entry.store.getState().getProgress() as object),
        [entry.timeKey]: NEW_SAVE_PLAY_TIME,
      } as never);
      mine[name] = capture(entry);
    }

    out[entry.appId] = {
      key: entry.key,
      version: entry.store.persist.getOptions().version ?? 0,
      saves: mine,
    };
    entry.reset();
    localStorage.removeItem(entry.key);
  }
  return out;
}
