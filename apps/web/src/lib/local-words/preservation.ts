import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import { GUEST_CANDIDATE_PREFIX, GUEST_HANDOFF_KEY, PROGRESS_NAMESPACE, PROGRESS_QUARANTINE, type ProgressLease, type WordPersistenceGuard } from "../owner-bound-progress";
import { PROGRESS_OWNER_KEY } from "../storage-keys";
import { DeletedWordOwnerError, type LocalWordsDatabase, type SourceRecord } from "./database";
import type { WordAppId } from "./contracts";
import { extractLegacyWordSource, legacyWordSources } from "./inventory";
import type { SourceLocks } from "./migration";

export type WordStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export const WORD_DELETION_PENDING = "hh-words:deletion-pending:v1:";
export const physicalWordKey = (owner: string, logical: string) => PROGRESS_NAMESPACE + JSON.stringify([owner, logical]);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (raw: string) => [...sha256(new TextEncoder().encode(raw))].map(n => n.toString(16).padStart(2, "0")).join("");
const appFor = (key: string) => Object.keys(legacyWordSources).find(app => legacyWordSources[app] === key) as WordAppId | undefined;

/** Unknown/future formats are retained byte-for-byte but never mapped. */
function extract(app: WordAppId, raw: string) {
  try {
    const value: unknown = JSON.parse(raw);
    const max = app === "oregon-trail" ? 1 : 0;
    if (!object(value) || (value.version !== undefined && (typeof value.version !== "number" || value.version < 0 || value.version > max))) return null;
    return extractLegacyWordSource(app, raw);
  } catch { return null; }
}
function inner(app: WordAppId, logical: string, owner: string, raw: string) {
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 2 || value.ownerKey !== owner || value.logicalKey !== logical) return null;
    if (value.raw === null) return { fields: [] };
    return typeof value.raw === "string" ? extract(app, value.raw) : null;
  } catch { return null; }
}

/** Exact source snapshots outlive hydration and never acquire a later owner. */
export function createWordPreservation(options: {
  storage: () => WordStorage | undefined;
  sessionStorage: () => WordStorage | undefined;
  locks: () => SourceLocks | undefined;
  database: () => LocalWordsDatabase;
  isCurrent: (lease: ProgressLease) => boolean;
  isDeleted: (owner: string) => boolean;
  isVerified: (owner: string) => boolean;
  failed: (app: WordAppId, lease?: ProgressLease) => void;
  captured: (app: WordAppId, owner: string) => void;
}) {
  type Capture = { source: SourceRecord; flight?: Promise<void>; done: boolean };
  const captures = new Map<string, Capture>();
  const bootstrap = new Map<WordAppId, Promise<void>[]>();
  const replacements = new Map<string, { lease: ProgressLease; raw: string | null; commit: (expected: string | null) => boolean; flight?: Promise<void>; failed?: boolean }>();
  const snapshots = new Set<string>();
  let legacyMarker: string | null | undefined;
  const legacyBytes = new Map<string, string>();
  const capture = (source: SourceRecord): Promise<void> => {
    let entry = captures.get(source.id);
    if (!entry) { entry = { source, done: false }; captures.set(source.id, entry); }
    if (entry.done) return Promise.resolve();
    if (entry.flight) return entry.flight;
    const row = entry;
    row.flight = (async () => {
      if (options.isDeleted(source.ownerKey)) return;
      const db = options.database();
      const epoch = await db.ownerEpoch(source.ownerKey);
      if (options.isDeleted(source.ownerKey) || epoch > 0) throw new DeletedWordOwnerError();
      await db.capture(source, epoch);
      row.done = true;
      options.captured(source.appId as WordAppId, source.ownerKey);
    })().finally(() => { row.flight = undefined; });
    return row.flight;
  };
  const make = (ownerKey: string, appId: WordAppId, sourceKey: string, raw: string, fields: SourceRecord["fields"]): SourceRecord => {
    const sourceVersion = 1;
    const hash = digest(raw);
    return { id: JSON.stringify([ownerKey, appId, sourceKey, sourceVersion, hash]), ownerKey, appId, sourceKey, sourceVersion, digest: hash, raw, fields };
  };
  const remember = (owner: string, app: WordAppId, key: string, raw: string, fields: SourceRecord["fields"]) => {
    // Retain errors for prepare/retry, while preventing unhandled rejections.
    const job = capture(make(owner, app, key, raw, fields));
    void job.catch(() => options.failed(app));
    return job;
  };
  const install = () => {
    let local: WordStorage | undefined;
    try { local = options.storage(); } catch { return; }
    if (!local) return;
    try { legacyMarker = local.getItem(PROGRESS_OWNER_KEY); } catch { legacyMarker = undefined; }
    for (const [id, key] of Object.entries(legacyWordSources)) {
      const app = id as WordAppId;
      try {
        const raw = local.getItem(key);
        if (raw === null || legacyMarker === undefined) continue;
        legacyBytes.set(key, raw);
        const marker = legacyMarker;
        const job = ownerKeyFor(marker).then(owner => remember(owner, app, key, raw, extract(app, raw)?.fields ?? []));
        bootstrap.set(app, [job]);
        void job.catch(() => options.failed(app));
      } catch { options.failed(app); }
    }
  };
  const snapshotOwner = (lease: ProgressLease) => {
    // A confirmed refresh must not re-import physical progress into active memory.
    if (snapshots.has(lease.ownerKey)) return;
    snapshots.add(lease.ownerKey);
    let local: WordStorage | undefined;
    try { local = options.storage(); } catch { return; }
    if (!local) return;
    for (const [id, logical] of Object.entries(legacyWordSources)) {
      const app = id as WordAppId;
      try {
        const key = physicalWordKey(lease.ownerKey, logical);
        const raw = local.getItem(key);
        if (raw !== null) remember(lease.ownerKey, app, key, raw, inner(app, logical, lease.ownerKey, raw)?.fields ?? []);
      } catch { options.failed(app, lease); }
    }
    try {
      for (let i = 0; i < local.length; i++) {
        const key = local.key(i);
        if (!key) continue;
        if (!key.startsWith(PROGRESS_QUARANTINE) && !key.startsWith(GUEST_CANDIDATE_PREFIX)) continue;
        try {
          const prefix = key.startsWith(PROGRESS_QUARANTINE) ? PROGRESS_QUARANTINE : GUEST_CANDIDATE_PREFIX;
          const address: unknown = JSON.parse(key.slice(prefix.length));
          if (!Array.isArray(address) || address[0] !== lease.ownerKey) continue;
          const raw = local.getItem(key);
          if (raw === null) continue;
          const value: unknown = JSON.parse(raw);
          if (!object(value) || value.version !== 2 || value.ownerKey !== lease.ownerKey || typeof value.logicalKey !== "string") continue;
          const app = appFor(value.logicalKey);
          if (!app) continue;
          if (prefix === GUEST_CANDIDATE_PREFIX) {
            if (value.sourceOwner === "guest" && typeof value.raw === "string") remember("guest", app, key, raw, extract(app, value.raw)?.fields ?? []);
          } else remember(lease.ownerKey, app, key, raw, inner(app, value.logicalKey, lease.ownerKey, raw)?.fields ?? []);
        } catch { /* Unvalidated ownership is never inferred. */ }
      }
      const raw = options.sessionStorage()?.getItem(GUEST_HANDOFF_KEY);
      if (raw) {
        const value: unknown = JSON.parse(raw);
        if (object(value) && value.version === 2 && (value.ownerKey === "guest" || value.ownerKey === lease.ownerKey) && object(value.rows)) {
          for (const [logical, row] of Object.entries(value.rows)) {
            const app = appFor(logical);
            if (app && object(row) && typeof row.raw === "string") remember("guest", app, `${GUEST_HANDOFF_KEY}:${logical}`, raw, extract(app, row.raw)?.fields ?? []);
          }
        }
      }
    } catch { /* Each original remains untouched when enumeration is unavailable. */ }
  };
  const beforeHydrate = (logical: string, lease: ProgressLease) => {
    const app = appFor(logical);
    if (!app) return;
    try {
      const key = physicalWordKey(lease.ownerKey, logical);
      const raw = options.storage()?.getItem(key);
      if (raw != null) remember(lease.ownerKey, app, key, raw, inner(app, logical, lease.ownerKey, raw)?.fields ?? []);
    } catch { options.failed(app, lease); }
  };
  const runReplacement = (logical: string, job: NonNullable<ReturnType<typeof replacements.get>>) => {
    if (job.flight) return;
    const app = appFor(logical)!;
    const key = physicalWordKey(job.lease.ownerKey, logical);
    const work = async () => {
      const local = options.storage();
      if (!local) throw Error("Local storage unavailable");
      if (await options.database().ownerEpoch(job.lease.ownerKey) > 0) throw new DeletedWordOwnerError();
      // An old tab can change the source while capture waits. Capture its new
      // exact version before replacement, with no lossy size/time cutoff.
      while (replacements.get(key) === job && options.isCurrent(job.lease) && !options.isDeleted(job.lease.ownerKey)) {
        const previous = local.getItem(key);
        const extracted = previous === null ? { fields: [] } : inner(app, logical, job.lease.ownerKey, previous);
        if (previous !== null) await capture(make(job.lease.ownerKey, app, key, previous, extracted?.fields ?? []));
        if (replacements.get(key) !== job || !options.isCurrent(job.lease) || options.isDeleted(job.lease.ownerKey)) return;
        if (!options.locks() && (extracted === null || extracted.fields.length > 0)) throw Error("Source lock unavailable");
        if (local.getItem(key) !== previous) continue;
        if (!job.commit(previous)) throw Error("Local persistence failed");
        if (replacements.get(key) === job) replacements.delete(key);
        return;
      }
    };
    const locks = options.locks();
    job.flight = (locks ? locks.request(key, work) : work())
      .catch(() => { job.failed = true; options.failed(app, job.lease); }).finally(() => { job.flight = undefined; });
  };
  const guard: WordPersistenceGuard = {
    handles: key => !!appFor(key), snapshotOwner, beforeHydrate,
    replace(logical, raw, lease, commit) {
      const key = physicalWordKey(lease.ownerKey, logical);
      if (options.isDeleted(lease.ownerKey)) return false;
      const prior = replacements.get(key);
      if (prior && prior.raw === raw && prior.lease.generation === lease.generation) {
        if (!prior.failed) runReplacement(logical, prior);
        return false;
      }
      try {
        const previous = options.storage()?.getItem(key);
        const extracted = previous === null ? { fields: [] } : previous === undefined ? null : inner(appFor(logical)!, logical, lease.ownerKey, previous);
        if (options.isVerified(lease.ownerKey) && extracted?.fields.length === 0 && previous !== undefined) {
          const durable = commit(previous);
          if (durable) replacements.delete(key);
          return durable;
        }
      } catch { options.failed(appFor(logical)!, lease); return false; }
      const job = { lease: { ...lease }, raw, commit };
      replacements.set(key, job);
      runReplacement(logical, job);
      return false;
    },
  };
  return {
    guard, install,
    hasFailure(app: WordAppId, owner: string) {
      return [...replacements.entries()].some(([key, row]) => row.failed && row.lease.ownerKey === owner && key === physicalWordKey(owner, legacyWordSources[app]));
    },
    async settle(app: WordAppId, owner: string) {
      await Promise.all(bootstrap.get(app) ?? []);
      await Promise.all([...captures.values()].filter(row => row.source.ownerKey === owner && row.source.appId === app).map(row => capture(row.source)));
    },
    async retry(lease: ProgressLease, app?: WordAppId) {
      // Failed bootstrap promises are replaced by the already pinned sources.
      for (const id of bootstrap.keys()) if (!app || id === app) bootstrap.delete(id);
      const flights: Array<Promise<void> | undefined> = [];
      for (const [key, row] of replacements) {
        if (row.lease.ownerKey !== lease.ownerKey) continue;
        const pair = JSON.parse(key.slice(PROGRESS_NAMESPACE.length)) as [string, string];
        if (app && pair[1] !== legacyWordSources[app]) continue;
        // Ask core for a fresh callback; an old callback must never renew a lease.
        if (row.lease.generation !== lease.generation) { replacements.delete(key); continue; }
        row.failed = false;
        runReplacement(pair[1], row);
        flights.push(row.flight);
      }
      await Promise.all(flights);
    },
    async cleanup(owner: string) {
      const local = options.storage();
      if (!local) throw Error("Local storage unavailable");
      const keys: string[] = [];
      for (let i = 0; i < local.length; i++) { const key = local.key(i); if (key) keys.push(key); }
      for (const key of keys) {
        const prefix = [PROGRESS_NAMESPACE, PROGRESS_QUARANTINE, GUEST_CANDIDATE_PREFIX].find(prefix => key.startsWith(prefix));
        if (!prefix) continue;
        let pair: unknown;
        try { pair = JSON.parse(key.slice(prefix.length)); } catch { continue; }
        if (!Array.isArray(pair) || pair[0] !== owner) continue;
        if (prefix === PROGRESS_NAMESPACE) {
          const app = appFor(pair[1]);
          if (!app) continue;
          const bytes = local.getItem(key);
          // The device-word deletion helper does not erase word-free gameplay.
          if (bytes === null || inner(app, pair[1], owner, bytes)?.fields.length === 0) continue;
        }
        const remove = async () => { local.removeItem(key); };
        const locks = options.locks();
        if (prefix === PROGRESS_NAMESPACE && !locks) throw Error("Source lock unavailable");
        if (locks) await locks.request(key, remove); else await remove();
      }
      const session = options.sessionStorage();
      const handoff = session?.getItem(GUEST_HANDOFF_KEY);
      if (handoff) { const value: unknown = JSON.parse(handoff); if (object(value) && value.ownerKey === owner) session!.removeItem(GUEST_HANDOFF_KEY); }
      local.removeItem(`hh-words:v1:${owner}`);
      if (legacyMarker) {
        const legacyOwner = await ownerKeyFor(legacyMarker);
        if (legacyOwner === owner) for (const [key, raw] of legacyBytes) {
          const locks = options.locks();
          if (!locks) throw Error("Source lock unavailable");
          await locks.request(`hh-words:source:${key}`, async () => {
            if (local.getItem(PROGRESS_OWNER_KEY) === legacyMarker && local.getItem(key) === raw) local.removeItem(key);
          });
        }
      }
    },
  };
}
