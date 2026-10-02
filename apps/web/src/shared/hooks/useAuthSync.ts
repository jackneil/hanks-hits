"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import type { ValidAppId, AppProgressData } from "@hank-neil/db/schema";
import { extractTimestamp } from "@/lib/progress-merge";
import { reportProgressToAchievements } from "@/shared/lib/achievements";
import { sameProgress } from "@/shared/lib/progressStamp";
import {
  foldGuestProgress,
  foldProgress,
  isLegacyUntouchedRow,
  isMarkedSave,
  isRecord,
  isUntouchedProgress,
  progressFromSave,
  progressTimeKey,
} from "@/shared/lib/untouchedProgress";
import {
  PROGRESS_OWNER_KEY,
  SAVES_CLEARED_KEY,
  SIGNOUT_BROADCAST_KEY,
  clearGameStorage,
  isClearedOnSignOut,
  syncLineageKey,
} from "@/lib/storage-keys";

type SyncStatus = "idle" | "syncing" | "synced" | "error";

type UseAuthSyncOptions<T> = {
  appId: ValidAppId;
  localStorageKey: string;
  getState: () => T;
  setState: (data: T) => void;
  debounceMs?: number;
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
   * guest at once, for a signed-in player when the first sync is done, so
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

/**
 * What the page found on this device at its first render, before this
 * page's sync (or another tab's) writes the keys. builtOnDefaults() reads it.
 */
type LoadState = {
  /** A save for this key was on disk (unknown, blocked storage: true). */
  saved: boolean;
  /** The save's progress was untouched (time 0, or the store's rule). */
  untouched: boolean;
  /** The save descends from the progress of a signed-in account (syncLineageKey). */
  lineage: boolean;
  /** The account that last synced progress on this device (PROGRESS_OWNER_KEY). */
  owner: string | null;
  /** clearGameStorage() removed every save on this device at some time (SAVES_CLEARED_KEY). */
  cleared: boolean;
};

// True from the moment a foreign-owner purge begins until the pending hard
// reload lands. MODULE-level on purpose: it must survive client-side
// navigation and remounts (a fresh hook instance would otherwise sail past
// the now-matching marker and upload the foreign in-memory state), and it
// dies automatically with the reload.
let foreignPurgePending = false;

/** Test-only escape hatch: jsdom never actually reloads, so tests must
 * release the module-level lock between cases. Never call in app code. */
export function __unsafeResetForeignPurgeLockForTests() {
  foreignPurgePending = false;
}

/**
 * Hook for syncing game/app state between localStorage and database
 *
 * - Guest mode: saves to localStorage only
 * - Authenticated: syncs to DB with debounced auto-save
 * - On login: merges localStorage → DB
 * - On logout: clears localStorage (handled by signOutAndClear)
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
 * - Progress that the device built on the defaults (a guest's play, a blank
 *   device that played while the first sync failed, a save from after a
 *   sign-out) never replaces the account's real progress: the account's
 *   progress stays the base, and the device's records and new items fold in
 *   (builtOnDefaults, foldGuestProgress).
 * - When the first sync takes the account's progress (the account is as
 *   new as the device, or the device is untouched), a change that the
 *   player made on the old copy during the sync goes: the account's newer
 *   progress must not lose to it. Its records stay (a high score, an
 *   unlock) and save. When the device was newer, its change stays and the
 *   next save sends it.
 * - Another tab that saves newer progress for this key: this tab takes it
 *   before its next change, so a stale tab never replaces it. This tab's
 *   records fold in.
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
}: UseAuthSyncOptions<T>): UseAuthSyncReturn {
  // Every synced key MUST be cleared by signOutAndClear, or the next kid on
  // a shared device inherits (and uploads) this one's progress. The scan test
  // only sees string literals, so catch every construction here at mount.
  if (process.env.NODE_ENV !== "production" && !isClearedOnSignOut(localStorageKey)) {
    throw new Error(
      `useAuthSync localStorageKey "${localStorageKey}" is not covered by ` +
        `signOutAndClear — add it to GAME_STORAGE_KEYS in src/lib/storage-keys.ts`
    );
  }

  const { data: session, status } = useSession();
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
  const loadRef = useRef<LoadState | null>(null);
  if (savedAtLoadRef.current === null && typeof window !== "undefined") {
    try {
      savedAtLoadRef.current = localStorage.getItem(localStorageKey) !== null;
    } catch {
      savedAtLoadRef.current = true;
    }
  }
  if (tsAtLoadRef.current === undefined) {
    tsAtLoadRef.current = extractTimestamp(getState() as AppProgressData);
  }
  if (loadRef.current === null && typeof window !== "undefined") {
    const atLoad = getState();
    const untouched = untouchedTime(atLoad) || isUntouchedProgress(appId, atLoad);
    try {
      loadRef.current = {
        saved: savedAtLoadRef.current !== false,
        untouched,
        lineage: localStorage.getItem(syncLineageKey(localStorageKey)) !== null,
        owner: localStorage.getItem(PROGRESS_OWNER_KEY),
        cleared: localStorage.getItem(SAVES_CLEARED_KEY) !== null,
      };
    } catch {
      // Blocked storage: nothing is saved here; the last-write rule.
      loadRef.current = { saved: true, untouched, lineage: true, owner: null, cleared: false };
    }
  }

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>("");
  const initialSyncDoneRef = useRef(false);
  // The account whose first sync is done (for `ready`). A sign-out leaves
  // the page (signOutAndClear navigates, other tabs reload), so a page syncs
  // one account at most.
  const [syncedUserId, setSyncedUserId] = useState<string | null>(null);
  const syncAttemptsRef = useRef(0);
  const syncInFlightRef = useRef(false);
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

  useEffect(() => {
    getStateRef.current = getState;
    setStateRef.current = setState;
    onSyncCompleteRef.current = onSyncComplete;
  }, [getState, setState, onSyncComplete]);

  /**
   * True when this device's progress was built on the defaults, not on the
   * progress of the account `userId`: there was no save at load (a blank
   * device, a guest page), the save was untouched, or the save does not
   * descend from a signed-in account. The last needs the lineage key, which
   * this code writes when a first sync is done: a save without it, made after
   * clearGameStorage() (a sign-out), or on a device where no account ever
   * synced, is a guest's save. A save from before the lineage key existed,
   * on a device where this account synced, keeps the last-write rule.
   */
  const builtOnDefaults = useCallback((userId: string | undefined) => {
    const load = loadRef.current;
    if (!load) return false;
    if (!load.saved || load.untouched) return true;
    if (load.lineage) return false;
    return load.cleared || load.owner === null || load.owner !== userId;
  }, []);

  /** This device's save now descends from the signed-in account's progress. */
  const writeLineage = useCallback(() => {
    try {
      localStorage.setItem(syncLineageKey(localStorageKey), "1");
    } catch {
      // Blocked storage: nothing is saved on this device.
    }
    if (loadRef.current) loadRef.current = { ...loadRef.current, lineage: true };
  }, [localStorageKey]);

  // Another tab signing out clears localStorage, but THIS tab's in-memory
  // store would re-persist it within seconds. Reload on the broadcast so the
  // previous user's progress can't survive into the next login.
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
      if (foreignDataRef.current || foreignPurgePending) return;
      let saved: unknown;
      try {
        const parsed = JSON.parse(raw);
        saved = isRecord(parsed) ? parsed.state : null;
      } catch {
        return;
      }
      const theirs = progressFromSave(appId, saved);
      if (!theirs) return;
      const theirTime = extractTimestamp(theirs as AppProgressData) ?? 0;
      const ours = getStateRef.current();
      const ourTime = extractTimestamp(ours as AppProgressData) ?? 0;
      if (theirTime <= ourTime) return;
      const folded = foldProgress(appId, theirs as AppProgressData, ours as AppProgressData);
      setStateRef.current(folded as T);
      // This tab's progress now descends from the other tab's save.
      if (loadRef.current) {
        let lineage = loadRef.current.lineage;
        try {
          lineage = localStorage.getItem(syncLineageKey(localStorageKey)) !== null;
        } catch {
          // Blocked storage: keep what the page knew.
        }
        loadRef.current = {
          ...loadRef.current,
          saved: true,
          untouched: untouchedTime(theirs) || isUntouchedProgress(appId, theirs),
          lineage,
        };
      }
      // The other tab saves its progress to the account. When nothing of this
      // tab's folded in, this tab has nothing new; else the next save sends
      // the records.
      if (sameProgress(folded, theirs)) lastSavedRef.current = JSON.stringify(getStateRef.current());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === SIGNOUT_BROADCAST_KEY) {
        window.location.reload();
        return;
      }
      if (e.key !== localStorageKey) return;
      takeNewer(e.newValue);
    };
    // A page from the back-forward cache missed the storage events of the
    // time it was away: read the save again.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      try {
        takeNewer(localStorage.getItem(localStorageKey));
      } catch {
        // Blocked storage: no other tab wrote anything.
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [appId, localStorageKey]);

  /**
   * Fetch progress from server
   */
  const fetchFromServer = useCallback(async (): Promise<{
    data: T | null;
    lastSyncedAt: string | null;
  } | null> => {
    try {
      const res = await fetch(`/api/progress/${appId}`);
      if (!res.ok) {
        console.error("Failed to fetch progress:", res.status);
        return null;
      }
      return res.json();
    } catch (error) {
      console.error("Fetch progress error:", error);
      return null;
    }
  }, [appId]);

  /**
   * Save progress to server
   */
  const saveToServer = useCallback(
    async (data: T, merge = false): Promise<SaveResult> => {
      try {
        setSyncStatus("syncing");

        const res = await fetch(`/api/progress/${appId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data,
            merge,
          }),
        });

        if (!res.ok) {
          // The status and the server's reason (a field path and a rule,
          // never a value of the progress), so that a refusal can be found.
          let reason = "";
          try {
            const body = (await res.json()) as { error?: unknown };
            if (typeof body?.error === "string") reason = body.error.slice(0, 300);
          } catch {
            // No JSON body.
          }
          console.error(`Failed to save progress for ${appId}:`, res.status, reason);
          setSyncStatus("error");
          return { ok: false, status: res.status };
        }

        const result = await res.json();
        setSyncStatus("synced");
        setLastSynced(new Date(result.updatedAt));
        return { ok: true, status: res.status };
      } catch (error) {
        console.error("Save progress error:", error);
        setSyncStatus("error");
        return { ok: false, status: null };
      }
    },
    [appId]
  );

  /**
   * Wait for Zustand persist hydration from localStorage
   * This prevents uploading empty state if hydration hasn't completed yet
   */
  const waitForHydration = useCallback(async (): Promise<T> => {
    // Check if localStorage has data for this key
    const stored = localStorage.getItem(localStorageKey);
    if (!stored) {
      // No localStorage data, no need to wait
      return getStateRef.current();
    }

    // The progress that the store holds after hydration: the save's
    // progress as the store's rule reads it (shared/lib/untouchedProgress.ts).
    // A save of the code before the sync-time fix gets its real time on load
    // (the load time when it has none), so it is compared without its time.
    let expected: Record<string, unknown> | null = null;
    let legacy = false;
    try {
      const parsed = JSON.parse(stored);
      const saved = isRecord(parsed) ? parsed.state : null;
      legacy = !isMarkedSave(saved);
      expected = progressFromSave(appId, saved);
    } catch {
      // If parse fails, just return current state
      return getStateRef.current();
    }
    if (!expected) return getStateRef.current();
    const ignore = legacy ? [progressTimeKey(appId)] : [];

    // Wait until the store's state actually EQUALS the persisted snapshot.
    // (The old heuristic returned as soon as lastModified was defined — which
    // the pre-hydration DEFAULT state satisfies, so default zeros could be
    // uploaded as if they were the player's progress.)
    const maxWait = 500;
    const checkInterval = 25;
    let waited = 0;

    while (waited < maxWait) {
      const state = getStateRef.current();
      if (sameProgress(state, expected, ignore)) {
        return state;
      }
      await new Promise((r) => setTimeout(r, checkInterval));
      waited += checkInterval;
    }

    // Return whatever we have after waiting
    return getStateRef.current();
  }, [appId, localStorageKey]);

  /** The first sync is done: saves may start, and the page is ready. */
  const markSynced = useCallback(() => {
    initialSyncDoneRef.current = true;
    setSyncedUserId(session?.user?.id ?? null);
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, [session?.user?.id]);

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

    // Shared-device guard: if the locally stored progress belongs to a
    // DIFFERENT user (the previous kid on a family computer — possible when
    // a second open tab re-persisted after sign-out cleared the keys), never
    // let it reach this account. Clearing localStorage is NOT enough: the
    // module-level zustand store already hydrated the foreign data into
    // memory, where any later save path (debounce, forceSync, the unmount
    // beacon, or a remount after client-side navigation) could upload it.
    // A hard reload is the only thing that destroys that in-memory state;
    // after it, stores hydrate to defaults, the marker matches, and the
    // normal path adopts server state. Fail-closed by construction — even
    // if the server is down post-reload, defaults are all that's left to
    // upload. foreignDataRef locks every save path on THIS instance in the
    // window before the reload lands (and in any context that blocks it).
    const userId = session?.user?.id;
    if (userId) {
      const owner = localStorage.getItem(PROGRESS_OWNER_KEY);
      if (owner && owner !== userId) {
        foreignDataRef.current = true;
        foreignPurgePending = true;
        clearGameStorage();
        localStorage.setItem(PROGRESS_OWNER_KEY, userId);
        // The persist middleware can re-write the foreign blob from memory
        // BEFORE the reload's navigation commits (cookie-clicker's ticker
        // writes 20x/s). pagehide fires when the navigation commits, after
        // the document's last timer — so this makes the clear the final
        // write and the reload always boots from clean disk.
        window.addEventListener("pagehide", () => clearGameStorage(), {
          once: true,
        });
        // bfcache escape: if a competing navigation preempts the reload and
        // this document is later restored frozen, reload it then too.
        window.addEventListener(
          "pageshow",
          (e) => {
            if ((e as PageTransitionEvent).persisted) {
              window.location.reload();
            }
          },
          { once: true }
        );
        window.location.reload();
        return;
      }
      localStorage.setItem(PROGRESS_OWNER_KEY, userId);
    }

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
    const localState = await waitForHydration();

    // Fetch server state
    const serverResult = await fetchFromServer();

    if (!serverResult) {
      // Server fetch failed - DON'T set the flag; try again soon.
      setSyncStatus("error");
      scheduleRetry();
      return;
    }

    const serverData = serverResult.data as T | null;
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
     * progress while the sync ran (the sync judged `judged`), the records of
     * that change stay: a new high score, an unlock (foldProgress). They
     * fold into `data`, and the next save sends them. Without this, a
     * record set while the first GET was in flight was gone, and never
     * reached the account.
     */
    const take = (data: T, judged: string, account: T) => {
      const during = getStateRef.current();
      let next = data;
      if (JSON.stringify(during) !== judged && !untouchedTime(during)) {
        const kept = foldProgress(appId, data, during as AppProgressData);
        if (!sameProgress(kept, data)) {
          next = { ...kept, [timeKey]: Math.max(timeOf(data), timeOf(during)) } as T;
        }
      }
      setStateRef.current(next);
      const now = getStateRef.current();
      lastSavedRef.current = sameProgress(now, account) ? JSON.stringify(now) : JSON.stringify(account);
    };
    /** The first sync is done: this device's progress is the account's (or builds on it). */
    const synced = (source: "local" | "server") => {
      writeLineage();
      markSynced();
      setSyncStatus("synced");
      onSyncCompleteRef.current?.(source);
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
      markSynced();
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
      const result = await saveToServer(sent, false);
      if (!result.ok) {
        saveFailed(result);
        return;
      }
      lastSavedRef.current = JSON.stringify(sent);
      synced("local");
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
      const result = await saveToServer(sent, false);
      if (!result.ok) {
        saveFailed(result);
        return;
      }
      take(sent, JSON.stringify(current), sent);
      synced("local");
      return;
    }

    // The device's progress was built on the defaults, not on this account's
    // progress: a guest's play (on a blank device, or saved after a
    // sign-out), or play on a blank device while the first sync failed. Its
    // time is newer than the account's only because it is a new copy: the
    // server's last write would make it the base, and the account would keep
    // only its counters and unlocks. So the account's progress stays the
    // base, and the device's records and the items that the player made fold
    // in (foldGuestProgress). Its non-record fields (a wallet, a journey)
    // were built on nothing that the account holds.
    if (builtOnDefaults(userId)) {
      const current = getStateRef.current();
      const judged = JSON.stringify(current);
      const folded = foldGuestProgress(appId, serverData, current as AppProgressData);
      if (sameProgress(folded, serverData)) {
        take(serverData, judged, serverData);
        synced("server");
        return;
      }
      const sent = { ...folded, [timeKey]: Math.max(timeOf(serverData) + 1, timeOf(current)) } as T;
      const result = await saveToServer(sent, true);
      if (!result.ok) {
        if (retryable(result)) {
          scheduleRetry();
          return;
        }
        // The server refuses the fold: the account's own progress stays,
        // and the device takes it (its copy must not replace the account's
        // with the next save).
        console.warn(
          `useAuthSync: the server refused the progress of ${appId} (${result.status}); this device takes the account's progress.`
        );
        take(serverData, judged, serverData);
        synced("server");
        return;
      }
      take(sent, judged, sent);
      synced("server");
      return;
    }

    // Both exist - upload local with merge flag; the server reconciles by
    // the blobs' own lastModified with field-aware merging.
    const result = await saveToServer(localState, true);
    if (!result.ok) {
      saveFailed(result);
      return;
    }
    // Re-fetch to get merged result
    const merged = await fetchFromServer();
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
    // stay (take).
    const accountTs = timeOf(serverData);
    const mergedTs = extractTimestamp(merged.data as AppProgressData);
    const stale = mergedTs !== null && localTs !== null && mergedTs < localTs;
    const changedDuringSync = JSON.stringify(getStateRef.current()) !== localJson;
    // The account added nothing to what this device sent (the device's save
    // is the account's progress): a change during the sync builds on it.
    const nothingNew = sameProgress(merged.data, localState);
    if (stale || (changedDuringSync && (nothingNew || (localTs ?? 0) > accountTs))) {
      lastSavedRef.current = localJson;
    } else {
      take(merged.data as T, localJson, merged.data as T);
    }
    synced("server");
  }, [
    appId,
    waitForHydration,
    fetchFromServer,
    saveToServer,
    scheduleRetry,
    markSynced,
    builtOnDefaults,
    writeLineage,
    session?.user?.id,
  ]);

  /** One initial sync at a time (a retry or a second effect run waits its turn). */
  const performInitialSync = useCallback(async () => {
    if (initialSyncDoneRef.current || foreignPurgePending || syncInFlightRef.current) return;
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
      if (
        !isAuthenticated ||
        !initialSyncDoneRef.current ||
        foreignDataRef.current ||
        foreignPurgePending
      )
        return;

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
        if (foreignDataRef.current || foreignPurgePending) return;
        const latest = getStateRef.current();
        const latestStr = JSON.stringify(latest);
        if (!uploadable(appId, latest) || latestStr === lastSavedRef.current) return;
        lastSavedRef.current = latestStr;
        // merge:true — the server folds this into any concurrent write from
        // another tab/device instead of blind-overwriting it.
        await saveToServer(latest, true);
      }, debounceMs);
    },
    [appId, isAuthenticated, debounceMs, saveToServer]
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

    // Clear pending debounce
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const data = getStateRef.current();
    if (!uploadable(appId, data)) return;
    lastSavedRef.current = JSON.stringify(data);
    await saveToServer(data, true);
  }, [appId, isAuthenticated, saveToServer]);

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

    if (isAuthenticated && !initialSyncDoneRef.current) {
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
  }, [isAuthenticated, status, performInitialSync, retryTick]);

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
      if (foreignDataRef.current || foreignPurgePending) return;
      const state = getStateRef.current();
      const stateStr = JSON.stringify(state);
      if (stateStr === lastReported) return;
      lastReported = stateStr;
      reportProgressToAchievements(appId, state as Record<string, unknown>);
    }, 1000);

    return () => clearInterval(interval);
  }, [appId]);

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
      if (
        !isAuthenticated ||
        !initialSyncDoneRef.current ||
        foreignDataRef.current
      )
        return;

      const data = getStateRef.current();
      const dataStr = JSON.stringify(data);
      if (!uploadable(appId, data) || dataStr === lastSavedRef.current) return; // nothing unsaved

      // merge:true so this best-effort write can never blind-overwrite a
      // newer save that raced it.
      const payload = JSON.stringify({ data, merge: true });

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
      if (
        isAuthenticated &&
        initialSyncDoneRef.current &&
        !foreignDataRef.current &&
        !foreignPurgePending
      ) {
        const data = getStateRef.current();
        const dataStr = JSON.stringify(data);
        if (uploadable(appId, data) && dataStr !== lastSavedRef.current) {
          lastSavedRef.current = dataStr;
          // merge:true — same race protection as the unload beacon.
          const payload = JSON.stringify({ data, merge: true });
          // Must use Blob with Content-Type or API's request.json() fails
          const blob = new Blob([payload], { type: "application/json" });
          navigator.sendBeacon(`/api/progress/${appId}`, blob);
        }
      }
    };
  }, [appId, isAuthenticated]);

  return {
    isAuthenticated,
    isGuest,
    syncStatus: isLoading ? "syncing" : syncStatus,
    lastSynced,
    forceSync,
    ready: !isLoading && (!isAuthenticated || syncedUserId === session?.user?.id || offline),
    synced: isAuthenticated && syncedUserId === session?.user?.id,
  };
}

export default useAuthSync;
