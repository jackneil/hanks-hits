import { afterEach, expect, it, vi } from "vitest";
import { useCookieClickerStore } from "@/games/cookie-clicker/lib/store";
import { newProgressJournal, progressJournalKey } from "@/shared/lib/progressJournal";
import { progressSyncPresentation, type ProgressPresentation } from "@/shared/lib/progressSyncPresentation";
import { inspectDurableRecovery } from "./durableRecovery";

const appId = "cookie-clicker", ownerId = "owner";
const progress = (cookies: number) => ({ ...useCookieClickerStore.getState().getProgress(), cookies });
afterEach(() => {
  localStorage.clear();
  progressSyncPresentation.remove("oracle-fixture");
});

function fixture(failCapture = false, staleDurability = false) {
  const old = progress(200), live = progress(1200);
  const journal = newProgressJournal(appId, ownerId, "writer", { data: old, revision: "a".repeat(64) }, old, true);
  const key = progressJournalKey(appId, "writer");
  const original = JSON.stringify(journal);
  localStorage.setItem(key, original);
  const close = vi.fn();
  const entry: ProgressPresentation = {
    id: "oracle-fixture", appId, ownerKey: ownerId, generation: 0, status: "conflict", localDurable: true,
    retry: async () => {},
    open: () => {
      if (failCapture) {
        if (!staleDurability) progressSyncPresentation.publish({ ...entry, localDurable: false });
      } else localStorage.setItem(key, JSON.stringify({ ...journal, live }));
      return { options: [{ id: "local", label: "This device", data: live }], cloudMissing: false,
        choose: async () => ({ ok: false, status: null }), close };
    },
  };
  progressSyncPresentation.publish(entry);
  return { key, original, live, close };
}

it("credits a selectable copy only after matching the newly persisted bytes", () => {
  const h = fixture();
  expect(inspectDurableRecovery(appId, ownerId)).toEqual([h.live]);
  expect(h.close).toHaveBeenCalledOnce();
});

it.each([false, true])("does not credit a newer live edit after failed capture, even with stale durability=%s", stale => {
  const h = fixture(true, stale);
  expect(inspectDurableRecovery(appId, ownerId)).toEqual([]);
  expect(localStorage.getItem(h.key)).toBe(h.original);
  expect(h.close).toHaveBeenCalledOnce();
});

it("does not credit another owner's physical journal", () => {
  fixture();
  expect(inspectDurableRecovery(appId, "other-owner")).toEqual([]);
});
