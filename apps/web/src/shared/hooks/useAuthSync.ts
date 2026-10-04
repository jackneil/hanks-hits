"use client";

import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import type { ValidAppId, AppProgressData } from "@hank-neil/db/schema";
import { extractTimestamp } from "@/lib/progress-merge";
import { reportProgressToAchievements } from "@/shared/lib/achievements";
import { sameProgress } from "@/shared/lib/progressStamp";
import {
  addListItems,
  applyOwnChanges,
  foldProgress,
  isLegacyUntouchedRow,
  isRecord,
  isUntouchedProgress,
  listItemKeys,
  newListItems,
  progressFromSave,
  progressTimeKey,
  type ListItemKeys,
} from "@/shared/lib/untouchedProgress";
import {
  SIGNOUT_BROADCAST_KEY,
  isClearedOnSignOut,
} from "@/lib/storage-keys";
import { ownerBoundProgress } from "@/lib/owner-bound-progress";

import type { ProgressContinuation, ProgressRead } from "@/shared/lib/progressContinuation";

type SyncStatus = "idle" | "syncing" | "synced" | "error";

type UseAuthSyncOptions<T extends AppProgressData> = {
  appId: ValidAppId;
  localStorageKey: string;
  getState: () => T;
  setState: (data: T) => void;
  debounceMs?: number;
  continuation?: ProgressContinuation<T>;
  onSyncComplete?: (source: "local" | "server") => void;
};

type UseAuthSyncReturn = {
  isAuthenticated: boolean;
  isGuest: boolean;
  syncStatus: SyncStatus;
  lastSynced: Date | null;
  forceSync: () => Promise<void>;
  /**
   * True when the page may change progress by itself (a time update, a
   * catch-up for the time away, a first item that shows by itself): for a
   * guest after local hydration, for a signed-in player when first sync is done, so
   * the change goes onto the account's progress and not onto an old copy.
   * When the account cannot be reached for READY_FALLBACK_MS, the page runs
   * on the device's progress (as a guest's page does), and a later sync
   * merges as usual.
   */
  ready: boolean;
  /**
   * True when the first sync for the signed-in account is done: the store
   * holds the account's progress. An automatic change stamps the time only
   * then (automaticStamp in shared/lib/progressStamp.ts). False for a guest,
   * and while the page runs on the device's copy after READY_FALLBACK_MS.
   */
  synced: boolean;
};

/** The first sync failed: the next try waits 2 s, then 4 s, 8 s ... 30 s. */
const RETRY_FIRST_MS = 2_000;
const RETRY_MAX_MS = 30_000;
/**
 * A first sync that is not done after this long: the page stops waiting
 * for the account (`ready`), and the sync keeps trying. A sync takes well
 * under a second; this covers about three failed tries.
 */
export const READY_FALLBACK_MS = 10_000;

type SaveResult = { ok: boolean; status: number | null };

/**
 * A failed save worth trying again: no answer, a server error, a timeout or
 * a rate limit. Any other refusal (400: the server's schema refuses the
 * progress) answers the same way every time.
 */
function retryable(result: SaveResult): boolean {
  const { status } = result;
  return status === null || status >= 500 || status === 408 || status === 429;
}

/**
 * Progress with time 0 (or none) is untouched: no player action changed it
 * (shared/lib/progressStamp.ts). An upload of it adds nothing to the
 * account, so no save path sends it (a time update of an untouched pet, for
 * example, changes the progress but keeps time 0).
 */
function untouchedTime(data: unknown): boolean {
  const time = extractTimestamp(data as AppProgressData);
  return time === null || time <= 0;
}

/**
 * Progress that a save may send: a player changed it (time above 0), and
 * the store's rule does not call it untouched (a setting, a phase or a clock
 * changed it, shared/lib/untouchedProgress.ts). A row of untouched progress
 * with a new time became the base of the server's merge and wiped the real
 * progress that another device had put on the account. A change to a
 * setting alone reaches the account with the kid's next real change.
 */
function uploadable(appId: string, data: unknown): boolean {
  return !untouchedTime(data) && !isUntouchedProgress(appId, data);
}

/** Adds the item keys of `keys` to `into` (a union per list). */
function addKeys(into: Map<string, Set<string>>, keys: ListItemKeys): void {
  for (const [field, set] of keys) {
    const known = into.get(field);
    if (known) for (const key of set) known.add(key);
    else into.set(field, new Set(set));
  }
}

// Lock sync across remounts after authority revocation until the provider
// completes a hard navigation. Legacy saves and their marker remain untouched.
let foreignPurgePending = false;

/** Test-only escape hatch: jsdom never actually reloads, so tests must
 * release the module-level lock between cases. Never call in app code. */
export function __unsafeResetForeignPurgeLockForTests() {
  foreignPurgePending = false;
}

/**
 * Hook for syncing game/app state between localStorage and database
 *
 * - Guest mode: saves in the confirmed guest namespace
 * - Authenticated: syncs to DB with debounced auto-save
 * - On login: merges the owner-approved local snapshot with DB
 * - On logout: revokes the document; original legacy sources remain intact
 *
 * Untouched progress never replaces the account's progress. The server
 * merges by the time in the progress (last write wins), and a store that no
 * player action changed has time 0 (shared/lib/progressStamp.ts), so it
 * loses. More guards:
 * - No save sends progress that the store's rule calls untouched (only a
 *   setting, a phase or a clock changed): see uploadable().
 * - A page that loaded with no save for this key, where nothing changed the
 *   progress since the first render, takes the account's progress and
 *   uploads nothing.
 * - Untouched progress on the account (the defaults that the code before
 *   the sync-time fix uploaded, with the page-load time) never wins over
 *   the device's real progress (shared/lib/untouchedProgress.ts).
 * - Progress that a player changed on this device goes to the server with
 *   merge:true, and the server's last-write rule decides (the same rule as
 *   before this change). A guest's play at sign-in follows that rule too:
 *   the merge that keeps both sides is #69i.
 * - When the first sync takes the account's progress (the device is
 *   untouched, or the account is newer), a change that the player made on
 *   the old copy during the sync goes: the account's newer progress must
 *   not lose to it. Its records stay (a high score, an unlock), and so do
 *   the items that the player made during the sync (a beat, a drawing).
 *   They save with the next save. When the device was newer, its change
 *   stays and the next save sends it.
 * - Another tab that saves newer progress for this key: this tab takes it
 *   before its next change, so a stale tab never replaces it. This tab's
 *   records and its unsaved items join it, and the next save sends them.
 * - The progress of one account never goes to another account. Each save
 *   needs the account of the first sync to be the session's account. A new
 *   account on the page, a page from the back-forward cache after a
 *   sign-out, and another tab that claims the device for a new account
 *   (the owner key) lock every save and reload the page.
 * No save leaves the page before the first sync is done; a failed first
 * sync tries again (a refusal from the server's schema does not).
 */
export function useAuthSync<T extends AppProgressData>({
  appId,
  localStorageKey,
  getState,
  setState,
  debounceMs = 2000,
  onSyncComplete,
  continuation,
}: UseAuthSyncOptions<T>): UseAuthSyncReturn {
  // Keep every synced logical key inventoried. Physical owner isolation and
  // legacy preservation are enforced by the storage authority.
  if (process.env.NODE_ENV !== "production" && !isClearedOnSignOut(localStorageKey)) {
    throw new Error(
      `useAuthSync localStorageKey "${localStorageKey}" is not covered by ` +
        `signOutAndClear — add it to GAME_STORAGE_KEYS in src/lib/storage-keys.ts`
    );
  }

  const { data: session, status } = useSession();
  const ownerSnapshot = useSyncExternalStore(ownerBoundProgress.subscribe, ownerBoundProgress.getSnapshot, ownerBoundProgress.getSnapshot);
  const leaseRef = useRef<ReturnType<typeof ownerBoundProgress.captureLease>>(null);
  if (leaseRef.current === null && ownerSnapshot.status === "ready") leaseRef.current = ownerBoundProgress.captureLease();
  const bindingIsCurrent = useCallback(() => leaseRef.current !== null && ownerBoundProgress.isCurrent(leaseRef.current)
    && ownerBoundProgress.matchesSession(status, session?.user?.id), [status, session?.user?.id]);
  const bindingIsCurrentRef = useRef(bindingIsCurrent);
  bindingIsCurrentRef.current = bindingIsCurrent;
  const hydrated = ownerBoundProgress.isHydrated(localStorageKey);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  const isAuthenticated = status === "authenticated" && !!session?.user?.id;
  const isGuest = status === "unauthenticated";
  const isLoading = status === "loading";

  // The page at its first render, before any effect: was there a save for
  // this key, and what was the time of the progress? A mount effect (a time
  // update, a catch-up) can change the store before the sync starts, and a
  // guest can play before the session turns authenticated (sign-in in
  // another tab, the session's "loading" window). Unknown (blocked storage)
  // counts as a save, so the merge runs.
  const savedAtLoadRef = useRef<boolean | null>(null);
  const tsAtLoadRef = useRef<number | null | undefined>(undefined);
  // The account whose progress the page loaded (the owner key at the first
  // render), and the mark of the last sign-out at that time. Another tab can
  // change both while this page holds the loaded progress in memory.
  // The keys of the list items that this page shares with the account or
  // another tab (its save at load, its uploads, the progress that it took),
  // per list. An item that is not here and that newer progress does not
  // hold is an item that the player made on this page and did not save yet.
  const knownItemsRef = useRef<Map<string, Set<string>> | null>(null);
  if (savedAtLoadRef.current === null && hydrated) {
    const evidence = ownerBoundProgress.readEvidence(localStorageKey);
    savedAtLoadRef.current = !evidence.markerReadable || evidence.raw !== null;
  }
  if (tsAtLoadRef.current === undefined && hydrated) {
    tsAtLoadRef.current = extractTimestamp(getState() as AppProgressData);
  }
  if (knownItemsRef.current === null) {
    knownItemsRef.current = new Map();
    addKeys(knownItemsRef.current, listItemKeys(appId, getState()));
  }
  // The session's account at this render (the save paths read it).
  const sessionUserIdRef = useRef<string | undefined>(undefined);
  sessionUserIdRef.current = session?.user?.id;

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>("");
  const initialSyncDoneRef = useRef(false);
  // The account whose first sync is done (for `ready`). A sign-out leaves
  // the page (signOutAndClear navigates, other tabs reload), so a page syncs
  // one account at most. The ref is for the save paths: each save needs it
  // to be the session's account.
  const [syncedUserId, setSyncedUserId] = useState<string | null>(null);
  const syncedUserIdRef = useRef<string | null>(null);
  const initialSyncUserIdRef = useRef<string | null>(null);
  const syncAttemptsRef = useRef(0);
  const syncInFlightRef = useRef(false);
  const acceptedGuestCandidatesRef = useRef(new Set<string>());
  const guestCanonicalRef = useRef(false);
  const retryGuestRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  // The account cannot be reached for READY_FALLBACK_MS: `ready` anyway.
  const [offline, setOffline] = useState(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // forceSync() before the first sync was done: save when it is.
  const pendingForceRef = useRef(false);
  // Set when the local/in-memory state belongs to a DIFFERENT user (shared
  // device). Locks every upload path until the pending hard reload lands.
  const foreignDataRef = useRef(false);

  // Store getState/setState in refs to avoid callback instability
  // (These are inline arrow functions that change every render)
  const getStateRef = useRef(getState);
  const setStateRef = useRef(setState);
  const onSyncCompleteRef = useRef(onSyncComplete);
  const continuationRef = useRef(continuation);
  continuationRef.current = continuation;

  useEffect(() => {
    getStateRef.current = getState;
    setStateRef.current = setState;
    onSyncCompleteRef.current = onSyncComplete;
  }, [getState, setState, onSyncComplete]);

  /** The page shares the list items of `progress` with the account or another tab. */
  const noteKnown = useCallback(
    (progress: unknown) => {
      if (!knownItemsRef.current) knownItemsRef.current = new Map();
      addKeys(knownItemsRef.current, listItemKeys(appId, progress));
    },
    [appId]
  );

  /** `progress` is on the account now: nothing of it is unsaved. */
  const noteSaved = useCallback(
    (progress: unknown) => {
      lastSavedRef.current = JSON.stringify(progress);
      noteKnown(progress);
    },
    [noteKnown]
  );

  const acknowledgeGuestCandidates = useCallback(() => {
    const lease = leaseRef.current;
    if (!lease || !bindingIsCurrentRef.current() || !guestCanonicalRef.current) return;
    if (acceptedGuestCandidatesRef.current.size) ownerBoundProgress.flushStore(localStorageKey, lease);
    for (const id of acceptedGuestCandidatesRef.current) {
      if (ownerBoundProgress.acknowledgeGuestCandidate(localStorageKey, id, lease)) {
        acceptedGuestCandidatesRef.current.delete(id);
      }
    }
  }, [localStorageKey]);

  /**
   * True when a save may leave the page: the first sync is done for the
   * session's account, and no other account took the page or the device.
   */
  const ownerMaySave = useCallback(
    () =>
      !foreignDataRef.current &&
      !foreignPurgePending &&
      bindingIsCurrentRef.current() &&
      syncedUserIdRef.current !== null &&
      syncedUserIdRef.current === sessionUserIdRef.current,
    []
  );

  /** The provider owns navigation. Revocation never changes legacy storage. */
  const leaveStalePage = useCallback(() => {
    if (foreignDataRef.current) return;
    foreignDataRef.current = true;
    foreignPurgePending = true;
    ownerBoundProgress.revoke();
  }, []);

  const deviceChangedUnderPage = useCallback(
    () => !bindingIsCurrentRef.current(), []
  );

  // A sign-out invalidates this document before navigation. Scoped events
  // can update only the currently captured owner binding.
  //
  // Another tab that saves newer progress for this key: take it now (the
  // way the first sync takes the account's progress), so that this tab's
  // next change builds on it. A stale tab's change would replace it on the
  // device and, with a newer time, on the account. The records of this tab
  // that the other tab does not hold (a high score set here while that tab
  // missed this tab's save: a frozen phone tab, a page from the back-forward
  // cache) fold in and save.
  useEffect(() => {
    const takeNewer = (raw: string | null) => {
      if (raw === null) return;
      if (foreignDataRef.current || foreignPurgePending || !bindingIsCurrentRef.current()) return;
      let saved: unknown;
      try {
        const parsed = JSON.parse(raw);
        saved = isRecord(parsed) ? parsed.state : null;
      } catch {
        return;
      }
      const theirs = progressFromSave(appId, saved, ownerBoundProgress.readEvidence(localStorageKey).loadAt);
      if (!theirs) return;
      if (continuationRef.current?.active) {
        continuationRef.current.observeOtherTab(theirs as T);
        return;
      }
      const theirTime = extractTimestamp(theirs as AppProgressData) ?? 0;
      const ours = getStateRef.current();
      const ourTime = extractTimestamp(ours as AppProgressData) ?? 0;
      if (theirTime <= ourTime) return;
      // This tab's records, and the items that this tab made and did not
      // save yet (an item that this page shared before and that the other
      // tab does not hold was deleted there, so it stays deleted).
      const records = foldProgress(appId, theirs as AppProgressData, ours as AppProgressData);
      const unsaved = newListItems(appId, ours, [knownItemsRef.current ?? new Map(), listItemKeys(appId, theirs)]);
      const folded = addListItems(appId, records, unsaved);
      noteKnown(theirs);
      if (sameProgress(folded, theirs)) {
        setStateRef.current(folded as T);
        // The other tab saves its progress to the account: this tab has
        // nothing new.
        lastSavedRef.current = JSON.stringify(getStateRef.current());
        return;
      }
      // Something of this tab joined: one moment newer than the other tab's
      // save, so that the account and the other tab take it. The save stays
      // pending, and the next save sends it.
      setStateRef.current({ ...folded, [progressTimeKey(appId)]: theirTime + 1 } as T);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === SIGNOUT_BROADCAST_KEY) {
        leaveStalePage();
        return;
      }
      if (ownerBoundProgress.getSnapshot().status === "unresolved") return;
      if (deviceChangedUnderPage()) { leaveStalePage(); return; }
      if (!ownerBoundProgress.isScopedStorageEvent(e, localStorageKey)) return;
      takeNewer(ownerBoundProgress.readScoped(localStorageKey, leaseRef.current ?? undefined));
    };
    // A page from the back-forward cache missed the storage events of the
    // time it was away: a sign-out or a new owner reloads it; else it reads
    // the save again.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      // The provider's capture-phase handler first revalidates authentication.
      // Suspension is not evidence that a different owner took this document.
      if (ownerBoundProgress.getSnapshot().status === "unresolved") return;
      if (deviceChangedUnderPage()) {
        leaveStalePage();
        return;
      }
      takeNewer(ownerBoundProgress.readScoped(localStorageKey, leaseRef.current ?? undefined));
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onPageShow);
    // A provider may have suspended the bfcache event while checking auth.
    // Once this owner is confirmed, merge its latest bytes through the same
    // B1 path, without rehydrating over in-memory play.
    if (bindingIsCurrentRef.current() && hydrated) {
      takeNewer(ownerBoundProgress.readScoped(localStorageKey, leaseRef.current ?? undefined));
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [appId, localStorageKey, noteKnown, deviceChangedUnderPage, leaveStalePage, hydrated, ownerSnapshot.generation]);

  // The session's account changed on this mounted page (another tab signed
  // in as another kid; the login page does not sign out first). The
  // progress in memory is the first account's: it must never reach the new
  // one.
  const sessionUserId = session?.user?.id;
  useEffect(() => {
    const synced = syncedUserIdRef.current ?? initialSyncUserIdRef.current;
    if (!sessionUserId || synced === null || sessionUserId === synced) return;
    if (foreignDataRef.current || foreignPurgePending) return;
    leaveStalePage();
  }, [sessionUserId, leaveStalePage]);

  /**
   * Fetch progress from server
   */
  const fetchFromServer = useCallback(async (): Promise<ProgressRead<T> | null> => {
    const lease = leaseRef.current;
    const ownerId = sessionUserIdRef.current;
    if (!lease || !ownerId || !bindingIsCurrentRef.current()) return null;
    try {
      const res = await fetch(`/api/progress/${appId}`, { headers: { "x-hh-expected-owner": ownerId } });
      if (!ownerBoundProgress.isCurrent(lease) || !bindingIsCurrentRef.current()) return null;
      if (!res.ok) {
        if (res.status === 409) {
          const body: unknown = await res.json();
          if (!ownerBoundProgress.isCurrent(lease) || !bindingIsCurrentRef.current()) return null;
          if (isRecord(body) && body.code === "owner_changed") leaveStalePage();
        }
        console.error("Failed to fetch progress:", res.status);
        return null;
      }
      const result = await res.json();
      return ownerBoundProgress.isCurrent(lease) && bindingIsCurrentRef.current() ? result : null;
    } catch (error) {
      console.error("Fetch progress error:", error);
      return null;
    }
  }, [appId, leaveStalePage]);

  /**
   * Save progress to server
   */
  const saveToServer = useCallback(
    async (data: T, merge = false): Promise<SaveResult> => {
      const lease = leaseRef.current;
      const ownerId = sessionUserIdRef.current;
      if (!lease || !ownerId || !bindingIsCurrentRef.current()) return { ok: false, status: null };
      const current = () => ownerBoundProgress.isCurrent(lease) && bindingIsCurrentRef.current();
      if (continuationRef.current?.active) {
        setSyncStatus("syncing");
        const result = await continuationRef.current.save(data);
        if (!current()) return { ok: false, status: result.status };
        setSyncStatus(result.ok ? "synced" : "error");
        if (result.ok) setLastSynced(new Date());
        return result;
      }
      try {
        setSyncStatus("syncing");

        const res = await fetch(`/api/progress/${appId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data,
            merge,
            expectedOwnerId: ownerId,
          }),
        });
        if (!current()) return { ok: false, status: res.status };

        if (!res.ok) {
          // The status and the server's reason (a field path and a rule,
          // never a value of the progress), so that a refusal can be found.
          let reason = "";
          try {
            const body = (await res.json()) as { error?: unknown; code?: unknown };
            if (!current()) return { ok: false, status: res.status };
            if (res.status === 409 && body?.code === "owner_changed") {
              leaveStalePage();
              return { ok: false, status: res.status };
            }
            if (typeof body?.error === "string") reason = body.error.slice(0, 300);
          } catch {
            // No JSON body.
          }
          console.error(`Failed to save progress for ${appId}:`, res.status, reason);
          setSyncStatus("error");
          return { ok: false, status: res.status };
        }

        const result = await res.json();
        if (!current()) return { ok: false, status: res.status };
        setSyncStatus("synced");
        setLastSynced(new Date(result.updatedAt));
        return { ok: true, status: res.status };
      } catch (error) {
        if (!current()) return { ok: false, status: null };
        console.error("Save progress error:", error);
        setSyncStatus("error");
        return { ok: false, status: null };
      }
    },
    [appId, leaveStalePage]
  );

  /** Middleware completion, never a timer or an equality guess. */
  const waitForHydration = useCallback(async (): Promise<T> => {
    await ownerBoundProgress.whenHydrated(localStorageKey);
    return getStateRef.current();
  }, [localStorageKey]);

  /** The first sync for `userId` is done: saves may start, and the page is ready. */
  const markSynced = useCallback((userId: string) => {
    initialSyncDoneRef.current = true;
    syncedUserIdRef.current = userId;
    setSyncedUserId(userId);
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  /**
   * The first sync failed (the server did not answer): try again later,
   * with a longer wait each time. Saves wait for the first sync.
   */
  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current) return;
    const attempt = Math.max(1, syncAttemptsRef.current);
    const delay = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** (attempt - 1));
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      setRetryTick((tick) => tick + 1);
    }, delay);
  }, []);

  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    },
    []
  );

  /**
   * Initial sync on login - merge localStorage with server
   */
  const runInitialSync = useCallback(async () => {
    const firstAttempt = syncAttemptsRef.current === 0;
    syncAttemptsRef.current += 1;
    setSyncStatus("syncing");

    const userId = session?.user?.id;
    if (!userId || !bindingIsCurrentRef.current()) return;
    initialSyncUserIdRef.current = userId;
    const sessionMoved = () => foreignDataRef.current || foreignPurgePending
      || sessionUserIdRef.current !== userId || !bindingIsCurrentRef.current();

    const tsAtStart = extractTimestamp(getStateRef.current() as AppProgressData);

    // The account cannot be reached for READY_FALLBACK_MS: the page stops
    // waiting (`ready`), and this sync keeps trying.
    if (firstAttempt && !fallbackTimerRef.current) {
      fallbackTimerRef.current = setTimeout(() => {
        fallbackTimerRef.current = null;
        if (!initialSyncDoneRef.current) setOffline(true);
      }, READY_FALLBACK_MS);
    }

    // Wait for Zustand to hydrate from localStorage first
    let localState = await waitForHydration();
    if (sessionMoved()) return;

    // Admit explicit guest play through the existing server merge before the
    // normal first GET. The hydrated account namespace remains our local side.
    // Cookie wallets require an explicit recovery choice instead.
    retryGuestRef.current = false;
    if (appId !== "cookie-clicker") {
      const lease = leaseRef.current!;
      for (const candidate of ownerBoundProgress.listGuestCandidates(localStorageKey, lease)) {
        if (acceptedGuestCandidatesRef.current.has(candidate.id)) continue;
        let progress: Record<string, unknown> | null = null;
        try {
          const envelope: unknown = JSON.parse(candidate.raw);
          progress = progressFromSave(appId, isRecord(envelope) ? envelope.state : null, candidate.loadAt);
        } catch { /* Unsupported candidates remain available for recovery. */ }
        if (!progress) continue;
        if (uploadable(appId, progress)) {
          const accepted = await saveToServer(progress as T, true);
          if (sessionMoved()) return;
          if (!accepted.ok) {
            retryGuestRef.current ||= retryable(accepted);
            continue; // An unavailable candidate does not block account saving.
          }
        }
        acceptedGuestCandidatesRef.current.add(candidate.id);
        guestCanonicalRef.current = false;
      }
      if (retryGuestRef.current) scheduleRetry();
    }

    // Fetch server state
    const serverResult = await fetchFromServer();
    if (sessionMoved()) return;

    if (!serverResult) {
      // Server fetch failed - DON'T set the flag; try again soon.
      setSyncStatus("error");
      scheduleRetry();
      return;
    }

    const continuationContext = (canonical: ProgressRead<T>) => ({
      ownerId: userId, canonical, live: getStateRef.current(),
      maySave: () => !sessionMoved() && !deviceChangedUnderPage(),
    });
    if (continuationRef.current?.recover(continuationContext(serverResult))) {
      if (sessionMoved()) return;
      markSynced(userId);
      setSyncStatus("synced");
      onSyncCompleteRef.current?.("local");
      return;
    }
    const serverData = serverResult.data as T | null;
    // The first GET may take long enough for the player to create progress.
    // Judge that live progress as touched, so the normal server LWW rule
    // applies. Only in this witnessed transition from untouched do we add
    // the account's list items: neither side has deleted a previously shared
    // item, and new drawings/beats must survive the initial load.
    const live = getStateRef.current();
    if (!uploadable(appId, localState) && uploadable(appId, live)) {
      const before = localState;
      localState = live;
      if (serverData) {
        const accountItems = newListItems(appId, serverData, [listItemKeys(appId, before)]);
        localState = addListItems(appId, live as AppProgressData, accountItems) as T;
        setStateRef.current(localState);
      }
    }
    const localTs = extractTimestamp(localState as AppProgressData);
    const emptyLocal = !localState || Object.keys(localState).length === 0;
    // The page loaded with no save for this key, and nothing changed the
    // progress since the first render: the player made nothing here. Only
    // the first try: on a retry, the player may have played meanwhile.
    const freshPage =
      firstAttempt &&
      savedAtLoadRef.current === false &&
      localTs === tsAtStart &&
      localTs === tsAtLoadRef.current;
    // Untouched: time 0 (or none) means that no player action changed it;
    // the store's rule says when only time or a setting changed it (a
    // guest who only turned the sound off must not replace the account's
    // progress, shared/lib/untouchedProgress.ts).
    const untouched =
      emptyLocal ||
      freshPage ||
      localTs === null ||
      localTs <= 0 ||
      isUntouchedProgress(appId, localState);
    const localJson = JSON.stringify(localState);
    const timeKey = progressTimeKey(appId);
    const timeOf = (data: unknown) => extractTimestamp(data as AppProgressData) ?? 0;

    /**
     * Take `data`, which the account holds as `account` once this sync is
     * done: nothing uploads until the player changes something, unless
     * `data` holds more than `account`. When the player changed the
     * progress while the sync ran (the sync judged `judged`), these changes
     * stay: a change at a field that `data` holds as the sync judged it
     * (applyOwnChanges: the account did not change it), the records (a new
     * high score, an unlock: foldProgress), and the items that the player
     * made (a beat, a drawing: addListItems). A field that the account
     * changed too keeps the account's value. The kept changes join `data`,
     * and the next save sends them. Without this, a change made while the
     * first GET was in flight was gone, and never reached the account.
     */
    const take = (data: T, judged: string, account: T) => {
      const during = getStateRef.current();
      let next = data;
      if (JSON.stringify(during) !== judged && !untouchedTime(during)) {
        const start = JSON.parse(judged) as unknown;
        const own = applyOwnChanges(appId, data, during, start);
        const records = foldProgress(appId, own, during as AppProgressData);
        const made = newListItems(appId, during, [listItemKeys(appId, start), listItemKeys(appId, data)]);
        const kept = addListItems(appId, records, made);
        if (!sameProgress(kept, data)) {
          next = { ...kept, [timeKey]: Math.max(timeOf(data), timeOf(during)) } as T;
        }
      }
      setStateRef.current(next);
      noteKnown(data);
      noteKnown(account);
      const now = getStateRef.current();
      lastSavedRef.current = sameProgress(now, account) ? JSON.stringify(now) : JSON.stringify(account);
    };
    /** The first sync is done: this device's progress is the account's (or builds on it). */
    const synced = (source: "local" | "server", canonical = serverResult, related = true) => {
      continuationRef.current?.begin(continuationContext(canonical), related);
      markSynced(userId);
      setSyncStatus("synced");
      onSyncCompleteRef.current?.(source);
      guestCanonicalRef.current = true;
      acknowledgeGuestCandidates();
      if (acceptedGuestCandidatesRef.current.size) {
        retryGuestRef.current = true;
        scheduleRetry();
      }
    };
    /**
     * A save of the first sync failed. A failure worth trying again (no
     * answer, a server error) tries again later. A refusal (the server's
     * schema refuses this progress) answers the same way every time: the
     * device keeps its progress, adopts nothing, and the page goes on.
     */
    const saveFailed = (result: SaveResult) => {
      if (retryable(result)) {
        scheduleRetry();
        return;
      }
      console.warn(
        `useAuthSync: the server refused the progress of ${appId} (${result.status}); this device keeps it and does not try again.`
      );
      lastSavedRef.current = localJson;
      markSynced(userId);
      setSyncStatus("error");
    };

    // No server data
    if (!serverData) {
      const sent = getStateRef.current();
      if (untouched || !uploadable(appId, sent)) {
        // Nothing that the player made. A change made while the sync ran
        // (the snapshot is what was judged) saves with the next poll.
        lastSavedRef.current = localJson;
        synced("local");
        return;
      }
      if (sessionMoved()) return;
      const result = await saveToServer(sent, false);
      if (sessionMoved()) return;
      if (!result.ok) {
        saveFailed(result);
        return;
      }
      noteSaved(sent);
      if (continuationRef.current) {
        const canonical = await fetchFromServer();
        if (sessionMoved()) return;
        if (!canonical) { scheduleRetry(); return; }
        synced("local", canonical, sameProgress(canonical.data, sent));
      } else synced("local");
      return;
    }

    // Nothing on this device that the player made - use the server. What
    // time alone earned on this device (an unlocked species) is folded in
    // and saved (shared/lib/untouchedProgress.ts).
    if (untouched) {
      const folded = emptyLocal ? serverData : foldProgress(appId, serverData, localState);
      const target = sameProgress(folded, serverData)
        ? serverData
        : ({ ...folded, [timeKey]: Math.max(Date.now(), timeOf(serverData)) } as T);
      take(target, localJson, serverData);
      setLastSynced(
        serverResult.lastSyncedAt
          ? new Date(serverResult.lastSyncedAt)
          : new Date()
      );
      synced("server");
      return;
    }

    // The account holds untouched progress that the code before the
    // sync-time fix uploaded with the page-load time: the device's real
    // progress replaces it, whatever the times say, and keeps the row's
    // records (shared/lib/untouchedProgress.ts).
    if (isLegacyUntouchedRow(appId, serverData)) {
      const current = getStateRef.current();
      const sent = foldProgress(appId, current, serverData);
      if (sessionMoved()) return;
      const result = await saveToServer(sent, false);
      if (sessionMoved()) return;
      if (!result.ok) {
        saveFailed(result);
        return;
      }
      take(sent, JSON.stringify(current), sent);
      if (continuationRef.current) {
        const canonical = await fetchFromServer();
        if (sessionMoved()) return;
        if (!canonical) { scheduleRetry(); return; }
        synced("local", canonical, sameProgress(canonical.data, sent));
      } else synced("local");
      return;
    }

    // Both exist - upload local with merge flag; the server reconciles by
    // the blobs' own lastModified with field-aware merging (last write
    // wins). This is the rule of the code before this change, also for a
    // guest's play: the merge that keeps both sides is #69i.
    if (sessionMoved()) return;
    const result = await saveToServer(localState, true);
    if (sessionMoved()) return;
    if (!result.ok) {
      saveFailed(result);
      return;
    }
    // Re-fetch to get merged result
    const merged = await fetchFromServer();
    if (sessionMoved()) return;
    if (!merged?.data) {
      scheduleRetry();
      return;
    }
    // Take the merged progress, with two exceptions:
    // - a merged result older than what this device sent is a stale answer
    //   (the server keeps the newer time): never let it wipe the device;
    // - the player changed the progress during this sync, and the device
    //   was newer than the account or the account added nothing to it: the
    //   newest progress is on this device, and the next save sends it (the
    //   server folds the account's records in).
    // When the account holds something newer, a change on the old copy
    // goes: it must not replace the account's newer progress. Its records
    // and the items made during the sync stay (take).
    const accountTs = timeOf(serverData);
    const mergedTs = extractTimestamp(merged.data as AppProgressData);
    const stale = mergedTs !== null && localTs !== null && mergedTs < localTs;
    const changedDuringSync = JSON.stringify(getStateRef.current()) !== localJson;
    // The account added nothing to what this device sent (the device's save
    // is the account's progress): a change during the sync builds on it.
    const nothingNew = sameProgress(merged.data, localState);
    let related = true;
    if (stale || (changedDuringSync && (nothingNew || (localTs ?? 0) > accountTs))) {
      // Keeping local play does not mean it descends from this returned row.
      // Another device may have committed between the first GET and re-fetch.
      related = !stale && nothingNew;
      noteKnown(localState);
      lastSavedRef.current = localJson;
    } else {
      take(merged.data as T, localJson, merged.data as T);
    }
    synced("server", merged, related);
  }, [
    appId,
    waitForHydration,
    fetchFromServer,
    saveToServer,
    scheduleRetry,
    markSynced,
    noteKnown,
    noteSaved,
    deviceChangedUnderPage,
    acknowledgeGuestCandidates,
    localStorageKey,
    session?.user?.id,
  ]);

  /** One initial sync at a time (a retry or a second effect run waits its turn). */
  const performInitialSync = useCallback(async () => {
    if ((initialSyncDoneRef.current && !retryGuestRef.current) || foreignPurgePending || syncInFlightRef.current || !bindingIsCurrentRef.current()) return;
    syncInFlightRef.current = true;
    try {
      await runInitialSync();
    } finally {
      syncInFlightRef.current = false;
    }
  }, [runInitialSync]);

  /**
   * Debounced save - called on state changes
   */
  const debouncedSave = useCallback(
    (data: T) => {
      // No save before the first sync is done: until then this device may
      // hold only untouched defaults, and the account's progress is not here
      // yet.
      // Each save needs the account of the first sync to be the session's.
      if (!isAuthenticated || !initialSyncDoneRef.current || !ownerMaySave()) return;

      // Nothing new since the last completed save (or nothing that a player
      // made): drop any stale pending timer and stop.
      if (!uploadable(appId, data) || JSON.stringify(data) === lastSavedRef.current) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        return;
      }

      // A save is already scheduled: it sends the newest progress when it
      // fires. (A new timer on each change starved the save of a page whose
      // progress changes every second, such as Cookie Clicker's bakery: the
      // 1 s poller came back before the debounce ran out.)
      if (saveTimeoutRef.current) return;

      saveTimeoutRef.current = setTimeout(async () => {
        saveTimeoutRef.current = null;
        if (!ownerMaySave()) return;
        const latest = getStateRef.current();
        const latestStr = JSON.stringify(latest);
        if (!uploadable(appId, latest) || latestStr === lastSavedRef.current) return;
        if (!continuationRef.current?.active) noteSaved(latest);
        // merge:true — the server folds this into any concurrent write from
        // another tab/device instead of blind-overwriting it.
        await saveToServer(latest, true);
      }, debounceMs);
    },
    [appId, isAuthenticated, debounceMs, saveToServer, ownerMaySave, noteSaved]
  );

  /**
   * Force immediate sync
   */
  const forceSync = useCallback(async () => {
    if (!isAuthenticated || foreignDataRef.current || foreignPurgePending) return;
    // Before the first sync: save when it is done (the effect below).
    if (!initialSyncDoneRef.current) {
      pendingForceRef.current = true;
      return;
    }
    if (!ownerMaySave()) return;

    // Clear pending debounce
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const data = getStateRef.current();
    if (!uploadable(appId, data)) return;
    if (!continuationRef.current?.active) noteSaved(data);
    await saveToServer(data, true);
  }, [appId, isAuthenticated, saveToServer, ownerMaySave, noteSaved]);

  // A forceSync() that came before the first sync was done: save now, if
  // anything is unsaved.
  useEffect(() => {
    if (!syncedUserId || !pendingForceRef.current) return;
    pendingForceRef.current = false;
    if (JSON.stringify(getStateRef.current()) !== lastSavedRef.current) void forceSync();
  }, [syncedUserId, forceSync]);

  // Initial sync when authenticated
  useEffect(() => {
    let syncTimer: ReturnType<typeof setTimeout> | undefined;

    if (isAuthenticated && hydrated && bindingIsCurrent() && (!initialSyncDoneRef.current || retryGuestRef.current)) {
      syncTimer = setTimeout(() => {
        performInitialSync();
      }, 0);
    }

    // Reset sync flag on logout
    if (!isAuthenticated && status !== "loading") {
      initialSyncDoneRef.current = false;
    }

    return () => {
      if (syncTimer) clearTimeout(syncTimer);
    };
  }, [isAuthenticated, status, hydrated, bindingIsCurrent, performInitialSync, retryTick]);

  // Achievements observer — ALWAYS on (the auto-save poll below is
  // auth-gated, which would lock guest kids out of trophies). Every synced
  // module already mounts this hook, so this one effect gives the Trophy
  // Case cross-game detection with zero per-island edits. The achievements
  // blob itself is skipped (feedback loop), and foreign (previous-user)
  // state must never earn the next kid's trophies.
  useEffect(() => {
    if (appId === "achievements") return;

    let lastReported = "";
    const interval = setInterval(() => {
      if (foreignDataRef.current || foreignPurgePending || !bindingIsCurrentRef.current() || !ownerBoundProgress.isHydrated(localStorageKey)) return;
      const state = getStateRef.current();
      const stateStr = JSON.stringify(state);
      if (stateStr === lastReported) return;
      lastReported = stateStr;
      reportProgressToAchievements(appId, state as Record<string, unknown>);
    }, 1000);

    return () => clearInterval(interval);
  }, [appId, localStorageKey]);

  // Subscribe to state changes for auto-save
  useEffect(() => {
    if (!isAuthenticated) return;

    // Set up an interval to check for changes
    // (Better approach: subscribe to Zustand store directly in the game)
    const interval = setInterval(() => {
      const currentState = getStateRef.current();
      debouncedSave(currentState);
    }, 1000);

    return () => {
      clearInterval(interval);
      // The unmount flush below sends what is still unsaved.
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [isAuthenticated, debouncedSave]);

  // Force-save pending changes on unmount or page leave
  useEffect(() => {
    // Handler for beforeunload (tab close/navigate away)
    const handleBeforeUnload = () => {
      // Never beacon before the initial sync has completed — a pre-hydration
      // or StrictMode-double-mount beacon would ship DEFAULT state and (before
      // merge protection) erase real progress on the server. Never beacon
      // foreign (previous-user) state either.
      if (!isAuthenticated || !initialSyncDoneRef.current || !ownerMaySave()) return;

      const data = getStateRef.current();
      const dataStr = JSON.stringify(data);
      if (!uploadable(appId, data) || dataStr === lastSavedRef.current) return; // nothing unsaved

      if (continuationRef.current?.active) {
        continuationRef.current.flush(data);
        return;
      }

      // merge:true so this best-effort write can never blind-overwrite a
      // newer save that raced it.
      const payload = JSON.stringify({ data, merge: true, expectedOwnerId: sessionUserIdRef.current });

      // Must use Blob with Content-Type or API's request.json() fails
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(`/api/progress/${appId}`, blob);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);

      // Also flush unsaved progress on component unmount (a pending save,
      // or a change that the 1 s poller did not see yet).
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      // Flush only after initial sync — a StrictMode unmount fires this
      // with DEFAULT state before hydration, which must never be saved.
      // Foreign (previous-user) state must never flush either.
      if (isAuthenticated && initialSyncDoneRef.current && ownerMaySave()) {
        const data = getStateRef.current();
        const dataStr = JSON.stringify(data);
        if (uploadable(appId, data) && dataStr !== lastSavedRef.current) {
          if (continuationRef.current?.active) {
            continuationRef.current.flush(data);
            return;
          }
          lastSavedRef.current = dataStr;
          // merge:true — same race protection as the unload beacon.
          const payload = JSON.stringify({ data, merge: true, expectedOwnerId: sessionUserIdRef.current });
          // Must use Blob with Content-Type or API's request.json() fails
          const blob = new Blob([payload], { type: "application/json" });
          navigator.sendBeacon(`/api/progress/${appId}`, blob);
        }
      }
    };
  }, [appId, isAuthenticated, ownerMaySave]);

  // This cleanup runs after the final flush. A temporary session "loading"
  // transition must not disable strict saves when authentication returns.
  useEffect(() => () => continuationRef.current?.deactivate(), []);

  return {
    isAuthenticated,
    isGuest,
    syncStatus: isLoading ? "syncing" : syncStatus,
    lastSynced,
    forceSync,
    ready: !isLoading && hydrated && bindingIsCurrent() && (!isAuthenticated || syncedUserId === session?.user?.id || offline),
    synced: isAuthenticated && hydrated && bindingIsCurrent() && syncedUserId === session?.user?.id,
  };
}

export default useAuthSync;
