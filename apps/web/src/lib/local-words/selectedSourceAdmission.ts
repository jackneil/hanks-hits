import { isOwnerKey, sha256 } from "@/shared/clips/library/ownerKey";
import type { OwnerBoundProgress, ProgressLease } from "../owner-bound-progress/core";
import { DeletedWordOwnerError, StaleOwnerEpochError, type LocalWordsDatabase } from "./database";
import { extractLegacyWordSource, legacyWordSources } from "./inventory";
import type { PreparedWordOwner } from "./ownerPreparation";

/**
 * The full pure persist projection in the extractor's comparison domain, not
 * getProgress(), a stripped view or the last successfully written cache.
 * The caller owns the clock: every accepted edit (including equal-valued clear
 * and edit/revert) advances it synchronously before publication or persistence.
 * Both reference identities must change, never be reused, when their lifetime
 * ends. Failed, denied and awaiting-retry writes remain unsettled.
 */
export interface SelectedSourceObservation {
  persistedState: unknown;
  storeInstance: object;
  clockInstance: object;
  acceptedRevision: number;
  hasUnsettledAcceptedWrites: boolean;
}

export interface SelectedSourceAdmissionDependencies {
  authority: Pick<OwnerBoundProgress, "isCurrent" | "matchesSession" | "isHydrated">;
  words: Pick<LocalWordsDatabase, "readCapturedSource">;
  readObservation(): SelectedSourceObservation;
}

export interface SelectedSourceAdmissionScope {
  ownerId: string;
  lease: ProgressLease;
  appId: string;
  prepared: PreparedWordOwner;
}

export type SelectedSourceAdmissionOutcome =
  | {
    status: "admitted";
    ownerKey: string;
    appId: string;
    sourceId: string;
    progress: unknown;
    /** Local evidence only: no fresh durable epoch read or mutation authority. */
    isObservationCurrent(): boolean;
  }
  | { status: "mismatch" | "missing" | "unprojectable" | "changed" | "unavailable" };

class ChangedObservation extends Error {}

/** Exact JSON-value equality, including own key presence at every depth. */
function sameJsonValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((value, index) => sameJsonValue(value, other[index]));
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]));
}

/** Copy JSON values without invoking getters or normalizing away evidence. */
function copyJson(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null || ancestors.has(value)) throw new Error("Invalid persisted observation.");
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new Error("Invalid persisted observation.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== "string")) throw new Error("Invalid persisted observation.");
  if (array && (keys.length !== value.length + 1
    || keys.some(key => key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key as string)
      || Number(key) >= value.length)))) {
    throw new Error("Invalid persisted observation.");
  }
  ancestors.add(value);
  try {
    const copied: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of keys as string[]) {
      if (array && key === "length") continue;
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) throw new Error("Invalid persisted observation.");
      Object.defineProperty(copied, key, { value: copyJson(descriptor.value, ancestors),
        enumerable: true, configurable: true, writable: true });
    }
    return copied;
  } finally { ancestors.delete(value); }
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) throw new Error("Invalid observation contract.");
  return descriptor.value;
}

function snapshot(observation: SelectedSourceObservation): SelectedSourceObservation {
  if (!observation || typeof observation !== "object") throw new Error("Invalid observation contract.");
  const storeInstance = dataProperty(observation, "storeInstance"), clockInstance = dataProperty(observation, "clockInstance");
  const reference = (value: unknown): value is object => value !== null && (typeof value === "object" || typeof value === "function");
  const acceptedRevision = dataProperty(observation, "acceptedRevision"), hasUnsettledAcceptedWrites = dataProperty(observation, "hasUnsettledAcceptedWrites");
  if (!reference(storeInstance) || !reference(clockInstance)
    || typeof acceptedRevision !== "number" || !Number.isSafeInteger(acceptedRevision) || acceptedRevision < 0
    || typeof hasUnsettledAcceptedWrites !== "boolean") throw new Error("Invalid observation contract.");
  const persistedState = copyJson(dataProperty(observation, "persistedState"));
  if (persistedState === null || typeof persistedState !== "object" || Array.isArray(persistedState)) {
    throw new Error("Invalid persisted observation.");
  }
  return { persistedState, storeInstance, clockInstance, acceptedRevision, hasUnsettledAcceptedWrites };
}

/**
 * Unused conditional admission of one captured original. Import/construction
 * performs no I/O. No store setter, hydration, dispatch, retirement or deletion
 * is authorized by a returned view. The synchronous predicate observes only
 * the caller's local fence, not durable epochs or unobserved external ABA.
 */
export function createSelectedSourceAdmission(
  dependencies: SelectedSourceAdmissionDependencies,
  scope: SelectedSourceAdmissionScope,
): { admit(sourceId: string): Promise<SelectedSourceAdmissionOutcome> } {
  const { authority, words, readObservation } = dependencies;
  const { ownerId, appId, prepared } = scope;
  // Keep the originally supplied lease, even if callers mutate their scope.
  let lease: ProgressLease | null = null;
  try { lease = Object.freeze({ ownerKey: scope.lease.ownerKey, generation: scope.lease.generation }); }
  catch { /* An invalid scope can never produce a candidate. */ }
  const logicalKey = Object.hasOwn(legacyWordSources, appId) ? legacyWordSources[appId] : null;
  return {
    async admit(sourceId) {
      if (!logicalKey) return { status: "unprojectable" };
      if (typeof ownerId !== "string" || !ownerId || !lease || !isOwnerKey(lease.ownerKey) || lease.ownerKey === "guest"
        || !Number.isSafeInteger(lease.generation) || lease.generation < 0 || typeof sourceId !== "string") return { status: "unavailable" };
      const originalLease = lease;
      let invalidated = false, observed: SelectedSourceObservation | undefined;
      const ownerCurrent = () => authority.matchesSession("authenticated", ownerId)
        && authority.isCurrent(originalLease) && authority.isHydrated(logicalKey);
      const changed = (): never => { invalidated = true; throw new ChangedObservation(); };
      const check = () => {
        if (invalidated || !ownerCurrent()) changed();
        const current = snapshot(readObservation());
        if (current.hasUnsettledAcceptedWrites || observed && (current.storeInstance !== observed.storeInstance
          || current.clockInstance !== observed.clockInstance || current.acceptedRevision !== observed.acceptedRevision
          || !sameJsonValue(current.persistedState, observed.persistedState))) changed();
        if (!ownerCurrent()) changed();
        return current;
      };
      try {
        observed = check();
        const source = await words.readCapturedSource(originalLease.ownerKey, sourceId, 0);
        check();
        if (!source) return { status: "missing" };
        // Read raw exactly once. Hash and decode this same immutable primitive,
        // even when an injected reader returns an accessor-shaped row.
        const { id, ownerKey, appId: sourceAppId, sourceKey, sourceVersion, digest, raw } = source;
        if (ownerKey !== originalLease.ownerKey || sourceAppId !== appId || id !== sourceId
          || typeof sourceKey !== "string" || !(typeof sourceVersion === "string"
            || typeof sourceVersion === "number" && Number.isFinite(sourceVersion))
          || typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)
          || id !== JSON.stringify([ownerKey, sourceAppId, sourceKey, sourceVersion, digest]) || typeof raw !== "string") {
          return { status: "unavailable" };
        }
        const actualDigest = [...sha256(new TextEncoder().encode(JSON.stringify(raw)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
        if (digest !== actualDigest) return { status: "unavailable" };
        const original = extractLegacyWordSource(appId, raw);
        if (!original) return { status: "unprojectable" };
        if (!sameJsonValue(original.progress, observed.persistedState)) return { status: "mismatch" };
        const projection = await prepared.projectLegacySource(sourceId);
        check();
        if (projection.status !== "projected") return { status: projection.status };
        if (projection.sourceId !== sourceId || projection.appId !== appId) return { status: "unavailable" };
        const progress = copyJson(projection.progress);
        check();
        return { status: "admitted", ownerKey: originalLease.ownerKey, appId, sourceId, progress,
          isObservationCurrent() {
            try { check(); return true; }
            catch { invalidated = true; return false; }
          } };
      } catch (error) {
        invalidated = true;
        return { status: error instanceof ChangedObservation || error instanceof DeletedWordOwnerError
          || error instanceof StaleOwnerEpochError ? "changed" : "unavailable" };
      }
    },
  };
}
