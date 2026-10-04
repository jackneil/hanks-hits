import type { StateStorage } from "zustand/middleware";
import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import { projectGuestSave } from "./admission";
import { PROGRESS_STORAGE_KEYS } from "./keys";

export type ProgressLease = Readonly<{ ownerKey: string; generation: number }>;
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";
export type ProgressSnapshot = Readonly<{
  status: "unresolved" | "ready" | "revoked";
  ownerKey: string | null;
  generation: number;
  needsNavigation: boolean;
  hydrating: boolean;
  memoryOnly: boolean;
  guestHandoffUnavailable: boolean;
}>;
export type ProgressEvidence = Readonly<{
  raw: string | null;
  legacyRaw: string | null;
  marker: string | null;
  markerReadable: boolean;
  eligible: boolean;
  loadAt: number;
  source: "namespace" | "legacy" | "guest-handoff" | "none";
}>;
export type PersistHandle = {
  rehydrate: () => Promise<void> | void;
  hasHydrated: () => boolean;
  onFinishHydration: (listener: () => void) => () => void;
};
/** Installed explicitly by local-words before the first owner hydration. */
export interface WordPersistenceGuard {
  handles(logicalKey: string): boolean;
  snapshotOwner(lease: ProgressLease): void;
  beforeHydrate(logicalKey: string, lease: ProgressLease): void;
  replace(logicalKey: string, raw: string | null, lease: ProgressLease,
    commit: (expectedPhysical: string | null) => boolean): boolean;
}
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
type Legacy = { raw: string | null; marker: string | null; markerReadable: boolean; loadAt: number };
export type GuestCandidate = Readonly<{ id: string; raw: string; loadAt: number }>;
type GuestSource = { version: 2; ownerKey: string; logicalKey: string; id: string; sourceOwner: "guest"; raw: string; loadAt: number; acknowledged: boolean };
type GuestReceipt = { version: 2; ownerKey: string; nonce: string; rows: Record<string, { raw: string; loadAt: number }> };
type Row = { appId?: string; legacy: Legacy; evidence?: ProgressEvidence; memory?: { raw: string | null; durable: boolean } };
type Binding = { persist: PersistHandle; hydrated: boolean; flight: Promise<void> | null; flush?: () => void };
export const PROGRESS_NAMESPACE = "hh-progress:v2:";
export const GUEST_CANDIDATE_PREFIX = "hh-progress:guest-candidate:v2:";
export const PROGRESS_QUARANTINE = "hh-progress:quarantine:v2:";
export const GUEST_HANDOFF_KEY = "hh-progress:guest-handoff:v2";
const OWNER_MARKER = "hanks-hits-progress-owner";
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const digestOf = (raw: string) => [...sha256(new TextEncoder().encode(raw))].map(byte => byte.toString(16).padStart(2, "0")).join("");
const candidateKey = (owner: string, id: string) => GUEST_CANDIDATE_PREFIX + JSON.stringify([owner, id]);
const physicalKey = (owner: string, logical: string) => PROGRESS_NAMESPACE + JSON.stringify([owner, logical]);

/** One authority per document. A confirmed owner can never become another owner. */
export function createOwnerBoundProgress(deps: {
  storage?: () => StorageLike | undefined;
  sessionStorage?: () => StorageLike | undefined;
  ownerKeyFor?: (userId: string | null) => Promise<string>;
  now?: () => number;
} = {}) {
  const storage = deps.storage ?? (() => typeof window === "undefined" ? undefined : window.localStorage);
  const sessionStorage = deps.sessionStorage ?? (() => typeof window === "undefined" ? undefined : window.sessionStorage);
  const keyFor = deps.ownerKeyFor ?? ownerKeyFor;
  const now = deps.now ?? Date.now;
  const rows = new Map<string, Row>();
  const bindings = new Map<string, Binding>();
  const waiters = new Map<string, Set<() => void>>();
  const listeners = new Set<() => void>();
  let snapshot: ProgressSnapshot = Object.freeze({ status: "unresolved", ownerKey: null, generation: 0, needsNavigation: false, hydrating: false, memoryOnly: false, guestHandoffUnavailable: false });
  let requestedStatus: AuthStatus = "loading";
  let requestedUserId: string | undefined;
  let pinnedIdentity: string | null | undefined;
  const guestSources = new Map<string, GuestSource>();
  let pendingReceipt: GuestReceipt | null = null;
  let preparedProof: string | null = null;
  let authorizedProof: string | null = null;
  let proofOffered = false;
  let wordGuard: WordPersistenceGuard | null = null;

  const publish = (change: Partial<ProgressSnapshot>) => {
    snapshot = Object.freeze({ ...snapshot, ...change });
    for (const listener of listeners) listener();
  };
  const memoryOnly = () => { if (!snapshot.memoryOnly) publish({ memoryOnly: true }); };
  const reportGuestHandoffFailure = () => { if (!snapshot.guestHandoffUnavailable) publish({ guestHandoffUnavailable: true }); };
  const captureLease = (): ProgressLease | null => snapshot.status === "ready" && snapshot.ownerKey !== null
    ? Object.freeze({ ownerKey: snapshot.ownerKey, generation: snapshot.generation }) : null;
  const isCurrent = (lease: ProgressLease): boolean => snapshot.status === "ready"
    && lease.ownerKey === snapshot.ownerKey && lease.generation === snapshot.generation;
  const readLegacy = (key: string): { raw: string | null; marker: string | null; markerReadable: boolean } => {
    try {
      const local = storage();
      if (!local) return { raw: null, marker: null, markerReadable: false };
      // Both reads are synchronous; no owner resolution or hydration can interleave.
      return { raw: local.getItem(key), marker: local.getItem(OWNER_MARKER), markerReadable: true };
    } catch { return { raw: null, marker: null, markerReadable: false }; }
  };
  const rowFor = (key: string, appId?: string): Row => {
    let row = rows.get(key);
    if (!row) {
      row = { appId: appId ?? Object.keys(PROGRESS_STORAGE_KEYS).find(id => PROGRESS_STORAGE_KEYS[id] === key), legacy: { ...readLegacy(key), loadAt: now() } };
      rows.set(key, row);
    } else if (appId) row.appId = appId;
    return row;
  };
  const readPhysical = (key: string, lease: ProgressLease): { raw: string | null; present: boolean; readable: boolean } => {
    try {
      const local = storage();
      if (!local) return { raw: null, present: false, readable: false };
      const raw = local.getItem(physicalKey(lease.ownerKey, key));
      if (raw === null) return { raw: null, present: false, readable: true };
      const envelope: unknown = JSON.parse(raw);
      if (!object(envelope) || envelope.version !== 2 || envelope.ownerKey !== lease.ownerKey || envelope.logicalKey !== key || (typeof envelope.raw !== "string" && envelope.raw !== null)) {
        return { raw: null, present: true, readable: false };
      }
      return { raw: envelope.raw as string | null, present: true, readable: true };
    } catch { return { raw: null, present: true, readable: false }; }
  };
  const guestProjection = (row: Row, raw: string, loadAt: number): string | null =>
    row.appId ? projectGuestSave(row.appId, raw, loadAt) : raw;
  const loadGuestSources = (lease: ProgressLease) => {
    try {
      const local = storage();
      if (!local) return;
      for (let i = 0; i < local.length; i++) {
        const name = local.key(i);
        if (!name?.startsWith(GUEST_CANDIDATE_PREFIX)) continue;
        try {
          const address: unknown = JSON.parse(name.slice(GUEST_CANDIDATE_PREFIX.length));
          if (!Array.isArray(address) || address[0] !== lease.ownerKey) continue;
          const value: unknown = JSON.parse(local.getItem(name) ?? "null");
          if (object(value) && value.version === 2 && value.ownerKey === lease.ownerKey
            && value.sourceOwner === "guest" && typeof value.id === "string"
            && typeof value.logicalKey === "string" && typeof value.raw === "string"
            && typeof value.loadAt === "number" && Number.isFinite(value.loadAt)
            && typeof value.acknowledged === "boolean" && name === candidateKey(lease.ownerKey, value.id)
            && value.id === digestOf(JSON.stringify([value.logicalKey, value.raw, value.loadAt]))) {
            guestSources.set(value.id, value as GuestSource);
          }
        } catch { /* Unknown candidate bytes remain intact. */ }
      }
    } catch { memoryOnly(); }
  };
  const listGuestCandidates = (key: string, lease: ProgressLease | null = captureLease()): GuestCandidate[] => {
    if (!lease || !isCurrent(lease) || lease.ownerKey === "guest") return [];
    loadGuestSources(lease);
    const row = rowFor(key);
    return [...guestSources.values()].flatMap(source => {
      if (source.ownerKey !== lease.ownerKey || source.logicalKey !== key || source.acknowledged) return [];
      const raw = guestProjection(row, source.raw, source.loadAt);
      return raw === null ? [] : [{ id: source.id, raw, loadAt: source.loadAt }];
    });
  };
  const readGuestCandidate = (key: string, lease: ProgressLease | null = captureLease()): GuestCandidate | null =>
    listGuestCandidates(key, lease)[0] ?? null;
  const readEvidence = (key: string): ProgressEvidence => {
    const row = rowFor(key);
    const { raw: legacyRaw, marker, markerReadable, loadAt } = row.legacy;
    const lease = captureLease();
    if (!lease) return { raw: null, legacyRaw, marker, markerReadable, eligible: false, loadAt, source: "none" };
    if (row.evidence) return row.evidence;
    const scoped = readPhysical(key, lease);
    let raw: string | null = null;
    let source: ProgressEvidence["source"] = "none";
    if (!scoped.readable) memoryOnly();
    if (scoped.present) {
      raw = scoped.raw;
      if (raw !== null) source = "namespace";
    } else if (readGuestCandidate(key, lease)) {
      raw = readGuestCandidate(key, lease)!.raw;
      source = "guest-handoff";
    } else if (markerReadable && (marker === null || (pinnedIdentity !== null && marker === pinnedIdentity))) {
      raw = marker === null && pinnedIdentity !== null && legacyRaw !== null ? guestProjection(row, legacyRaw, loadAt) : legacyRaw;
      if (raw !== null) source = "legacy";
    }
    const evidence = Object.freeze({ raw, legacyRaw, marker, markerReadable, eligible: raw !== null, loadAt, source });
    // A word-bearing module may register its projector after Home first probes it.
    // Keep unavailable projections retryable, without treating them as permission.
    if (raw !== null || scoped.present || !row.appId) row.evidence = evidence;
    return evidence;
  };
  const readScoped = (key: string, lease: ProgressLease | null = captureLease()): string | null => {
    if (!lease || !isCurrent(lease)) return null;
    const row = rowFor(key);
    if (row.memory && !row.memory.durable) return row.memory.raw;
    const current = readPhysical(key, lease);
    if (!current.readable) {
      memoryOnly();
      return row.memory?.raw ?? readEvidence(key).raw;
    }
    if (current.present) return current.raw;
    // A locally removed row is a tombstone in this document; never resurrect legacy bytes.
    if (row.memory?.raw === null) return null;
    return readEvidence(key).raw;
  };
  const preserveMalformed = (local: StorageLike, key: string, lease: ProgressLease): void => {
    const previous = local.getItem(physicalKey(lease.ownerKey, key));
    if (previous === null) return;
    let valid = false;
    try {
      const outer: unknown = JSON.parse(previous);
      if (object(outer) && outer.version === 2 && outer.ownerKey === lease.ownerKey && outer.logicalKey === key) {
        if (outer.raw === null) valid = true;
        else if (typeof outer.raw === "string") {
          const inner: unknown = JSON.parse(outer.raw);
          const supportedVersion = key === "checkers-progress" ? 2
            : ["oregon-trail-storage", "retro-arcade-progress"].includes(key) ? 1 : 0;
          valid = Object.values(PROGRESS_STORAGE_KEYS).includes(key)
            ? object(inner) && object(inner.state) && (inner.version === undefined
              || typeof inner.version === "number" && inner.version >= 0 && inner.version <= supportedVersion)
            : object(inner);
        }
      }
    } catch { /* Exact bytes are copied before replacing unreadable data. */ }
    if (valid) return;
    const digest = digestOf(previous);
    const quarantineKey = PROGRESS_QUARANTINE + JSON.stringify([lease.ownerKey, key, digest]);
    if (local.getItem(quarantineKey) !== previous) local.setItem(quarantineKey, previous);
  };
  const replaceScoped = (key: string, raw: string | null, lease: ProgressLease | null): boolean => {
    if (!lease || !isCurrent(lease)) return false;
    const row = rowFor(key);
    readEvidence(key);
    if (row.memory?.durable && row.memory.raw === raw) {
      const saved = readPhysical(key, lease);
      if (saved.present && saved.readable && saved.raw === raw) return true;
    }
    row.memory = { raw, durable: false };
    const commit = (expectedPhysical?: string | null): boolean => {
      if (!isCurrent(lease) || row.memory?.raw !== raw) return false;
      try {
        const local = storage();
        if (!local) { memoryOnly(); return false; }
        if (expectedPhysical !== undefined && local.getItem(physicalKey(lease.ownerKey, key)) !== expectedPhysical) return false;
        preserveMalformed(local, key, lease);
        local.setItem(physicalKey(lease.ownerKey, key), JSON.stringify({ version: 2, ownerKey: lease.ownerKey, logicalKey: key, raw }));
        const confirmed = readPhysical(key, lease);
        if (!confirmed.present || !confirmed.readable || confirmed.raw !== raw) return false;
        row.memory.durable = true;
        if (wordGuard?.handles(key)) publish({});
        return true;
      } catch { memoryOnly(); return false; }
    };
    if (wordGuard?.handles(key)) return wordGuard.replace(key, raw, lease, commit);
    return commit();
  };
  const writeScoped = (key: string, raw: string, lease: ProgressLease | null = captureLease()): boolean => replaceScoped(key, raw, lease);
  const removeScoped = (key: string, lease: ProgressLease | null = captureLease()): boolean => replaceScoped(key, null, lease);
  const listLegacyKeys = (prefix: string): string[] => {
    const keys: string[] = [];
    try { const local = storage(); if (local) for (let i = 0; i < local.length; i++) { const key = local.key(i); if (key?.startsWith(prefix) && !key.startsWith(PROGRESS_NAMESPACE)) keys.push(key); } } catch { /* Recovery remains optional when storage is unavailable. */ }
    return keys;
  };
  const listScoped = (prefix: string, lease: ProgressLease | null = captureLease()): string[] => {
    if (!lease || !isCurrent(lease)) return [];
    const keys = new Set<string>();
    try {
      const local = storage();
      if (local) for (let i = 0; i < local.length; i++) {
        const key = local.key(i);
        if (!key?.startsWith(PROGRESS_NAMESPACE)) continue;
        try { const pair: unknown = JSON.parse(key.slice(PROGRESS_NAMESPACE.length)); if (Array.isArray(pair) && pair.length === 2 && pair[0] === lease.ownerKey && typeof pair[1] === "string" && pair[1].startsWith(prefix)) keys.add(pair[1]); } catch { /* Ignore unrecognized keys. */ }
      }
    } catch { memoryOnly(); }
    for (const [key, row] of rows) if (key.startsWith(prefix) && row.memory) { if (row.memory.raw === null) keys.delete(key); else keys.add(key); }
    return [...keys].filter(key => readScoped(key, lease) !== null);
  };
  const finish = (key: string, binding: Binding) => {
    binding.hydrated = true;
    for (const resolve of waiters.get(key) ?? []) resolve();
    waiters.delete(key);
    publish({ hydrating: [...bindings.values()].some(item => !item.hydrated) });
  };
  const hydrate = (key: string, binding: Binding) => {
    const lease = captureLease();
    if (!lease || binding.hydrated || binding.flight) return;
    wordGuard?.beforeHydrate(key, lease);
    publish({ hydrating: true });
    // Calling rehydrate, including its returned promise, is the real middleware gate.
    binding.flight = (async () => {
      try { await binding.persist.rehydrate(); if (!binding.persist.hasHydrated()) memoryOnly(); }
      catch { memoryOnly(); }
      if (isCurrent(lease)) finish(key, binding);
    })();
  };
  const cancelGuestHandoff = () => {
    preparedProof = null;
    try {
      const session = sessionStorage();
      const raw = session?.getItem(GUEST_HANDOFF_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (object(parsed) && parsed.ownerKey === "guest") session!.removeItem(GUEST_HANDOFF_KEY);
    } catch { /* Never prevent sign-in or destroy a bound recovery receipt. */ }
  };
  const persistGuestSources = () => {
    if (!pendingReceipt) return;
    let durable = true;
    for (const [key, value] of Object.entries(pendingReceipt.rows)) {
      const id = digestOf(JSON.stringify([key, value.raw, value.loadAt]));
      const source: GuestSource = { version: 2, ownerKey: pendingReceipt.ownerKey,
        logicalKey: key, id, sourceOwner: "guest", raw: value.raw,
        loadAt: value.loadAt, acknowledged: false };
      guestSources.set(id, source);
      try {
        const local = storage();
        if (!local) throw Error("Storage unavailable");
        const name = candidateKey(source.ownerKey, id);
        const existing = local.getItem(name);
        if (existing === null) local.setItem(name, JSON.stringify(source));
        else {
          const parsed: unknown = JSON.parse(existing);
          if (!object(parsed) || parsed.version !== 2 || parsed.id !== id || typeof parsed.acknowledged !== "boolean" || parsed.ownerKey !== source.ownerKey || parsed.logicalKey !== key
            || parsed.raw !== source.raw || parsed.loadAt !== source.loadAt || parsed.sourceOwner !== "guest") throw Error("Unrecognized candidate");
          if (parsed.acknowledged === true) guestSources.set(id, { ...source, acknowledged: true });
        }
      } catch { durable = false; memoryOnly(); }
    }
    if (durable) {
      try { sessionStorage()?.removeItem(GUEST_HANDOFF_KEY); pendingReceipt = null; }
      catch { /* Repeating this exact bound receipt is idempotent. */ }
    }
  };
  const consumeHandoff = (ownerKey: string) => {
    const proof = authorizedProof;
    authorizedProof = null; // One attempt, even if all subsequent storage fails.
    try {
      const session = sessionStorage();
      const raw = session?.getItem(GUEST_HANDOFF_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!object(parsed) || parsed.version !== 2 || !object(parsed.rows)
        || typeof parsed.nonce !== "string" || !/^[a-f0-9]{48}$/.test(parsed.nonce)
        || (parsed.ownerKey !== "guest" && parsed.ownerKey !== ownerKey)) return;
      if (parsed.ownerKey === "guest" && (!proof || proof !== parsed.nonce)) return;
      const admitted: GuestReceipt["rows"] = Object.create(null);
      for (const [key, value] of Object.entries(parsed.rows)) {
        if (Object.values(PROGRESS_STORAGE_KEYS).includes(key) && object(value)
          && typeof value.raw === "string" && typeof value.loadAt === "number" && Number.isFinite(value.loadAt)) {
          admitted[key] = { raw: value.raw, loadAt: value.loadAt };
        }
      }
      const receipt: GuestReceipt = { version: 2, ownerKey, nonce: parsed.nonce, rows: admitted };
      // Bind before exposing or copying any candidate; another account cannot
      // consume it even if copying later hits quota or the document closes.
      if (parsed.ownerKey === "guest") session!.setItem(GUEST_HANDOFF_KEY, JSON.stringify(receipt));
      pendingReceipt = receipt;
      persistGuestSources();
    } catch { reportGuestHandoffFailure(); }
  };
  const revoke = () => { if (snapshot.status !== "revoked") publish({ status: "revoked", generation: snapshot.generation + 1, needsNavigation: true, hydrating: false }); };
  const updateSession = async (status: AuthStatus, userId?: string): Promise<void> => {
    if (snapshot.status === "revoked") return;
    const nextStatus = status === "authenticated" && !userId ? "loading" : status;
    const identity = nextStatus === "authenticated" ? userId : undefined;
    if (requestedStatus === nextStatus && requestedUserId === identity) return;
    requestedStatus = nextStatus;
    requestedUserId = identity;
    const generation = snapshot.generation + 1;
    for (const binding of bindings.values()) if (!binding.hydrated) binding.flight = null;
    publish({ status: "unresolved", generation, hydrating: false });
    if (nextStatus === "loading") return;
    const nextIdentity = identity ?? null;
    if (pinnedIdentity !== undefined && pinnedIdentity !== nextIdentity) { revoke(); return; }
    try {
      const ownerKey = await keyFor(nextIdentity);
      if (snapshot.generation !== generation) return;
      const firstBinding = pinnedIdentity === undefined;
      pinnedIdentity = nextIdentity;
      wordGuard?.snapshotOwner({ ownerKey, generation });
      if (firstBinding && nextIdentity !== null) consumeHandoff(ownerKey);
      publish({ status: "ready", ownerKey, hydrating: [...bindings.values()].some(item => !item.hydrated) });
      for (const [key, binding] of bindings) hydrate(key, binding);
    } catch { if (snapshot.generation === generation) { requestedStatus = "loading"; requestedUserId = undefined; memoryOnly(); } }
  };
  return {
    getSnapshot: (): ProgressSnapshot => snapshot,
    subscribe: (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    updateSession, revoke, captureLease, isCurrent,
    registerWordPersistenceGuard: (guard: WordPersistenceGuard): void => {
      if (wordGuard && wordGuard !== guard) throw new Error("A word persistence guard is already installed.");
      wordGuard = guard;
      const lease = captureLease();
      if (lease) guard.snapshotOwner(lease);
    },
    reportGuestHandoffFailure,
    getGuestHandoffProof: (): string | null => preparedProof,
    authorizeGuestHandoff: (nonce: string): void => {
      if (proofOffered || pinnedIdentity !== undefined || snapshot.status === "revoked") return;
      proofOffered = true;
      if (/^[a-f0-9]{48}$/.test(nonce)) authorizedProof = nonce;
      else reportGuestHandoffFailure();
    },
    matchesSession: (status: AuthStatus, userId?: string): boolean => snapshot.status === "ready"
      && status !== "loading" && (status === "authenticated" ? !!userId && pinnedIdentity === userId : pinnedIdentity === null),
    readEvidence, readScoped, writeScoped, removeScoped, listScoped, readLegacy, listLegacyKeys,
    readGuestCandidate, listGuestCandidates,
    acknowledgeGuestCandidate: (key: string, id: string, lease: ProgressLease | null = captureLease()): boolean => {
      if (!lease || !isCurrent(lease)) return false;
      persistGuestSources();
      loadGuestSources(lease);
      const source = guestSources.get(id);
      const saved = readPhysical(key, lease);
      if (!source || source.ownerKey !== lease.ownerKey || source.logicalKey !== key
        || !saved.present || !saved.readable || saved.raw === null) return false;
      const memory = rows.get(key)?.memory;
      if (!memory?.durable || memory.raw !== saved.raw) return false;
      try {
        const local = storage();
        if (!local) return false;
        const name = candidateKey(lease.ownerKey, id);
        const previous = local.getItem(name);
        if (previous !== null) {
          const stored: unknown = JSON.parse(previous);
          if (!object(stored) || stored.id !== id || stored.ownerKey !== lease.ownerKey
            || stored.sourceOwner !== "guest" || stored.raw !== source.raw
            || stored.loadAt !== source.loadAt || stored.logicalKey !== key) return false;
        }
        const acknowledged = { ...source, acknowledged: true };
        local.setItem(name, JSON.stringify(acknowledged));
        guestSources.set(id, acknowledged);
        return true;
      } catch { memoryOnly(); return false; }
    },
    retryPendingWordWrites: (lease: ProgressLease): void => {
      if (!isCurrent(lease)) return;
      for (const [key, row] of rows) if (wordGuard?.handles(key) && row.memory && !row.memory.durable) replaceScoped(key, row.memory.raw, lease);
    },
    isLatestDurable: (key: string, lease: ProgressLease | null = captureLease()): boolean => {
      if (!lease || !isCurrent(lease)) return false;
      const memory = rows.get(key)?.memory;
      const saved = readPhysical(key, lease);
      return !!memory?.durable && saved.present && saved.readable && saved.raw === memory.raw;
    },
    hasDurable: (key: string): boolean => { const lease = captureLease(); if (!lease) return false; const value = readPhysical(key, lease); return value.present && value.readable && value.raw !== null; },
    isScopedStorageEvent: (event: Pick<StorageEvent, "key">, logicalKey?: string): boolean => {
      const lease = captureLease(); if (!lease) return false;
      if (event.key === null) return true;
      if (logicalKey) return event.key === physicalKey(lease.ownerKey, logicalKey);
      try { const pair: unknown = event.key.startsWith(PROGRESS_NAMESPACE) ? JSON.parse(event.key.slice(PROGRESS_NAMESPACE.length)) : null; return Array.isArray(pair) && pair[0] === lease.ownerKey; } catch { return false; }
    },
    getLoadTime: (appId: string): number | undefined => { const key = PROGRESS_STORAGE_KEYS[appId]; return key ? rows.get(key)?.legacy.loadAt : undefined; },
    createStorage: (key: string, appId?: string): StateStorage => {
      rowFor(key, appId);
      let lease: ProgressLease | null = null;
      return {
        getItem: () => {
          lease = captureLease();
          const raw = readScoped(key, lease);
          if (raw === null) return null;
          try { const parsed: unknown = JSON.parse(raw); if (!object(parsed) || !object(parsed.state)) { memoryOnly(); return null; } return raw; }
          catch { memoryOnly(); return null; }
        },
        setItem: (_name, raw) => {
          const current = captureLease();
          // Only this permanently pinned document owner can resume local writes.
          // Cloud callers retain their strict original generation checks.
          if (lease && current?.ownerKey === lease.ownerKey) writeScoped(key, raw, current);
        },
        removeItem: () => {
          const current = captureLease();
          if (lease && current?.ownerKey === lease.ownerKey) removeScoped(key, current);
        },
      };
    },
    bindPersistedStore: (key: string, persist: PersistHandle, flush?: () => void): (() => void) => {
      rowFor(key);
      const existing = bindings.get(key);
      if (existing?.persist === persist) { if (flush) existing.flush = flush; return () => {}; }
      const binding: Binding = { persist, hydrated: false, flight: null, flush };
      bindings.set(key, binding);
      hydrate(key, binding);
      return () => { if (bindings.get(key) === binding) bindings.delete(key); };
    },
    flushStore: (key: string, lease: ProgressLease | null = captureLease()): boolean => {
      const binding = bindings.get(key);
      if (!lease || !isCurrent(lease) || !binding?.hydrated || !binding.flush) return false;
      try { binding.flush(); } catch { memoryOnly(); return false; }
      if (!isCurrent(lease)) return false;
      const memory = rows.get(key)?.memory;
      const saved = readPhysical(key, lease);
      return !!memory?.durable && memory.raw !== null && saved.present && saved.readable && saved.raw === memory.raw;
    },
    isHydrated: (key: string): boolean => snapshot.status === "ready" && bindings.get(key)?.hydrated === true,
    whenHydrated: (key: string): Promise<void> => bindings.get(key)?.hydrated && snapshot.status === "ready" ? Promise.resolve() : new Promise(resolve => { const pending = waiters.get(key) ?? new Set(); pending.add(resolve); waiters.set(key, pending); }),
    prepareGuestHandoff: (): boolean => {
      preparedProof = null;
      const lease = captureLease();
      if (!lease || lease.ownerKey !== "guest" || pinnedIdentity !== null) return false;
      const values: GuestReceipt["rows"] = Object.create(null);
      for (const key of Object.values(PROGRESS_STORAGE_KEYS)) {
        const raw = readScoped(key, lease);
        if (raw !== null) values[key] = { raw, loadAt: rowFor(key).legacy.loadAt };
      }
      try {
        const session = sessionStorage(); if (!session) return false;
        const previous = session.getItem(GUEST_HANDOFF_KEY);
        // A failed earlier account transfer owns its pending receipt. Do not
        // replace its only association with a later guest's sign-in attempt.
        if (previous) { const parsed: unknown = JSON.parse(previous); if (object(parsed) && parsed.ownerKey !== "guest") return false; }
        const nonce = [...crypto.getRandomValues(new Uint8Array(24))].map(byte => byte.toString(16).padStart(2, "0")).join("");
        session.setItem(GUEST_HANDOFF_KEY, JSON.stringify({ version: 2, ownerKey: "guest", nonce, rows: values }));
        preparedProof = nonce;
        return true;
      }
      catch { cancelGuestHandoff(); return false; }
    },
    cancelGuestHandoff,
  };
}
export type OwnerBoundProgress = ReturnType<typeof createOwnerBoundProgress>;
