import { ownerKeyFor } from "@/shared/clips/library/ownerKey";

export type LocalWordsLease = Readonly<{ ownerKey: string; generation: number }>;
export type LocalWordsSnapshot =
  | Readonly<{ status: "unresolved"; generation: number }>
  | Readonly<LocalWordsLease & { status: "guest" | "account" }>;
export type LocalWordsAuthStatus = "loading" | "authenticated" | "unauthenticated";

/** No browser listeners or storage work happen until a caller supplies a session. */
export function createLocalWordsSession(deps: {
  ownerKeyFor?: (userId: string | null) => Promise<string>;
} = {}) {
  const keyFor = deps.ownerKeyFor ?? ownerKeyFor;
  const listeners = new Set<() => void>();
  const revoked = new Set<string>();
  let generation = 0;
  let snapshot: LocalWordsSnapshot = Object.freeze({ status: "unresolved", generation });
  // Raw identity is private and used only to deduplicate session notifications.
  let requestedStatus: LocalWordsAuthStatus = "loading";
  let requestedUserId: string | undefined;

  const notify = () => { for (const listener of listeners) listener(); };
  const invalidate = () => {
    requestedStatus = "loading";
    requestedUserId = undefined;
    snapshot = Object.freeze({ status: "unresolved", generation: ++generation });
    notify();
  };

  const update = async (status: LocalWordsAuthStatus, userId?: string): Promise<void> => {
    // An authenticated session without an identity is unresolved, never a guest.
    const nextStatus = status === "authenticated" && !userId ? "loading" : status;
    const nextUserId = nextStatus === "authenticated" ? userId : undefined;
    if (requestedStatus === nextStatus && requestedUserId === nextUserId) return;

    requestedStatus = nextStatus;
    requestedUserId = nextUserId;
    const capturedGeneration = ++generation;
    snapshot = Object.freeze({ status: "unresolved", generation });
    // Hide prior words and invalidate leases before starting even the hash.
    notify();
    if (nextStatus === "loading" || generation !== capturedGeneration) return;

    try {
      const ownerKey = await keyFor(nextUserId ?? null);
      if (generation !== capturedGeneration) return;
      if (revoked.has(ownerKey)) {
        requestedStatus = "loading";
        requestedUserId = undefined;
        return;
      }
      snapshot = Object.freeze({
        status: nextStatus === "authenticated" ? "account" : "guest",
        ownerKey,
        generation: capturedGeneration,
      });
      notify();
    } catch {
      // No identity or error values escape. Allow a later notification to retry.
      if (generation === capturedGeneration) {
        requestedStatus = "loading";
        requestedUserId = undefined;
      }
    }
  };

  return {
    update,
    invalidate,
    revoke: (ownerKey: string): void => {
      revoked.add(ownerKey);
      if (snapshot.status !== "unresolved" && snapshot.ownerKey === ownerKey) invalidate();
    },
    getSnapshot: (): LocalWordsSnapshot => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    captureLease: (): LocalWordsLease | null => snapshot.status === "unresolved"
      ? null : Object.freeze({ ownerKey: snapshot.ownerKey, generation: snapshot.generation }),
    /** Check after every await and before exposing owner-bound results. */
    isCurrent: (lease: LocalWordsLease): boolean => snapshot.status !== "unresolved"
      && snapshot.ownerKey === lease.ownerKey && snapshot.generation === lease.generation
      && !revoked.has(lease.ownerKey),
  };
}

export type LocalWordsSession = ReturnType<typeof createLocalWordsSession>;
