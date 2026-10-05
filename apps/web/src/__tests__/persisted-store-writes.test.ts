import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistedStores } from "./persisted-store-fixtures";
import { PROGRESS_STORAGE_KEYS } from "@/lib/owner-bound-progress/keys";

// Common surface only; individual stores retain their own state/progress types.
interface PersistedStore {
  getState(): {
    getProgress(): Record<string, unknown>;
    setProgress(progress: Record<string, unknown>): void;
  };
  setState(state: object): void;
  persist: { getOptions(): { name: string }; hasHydrated(): boolean };
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("every persisted store preserves unchanged progress", () => {
  for (const entry of persistedStores)
    it(entry.file, async () => {
      const store = (await entry.load()) as unknown as PersistedStore;
      const { ownerBoundProgress: authority } =
        await import("@/lib/owner-bound-progress");
      const key = store.persist.getOptions().name;
      const appId = entry.file.startsWith("shared/")
        ? "achievements"
        : entry.file.split("/")[1];
      expect(key).toBe(PROGRESS_STORAGE_KEYS[appId]);
      expect(store.persist.hasHydrated()).toBe(false);
      // Exercise the production binding, never manually authorize/rehydrate a store.
      await authority.updateSession("unauthenticated");
      await authority.whenHydrated(key);
      expect(store.persist.hasHydrated()).toBe(true);
      store.setState({}); // Establish the first durable save before measuring duplicates.
      const before = authority.readScoped(key);
      expect(before).not.toBeNull();
      const writes = vi.spyOn(localStorage, "setItem");
      const stringify = vi.spyOn(JSON, "stringify");
      // Projection notifications, not simulated gameplay or a wall-clock benchmark.
      for (let update = 0; update < 120; update++) store.setState({});
      const payloadSerializations = stringify.mock.calls.filter(
        ([value]) =>
          value !== null &&
          typeof value === "object" &&
          ("state" in value || "raw" in value),
      ).length;
      stringify.mockRestore();
      expect(writes).toHaveBeenCalledTimes(0);
      expect(payloadSerializations).toBe(0);
      expect(authority.readScoped(key)).toBe(before);

      // A changed durable timestamp must still reach storage through the same adapter.
      const progress = store.getState().getProgress();
      const timeKey =
        "updatedAt" in progress && !("lastModified" in progress)
          ? "updatedAt"
          : "lastModified";
      const timestamp = Date.now() + 1000;
      store.getState().setProgress({ ...progress, [timeKey]: timestamp });
      expect(writes.mock.calls.length).toBeGreaterThan(0);
      const after = JSON.parse(authority.readScoped(key)!).state;
      expect((after.progress ?? after)[timeKey]).toBe(timestamp);
    });
});
