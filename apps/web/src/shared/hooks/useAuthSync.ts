"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import type { ValidAppId, AppProgressData } from "@hank-neil/db/schema";

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
  const { data: session, status } = useSession();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  const isAuthenticated = status === "authenticated" && !!session?.user?.id;
  const isGuest = status === "unauthenticated";
  const isLoading = status === "loading";

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>("");
  const initialSyncDoneRef = useRef(false);

  // Store getState/setState in refs to avoid callback instability
  // (These are inline arrow functions that change every render)
  const getStateRef = useRef(getState);
  const setStateRef = useRef(setState);

  useEffect(() => {
    getStateRef.current = getState;
    setStateRef.current = setState;
  }, [getState, setState]);

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

    // Parse localStorage to get expected state
    let expectedState: T | null = null;
    try {
      const parsed = JSON.parse(stored);
      // Zustand persist stores data under "state" key
      expectedState = parsed.state || parsed;
    } catch {
      // If parse fails, just return current state
      return getStateRef.current();
    }

    // Wait for Zustand to hydrate by comparing current state to localStorage
    // Give it up to 500ms (typically happens in <50ms)
    const maxWait = 500;
    const checkInterval = 25;
    let waited = 0;

    while (waited < maxWait) {
      const state = getStateRef.current();

      // Check for indicators of real gameplay data (not defaults)
      // These fields are common across most games and only increase with play
      const hasPlayData =
        (state as Record<string, unknown>).gamesPlayed !== undefined &&
        (state as Record<string, unknown>).gamesPlayed !== 0;
      const hasHighScore =
        (state as Record<string, unknown>).highScore !== undefined &&
        (state as Record<string, unknown>).highScore !== 0;
      const hasLastModified =
        (state as Record<string, unknown>).lastModified !== undefined;

      // If state has any gameplay indicators, we're hydrated
      if (hasPlayData || hasHighScore || hasLastModified) {
        return state;
      }

      // Also check if current state matches what's in localStorage (hydration complete)
      if (expectedState) {
        const expectedGamesPlayed = (expectedState as Record<string, unknown>)
          .gamesPlayed;
        const currentGamesPlayed = (state as Record<string, unknown>)
          .gamesPlayed;
        if (
          expectedGamesPlayed !== undefined &&
          expectedGamesPlayed === currentGamesPlayed
        ) {
          return state;
        }
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
    if (initialSyncDoneRef.current) return;

    setSyncStatus("syncing");

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

    // Both exist - merge (server takes precedence for now)
    // This saves local to server with merge flag
    const success = await saveToServer(localState, true);
    if (success) {
      // Re-fetch to get merged result
      const merged = await fetchFromServer();
      if (merged?.data) {
        setStateRef.current(merged.data as T);
        initialSyncDoneRef.current = true;
        onSyncComplete?.("server");
      }
    }
  }, [waitForHydration, fetchFromServer, saveToServer, onSyncComplete]);

  /**
   * Debounced save - called on state changes
   */
  const debouncedSave = useCallback(
    (data: T) => {
      if (!isAuthenticated) return;

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Check if data actually changed
      const dataStr = JSON.stringify(data);
      if (dataStr === lastSavedRef.current) return;

      // Schedule save
      saveTimeoutRef.current = setTimeout(async () => {
        lastSavedRef.current = dataStr;
        await saveToServer(data, false);
      }, debounceMs);
    },
    [isAuthenticated, debounceMs, saveToServer]
  );

  /**
   * Force immediate sync
   */
  const forceSync = useCallback(async () => {
    if (!isAuthenticated) return;

    // Clear pending debounce
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const data = getStateRef.current();
    lastSavedRef.current = JSON.stringify(data);
    await saveToServer(data, false);
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
      if (!isAuthenticated || !saveTimeoutRef.current) return;

      // Use sendBeacon for reliable save on page unload
      const data = getStateRef.current();
      const payload = JSON.stringify({
        data,
        merge: false,
      });

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

        // Try to save synchronously if we have pending changes
        if (isAuthenticated) {
          const data = getStateRef.current();
          const dataStr = JSON.stringify(data);
          if (dataStr !== lastSavedRef.current) {
            // Use sendBeacon as it's more reliable for cleanup
            const payload = JSON.stringify({
              data,
              merge: false,
            });
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
