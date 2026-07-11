import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GAME_STORAGE_KEYS,
  PROGRESS_OWNER_KEY,
} from "@/lib/storage-keys";

// Authenticated session for "user B" — the kid signing in after someone else
// used the device.
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-B" } },
    status: "authenticated",
  }),
}));

import { useAuthSync } from "../useAuthSync";

type FakeProgress = { highScore: number; lastModified: number };

describe("useAuthSync shared-device owner guard", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
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

  it("never uploads a previous user's local progress (owner mismatch)", async () => {
    // User A's leftovers: owner marker + a stale game blob.
    localStorage.setItem(PROGRESS_OWNER_KEY, "user-A");
    localStorage.setItem(
      "snake-game-state",
      JSON.stringify({
        state: { progress: { highScore: 9999, lastModified: 123 } },
      })
    );

    const foreignState: FakeProgress = { highScore: 9999, lastModified: 123 };
    renderHook(() =>
      useAuthSync<FakeProgress>({
        appId: "snake",
        localStorageKey: "snake-game-state",
        getState: () => foreignState,
        setState: () => {},
        debounceMs: 50,
      })
    );

    // The guard resolves before any upload can happen.
    await waitFor(() => {
      expect(localStorage.getItem(PROGRESS_OWNER_KEY)).toBe("user-B");
    });

    // No POST of user A's blob — only GETs are allowed to have happened.
    const posts = fetchSpy.mock.calls.filter(
      ([, init]) => init && (init as RequestInit).method === "POST"
    );
    expect(posts).toEqual([]);

    // Every game storage key was dropped, including A's stale blob.
    expect(localStorage.getItem("snake-game-state")).toBeNull();
    for (const key of GAME_STORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
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
