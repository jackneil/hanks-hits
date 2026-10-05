import type { ValidAppId } from "@hank-neil/db/schema";
import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import { parseProgressJournal, progressJournalKey } from "@/shared/lib/progressJournal";
import type { ProgressLease } from "../owner-bound-progress/core";
import { extractProgressWords, PROGRESS_WORD_FIELDS, WORD_EXTRACTION_VERSION } from "../progress-words";
import type { SourceRecord } from "./database";
import type { MigrationDatabase } from "./migration";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const child = (value: unknown, key: string): unknown => object(value) && Object.hasOwn(value, key) ? value[key] : undefined;
const digest = (raw: string) => [...sha256(new TextEncoder().encode(raw))].map(byte => byte.toString(16).padStart(2, "0")).join("");

/**
 * Extract each journal alternative as a separate source. Never combine two
 * versions of a name/artwork into one candidate and let array order choose it.
 * The raw journal bytes accompany every source, including unknown formats.
 * Ownership and its physical address come from the mounted storage authority.
 */
export function progressJournalWordSources(raw: string, address: {
  appId: ValidAppId; ownerId: string; ownerKey: string; logicalKey: string;
}): SourceRecord[] | null {
  try {
    const row: unknown = JSON.parse(raw);
    if (!object(row) || row.ownerId !== address.ownerId || row.appId !== address.appId
      || typeof row.writerId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(row.writerId)
      || progressJournalKey(address.appId, row.writerId) !== address.logicalKey) return null;
    if (row.version === 1 && !Object.hasOwn(PROGRESS_WORD_FIELDS, address.appId)
      && parseProgressJournal(raw, address.appId, address.ownerId)) return [];
    const snapshots = row.version === 1 ? [
      ["acknowledged", child(row.acknowledged, "data")],
      ["sent-base", child(child(row.sent, "base"), "data")],
      ["sent", child(row.sent, "data")],
      ["live", row.live],
      ["conflict", child(child(row.conflict, "remote"), "data")],
    ] as const : [];
    const hash = digest(raw);
    const sourceVersion = `progress-journal:1:words:${WORD_EXTRACTION_VERSION}`;
    const make = (section: string, fields: SourceRecord["fields"]): SourceRecord => {
      const sourceKey = `${address.logicalKey}:${section}`;
      return {
        id: JSON.stringify([address.ownerKey, address.appId, sourceKey, sourceVersion, hash]),
        ownerKey: address.ownerKey, appId: address.appId, sourceKey, sourceVersion, digest: hash, raw, fields,
      };
    };
    const sources = snapshots.flatMap(([section, data]) => {
      const fields = extractProgressWords(address.appId, data).fields;
      return fields.length ? [make(section, fields)] : [];
    });
    // No recognized words is not proof that future/malformed data has none.
    // Preserve the opaque bytes instead of approving destructive cleanup.
    return sources.length ? sources : [make("original", [])];
  } catch { return null; }
}

/**
 * A preservation barrier, not retirement permission. The caller still checks
 * the original source serial/bytes before changing any storage key. Tombstone
 * epochs prevent late captures after local-word deletion. Failures reveal no
 * source values, and partial successes remain idempotent on the next attempt.
 */
export async function captureProgressJournalWords(options: {
  raw: string; logicalKey: string; appId: ValidAppId; ownerId: string;
  lease: ProgressLease; isCurrent: (lease: ProgressLease) => boolean; database: MigrationDatabase;
}): Promise<boolean> {
  const lease = { ...options.lease };
  const { raw, logicalKey, appId, ownerId, database, isCurrent } = options;
  try {
    if (!isCurrent(lease) || await ownerKeyFor(ownerId) !== lease.ownerKey || !isCurrent(lease)) return false;
    const sources = progressJournalWordSources(raw, { appId, ownerId, ownerKey: lease.ownerKey, logicalKey });
    if (sources === null) return false;
    if (!sources.length) return isCurrent(lease);
    const epoch = await database.ownerEpoch(lease.ownerKey);
    if (epoch !== 0 || !isCurrent(lease)) return false;
    for (const source of sources) {
      if (!isCurrent(lease)) return false;
      await database.capture(source, epoch);
      if (!isCurrent(lease)) return false;
    }
    return true;
  } catch { return false; }
}
