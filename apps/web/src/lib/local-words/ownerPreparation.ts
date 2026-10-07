import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import { DeletedJournalOwnerError } from "@/shared/lib/progressJournalDatabase";
import { sameProgress } from "@/shared/lib/progressStamp";
import { PROGRESS_NAMESPACE, PROGRESS_QUARANTINE, type OwnerBoundProgress, type ProgressLease } from "../owner-bound-progress/core";
import { stripProgressWords, WORD_EXTRACTION_VERSION } from "../progress-words";
import { DeletedWordOwnerError, StaleOwnerEpochError, type LocalWordsDatabase, type SourceRecord } from "./database";
import { extractLegacyWordSource, legacyWordSources } from "./inventory";
import { captureWordPreservation, type WordPreservationOptions } from "./preservation";

export type WordOwnerPreparationDependencies = Omit<WordPreservationOptions, "ownerId" | "lease" | "authority" | "words"> & {
  authority: Pick<OwnerBoundProgress, "isCurrent" | "matchesSession">;
  words: Pick<LocalWordsDatabase, "ownerEpoch" | "capture" | "readCapturedSource">;
};

export type LegacyProjectionOutcome =
  | { status: "projected"; sourceId: string; appId: string; progress: unknown }
  | { status: "missing" | "unprojectable" | "changed" | "unavailable" };

export interface PreparedWordOwner {
  projectLegacySource(sourceId: string): Promise<LegacyProjectionOutcome>;
}

export type PreparationOutcome =
  | { status: "captured" | "empty"; context: PreparedWordOwner }
  | { status: "changed" | "unavailable" };

class ChangedPreparation extends Error {}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const parse = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return null; } };

/** Recognize only the released collector's exact legacy fields address. */
function legacyAddress(source: SourceRecord): boolean {
  const parts = parse(source.sourceKey), logicalKey = legacyWordSources[source.appId];
  if (!Array.isArray(parts) || parts.length !== 5 || parts[0] !== "word-preservation"
    || parts[3] !== logicalKey || parts[4] !== "fields" || typeof parts[2] !== "string") return false;
  if (parts[1] === "legacy") return parts[2] === logicalKey;
  const prefix = parts[1] === "scoped" ? PROGRESS_NAMESPACE : parts[1] === "quarantine" ? PROGRESS_QUARANTINE : null;
  if (!prefix || !parts[2].startsWith(prefix)) return false;
  const address = parse(parts[2].slice(prefix.length));
  return Array.isArray(address) && address.length === (parts[1] === "scoped" ? 2 : 3)
    && address[0] === source.ownerKey && address[1] === logicalKey
    && (parts[1] === "scoped" || typeof address[2] === "string" && /^[0-9a-f]{64}$/.test(address[2]));
}

function project(source: SourceRecord, ownerKey: string, sourceId: string): LegacyProjectionOutcome {
  if (source.ownerKey !== ownerKey || source.id !== sourceId
    || source.id !== JSON.stringify([source.ownerKey, source.appId, source.sourceKey, source.sourceVersion, source.digest])) {
    throw new Error("Captured source identity conflicts.");
  }
  if (!Object.hasOwn(legacyWordSources, source.appId)
    || source.sourceVersion !== `preservation:v1:legacy-parser:v1:extraction:${WORD_EXTRACTION_VERSION}`
    || typeof source.raw !== "string" || !legacyAddress(source)) return { status: "unprojectable" };
  const digest = [...sha256(new TextEncoder().encode(JSON.stringify(source.raw)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (source.digest !== digest) throw new Error("Captured source content conflicts.");
  const envelope = parse(source.raw);
  if (!object(envelope) || !object(envelope.state)
    || envelope.version !== undefined && envelope.version !== 0 && !(source.appId === "oregon-trail" && envelope.version === 1)) {
    return { status: "unprojectable" };
  }
  const extracted = extractLegacyWordSource(source.appId, source.raw);
  if (!extracted || !extracted.fields.length || !sameProgress(extracted.fields, source.fields)) return { status: "unprojectable" };
  return { status: "projected", sourceId, appId: source.appId, progress: stripProgressWords(source.appId, extracted.progress) };
}

/**
 * Unused selected-source preparation. Construction performs no I/O. A context
 * authorizes only a derived view of exact preserved evidence, not live progress,
 * hydration, dispatch, source retirement or deletion. There is no cross-database
 * snapshot, post-return atomicity or wall-clock timeout promise.
 */
export function createWordOwnerPreparation(dependencies: WordOwnerPreparationDependencies): {
  prepare(ownerId: string, lease: ProgressLease): Promise<PreparationOutcome>;
} {
  const { authority, storage, words, journals } = dependencies;
  return {
    async prepare(ownerId, suppliedLease) {
      let lease: ProgressLease;
      try { lease = Object.freeze({ ...suppliedLease }); }
      catch { return { status: "unavailable" }; }
      let invalidated = false;
      const changed = (): never => { invalidated = true; throw new ChangedPreparation(); };
      const current = () => {
        if (invalidated) return false;
        if (!ownerId || !authority.matchesSession("authenticated", ownerId)
          || !authority.isCurrent(lease) || journals.isOwnerDeleted(lease.ownerKey)) {
          invalidated = true;
          return false;
        }
        return true;
      };
      const check = () => { if (!current()) changed(); };
      const failure = (error: unknown): "changed" | "unavailable" => {
        if (error instanceof ChangedPreparation || error instanceof DeletedWordOwnerError
          || error instanceof StaleOwnerEpochError || error instanceof DeletedJournalOwnerError
          || error instanceof Error && error.message === "Journal owner epoch changed") invalidated = true;
        try { if (!current()) return "changed"; } catch { /* Redact dependency failures, including authority reads. */ }
        return invalidated ? "changed" : "unavailable";
      };
      try {
        check();
        const resolvedOwner = await ownerKeyFor(ownerId);
        check();
        if (resolvedOwner !== lease.ownerKey) changed();
        const wordEpoch = await words.ownerEpoch(lease.ownerKey);
        check();
        if (wordEpoch !== 0) changed();
        const journalEpoch = await journals.ownerEpoch(lease.ownerKey);
        check();
        const captured = await captureWordPreservation({ ownerId, lease, storage, words, journals,
          authority: { isCurrent: candidate => current() && authority.isCurrent(candidate) } });
        check();
        if (captured === "changed") changed();
        const finalJournalEpoch = await journals.ownerEpoch(lease.ownerKey);
        check();
        if (finalJournalEpoch !== journalEpoch) changed();
        const finalWordEpoch = await words.ownerEpoch(lease.ownerKey);
        check();
        if (finalWordEpoch !== wordEpoch) changed();
        if (captured === "unavailable") return { status: "unavailable" };
        const context: PreparedWordOwner = {
          async projectLegacySource(sourceId) {
            try {
              check();
              let result: LegacyProjectionOutcome;
              try {
                const source = await words.readCapturedSource(lease.ownerKey, sourceId, wordEpoch);
                check();
                result = source ? project(source, lease.ownerKey, sourceId) : { status: "missing" };
              } catch (error) {
                const status = failure(error);
                if (status === "changed") return { status };
                result = { status };
              }
              const finalJournal = await journals.ownerEpoch(lease.ownerKey);
              check();
              if (finalJournal !== journalEpoch) changed();
              const finalWord = await words.ownerEpoch(lease.ownerKey);
              check();
              if (finalWord !== wordEpoch) changed();
              return result;
            } catch (error) {
              return { status: failure(error) };
            }
          },
        };
        return { status: captured, context };
      } catch (error) {
        return { status: failure(error) };
      }
    },
  };
}
