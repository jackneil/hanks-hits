"use client";

import { useEffect, useRef, useCallback, useState } from "react";
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
  isMarkedSave,
  isRecord,
  isUntouchedProgress,
  listItemKeys,
  newListItems,
  progressFromSave,
  progressTimeKey,
  type ListItemKeys,
} from "@/shared/lib/untouchedProgress";
import {
  PROGRESS_OWNER_KEY,
  SIGNOUT_BROADCAST_KEY,
  clearGameStorage,
  isClearedOnSignOut,
} from "@/lib/storage-keys";

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

/** Adds the item keys of `keys` to `into` (a union per list). */
function addKeys(into: Map<string, Set<string>>, keys: ListItemKeys): void {
  for (const [field, set] of keys) {
    const known = into.get(field);
    if (known) for (const key of set) known.add(key);
    else into.set(field, new Set(set));
  }
}

/** localStorage.getItem, or null when the storage is blocked. */
function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

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
  // The account whose progress the page loaded (the owner key at the first
  // render), and the mark of the last sign-out at that time. Another tab can
  // change both while this page holds the loaded progress in memory.
  const ownerAtLoadRef = useRef<string | null | undefined>(undefined);
  const signOutMarkRef = useRef<string | null>(null);
  // The keys of the list items that this page shares with the account or
  // another tab (its save at load, its uploads, the progress that it took),
  // per list. An item that is not here and that newer progress does not
  // hold is an item that the player made on this page and did not save yet.
  const knownItemsRef = useRef<Map<string, Set<string>> | null>(null);
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
  if (ownerAtLoadRef.current === undefined && typeof window !== "undefined") {
    ownerAtLoadRef.current = readKey(PROGRESS_OWNER_KEY);
    signOutMarkRef.current = readKey(SIGNOUT_BROADCAST_KEY);
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

  /**
   * True when a save may leave the page: the first sync is done for the
   * session's account, and no other account took the page or the device.
   */
  const ownerMaySave = useCallback(
    () =>
      !foreignDataRef.current &&
      !foreignPurgePending &&
      syncedUserIdRef.current !== null &&
      syncedUserIdRef.current === sessionUserIdRef.current,
    []
  );

  /**
   * The progress in memory belongs to another account than `userId`: lock
   * every save, remove the saves on this device, claim the device for
   * `userId`, and reload. A hard reload is the only thing that removes the
   * progress that the stores hold in memory (see runInitialSync).
   */
  const enterForeignOwner = useCallback((userId: string) => {
    foreignDataRef.current = true;
    foreignPurgePending = true;
    try {
      clearGameStorage();
      localStorage.setItem(PROGRESS_OWNER_KEY, userId);
    } catch {
      // Blocked storage: nothing is saved on this device.
    }
    // The persist middleware can re-write the foreign blob from memory
    // BEFORE the reload's navigation commits (cookie-clicker's ticker
    // writes 20x/s). pagehide fires when the navigation commits, after
    // the document's last timer — so this makes the clear the final
    // write and the reload always boots from clean disk.
    window.addEventListener(
      "pagehide",
      () => {
        try {
          clearGameStorage();
        } catch {
          // Blocked storage.
        }
      },
      { once: true }
    );
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
  }, []);

  /**
   * Another tab changed the device under this page (a sign-out, or the
   * claim of the device for another account): the progress in memory is
   * stale. Lock every save and reload. The other tab already handled the
   * saves on disk, so this page puts back the save of this key as the other
   * tab left it, as the last write before the reload (the persist
   * middleware can write the old progress from memory first).
   */
  const leaveStalePage = useCallback(() => {
    if (foreignDataRef.current) return;
    foreignDataRef.current = true;
    foreignPurgePending = true;
    const left = readKey(localStorageKey);
    window.addEventListener(
      "pagehide",
      () => {
        try {
          if (left === null) localStorage.removeItem(localStorageKey);
          else localStorage.setItem(localStorageKey, left);
        } catch {
          // Blocked storage.
        }
      },
      { once: true }
    );
    window.location.reload();
  }, [localStorageKey]);

  /**
   * True when another tab changed the device since this page loaded or
   * synced its progress: a sign-out (the broadcast mark), or a new owner
   * of the device (the owner key).
   */
  const deviceChangedUnderPage = useCallback(() => {
    if (readKey(SIGNOUT_BROADCAST_KEY) !== signOutMarkRef.current) return true;
    const expected = syncedUserIdRef.current ?? ownerAtLoadRef.current ?? null;
    return expected !== null && readKey(PROGRESS_OWNER_KEY) !== expected;
  }, []);

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
        window.location.reload();
        return;
      }
      if (e.key === PROGRESS_OWNER_KEY) {
        // Another tab claimed the device for another account (its first
        // sync found progress of a different owner).
        if (deviceChangedUnderPage()) leaveStalePage();
        return;
      }
      if (e.key !== localStorageKey) return;
      takeNewer(e.newValue);
    };
    // A page from the back-forward cache missed the storage events of the
    // time it was away: a sign-out or a new owner reloads it; else it reads
    // the save again.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      if (deviceChangedUnderPage()) {
        leaveStalePage();
        return;
      }
      takeNewer(readKey(localStorageKey));
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [appId, localStorageKey, noteKnown, deviceChangedUnderPage, leaveStalePage]);

  // The session's account changed on this mounted page (another tab signed
  // in as another kid; the login page does not sign out first). The
  // progress in memory is the first account's: it must never reach the new
  // one.
  const sessionUserId = session?.user?.id;
  useEffect(() => {
    const synced = syncedUserIdRef.current ?? initialSyncUserIdRef.current;
    if (!sessionUserId || synced === null || sessionUserId === synced) return;
    if (foreignDataRef.current || foreignPurgePending) return;
    enterForeignOwner(sessionUserId);
  }, [sessionUserId, enterForeignOwner]);

  /**
   * Fetch progress from server
   */
  const fetchFromServer = useCallback(async (): Promise<ProgressRead<T> | null> => {
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
      if (continuationRef.current?.active) {
        setSyncStatus("syncing");
        const result = await continuationRef.current.save(data);
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
    //
    // The owner at the page's first render counts too: another tab can claim
    // the device for this account (and remove the saves on disk) while this
    // page holds the previous account's progress in memory.
    const userId = session?.user?.id;
    if (!userId) return;
    initialSyncUserIdRef.current = userId;
    const owner = localStorage.getItem(PROGRESS_OWNER_KEY);
    const ownerAtLoad = ownerAtLoadRef.current ?? null;
    if ((owner && owner !== userId) || (ownerAtLoad !== null && ownerAtLoad !== userId)) {
      enterForeignOwner(userId);
      return;
    }
    localStorage.setItem(PROGRESS_OWNER_KEY, userId);
    // The session changed while this sync waited (another tab signed in as
    // another account): stop. The session effect locks the page.
    const sessionMoved = () => foreignDataRef.current || foreignPurgePending || sessionUserIdRef.current !== userId;

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
    enterForeignOwner,
    deviceChangedUnderPage,
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
          const payload = JSON.stringify({ data, merge: true });
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
    ready: !isLoading && (!isAuthenticated || syncedUserId === session?.user?.id || offline),
    synced: isAuthenticated && syncedUserId === session?.user?.id,
  };
}

export default useAuthSync;
