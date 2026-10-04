import { PROGRESS_OWNER_KEY } from "@/lib/storage-keys";

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
  const ownerBoundProgress = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    captureLease: (): Lease | null => owner() ? { ownerKey: owner()!, generation: 0 } : null,
    isCurrent: (lease: Lease) => lease.ownerKey === owner(),
    matchesSession: (status: string, userId?: string) => status !== "loading"
      && owner() === (status === "authenticated" ? userId : "guest"),
    isHydrated: () => true,
    whenHydrated: async () => {},
    listGuestCandidates: () => [],
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
