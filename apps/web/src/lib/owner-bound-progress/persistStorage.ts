import type { PersistStorage, StorageValue } from "zustand/middleware";
import { createOwnerBoundStorage, ownerBoundProgress } from "./index";

/** Compare the complete persist projection, including flat stores and version. */
function sameEnvelope<S>(a: StorageValue<S>, b: StorageValue<S>): boolean {
  if (a.version !== b.version) return false;
  if (Object.is(a.state, b.state)) return true;
  if (!a.state || !b.state || typeof a.state !== "object" || typeof b.state !== "object") return false;
  const before = a.state as Record<string, unknown>;
  const after = b.state as Record<string, unknown>;
  const keys = Object.keys(before);
  return keys.length === Object.keys(after).length
    && keys.every((key) => Object.hasOwn(after, key) && Object.is(before[key], after[key]));
}

/**
 * Suppress unchanged frame writes before JSON serialization. The projection must
 * use immutable values, as Zustand stores do. A failed write is always retried.
 */
export function createOwnerPersistStorage<S>(logicalKey: string, appId: string): PersistStorage<S> {
  const storage = createOwnerBoundStorage(logicalKey, appId);
  let lease: ReturnType<typeof ownerBoundProgress.captureLease> = null;
  let saved: StorageValue<S> | null = null;
  let pending: StorageValue<S> | null = null;
  // An asynchronous preservation transaction may span many animation frames.
  // Retain its exact serialization independently from proof of durability.
  let attempted: StorageValue<S> | null = null;
  let attemptedRaw: string | null = null;
  const write = (value: StorageValue<S>) => {
    const current = ownerBoundProgress.captureLease();
    if (!lease) return; // No hydration has authorized this store yet.
    if (!current) {
      // Same-document cleanup may settle progress while session refresh hides
      // the game. Retain it for this owner only; a real owner change discards it.
      if (ownerBoundProgress.getSnapshot().status === "unresolved") pending = value;
      return;
    }
    if (current.ownerKey !== lease.ownerKey) return;
    lease = current;
    if (saved && sameEnvelope(saved, value) && ownerBoundProgress.hasDurable(logicalKey)) return;
    const raw = attempted && sameEnvelope(attempted, value) && attemptedRaw !== null
      ? attemptedRaw : JSON.stringify(value);
    attempted = value;
    attemptedRaw = raw;
    const durable = ownerBoundProgress.writeScoped(logicalKey, raw, lease);
    saved = durable ? value : null;
  };
  ownerBoundProgress.subscribe(() => {
    if (ownerBoundProgress.getSnapshot().status === "revoked") {
      pending = null; saved = null; attempted = null; attemptedRaw = null;
    }
    const current = ownerBoundProgress.captureLease();
    if (current && current.ownerKey === lease?.ownerKey && attempted
      && ownerBoundProgress.isLatestDurable(logicalKey, current)
      && ownerBoundProgress.readScoped(logicalKey, current) === attemptedRaw) saved = attempted;
    if (!pending || !ownerBoundProgress.captureLease()) return;
    const value = pending;
    pending = null;
    write(value);
  });
  return {
    getItem: async (name) => {
      const raw = await storage.getItem(name);
      lease = ownerBoundProgress.captureLease();
      saved = null;
      attempted = null;
      attemptedRaw = null;
      return raw === null ? null : JSON.parse(raw) as StorageValue<S>;
    },
    setItem: (_name, value) => write(value),
    removeItem: (name) => {
      saved = null;
      pending = null;
      attempted = null;
      attemptedRaw = null;
      if (lease && ownerBoundProgress.isCurrent(lease)) storage.removeItem(name);
    },
  };
}
