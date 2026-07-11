import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuthSync } from "../useAuthSync";

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
    state = { score: 500, highScore: 500, lastModified: 2000 };
    localStorage.setItem(LS_KEY, JSON.stringify({ state: { progress: state } }));

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
});
