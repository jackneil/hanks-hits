import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuthSync } from "../useAuthSync";
import { PROGRESS_OWNER_KEY } from "@/lib/storage-keys";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-1" } },
    status: "authenticated",
  }),
}));

type TestProgress = { score: number; highScore: number; lastModified: number };

const APP_ID = "cookie-clicker" as never;
const LS_KEY = "cookie-clicker-storage";

function fetchResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("useAuthSync — audit save/wipe regressions", () => {
  let state: TestProgress;
  const getState = () => state;
  const setState = (d: TestProgress) => {
    state = d;
  };
  let fetchMock: ReturnType<typeof vi.fn>;
  let beaconMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    state = { score: 0, highScore: 0, lastModified: 100 };
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    beaconMock = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beaconMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("auto-save actually fires ~3s after a state change (debounce not perpetually cleared)", async () => {
    // Initial sync: no server data -> uploads local once.
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST") return fetchResponse({ data: null, lastSyncedAt: null });
      return fetchResponse({ success: true, updatedAt: new Date().toISOString() });
    });

    renderHook(() =>
      useAuthSync<TestProgress>({
        appId: APP_ID,
        localStorageKey: LS_KEY,
        getState,
        setState,
      })
    );

    // Let initial sync complete.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const postsAfterInitial = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit)?.method === "POST"
    ).length;

    // Play: the state changes once.
    state = { score: 10, highScore: 10, lastModified: 200 };

    // The 1s poller runs several times while the 2s debounce is pending —
    // the audit bug was that each poll cleared the pending save forever.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3200);
    });

    const savePosts = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit)?.method === "POST"
    );
    expect(savePosts.length).toBe(postsAfterInitial + 1);
    const lastBody = JSON.parse(savePosts[savePosts.length - 1][1].body as string);
    expect(lastBody.data.score).toBe(10);
    expect(lastBody.merge).toBe(true);
  });

  it("never beacons before the initial sync completes (StrictMode/pre-hydration zero-beacon)", async () => {
    // GET never resolves: initial sync stays incomplete.
    fetchMock.mockImplementation(() => new Promise(() => {}));

    renderHook(() =>
      useAuthSync<TestProgress>({
        appId: APP_ID,
        localStorageKey: LS_KEY,
        getState,
        setState,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    window.dispatchEvent(new Event("beforeunload"));
    expect(beaconMock).not.toHaveBeenCalled();
  });

  it("beacons unsaved progress with merge:true after sync is done", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST") return fetchResponse({ data: null, lastSyncedAt: null });
      return fetchResponse({ success: true, updatedAt: new Date().toISOString() });
    });

    renderHook(() =>
      useAuthSync<TestProgress>({
        appId: APP_ID,
        localStorageKey: LS_KEY,
        getState,
        setState,
      })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Dirty state that has NOT been saved yet (debounce not elapsed).
    state = { score: 42, highScore: 42, lastModified: 300 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000); // poller schedules, debounce pending
    });

    window.dispatchEvent(new Event("beforeunload"));
    expect(beaconMock).toHaveBeenCalledTimes(1);
    const blob = beaconMock.mock.calls[0][1] as Blob;
    vi.useRealTimers(); // FileReader completion events don't fire under fake timers
    const blobText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const payload = JSON.parse(blobText);
    expect(payload.merge).toBe(true);
    expect(payload.data.score).toBe(42);
  });

  it("does not adopt a stale server blob over newer local progress", async () => {
    // localStorage snapshot matches current state => hydration check passes.
    // The save is this account's progress (it synced on this device before).
    state = { score: 500, highScore: 500, lastModified: 2000 };
    localStorage.setItem(LS_KEY, JSON.stringify({ state: { progress: state } }));
    localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");

    const staleServer = { score: 1, highScore: 1, lastModified: 50 };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST")
        return fetchResponse({ data: staleServer, lastSyncedAt: null });
      return fetchResponse({ success: true, updatedAt: new Date().toISOString(), merged: true });
    });

    renderHook(() =>
      useAuthSync<TestProgress>({
        appId: APP_ID,
        localStorageKey: LS_KEY,
        getState,
        setState,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // The wipe: old code setState()d the re-fetched (stale) server blob.
    expect(state.score).toBe(500);
    expect(state.lastModified).toBe(2000);
  });

  const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "POST");

  it("a page with no save takes the account's progress and uploads nothing, even when its progress had a time before the first render", async () => {
    // No save for this key when the page loaded. The progress carries a
    // time from before the first render (a store that put the page-load
    // time into its defaults): it is newer than the account's save.
    const account = { score: 900, highScore: 900, lastModified: 1_000 };
    state = { score: 0, highScore: 0, lastModified: 5_000 };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST") return fetchResponse({ data: account, lastSyncedAt: null });
      return fetchResponse({ success: true, updatedAt: new Date().toISOString() });
    });

    renderHook(() => useAuthSync<TestProgress>({ appId: APP_ID, localStorageKey: LS_KEY, getState, setState }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(state).toEqual(account);
    // Nothing went up: the defaults never reached the account.
    expect(posts()).toEqual([]);
  });

  it("an untouched store (time 0) with a save on the device takes the account's progress and uploads nothing", async () => {
    state = { score: 0, highScore: 0, lastModified: 0 };
    localStorage.setItem(LS_KEY, JSON.stringify({ state: { progress: state } }));
    const account = { score: 900, highScore: 900, lastModified: 1_000 };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return fetchResponse({ success: true, updatedAt: new Date().toISOString() });
      return fetchResponse({ data: account, lastSyncedAt: null });
    });

    renderHook(() => useAuthSync<TestProgress>({ appId: APP_ID, localStorageKey: LS_KEY, getState, setState }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(state).toEqual(account);
    expect(posts()).toEqual([]);
  });

  it("saves nothing before the first sync is done, and tries the sync again when the server did not answer", async () => {
    state = { score: 10, highScore: 10, lastModified: 200 };
    localStorage.setItem(LS_KEY, JSON.stringify({ state: { progress: state } }));
    let gets = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return fetchResponse({ success: true, updatedAt: new Date().toISOString() });
      gets += 1;
      // The first two reads fail; the next ones work.
      return gets <= 2 ? fetchResponse({ error: "down" }, false) : fetchResponse({ data: null, lastSyncedAt: null });
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() =>
      useAuthSync<TestProgress>({ appId: APP_ID, localStorageKey: LS_KEY, getState, setState })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    // The sync failed: the poller and forceSync wait for it.
    await act(async () => {
      await result.current.forceSync();
    });
    expect(posts()).toEqual([]);
    expect(result.current.ready).toBe(false);
    expect(gets).toBe(1);

    // The retries wait 2 s, then 4 s. (React renders the retry at the end
    // of an act(), so each wait gets a short act() of its own after it.)
    const wait = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    };
    await wait(350); // 1.9 s after the first try
    expect(gets).toBe(1);
    await wait(300); // 2.3 s
    expect(gets).toBe(2);
    expect(posts()).toEqual([]);
    await wait(3_600); // 6.0 s: the second wait (4 s) is not over yet
    expect(gets).toBe(2);
    await wait(400);
    expect(gets).toBe(3);
    const sent = posts();
    expect(sent).toHaveLength(1);
    expect(JSON.parse((sent[0][1] as RequestInit).body as string).data.score).toBe(10);
    expect(result.current.ready).toBe(true);
    errors.mockRestore();
  });

  it("saves progress that changes every second (the debounce never starves)", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST") return fetchResponse({ data: null, lastSyncedAt: null });
      return fetchResponse({ success: true, updatedAt: new Date().toISOString() });
    });
    renderHook(() =>
      useAuthSync<TestProgress>({ appId: APP_ID, localStorageKey: LS_KEY, getState, setState, debounceMs: 5_000 })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // A bakery that bakes all the time: the progress changes every 500 ms.
    for (let i = 1; i <= 20; i++) {
      state = { score: i, highScore: i, lastModified: 1_000 + i };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    }

    // Before the fix, each poll set a new 5 s timer and nothing was sent.
    const sent = posts();
    expect(sent.length).toBeGreaterThanOrEqual(1);
    // A save sends the newest progress, not the one that started the timer.
    const last = JSON.parse((sent[sent.length - 1][1] as RequestInit).body as string);
    expect(last.data.score).toBeGreaterThan(5);
  });

  it("is ready for a guest at once, and for a signed-in player when the first sync is done", async () => {
    let answer: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      (url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? fetchResponse({ success: true, updatedAt: new Date().toISOString() })
          : new Promise<Response>((resolve) => {
              answer = resolve;
            })
    );
    const { result } = renderHook(() =>
      useAuthSync<TestProgress>({ appId: APP_ID, localStorageKey: LS_KEY, getState, setState })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.ready).toBe(false);
    await act(async () => {
      answer({ ok: true, status: 200, json: () => Promise.resolve({ data: null, lastSyncedAt: null }) } as Response);
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.ready).toBe(true);
  });

  it("sends a change on unmount that the 1 s poller had not seen yet", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST") return fetchResponse({ data: null, lastSyncedAt: null });
      return fetchResponse({ success: true, updatedAt: new Date().toISOString() });
    });
    const view = renderHook(() =>
      useAuthSync<TestProgress>({ appId: APP_ID, localStorageKey: LS_KEY, getState, setState })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    state = { score: 77, highScore: 77, lastModified: 900 };
    view.unmount();
    expect(beaconMock).toHaveBeenCalledTimes(1);
  });

  it("never uploads untouched progress (time 0), also when time changes it", async () => {
    state = { score: 0, highScore: 0, lastModified: 0 };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST") return fetchResponse({ data: null, lastSyncedAt: null });
      return fetchResponse({ success: true, updatedAt: new Date().toISOString() });
    });
    const view = renderHook(() =>
      useAuthSync<TestProgress>({ appId: APP_ID, localStorageKey: LS_KEY, getState, setState })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    // Time passing changes the untouched progress (a pet that gets hungry),
    // but no player changed it.
    state = { score: 3, highScore: 0, lastModified: 0 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await act(async () => {
      await view.result.current.forceSync();
    });
    window.dispatchEvent(new Event("beforeunload"));
    view.unmount();
    expect(posts()).toEqual([]);
    expect(beaconMock).not.toHaveBeenCalled();
  });
});

vi.mock("@/lib/owner-bound-progress", async () => {
  const { useSession: readSession } = await import("next-auth/react");
  const { createSyncOwnerFixture } = await import("@/shared/hooks/__tests__/ownerProgressFixture");
  return createSyncOwnerFixture(readSession);
});

// B1 reconciliation fixtures retain their historical physical save format.
vi.mock("@/lib/owner-bound-progress/persistStorage", async () => {
  const { createJSONStorage } = await import("zustand/middleware");
  return { createOwnerPersistStorage: () => createJSONStorage(() => localStorage) };
});
