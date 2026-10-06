import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import { DeletedJournalOwnerError } from "@/shared/lib/progressJournalDatabase";
import { PROGRESS_NAMESPACE, PROGRESS_QUARANTINE } from "../owner-bound-progress/core";
import { WORD_EXTRACTION_VERSION, type WordField } from "../progress-words";
import { PROGRESS_OWNER_KEY } from "../storage-keys";
import { DeletedWordOwnerError, StaleOwnerEpochError, type SourceRecord } from "./database";
import { extractLegacyWordSource, legacyWordSources } from "./inventory";
import { captureJournalInventory, type JournalInventoryOptions, type JournalInventoryResult,
  type PhysicalStorage } from "./journalInventory";

export type WordPreservationOptions = JournalInventoryOptions;
export type WordPreservationResult = JournalInventoryResult;

type Address = { backend: "legacy" | "scoped" | "quarantine"; name: string; logicalKey: string;
  appId: string; digest?: string };
type Layer = "outer" | "inner" | "fields";
const appsByKey = new Map(Object.entries(legacyWordSources).map(([appId, key]) => [key, appId]));
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const parse = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return null; } };
const hash = (raw: string) => [...sha256(new TextEncoder().encode(raw))].map(n => n.toString(16).padStart(2, "0")).join("");
const fingerprint = (raw: string) => hash(JSON.stringify(raw));
class ChangedPreservation extends Error {}

function record(ownerKey: string, address: Address, raw: string, layer: Layer, fields: WordField[] = []): SourceRecord {
  const appId = layer === "fields" ? address.appId : "preservation-inventory";
  const sourceKey = JSON.stringify(["word-preservation", address.backend, address.name, address.logicalKey, layer]);
  const sourceVersion = layer === "fields"
    ? `preservation:v1:legacy-parser:v1:extraction:${WORD_EXTRACTION_VERSION}` : "preservation:v1:raw";
  const digest = fingerprint(raw);
  return { id: JSON.stringify([ownerKey, appId, sourceKey, sourceVersion, digest]),
    ownerKey, appId, sourceKey, sourceVersion, digest, raw, fields };
}

function physicalAddress(name: string, ownerKey: string): Address | null {
  const backend = name.startsWith(PROGRESS_NAMESPACE) ? "scoped"
    : name.startsWith(PROGRESS_QUARANTINE) ? "quarantine" : null;
  if (!backend) return null;
  const prefix = backend === "scoped" ? PROGRESS_NAMESPACE : PROGRESS_QUARANTINE;
  const pair = parse(name.slice(prefix.length));
  if (!Array.isArray(pair) || pair.length !== (backend === "scoped" ? 2 : 3)
    || pair[0] !== ownerKey || typeof pair[1] !== "string") return null;
  const appId = appsByKey.get(pair[1]);
  if (!appId || backend === "quarantine" && (typeof pair[2] !== "string" || !/^[0-9a-f]{64}$/.test(pair[2]))) return null;
  return { backend, name, logicalKey: pair[1], appId, ...(backend === "quarantine" ? { digest: pair[2] } : {}) };
}

/** Enumeration retains readable addresses even when another index is denied. */
function physicalAddresses(local: PhysicalStorage, ownerKey: string): { addresses: Address[]; complete: boolean } {
  const length = local.length;
  if (!Number.isSafeInteger(length) || length < 0) return { addresses: [], complete: false };
  const seen = new Set<string>(), addresses: Address[] = [];
  let complete = true;
  for (let index = 0; index < length; index++) {
    let name;
    try { name = local.key(index); } catch { complete = false; continue; }
    if (name === null || seen.has(name)) { complete = false; continue; }
    seen.add(name);
    const address = physicalAddress(name, ownerKey);
    if (address) addresses.push(address);
  }
  if (local.length !== length) throw new ChangedPreservation();
  addresses.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { addresses, complete };
}

function legacyFields(raw: string, appId: string): WordField[] {
  const value = parse(raw);
  if (!object(value) || !object(value.state)
    || value.version !== undefined && value.version !== 0 && !(appId === "oregon-trail" && value.version === 1)) return [];
  return extractLegacyWordSource(appId, raw)?.fields ?? [];
}

/**
 * Unused account-scoped preservation. Exact source copies do not authorize
 * projection, replacement, dispatch, retirement or deletion. Guest and foreign
 * sources remain outside this inventory; its observations are not a snapshot.
 */
export async function captureWordPreservation(options: WordPreservationOptions): Promise<WordPreservationResult> {
  const { ownerId, authority, storage, words, journals } = options;
  const lease = { ...options.lease };
  let incomplete = false, changed = false, observed = 0;
  let marker: string | null | undefined, markerKnown = false, globalsAllowed = false;
  const current = () => {
    if (changed) return false;
    if (!authority.isCurrent(lease) || journals.isOwnerDeleted(lease.ownerKey)) { changed = true; return false; }
    try {
      const local = storage();
      if (!local) { incomplete = true; globalsAllowed = false; return true; }
      const value = local.getItem(PROGRESS_OWNER_KEY);
      if (markerKnown && value !== marker) { changed = true; return false; }
    } catch { incomplete = true; globalsAllowed = false; }
    return true;
  };
  const check = () => { if (!current()) throw new ChangedPreservation(); };
  const isChanged = (error: unknown) => error instanceof ChangedPreservation
    || error instanceof DeletedWordOwnerError || error instanceof StaleOwnerEpochError
    || error instanceof DeletedJournalOwnerError
    || error instanceof Error && error.message === "Journal owner epoch changed";
  const read = (name: string): string | null | undefined => {
    try {
      const local = storage();
      if (local) return local.getItem(name);
    } catch { /* Failed reads do not turn an observed source into absence. */ }
    incomplete = true;
    return undefined;
  };
  const enumerate = () => {
    try {
      const local = storage();
      if (local) {
        const result = physicalAddresses(local, lease.ownerKey);
        if (!result.complete) incomplete = true;
        return result;
      }
    } catch (error) { if (isChanged(error)) throw error; }
    incomplete = true;
    return undefined;
  };

  try {
    if (!authority.isCurrent(lease) || journals.isOwnerDeleted(lease.ownerKey)) return "changed";
    // Freeze marker provenance before owner resolution or database opening.
    try {
      const local = storage();
      if (local) {
        marker = local.getItem(PROGRESS_OWNER_KEY);
        markerKnown = true;
        globalsAllowed = !!ownerId && marker === ownerId;
      } else incomplete = true;
    } catch { incomplete = true; }
    check();
    if (!ownerId) return "changed";
    const resolvedOwner = await ownerKeyFor(ownerId);
    check();
    if (resolvedOwner !== lease.ownerKey) return "changed";
    const wordEpoch = await words.ownerEpoch(lease.ownerKey);
    check();
    if (wordEpoch !== 0) return "changed";
    const journalEpoch = await journals.ownerEpoch(lease.ownerKey);
    check();

    const capture = async (address: Address, raw: string, layer: Layer, fields?: WordField[]) => {
      check();
      if (address.backend === "legacy" && !globalsAllowed) return;
      await words.capture(record(lease.ownerKey, address, raw, layer, fields), wordEpoch);
      check();
    };
    const preserve = async (address: Address, raw: string) => {
      await capture(address, raw, "outer");
      check();
      if (address.backend === "legacy" && !globalsAllowed) return;
      let gameplayRaw = raw;
      if (address.backend !== "legacy") {
        const wrapper = parse(raw);
        const digestMatches = address.backend !== "quarantine" || address.digest === hash(raw);
        if (!digestMatches) incomplete = true;
        if (!object(wrapper) || wrapper.version !== 2) return;
        if (wrapper.ownerKey !== lease.ownerKey || wrapper.logicalKey !== address.logicalKey) {
          if (typeof wrapper.ownerKey === "string" && wrapper.ownerKey !== lease.ownerKey
            || typeof wrapper.logicalKey === "string" && wrapper.logicalKey !== address.logicalKey) incomplete = true;
          return;
        }
        if (typeof wrapper.raw !== "string") return;
        gameplayRaw = wrapper.raw;
        await capture(address, gameplayRaw, "inner");
        check();
        if (!digestMatches) return;
      }
      const fields = legacyFields(gameplayRaw, address.appId);
      if (fields.length) {
        await capture(address, gameplayRaw, "fields", fields);
        check();
      }
    };
    const values = new Map<string, { address: Address; digest: string | null }>();
    const recheckValue = (address: Address, expected: string | null) => {
      check();
      if (address.backend === "legacy" && !globalsAllowed) return;
      const value = read(address.name);
      check();
      if (value !== undefined && value !== expected) throw new ChangedPreservation();
    };

    const physical = enumerate();
    check();
    for (const [appId, logicalKey] of Object.entries(legacyWordSources)) {
      check();
      if (!globalsAllowed) break;
      const address: Address = { backend: "legacy", name: logicalKey, logicalKey, appId };
      const raw = read(address.name);
      check();
      if (!globalsAllowed || raw === undefined) continue;
      values.set(address.name, { address, digest: raw === null ? null : fingerprint(raw) });
      if (raw === null) continue;
      observed++;
      await preserve(address, raw);
      check();
      recheckValue(address, raw);
    }
    for (const address of physical?.addresses ?? []) {
      check();
      const raw = read(address.name);
      check();
      if (raw === undefined) continue;
      if (raw === null) throw new ChangedPreservation();
      observed++;
      values.set(address.name, { address, digest: fingerprint(raw) });
      await preserve(address, raw);
      check();
      recheckValue(address, raw);
    }

    check();
    const journalResult = await captureJournalInventory({ ownerId, lease, storage, words, journals,
      authority: { isCurrent: candidate => authority.isCurrent(candidate) && current() } });
    check();
    if (journalResult === "changed") return "changed";
    if (journalResult === "unavailable") incomplete = true;

    // Journal deletion has a synchronous fence; word deletion is checked last.
    const finalJournalEpoch = await journals.ownerEpoch(lease.ownerKey);
    check();
    if (finalJournalEpoch !== journalEpoch) return "changed";
    const finalWordEpoch = await words.ownerEpoch(lease.ownerKey);
    check();
    if (finalWordEpoch !== wordEpoch) return "changed";
    const finalPhysical = enumerate();
    check();
    if (physical?.complete && finalPhysical?.complete
      && JSON.stringify(finalPhysical.addresses) !== JSON.stringify(physical.addresses)) throw new ChangedPreservation();
    for (const { address, digest } of values.values()) {
      check();
      if (address.backend === "legacy" && !globalsAllowed) continue;
      const raw = read(address.name);
      check();
      if (raw !== undefined && (raw === null ? null : fingerprint(raw)) !== digest) throw new ChangedPreservation();
    }
    check();
    return incomplete ? "unavailable" : observed || journalResult === "captured" ? "captured" : "empty";
  } catch (error) {
    try { if (changed || isChanged(error) || !current()) return "changed"; } catch { /* Redact authority failures too. */ }
    return "unavailable";
  }
}
