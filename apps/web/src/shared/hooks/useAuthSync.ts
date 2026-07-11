"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import type { ValidAppId, AppProgressData } from "@hank-neil/db/schema";
import { extractTimestamp } from "@/lib/progress-merge";
import {
  PROGRESS_OWNER_KEY,
  SIGNOUT_BROADCAST_KEY,
  clearGameStorage,
  isClearedOnSignOut,
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

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>("");
  const pendingSaveRef = useRef<string>("");
  const initialSyncDoneRef = useRef(false);
  // Set when the local/in-memory state belongs to a DIFFERENT user (shared
  // device). Locks every upload path until the pending hard reload lands.
  const foreignDataRef = useRef(false);

  // Store getState/setState in refs to avoid callback instability
  // (These are inline arrow functions that change every render)
  const getStateRef = useRef(getState);
  const setStateRef = useRef(setState);

  useEffect(() => {
    getStateRef.current = getState;
    setStateRef.current = setState;
  }, [getState, setState]);

  // Another tab signing out clears localStorage, but THIS tab's in-memory
  // store would re-persist it within seconds. Reload on the broadcast so the
  // previous user's progress can't survive into the next login.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SIGNOUT_BROADCAST_KEY) {
        window.location.reload();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
    async (data: T, merge = false): Promise<boolean> => {
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
          console.error("Failed to save progress:", res.status);
          setSyncStatus("error");
          return false;
        }

        const result = await res.json();
        setSyncStatus("synced");
        setLastSynced(new Date(result.updatedAt));
        return true;
      } catch (error) {
        console.error("Save progress error:", error);
        setSyncStatus("error");
        return false;
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

    // Parse localStorage to get the persisted state we expect after hydration.
    // Zustand persist stores data under "state"; games partialize to
    // { progress } while getState() returns the progress object itself.
    let expectedStr: string | null = null;
    try {
      const parsed = JSON.parse(stored);
      const persisted = parsed?.state ?? parsed;
      const expected = persisted?.progress ?? persisted;
      expectedStr = JSON.stringify(expected);
    } catch {
      // If parse fails, just return current state
      return getStateRef.current();
    }

    // Wait until the store's state actually EQUALS the persisted snapshot.
    // (The old heuristic returned as soon as lastModified was defined — which
    // the pre-hydration DEFAULT state satisfies, so default zeros could be
    // uploaded as if they were the player's progress.)
    const maxWait = 500;
    const checkInterval = 25;
    let waited = 0;

    while (waited < maxWait) {
      const state = getStateRef.current();
      if (JSON.stringify(state) === expectedStr) {
        return state;
      }
      await new Promise((r) => setTimeout(r, checkInterval));
      waited += checkInterval;
    }

    // Return whatever we have after waiting
    return getStateRef.current();
  }, [localStorageKey]);

  /**
   * Initial sync on login - merge localStorage with server
   */
  const performInitialSync = useCallback(async () => {
    if (initialSyncDoneRef.current || foreignPurgePending) return;

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
        window.location.reload();
        return;
      }
      localStorage.setItem(PROGRESS_OWNER_KEY, userId);
    }

    // Wait for Zustand to hydrate from localStorage first
    const localState = await waitForHydration();

    // Fetch server state
    const serverResult = await fetchFromServer();

    if (!serverResult) {
      // Server fetch failed - DON'T set flag, allow retry on next auth change
      setSyncStatus("error");
      return;
    }

    const serverData = serverResult.data as T | null;

    // No server data - upload local
    if (!serverData) {
      if (localState && Object.keys(localState).length > 0) {
        const success = await saveToServer(localState, false);
        if (success) {
          initialSyncDoneRef.current = true;
          onSyncComplete?.("local");
        }
      } else {
        // No data anywhere, but sync is "done"
        initialSyncDoneRef.current = true;
        setSyncStatus("synced");
      }
      return;
    }

    // No local data - use server
    if (!localState || Object.keys(localState).length === 0) {
      setStateRef.current(serverData);
      setSyncStatus("synced");
      setLastSynced(
        serverResult.lastSyncedAt
          ? new Date(serverResult.lastSyncedAt)
          : new Date()
      );
      initialSyncDoneRef.current = true;
      onSyncComplete?.("server");
      return;
    }

    // Both exist - upload local with merge flag; the server reconciles by
    // the blobs' own lastModified with field-aware merging.
    const success = await saveToServer(localState, true);
    if (success) {
      // Re-fetch to get merged result
      const merged = await fetchFromServer();
      if (merged?.data) {
        // Adopt the server result ONLY if it is at least as new as what we
        // hold locally — never let a stale response overwrite live progress.
        const mergedTs = extractTimestamp(merged.data as AppProgressData);
        const localTs = extractTimestamp(localState as AppProgressData);
        if (mergedTs === null || localTs === null || mergedTs >= localTs) {
          setStateRef.current(merged.data as T);
        }
        initialSyncDoneRef.current = true;
        onSyncComplete?.("server");
      }
    }
  }, [
    waitForHydration,
    fetchFromServer,
    saveToServer,
    onSyncComplete,
    session?.user?.id,
  ]);

  /**
   * Debounced save - called on state changes
   */
  const debouncedSave = useCallback(
    (data: T) => {
      if (!isAuthenticated || foreignDataRef.current) return;

      const dataStr = JSON.stringify(data);

      // Nothing new since the last completed save: drop any stale pending
      // timer and stop.
      if (dataStr === lastSavedRef.current) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
          pendingSaveRef.current = "";
        }
        return;
      }

      // This exact payload is already scheduled: let the pending timer fire.
      // (Clearing-and-rearming here is the bug that kept the save perpetually
      // pending — the 1s poller re-entered before the 2s debounce elapsed.)
      if (dataStr === pendingSaveRef.current && saveTimeoutRef.current) return;

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      pendingSaveRef.current = dataStr;
      saveTimeoutRef.current = setTimeout(async () => {
        saveTimeoutRef.current = null;
        pendingSaveRef.current = "";
        lastSavedRef.current = dataStr;
        // merge:true — the server folds this into any concurrent write from
        // another tab/device instead of blind-overwriting it.
        await saveToServer(data, true);
      }, debounceMs);
    },
    [isAuthenticated, debounceMs, saveToServer]
  );

  /**
   * Force immediate sync
   */
  const forceSync = useCallback(async () => {
    if (!isAuthenticated || foreignDataRef.current) return;

    // Clear pending debounce
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
      pendingSaveRef.current = "";
    }

    const data = getStateRef.current();
    lastSavedRef.current = JSON.stringify(data);
    await saveToServer(data, true);
  }, [isAuthenticated, saveToServer]);

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
  }, [isAuthenticated, status, performInitialSync]);

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
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
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
      if (dataStr === lastSavedRef.current) return; // nothing unsaved

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

      // Also flush pending save on component unmount
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        pendingSaveRef.current = "";

        // Flush only after initial sync — a StrictMode unmount fires this
        // with DEFAULT state before hydration, which must never be saved.
        // Foreign (previous-user) state must never flush either.
        if (
          isAuthenticated &&
          initialSyncDoneRef.current &&
          !foreignDataRef.current
        ) {
          const data = getStateRef.current();
          const dataStr = JSON.stringify(data);
          if (dataStr !== lastSavedRef.current) {
            // merge:true — same race protection as the unload beacon.
            const payload = JSON.stringify({ data, merge: true });
            // Must use Blob with Content-Type or API's request.json() fails
            const blob = new Blob([payload], { type: "application/json" });
            navigator.sendBeacon(`/api/progress/${appId}`, blob);
          }
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
  };
}

export default useAuthSync;
