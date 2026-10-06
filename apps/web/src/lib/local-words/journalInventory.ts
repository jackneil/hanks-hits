import { VALID_APP_IDS, type ValidAppId } from "@hank-neil/db/schema";
import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import { PROGRESS_JOURNAL_PREFIX, progressJournalKey } from "@/shared/lib/progressJournal";
import {
  DeletedJournalOwnerError, type JournalPageCursor, type ProgressJournalDatabase,
} from "@/shared/lib/progressJournalDatabase";
import { isJournalSourceId, journalOriginalId, journalSourceId } from "@/shared/lib/progressJournalRecovery";
import { PROGRESS_NAMESPACE, type OwnerBoundProgress, type ProgressLease } from "../owner-bound-progress/core";
import { DeletedWordOwnerError, StaleOwnerEpochError, type SourceRecord } from "./database";
import type { MigrationDatabase } from "./migration";
import { progressJournalWordSources } from "./progressJournalSources";

export type PhysicalStorage = Pick<Storage, "length" | "key" | "getItem">;
export type JournalInventoryOptions = {
  ownerId: string;
  lease: ProgressLease;
  authority: Pick<OwnerBoundProgress, "isCurrent">;
  storage: () => PhysicalStorage | undefined;
  words: MigrationDatabase;
  journals: Pick<ProgressJournalDatabase, "ownerEpoch" | "isOwnerDeleted" | "checkpointPage" | "archivePage">;
};
export type JournalInventoryResult = "captured" | "empty" | "changed" | "unavailable";

const FORMAT_VERSION = 1;
const OPAQUE_APP = "journal-inventory";
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(value);
const parse = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return undefined; } };
// JSON quoting preserves distinct lone UTF-16 surrogates before UTF-8 encoding.
const fingerprint = (raw: string): string => [...sha256(new TextEncoder().encode(JSON.stringify(raw)))]
  .map(byte => byte.toString(16).padStart(2, "0")).join("");
type Provenance = readonly unknown[];
type Address = { appId: ValidAppId; writerId: string; generation?: number; sourceId?: string };
type PhysicalAddress = { name: string; logicalKey: string };
class ChangedInventory extends Error {}

function record(ownerKey: string, raw: string, provenance: Provenance, helper?: SourceRecord): SourceRecord {
  const appId = helper?.appId ?? OPAQUE_APP;
  const sourceKey = JSON.stringify(helper ? [...provenance, "section", helper.sourceKey] : provenance);
  // Keep the helper's extraction version: a new extractor must retain its own
  // section capture even when every observed journal byte stays unchanged.
  const sourceVersion = JSON.stringify(["journal-inventory", FORMAT_VERSION,
    helper ? "section" : "opaque", ...(helper ? [helper.sourceVersion] : [])]);
  const digest = fingerprint(raw);
  return { id: JSON.stringify([ownerKey, appId, sourceKey, sourceVersion, digest]),
    ownerKey, appId, sourceKey, sourceVersion, digest, raw, fields: helper?.fields ?? [] };
}

function physicalAddresses(local: PhysicalStorage, ownerKey: string): PhysicalAddress[] {
  const found: PhysicalAddress[] = [];
  for (let index = 0; index < local.length; index++) {
    const name = local.key(index);
    if (!name?.startsWith(PROGRESS_NAMESPACE)) continue;
    const pair = parse(name.slice(PROGRESS_NAMESPACE.length));
    if (Array.isArray(pair) && pair.length === 2 && pair[0] === ownerKey
      && typeof pair[1] === "string" && pair[1].startsWith(PROGRESS_JOURNAL_PREFIX)) {
      found.push({ name, logicalKey: pair[1] });
    }
  }
  return found.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** List every exact factory match; app prefixes alone are not an address. */
function physicalCandidates(logicalKey: string): Address[] {
  return VALID_APP_IDS.flatMap(appId => {
    const prefix = `${PROGRESS_JOURNAL_PREFIX}${appId}-`, suffix = "-storage";
    if (!logicalKey.startsWith(prefix) || !logicalKey.endsWith(suffix)) return [];
    const writerId = logicalKey.slice(prefix.length, -suffix.length);
    return identifier(writerId) && progressJournalKey(appId, writerId) === logicalKey ? [{ appId, writerId }] : [];
  });
}

/**
 * Unused preservation collector. Importing it does not observe storage. Copies
 * never grant projection, dispatch, retirement, or deletion permission. Pages
 * and physical rechecks are observations, not an owner-wide atomic snapshot.
 */
export async function captureJournalInventory(options: JournalInventoryOptions): Promise<JournalInventoryResult> {
  const { ownerId, authority, storage, words, journals } = options;
  const lease = { ...options.lease };
  let incomplete = false, observed = 0;
  const current = () => authority.isCurrent(lease) && !journals.isOwnerDeleted(lease.ownerKey);
  const check = () => { if (!current()) throw new ChangedInventory(); };
  const awaited = async <T>(promise: Promise<T>): Promise<T> => {
    const value = await promise;
    check();
    return value;
  };
  const isChanged = (error: unknown) => error instanceof ChangedInventory
    || error instanceof DeletedWordOwnerError || error instanceof StaleOwnerEpochError
    || error instanceof DeletedJournalOwnerError
    || error instanceof Error && error.message === "Journal owner epoch changed";

  try {
    check();
    if (!ownerId || await awaited(ownerKeyFor(ownerId)) !== lease.ownerKey) return "changed";
    const wordEpoch = await awaited(words.ownerEpoch(lease.ownerKey));
    if (wordEpoch !== 0) return "changed";
    const journalEpoch = await awaited(journals.ownerEpoch(lease.ownerKey));
    const capture = async (raw: string, provenance: Provenance, helper?: SourceRecord) => {
      check();
      await awaited(words.capture(record(lease.ownerKey, raw, provenance, helper), wordEpoch));
    };
    const alternative = async (raw: string, provenance: Provenance, address: Address, original: boolean,
      extract: boolean) => {
      await capture(raw, provenance);
      const row = parse(raw);
      // Unknown versions are recoverable opaque bytes, not understood content.
      if (!object(row) || row.version !== 1) return;
      if (row.ownerId !== ownerId || row.appId !== address.appId || !identifier(row.writerId)
        || !original && row.writerId !== address.writerId) {
        if (typeof row.ownerId === "string" && row.ownerId !== ownerId
          || typeof row.appId === "string" && row.appId !== address.appId
          || typeof row.writerId === "string" && (!identifier(row.writerId) || !original && row.writerId !== address.writerId)) {
          incomplete = true;
        }
        return;
      }
      if (!extract) return;
      const helpers = progressJournalWordSources(raw, { ownerId, ownerKey: lease.ownerKey,
        appId: address.appId, logicalKey: progressJournalKey(address.appId, row.writerId) });
      if (helpers === null) { incomplete = true; return; }
      for (const helper of helpers) await capture(raw, provenance, helper);
    };
    const interpret = async (raw: string, provenance: Provenance, bound: Address | Address[]) => {
      const value = parse(raw);
      let currentRaw = raw, originals: unknown[] = [], generation = 0;
      if (object(value) && value.format === "hh-progress-journal") {
        if (![1, 2, 3].includes(value.version as number) || !Number.isSafeInteger(value.generation)
          || (value.generation as number) < 0 || typeof value.current !== "string"
          || !Array.isArray(value.originals)) return;
        currentRaw = value.current;
        originals = value.originals;
        generation = value.generation as number;
      } else if (!object(value) || value.version !== 1) return;
      let address: Address;
      if (Array.isArray(bound)) {
        if (!bound.length) return;
        const inner = parse(currentRaw);
        if (!object(inner)) return;
        const matching = bound.filter(candidate => candidate.appId === inner.appId && candidate.writerId === inner.writerId);
        if (inner.ownerId !== ownerId || matching.length !== 1) {
          if (inner.version === 1 && (typeof inner.ownerId === "string" && inner.ownerId !== ownerId
            || typeof inner.appId === "string" && typeof inner.writerId === "string" && matching.length !== 1)) incomplete = true;
          return;
        }
        address = matching[0];
      } else address = bound;
      const validGeneration = address.generation === undefined || address.generation === generation;
      const validSource = address.sourceId === undefined
        || address.sourceId === journalSourceId(lease.ownerKey, address.appId, address.writerId, currentRaw);
      if (!validGeneration || !validSource) incomplete = true;
      await alternative(currentRaw, [...provenance, "current"], address, false, validGeneration && validSource);
      for (const [index, original] of originals.entries()) {
        if (object(original) && typeof original.raw === "string") {
          await alternative(original.raw, [...provenance, "original", index], address, true, validGeneration && validSource);
        }
      }
    };

    // A failed physical backend must not suppress readable IDB preservation.
    let physical: PhysicalAddress[] | undefined;
    const physicalValues = new Map<string, string>();
    try {
      const local = storage();
      if (local) physical = physicalAddresses(local, lease.ownerKey);
      else incomplete = true;
    } catch { incomplete = true; }
    check();
    for (const address of physical ?? []) {
      let outerRaw: string | null;
      try {
        const local = storage();
        if (!local) { incomplete = true; continue; }
        outerRaw = local.getItem(address.name);
      } catch { incomplete = true; continue; }
      check();
      if (outerRaw === null) throw new ChangedInventory();
      observed++;
      physicalValues.set(address.name, outerRaw);
      const provenance = ["localStorage", address.name, address.logicalKey] as const;
      await capture(outerRaw, [...provenance, "outer"]);
      const wrapper = parse(outerRaw);
      if (object(wrapper) && wrapper.version === 2) {
        if (wrapper.ownerKey !== lease.ownerKey || wrapper.logicalKey !== address.logicalKey) {
          if (typeof wrapper.ownerKey === "string" && wrapper.ownerKey !== lease.ownerKey
            || typeof wrapper.logicalKey === "string" && wrapper.logicalKey !== address.logicalKey) incomplete = true;
        }
        else if (typeof wrapper.raw === "string") {
          await capture(wrapper.raw, [...provenance, "inner"]);
          await interpret(wrapper.raw, [...provenance, "inner"], physicalCandidates(address.logicalKey));
        }
      }
      try {
        const local = storage();
        if (!local) incomplete = true;
        else if (local.getItem(address.name) !== outerRaw) throw new ChangedInventory();
      } catch (error) { if (isChanged(error)) throw error; incomplete = true; }
      check();
    }

    let checkpointCursor: JournalPageCursor<"checkpoints"> | null = null;
    const checkpointCursors = new Set<string>();
    do {
      let page;
      try { check(); page = await awaited(journals.checkpointPage(lease.ownerKey, journalEpoch, { cursor: checkpointCursor })); }
      catch (error) { if (isChanged(error)) throw error; check(); incomplete = true; break; }
      for (const row of page.rows) {
        if (row.ownerKey !== lease.ownerKey) { incomplete = true; continue; }
        observed++;
        const provenance = ["indexedDB", "checkpoints", row.ownerKey, row.appId, row.writerId, row.generation] as const;
        await capture(row.raw, [...provenance, "envelope"]);
        if (!VALID_APP_IDS.includes(row.appId) || !identifier(row.writerId)) { incomplete = true; continue; }
        await interpret(row.raw, provenance, row);
      }
      checkpointCursor = page.nextCursor;
      if (checkpointCursor) {
        const key = JSON.stringify(checkpointCursor);
        if (checkpointCursors.has(key)) { incomplete = true; break; }
        checkpointCursors.add(key);
      }
    } while (checkpointCursor);

    let archiveCursor: JournalPageCursor<"archives"> | null = null;
    const archiveCursors = new Set<string>();
    do {
      let page;
      try { check(); page = await awaited(journals.archivePage(lease.ownerKey, journalEpoch, { cursor: archiveCursor })); }
      catch (error) { if (isChanged(error)) throw error; check(); incomplete = true; break; }
      for (const row of page.rows) {
        if (row.ownerKey !== lease.ownerKey) { incomplete = true; continue; }
        observed++;
        const provenance = ["indexedDB", "archives", row.ownerKey, row.appId, row.sourceId, row.digest] as const;
        await capture(row.raw, [...provenance, "envelope"]);
        // The archive address contains a source ID, not a writerId property.
        if (!VALID_APP_IDS.includes(row.appId) || !isJournalSourceId(row.sourceId, row.appId, lease.ownerKey)
          || row.digest !== journalOriginalId(row.raw)) { incomplete = true; continue; }
        const parts = JSON.parse(row.sourceId) as [string, ValidAppId, string, string];
        await interpret(row.raw, provenance, { appId: row.appId, writerId: parts[2], sourceId: row.sourceId } satisfies Address);
      }
      archiveCursor = page.nextCursor;
      if (archiveCursor) {
        const key = JSON.stringify(archiveCursor);
        if (archiveCursors.has(key)) { incomplete = true; break; }
        archiveCursors.add(key);
      }
    } while (archiveCursor);

    if (physical) {
      try {
        const local = storage();
        if (!local) incomplete = true;
        else {
          const final = physicalAddresses(local, lease.ownerKey);
          if (JSON.stringify(final) !== JSON.stringify(physical)) throw new ChangedInventory();
          for (const [name, raw] of physicalValues) if (local.getItem(name) !== raw) throw new ChangedInventory();
        }
      } catch (error) { if (isChanged(error)) throw error; incomplete = true; }
    }
    check();
    if (await awaited(journals.ownerEpoch(lease.ownerKey)) !== journalEpoch) return "changed";
    // Words have no synchronous deletion fence, so read their durable epoch last.
    if (await awaited(words.ownerEpoch(lease.ownerKey)) !== wordEpoch) return "changed";
    check();
    return incomplete ? "unavailable" : observed ? "captured" : "empty";
  } catch (error) {
    try { if (!current() || isChanged(error)) return "changed"; } catch { /* Redact failures in authority checks too. */ }
    return "unavailable";
  }
}
