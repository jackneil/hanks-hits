import { PROGRESS_OWNER_KEY } from "@/lib/storage-keys";
import { createHash } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, vi } from "vitest";

/**
 * Existing B1 fixtures isolate reconciliation using their historical raw saves.
 * Runtime namespace/owner races have separate real-authority coverage. This
 * adapter makes their already-hydrated test stores explicit without introducing
 * a legacy-storage fallback into production sync.
 */
export function createSyncOwnerFixture(readSession: () => unknown) {
  type Session = { status: string; data?: { user?: { id?: string } } | null };
  type Lease = { ownerKey: string; generation: number };
  const snapshot = { status: "ready" as const, generation: 0, ownerKey: "fixture", hydrating: false, needsNavigation: false, memoryOnly: false };
  const owner = () => {
    const session = readSession() as Session;
    return session.status === "authenticated" ? session.data?.user?.id ?? null
      : session.status === "unauthenticated" ? "guest" : null;
  };
  const ownerKey = () => {
    const id = owner();
    return id === "guest" || id === null ? id : `u_${createHash("sha256").update("hh-clips:v1:" + id).digest("hex").slice(0, 20)}`;
  };
  let pinned: string | null = null;
  beforeEach(() => { pinned = null; vi.stubGlobal("indexedDB", new IDBFactory()); });
  const ownerBoundProgress = {
    subscribe: () => () => {},
    // These legacy projections are plain localStorage writes; the hook's poll
    // observes them. Real adapter notifications have separate integration tests.
    subscribeStoreWrites: () => () => {},
    getSnapshot: () => snapshot,
    captureLease: (): Lease | null => {
      const key = ownerKey(); if (!key || (pinned !== null && key !== pinned)) return null;
      pinned = key; return { ownerKey: key, generation: 0 };
    },
    isCurrent: (lease: Lease) => lease.ownerKey === ownerKey(),
    matchesSession: (status: string, userId?: string) => status !== "loading"
      && owner() === (status === "authenticated" ? userId : "guest")
      && (pinned === null || pinned === ownerKey()),
    isHydrated: () => true,
    whenHydrated: async () => {},
    listGuestCandidates: () => [],
    listDurableGuestCandidates: () => ({ candidates: [], unavailable: false }),
    listDurableLegacy: () => ({ keys: [], available: true }),
    listDurableScoped: (prefix: string) => ({ keys: Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).filter(key => key.startsWith(prefix)), available: true }),
    readDurableScoped: (key: string) => {
      try { const raw = localStorage.getItem(key); return raw === null ? { status: "missing" } : { status: "durable", raw }; }
      catch { return { status: "unavailable", raw: null }; }
    },
    flushStore: () => true,
    acknowledgeGuestCandidate: () => false,
    readEvidence: (key: string) => {
      try {
        const raw = localStorage.getItem(key), marker = localStorage.getItem(PROGRESS_OWNER_KEY);
        return { raw, legacyRaw: raw, marker, markerReadable: true, eligible: true, loadAt: Date.now(), source: raw ? "legacy" : "none" };
      } catch {
        return { raw: null, legacyRaw: null, marker: null, markerReadable: false, eligible: false, loadAt: Date.now(), source: "none" };
      }
    },
    readScoped: (key: string) => { try { return localStorage.getItem(key); } catch { return null; } },
    writeScoped: (key: string, raw: string) => { try { localStorage.setItem(key, raw); return true; } catch { return false; } },
    removeScoped: (key: string) => { try { localStorage.removeItem(key); return true; } catch { return false; } },
    hasDurable: (key: string) => localStorage.getItem(key) !== null,
    isScopedStorageEvent: (event: StorageEvent, key: string) => event.key === key,
    getLoadTime: () => undefined,
    revoke: () => { window.location.reload(); },
    createStorage: () => ({
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, raw: string) => localStorage.setItem(key, raw),
      removeItem: (key: string) => localStorage.removeItem(key),
    }),
    bindPersistedStore: (_key: string, persist: { rehydrate: () => unknown }) => { void persist.rehydrate(); return () => {}; },
  };
  return {
    ownerBoundProgress,
    createOwnerBoundStorage: ownerBoundProgress.createStorage,
    bindPersistedStore: ownerBoundProgress.bindPersistedStore,
  };
}
