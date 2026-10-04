import { isOwnerKey, ownerKeyFor } from "@/shared/clips/library/ownerKey";
import { sameProgress } from "@/shared/lib/progressStamp";
import { ownerBoundProgress, type OwnerBoundProgress } from "../owner-bound-progress";
import { LocalWordsDatabase, DeletedWordOwnerError, type SourceRecord, type WordRecord } from "./database";
import type { CandidateResult, LocalWordsRuntime, WordAppId, WordAppSnapshot, WordEdit, WordLease, WordMapper, WordSnapshot, WriteResult } from "./contracts";
import { legacyWordSources } from "./inventory";
import { recoverCloudWords } from "./recovery";
import { createWordPreservation, WORD_DELETION_PENDING, type WordStorage } from "./preservation";
import type { SourceLocks } from "./migration";

const apps = Object.keys(legacyWordSources) as WordAppId[];
const fieldKey = (record: Pick<WordRecord, "entityKey" | "field">) => JSON.stringify([record.entityKey, record.field]);
const blankApp = (): WordAppSnapshot => Object.freeze({ status: "idle", revision: 0, pendingWrites: false });
const blankApps = () => Object.fromEntries(apps.map(app => [app, blankApp()])) as Record<WordAppId, WordAppSnapshot>;
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const item of Object.values(value)) immutable(item); Object.freeze(value); }
  return value;
}
export class LocalWordDeletionError extends Error {
  constructor() { super("Local word deletion is incomplete. Please retry."); this.name = "LocalWordDeletionError"; }
}
type Pending = { revision: number; record: WordRecord };
type AppState = {
  words: Map<string, WordRecord>; candidates: Map<string, SourceRecord>;
  clock: number; edits: Map<string, number>; pending: Map<string, Pending>;
  failedWrites: Set<string>;
  tail: Promise<unknown>; preparation?: { generation: number; promise: Promise<WriteResult> };
  snapshot: WordAppSnapshot;
  wordView?: readonly WordRecord[]; candidateView?: readonly SourceRecord[];
};
type Fence = { revision: number; pending: Set<string> };

/** One lazy database and the existing progress authority, with no import-time I/O. */
export function createLocalWordsRuntime(deps: {
  authority?: OwnerBoundProgress;
  database?: LocalWordsDatabase;
  storage?: () => WordStorage | undefined;
  sessionStorage?: () => WordStorage | undefined;
  locks?: () => SourceLocks | undefined;
  fetch?: typeof globalThis.fetch;
  broadcast?: (owner: string) => void;
} = {}): LocalWordsRuntime {
  const authority = deps.authority ?? ownerBoundProgress;
  const storage = deps.storage ?? (() => typeof window === "undefined" ? undefined : window.localStorage);
  const sessionStorage = deps.sessionStorage ?? (() => typeof window === "undefined" ? undefined : window.sessionStorage);
  const locks = deps.locks ?? (() => typeof navigator === "undefined" ? undefined : navigator.locks);
  let db: LocalWordsDatabase | undefined = deps.database;
  const database = () => db ??= new LocalWordsDatabase();
  const owners = new Map<string, Map<WordAppId, AppState>>();
  const deleted = new Set<string>();
  const verifiedOwners = new Set<string>();
  const listeners = new Set<() => void>();
  const mappers = new Map<WordAppId, WordMapper>();
  let installed = false;
  let previousGeneration = -1;
  let channel: BroadcastChannel | undefined;
  let snapshot: WordSnapshot = Object.freeze({ ownerKey: null, generation: 0, status: "unresolved", apps: Object.freeze(blankApps()) });
  const state = (owner: string, app: WordAppId): AppState => {
    let byApp = owners.get(owner);
    if (!byApp) { byApp = new Map(); owners.set(owner, byApp); }
    let row = byApp.get(app);
    if (!row) {
      row = { words: new Map(), candidates: new Map(), clock: 0, edits: new Map(), pending: new Map(), failedWrites: new Set(), tail: Promise.resolve(), snapshot: blankApp() };
      byApp.set(app, row);
    }
    return row;
  };
  const publish = () => {
    const progress = authority.getSnapshot();
    const owner = progress.ownerKey;
    snapshot = Object.freeze({
      ownerKey: owner, generation: progress.generation,
      status: owner && deleted.has(owner) ? "deleted" : progress.status === "ready" ? "ready" : "unresolved",
      apps: Object.freeze(owner && progress.status === "ready" && !deleted.has(owner)
        ? Object.fromEntries(apps.map(app => [app, state(owner, app).snapshot])) as Record<WordAppId, WordAppSnapshot> : blankApps()),
    });
    for (const listener of listeners) listener();
  };
  const change = (row: AppState, patch: Partial<WordAppSnapshot>) => {
    row.wordView = undefined; row.candidateView = undefined;
    row.snapshot = Object.freeze({ ...row.snapshot, ...patch, revision: row.snapshot.revision + 1, pendingWrites: row.pending.size > 0 });
    publish();
  };
  const isCurrent = (lease: WordLease) => !deleted.has(lease.ownerKey) && authority.isCurrent(lease);
  const outcome = (lease: WordLease): "deleted" | "stale" => deleted.has(lease.ownerKey) ? "deleted" : "stale";
  const markDeleted = (owner: string) => {
    deleted.add(owner);
    owners.delete(owner);
    if (authority.getSnapshot().ownerKey === owner) authority.revoke();
    publish();
  };
  const epochFor = async (owner: string) => {
    if (deleted.has(owner)) throw new DeletedWordOwnerError();
    const epoch = await database().ownerEpoch(owner);
    if (epoch > 0 || deleted.has(owner)) { markDeleted(owner); throw new DeletedWordOwnerError(); }
    verifiedOwners.add(owner);
    return epoch;
  };
  const failure = (row: AppState, lease: WordLease, error?: unknown): WriteResult => {
    if (error instanceof DeletedWordOwnerError) markDeleted(lease.ownerKey);
    if (!isCurrent(lease)) return outcome(lease);
    change(row, { status: "memory-only" });
    return "memory-only";
  };
  const preservation = createWordPreservation({
    storage, sessionStorage, locks, database, isCurrent, isDeleted: owner => deleted.has(owner), isVerified: owner => verifiedOwners.has(owner),
    failed(app, lease) {
      const current = lease ?? authority.captureLease();
      if (current && isCurrent(current)) change(state(current.ownerKey, app), { status: "memory-only" });
    },
    captured(app, owner) {
      const lease = authority.captureLease();
      // Do not publish raw sources until prepare validates ownership and epochs.
      if (lease?.ownerKey === owner && isCurrent(lease)) change(state(owner, app), {});
    },
  });
  const enqueue = <T>(row: AppState, work: () => Promise<T>): Promise<T> => {
    const result = row.tail.then(work, work);
    row.tail = result.catch(() => undefined);
    return result;
  };
  const fence = (row: AppState): Fence => ({ revision: row.clock, pending: new Set(row.pending.keys()) });
  const protectedField = (row: AppState, key: string, captured: Fence) => captured.pending.has(key) || (row.edits.get(key) ?? 0) > captured.revision;
  const records = (app: WordAppId, edits: readonly WordEdit[], lease: WordLease): WordRecord[] => {
    const cloned = structuredClone(edits);
    const seen = new Set<string>();
    return cloned.map(edit => {
      if (typeof edit.entityKey !== "string" || typeof edit.field !== "string" || !Object.hasOwn(edit, "value")) throw Error("Invalid local word edit");
      const key = fieldKey(edit);
      if (seen.has(key)) throw Error("Duplicate local word edit");
      seen.add(key);
      return { entityKey: edit.entityKey, field: edit.field, value: edit.value, ownerKey: lease.ownerKey, appId: app };
    });
  };
  const accept = (row: AppState, edits: WordRecord[]): Pending[] => edits.map(record => {
    const key = fieldKey(record);
    const pending = { revision: ++row.clock, record };
    row.edits.set(key, pending.revision);
    row.pending.set(key, pending);
    row.words.set(key, record);
    return pending;
  });
  const persist = (row: AppState, pending: Pending[], lease: WordLease): Promise<WriteResult> => enqueue(row, async () => {
    if (!isCurrent(lease)) return outcome(lease);
    try {
      const epoch = await epochFor(lease.ownerKey);
      if (!isCurrent(lease)) return outcome(lease);
      await database().writeWords(pending.map(item => item.record), epoch);
      if (!isCurrent(lease)) return outcome(lease);
      for (const item of pending) { const key = fieldKey(item.record); if (row.pending.get(key)?.revision === item.revision) { row.pending.delete(key); row.failedWrites.delete(key); } }
      change(row, {});
      return "durable";
    } catch (error) {
      for (const item of pending) row.failedWrites.add(fieldKey(item.record));
      return failure(row, lease, error);
    }
  });
  const refreshCandidates = async (app: WordAppId, lease: WordLease, row: AppState) => {
    const [pending, committed] = await Promise.all([database().listSources(lease.ownerKey), database().listCommittedSources(lease.ownerKey)]);
    if (!isCurrent(lease)) return;
    row.candidates = new Map([...pending, ...committed].filter(source => source.ownerKey === lease.ownerKey && source.appId === app).map(source => [source.id, source]));
  };
  const mapCandidate = (app: WordAppId, sourceId: string, mapped: WordRecord[], lease: WordLease, captured: Fence): Promise<CandidateResult> => {
    const row = state(lease.ownerKey, app);
    return enqueue(row, async () => {
      if (!isCurrent(lease)) return outcome(lease);
      if (!mapped.length) return "conflict";
      if (mapped.some(record => protectedField(row, fieldKey(record), captured)
        || (row.words.has(fieldKey(record)) && !sameProgress(row.words.get(fieldKey(record))!.value, record.value)))) return "conflict";
      try {
        const epoch = await epochFor(lease.ownerKey);
        if (!isCurrent(lease)) return outcome(lease);
        // A user may accept an edit while the epoch transaction is pending.
        if (mapped.some(record => protectedField(row, fieldKey(record), captured))) return "conflict";
        const result = await database().commitSource(sourceId, mapped, epoch);
        if (!isCurrent(lease)) return outcome(lease);
        if (result === "conflict" || result === "missing") return result;
        if (result === "committed") for (const record of mapped) {
          if (!protectedField(row, fieldKey(record), captured)) row.words.set(fieldKey(record), record);
        }
        change(row, {});
        return "durable";
      } catch (error) { return failure(row, lease, error); }
    });
  };
  const prepare = (app: WordAppId, lease: WordLease): Promise<WriteResult> => {
    if (!isCurrent(lease)) return Promise.resolve(outcome(lease));
    const row = state(lease.ownerKey, app);
    if (row.preparation?.generation === lease.generation) return row.preparation.promise;
    const captured = fence(row);
    // Start the read before waiting on any mutation. Its fence must survive a
    // pending edit becoming durable while this old read remains unresolved.
    const read = Promise.resolve().then(() => database().readWords(lease.ownerKey, app));
    void read.catch(() => undefined);
    const promise = (async (): Promise<WriteResult> => {
      try {
        await epochFor(lease.ownerKey);
        const stored = await read;
        if (!isCurrent(lease)) return outcome(lease);
        for (const record of stored) if (record.ownerKey === lease.ownerKey && record.appId === app && !protectedField(row, fieldKey(record), captured)) row.words.set(fieldKey(record), record);
        change(row, {});
        await preservation.settle(app, lease.ownerKey);
        if (!isCurrent(lease)) return outcome(lease);
        await refreshCandidates(app, lease, row);
        if (!isCurrent(lease)) return outcome(lease);
        const mapper = mappers.get(app);
        if (mapper) for (const source of row.candidates.values()) {
          const mapped = mapper(structuredClone(source));
          if (!mapped?.length) continue;
          const result = await mapCandidate(app, source.id, records(app, mapped, lease), lease, captured);
          if (result === "memory-only" || result === "deleted" || result === "stale") return result;
        }
        if (!isCurrent(lease)) return outcome(lease);
        const failed = preservation.hasFailure(app, lease.ownerKey) || row.failedWrites.size > 0;
        change(row, { status: failed ? "memory-only" : "ready" });
        return failed ? "memory-only" : "durable";
      } catch (error) { return failure(row, lease, error); }
    })();
    row.preparation = { generation: lease.generation, promise };
    // Subscribers may prepare the same app synchronously. Publish only after
    // installing its in-flight promise, and keep synchronous read errors inside it.
    change(row, { status: row.snapshot.status === "memory-only" || row.failedWrites.size > 0 || preservation.hasFailure(app, lease.ownerKey) ? "memory-only" : "loading" });
    void promise.finally(() => { if (row.preparation?.promise === promise) row.preparation = undefined; });
    return promise;
  };
  const retry = async (lease: WordLease, appId?: WordAppId): Promise<WriteResult> => {
    if (!isCurrent(lease)) return outcome(lease);
    authority.retryPendingWordWrites(lease);
    const results = await Promise.all((appId ? [appId] : apps).map(async app => {
      const row = state(lease.ownerKey, app);
      // Start each app independently: an unrelated source lock cannot delay
      // saving this app's accepted edits or completing its retry.
      const preservationWork = preservation.retry(lease, app);
      if (row.pending.size) {
        const result = await persist(row, [...row.pending.values()], lease);
        if (result !== "durable") return result;
      }
      await preservationWork;
      if (row.snapshot.status !== "idle") return prepare(app, lease);
      return "durable" as const;
    }));
    if (!isCurrent(lease)) return outcome(lease);
    return results.includes("memory-only") ? "memory-only" : "durable";
  };
  const finishDeletion = async (owner: string) => {
    markDeleted(owner);
    try {
      const local = storage();
      try { local?.setItem(WORD_DELETION_PENDING + owner, "1"); } catch { /* IDB tombstone can still succeed. */ }
      try { deps.broadcast?.(owner); channel?.postMessage({ deletedOwner: owner }); } catch { /* Durable deletion still proceeds. */ }
      await database().deleteOwner(owner);
      await preservation.cleanup(owner);
      if (!local) throw Error("Local storage unavailable");
      local.removeItem(WORD_DELETION_PENDING + owner);
    } catch { throw new LocalWordDeletionError(); }
  };
  const install = () => {
    if (installed || (typeof window === "undefined" && !deps.storage)) return;
    installed = true;
    // Deletion receipts are scanned before a single source import is scheduled.
    const pendingDeletes: string[] = [];
    try {
      const local = storage();
      if (local) for (let i = 0; i < local.length; i++) {
        const key = local.key(i);
        if (key?.startsWith(WORD_DELETION_PENDING)) {
          const owner = key.slice(WORD_DELETION_PENDING.length);
          if (isOwnerKey(owner) && owner !== "guest") { deleted.add(owner); pendingDeletes.push(owner); }
        }
      }
    } catch { /* A denied store cannot provide deletion evidence. IDB remains authoritative. */ }
    if (typeof window !== "undefined") {
      if (typeof BroadcastChannel !== "undefined") {
        try {
          channel = new BroadcastChannel("hh-words:deletion:v1");
          channel.onmessage = event => { const owner: unknown = event.data?.deletedOwner; if (isOwnerKey(owner) && owner !== "guest") markDeleted(owner); };
        } catch { /* Storage events remain available. */ }
      }
      window.addEventListener("storage", event => {
        if (event.key?.startsWith(WORD_DELETION_PENDING) && event.newValue) {
          const owner = event.key.slice(WORD_DELETION_PENDING.length);
          if (isOwnerKey(owner) && owner !== "guest") markDeleted(owner);
        }
      });
    }
    preservation.install();
    authority.registerWordPersistenceGuard(preservation.guard);
    authority.subscribe(() => {
      publish();
      const lease = authority.captureLease();
      if (!lease || lease.generation === previousGeneration || !isCurrent(lease)) return;
      previousGeneration = lease.generation;
      void epochFor(lease.ownerKey).then(() => {
        if (!isCurrent(lease)) return;
        publish();
        // Resume only owner-pinned unsaved edits after a confirmed auth refresh.
        if ([...(owners.get(lease.ownerKey)?.values() ?? [])].some(row => row.pending.size)) void retry(lease);
      }).catch(() => { if (isCurrent(lease)) for (const row of owners.get(lease.ownerKey)?.values() ?? []) change(row, { status: "memory-only" }); });
    });
    for (const owner of pendingDeletes) void finishDeletion(owner).catch(() => undefined);
    publish();
  };
  return {
    install, prepare, retry, isCurrent,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    captureLease: () => { const lease = authority.captureLease(); return lease && isCurrent(lease) ? lease : null; },
    read(app, lease) {
      if (!isCurrent(lease)) return [];
      const row = state(lease.ownerKey, app);
      // Accepted edits are usable before IDB becomes available. Only imported
      // records need the durable owner epoch check before they can be exposed.
      if (!verifiedOwners.has(lease.ownerKey)) return row.wordView ??= immutable(structuredClone([...row.words.values()].filter(record => row.edits.has(fieldKey(record)))));
      return row.wordView ??= immutable(structuredClone([...row.words.values()]));
    },
    candidates(app, lease) {
      if (!isCurrent(lease) || !verifiedOwners.has(lease.ownerKey)) return [];
      const row = state(lease.ownerKey, app);
      return row.candidateView ??= immutable(structuredClone([...row.candidates.values()]));
    },
    write(app, edits, lease) {
      if (!isCurrent(lease)) return Promise.resolve(outcome(lease));
      const row = state(lease.ownerKey, app);
      const pending = accept(row, records(app, edits, lease));
      change(row, {});
      return persist(row, pending, { ...lease });
    },
    async commitCandidate(app, sourceId, edits, lease, mode) {
      if (!isCurrent(lease)) return outcome(lease);
      const row = state(lease.ownerKey, app);
      if (!row.candidates.has(sourceId)) return "missing";
      const mapped = records(app, edits, lease);
      if (!mapped.length) return "conflict";
      if (mode === "matching-identity") return mapCandidate(app, sourceId, mapped, lease, fence(row));
      const pending = accept(row, mapped);
      change(row, {});
      return enqueue(row, async () => {
        if (!isCurrent(lease)) return outcome(lease);
        try {
          const epoch = await epochFor(lease.ownerKey);
          if (!isCurrent(lease)) return outcome(lease);
          await database().writeWords(mapped, epoch);
          if (!isCurrent(lease)) return outcome(lease);
          const result = await database().commitSource(sourceId, mapped, epoch);
          if (!isCurrent(lease)) return outcome(lease);
          for (const item of pending) if (row.pending.get(fieldKey(item.record))?.revision === item.revision) { row.pending.delete(fieldKey(item.record)); row.failedWrites.delete(fieldKey(item.record)); }
          change(row, {});
          return result === "missing" || result === "conflict" ? result : "durable";
        } catch (error) {
          for (const item of pending) row.failedWrites.add(fieldKey(item.record));
          return failure(row, lease, error);
        }
      });
    },
    async recover(app, capturedUserId, lease) {
      const result = await recoverCloudWords({ appId: app, userId: capturedUserId, lease, isCurrent, database: database(), fetch: deps.fetch });
      if (!isCurrent(lease)) return "stale";
      if (result === "owner-changed") { authority.revoke(); return result; }
      if (result === "captured") {
        const active = state(lease.ownerKey, app).preparation;
        if (active) await active.promise;
        if (!isCurrent(lease)) return "stale";
        await prepare(app, lease);
      }
      return isCurrent(lease) ? result : "stale";
    },
    registerMapper(app, mapper) { mappers.set(app, mapper); },
    async forget(capturedUserId) {
      if (!capturedUserId) return;
      // matchesSession uses the pinned raw identity synchronously, before hashing.
      if (authority.matchesSession("authenticated", capturedUserId)) authority.revoke();
      const owner = await ownerKeyFor(capturedUserId);
      await finishDeletion(owner);
    },
  };
}
export const localWords = createLocalWordsRuntime();
export const forgetLocalWords = (capturedUserId: string): Promise<void> => localWords.forget(capturedUserId);
