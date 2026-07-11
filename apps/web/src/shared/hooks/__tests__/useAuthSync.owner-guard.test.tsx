import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GAME_STORAGE_KEYS,
  PROGRESS_OWNER_KEY,
  SIGNOUT_BROADCAST_KEY,
} from "@/lib/storage-keys";

// Authenticated session for "user B" — the kid signing in after someone else
// used the device.
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-B" } },
    status: "authenticated",
  }),
}));

import {
  useAuthSync,
  __unsafeResetForeignPurgeLockForTests,
} from "../useAuthSync";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type FakeProgress = { highScore: number; lastModified: number };

describe("useAuthSync shared-device owner guard", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let beaconSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    beaconSpy = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      writable: true,
      configurable: true,
      value: beaconSpy,
    });
    fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method === undefined || init.method === "GET") {
        return {
          ok: true,
          json: async () => ({ data: null, lastSyncedAt: null }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ success: true }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    // jsdom never actually reloads, so release the module-level purge lock
    // the mismatch tests set (in a browser the reload clears it naturally).
    __unsafeResetForeignPurgeLockForTests();
  });

  it("throws in dev/test when the key is not covered by signOutAndClear", () => {
    expect(() =>
      renderHook(() =>
        useAuthSync<FakeProgress>({
          appId: "snake",
          localStorageKey: "totally-uncovered-key",
          getState: () => ({ highScore: 0, lastModified: 0 }),
          setState: () => {},
        })
      )
    ).toThrow(/not covered by\s+signOutAndClear/);
  });

  it("never uploads a previous user's local progress (owner mismatch): clears, claims, reloads, and locks every upload path", async () => {
    // User A's leftovers: owner marker + a stale game blob. The in-memory
    // zustand store has already hydrated A's data, so clearing disk alone
    // is not enough — the guard must hard-reload and lock uploads until
    // the reload lands.
    localStorage.setItem(PROGRESS_OWNER_KEY, "user-A");
    localStorage.setItem(
      "snake-game-state",
      JSON.stringify({
        state: { progress: { highScore: 9999, lastModified: 123 } },
      })
    );

    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    // shouldAdvanceTime keeps waitFor's real-time polling alive while
    // letting us jump the hook's 1s auto-save poller deterministically.
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      // Mutable so we can simulate the kid playing a move (trigger #1).
      let foreignState: FakeProgress = { highScore: 9999, lastModified: 123 };
      const { result, unmount } = renderHook(() =>
        useAuthSync<FakeProgress>({
          appId: "snake",
          localStorageKey: "snake-game-state",
          getState: () => foreignState,
          setState: () => {},
          debounceMs: 10,
        })
      );

      // The guard claims the marker and schedules the reload.
      await waitFor(() => {
        expect(localStorage.getItem(PROGRESS_OWNER_KEY)).toBe("user-B");
      });
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      // Every game storage key was dropped, including A's stale blob.
      expect(localStorage.getItem("snake-game-state")).toBeNull();
      for (const key of GAME_STORAGE_KEYS) {
        expect(localStorage.getItem(key)).toBeNull();
      }

      // Even if the reload were blocked, the instance is locked: mutate the
      // state, then fire the 1s auto-save poller AND the debounce window so
      // debouncedSave really runs against the foreignDataRef gate...
      foreignState = { highScore: 10000, lastModified: 999 };
      await vi.advanceTimersByTimeAsync(1100);
      await vi.advanceTimersByTimeAsync(50);
      // ...and forceSync (the game-over flush every game calls) is a no-op.
      await result.current.forceSync();

      const posts = fetchSpy.mock.calls.filter(
        ([, init]) => init && (init as RequestInit).method === "POST"
      );
      expect(posts).toEqual([]);

      // The beacon channels (beforeunload + unmount flush) stay silent too.
      // (Double-gated: initialSyncDone never completes in the mismatch branch
      // AND the foreignData lock covers them — this asserts the outcome.)
      window.dispatchEvent(new Event("beforeunload"));
      unmount();
      expect(beaconSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      Object.defineProperty(window, "location", {
        writable: true,
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("clears a persist write-back on pagehide (the reload-window race)", async () => {
    // The real threat: zustand's persist middleware re-writes the foreign
    // blob from memory AFTER clearGameStorage() but BEFORE the reload's
    // navigation commits (cookie-clicker ticks 20x/s). The guard's pagehide
    // listener must make the clear the FINAL write.
    localStorage.setItem(PROGRESS_OWNER_KEY, "user-A");
    localStorage.setItem(
      "snake-game-state",
      JSON.stringify({
        state: { progress: { highScore: 9999, lastModified: 123 } },
      })
    );

    // A real persist-backed store on a covered key, hydrated with A's data.
    const useTestStore = create<{ progress: FakeProgress }>()(
      persist(() => ({ progress: { highScore: 9999, lastModified: 123 } }), {
        name: "snake-game-state",
        partialize: (s) => ({ progress: s.progress }),
      })
    );

    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    try {
      renderHook(() =>
        useAuthSync<FakeProgress>({
          appId: "snake",
          localStorageKey: "snake-game-state",
          getState: () => useTestStore.getState().progress,
          setState: () => {},
        })
      );

      await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
      expect(localStorage.getItem("snake-game-state")).toBeNull();

      // A ticking store writes the foreign blob straight back to disk —
      // this is the race the reload alone cannot win.
      useTestStore.setState({
        progress: { highScore: 9999, lastModified: 124 },
      });
      expect(localStorage.getItem("snake-game-state")).not.toBeNull();

      // pagehide (the navigation committing) makes the clear the final word.
      window.dispatchEvent(new Event("pagehide"));
      expect(localStorage.getItem("snake-game-state")).toBeNull();
    } finally {
      Object.defineProperty(window, "location", {
        writable: true,
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("reloads this tab when another tab broadcasts a sign-out", async () => {
    // Layer-1 defense: a second open tab must reload on sign-out so its
    // in-memory store can't re-persist the just-cleared keys.
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });
    try {
      renderHook(() =>
        useAuthSync<FakeProgress>({
          appId: "snake",
          localStorageKey: "snake-game-state",
          getState: () => ({ highScore: 0, lastModified: 0 }),
          setState: () => {},
        })
      );

      // Unrelated storage events must NOT reload.
      window.dispatchEvent(
        new StorageEvent("storage", { key: "some-other-key" })
      );
      expect(reloadSpy).not.toHaveBeenCalled();

      // The sign-out broadcast key does.
      window.dispatchEvent(
        new StorageEvent("storage", { key: SIGNOUT_BROADCAST_KEY })
      );
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", {
        writable: true,
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("uploads (not drops) existing progress on the first login after deploy (no marker yet)", async () => {
    // Deploy-day migration contract: devices with real progress but no
    // owner marker belong to the signing-in user — claim, don't clear.
    const existing: FakeProgress = { highScore: 4242, lastModified: 456 };
    localStorage.setItem(
      "snake-game-state",
      JSON.stringify({ state: { progress: existing } })
    );

    renderHook(() =>
      useAuthSync<FakeProgress>({
        appId: "snake",
        localStorageKey: "snake-game-state",
        getState: () => existing,
        setState: () => {},
      })
    );

    await waitFor(() => {
      const posts = fetchSpy.mock.calls.filter(
        ([, init]) => init && (init as RequestInit).method === "POST"
      );
      expect(posts.length).toBeGreaterThan(0);
      expect(String(posts[0][1]?.body)).toContain('"highScore":4242');
    });

    expect(localStorage.getItem(PROGRESS_OWNER_KEY)).toBe("user-B");
    expect(localStorage.getItem("snake-game-state")).not.toBeNull();
  });

  it("claims ownership for the signing-in user when no marker exists", async () => {
    renderHook(() =>
      useAuthSync<FakeProgress>({
        appId: "snake",
        localStorageKey: "snake-game-state",
        getState: () => ({ highScore: 0, lastModified: 0 }),
        setState: () => {},
      })
    );

    await waitFor(() => {
      expect(localStorage.getItem(PROGRESS_OWNER_KEY)).toBe("user-B");
    });
  });
});
