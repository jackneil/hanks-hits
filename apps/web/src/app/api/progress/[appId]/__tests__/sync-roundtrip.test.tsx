/**
 * The real useAuthSync (the client that is live today) against the real
 * progress route, on the in-memory database stand-in.
 *
 * The route chooses its answer to a merge save whose merged blob breaks the
 * schema for THIS client. What the client does with an answer:
 * - 200: the first sync fetches the stored blob and takes it when it is at
 *   least as new as the device's save; a later save keeps the device's state.
 * - any other status: the client keeps its save on the device and marks the
 *   sync as failed. It sends no retry of the same save; it sends the save
 *   again with the next change (or the next page load), and that save is
 *   newer than the row.
 * So a 409 loses nothing that the client sent, and a 200 must store a blob
 * that the client can take.
 */
import { vi } from "vitest";

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-20T13:00:00Z"));
});

const session = vi.hoisted(() => ({
  current: { data: { user: { id: "kid-user-1" } }, status: "authenticated" as string },
}));

vi.mock("next-auth/react", () => ({
  useSession: () => session.current,
  signOut: vi.fn(async () => undefined),
  signIn: vi.fn(async () => undefined),
  SessionProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/lib/auth", () => ({ auth: async () => session.current.data }));

vi.mock("@/lib/rate-limit", () => ({
  checkProgressRateLimit: () => ({ success: true }),
  checkProgressDeleteRateLimit: () => ({ success: true }),
}));

vi.mock("@/lib/handle-generator", () => ({
  generateUniqueHandle: async () => `SyncHandle${Math.random().toString(36).slice(2, 8)}`,
}));

const pg = await vi.hoisted(async () => (await import("./db-stand-in")).createDbStandIn());
vi.mock("@hank-neil/db", () => pg.module);

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { GET, POST } from "../route";
import { useAuthSync, __unsafeResetForeignPurgeLockForTests } from "@/shared/hooks/useAuthSync";
import { useCookieClickerStore } from "@/games/cookie-clicker/lib/store";
import { useMathAttackStore } from "@/games/math-attack/lib/store";

const USER_ID = "kid-user-1";
const HOUR = 60 * 60_000;

/** Every request that the client made, with the route's answer. */
let requests: { method: string; status: number }[] = [];
const posts = () => requests.filter((r) => r.method === "POST");

function installRouteFetch() {
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const appId = url.pathname.split("/").pop()!;
    const ctx = { params: Promise.resolve({ appId }) };
    const request = new Request(url, init);
    const response = init?.method === "POST" ? await POST(request, ctx) : await GET(request, ctx);
    requests.push({ method: init?.method ?? "GET", status: response.status });
    return response;
  });
  // The unload beacon: count it, so a test sees one if it fires.
  vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn(() => true) });
}

const row = (appId: string) =>
  pg.rows("app_progress").find((r) => r.userId === USER_ID && r.appId === appId);

function putRow(appId: string, data: Record<string, unknown>, updatedAt: Date) {
  const rows = pg.state.committed.get("app_progress") ?? [];
  rows.push({ id: crypto.randomUUID(), userId: USER_ID, appId, data, lastSyncedAt: updatedAt, updatedAt });
  pg.state.committed.set("app_progress", rows);
}

/** Run fake time forward in small steps, letting the client's awaits settle. */
async function settle(ms: number) {
  for (let left = ms; left > 0; left -= 250) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(250, left));
    });
  }
}

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

type Store = {
  getState: () => { getProgress: () => unknown; setProgress: (data: never) => void };
};

function mountSync(appId: ValidAppId, localStorageKey: string, store: Store) {
  return renderHook(() =>
    useAuthSync({
      appId,
      localStorageKey,
      getState: () => store.getState().getProgress() as AppProgressData,
      setState: (data) => store.getState().setProgress(data as never),
    })
  );
}

const cookieDefaults = useCookieClickerStore.getState().getProgress();
const mathDefaults = useMathAttackStore.getState().getProgress();

beforeEach(() => {
  pg.reset();
  requests = [];
  localStorage.clear();
  __unsafeResetForeignPurgeLockForTests();
  useCookieClickerStore.getState().setProgress(cookieDefaults);
  useMathAttackStore.getState().setProgress(mathDefaults);
  localStorage.clear();
  installRouteFetch();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the live client against the route: a merge that breaks the schema", () => {
  it("newer row + older device save (merge too long): the row stays, the device's record folds in, the device takes the stored blob, no loop", async () => {
    const now = Date.now();
    const rowData = {
      ...cookieDefaults,
      cookies: 7_000,
      totalCookiesBaked: 1_000,
      totalClicks: 50,
      unlockedAchievements: ids("row-", 300),
      lastTick: now - 60_000,
      lastModified: now - 60_000,
    };
    putRow("cookie-clicker", rowData, new Date(now - 60_000));
    const device = {
      ...cookieDefaults,
      cookies: 3,
      totalCookiesBaked: 5_000,
      totalClicks: 10,
      unlockedAchievements: ids("dev-", 300),
      lastTick: now - HOUR,
      lastModified: now - HOUR,
    };
    useCookieClickerStore.getState().setProgress(device as never);

    const view = mountSync("cookie-clicker", "cookie-clicker-storage", useCookieClickerStore);
    await settle(10_000);
    const postsAfterSync = posts().length;
    await settle(60_000);
    view.unmount();

    const stored = row("cookie-clicker")!.data as Record<string, unknown>;
    // The newer row is the base: its wallet and its list stay.
    expect(stored.cookies).toBe(7_000);
    expect(stored.unlockedAchievements).toEqual(ids("row-", 300));
    // The older save's record still folds in.
    expect(stored.totalCookiesBaked).toBe(5_000);
    // The client took the stored blob.
    const onDevice = useCookieClickerStore.getState().getProgress() as Record<string, unknown>;
    expect(onDevice.cookies).toBe(7_000);
    expect(onDevice.totalCookiesBaked).toBe(5_000);
    // No loop: every save was answered 200, and no save came after the sync settled.
    expect(posts().every((p) => p.status === 200)).toBe(true);
    expect(postsAfterSync).toBeGreaterThanOrEqual(1);
    expect(postsAfterSync).toBeLessThanOrEqual(2);
    expect(posts().length).toBe(postsAfterSync);
  });

  it("newer row that the schema refuses + older device save: 409, the row and the device both keep their own, no loop; the next play is saved", async () => {
    const now = Date.now();
    const rowData = {
      ...mathDefaults,
      highScore: 900,
      gamesPlayed: 40,
      settings: { soundEnabled: true, difficulty: "13yo" },
      lastModified: now - 60_000,
    };
    const rowTime = new Date(now - 60_000);
    putRow("math-attack", rowData, rowTime);
    const device = { ...mathDefaults, highScore: 300, gamesPlayed: 12, totalCorrect: 80, lastModified: now - HOUR };
    useMathAttackStore.getState().setProgress(device as never);

    const view = mountSync("math-attack", "math-attack-progress", useMathAttackStore);
    await settle(10_000);
    const postsAfterSync = posts().length;
    await settle(60_000);

    // The row is not touched.
    expect(row("math-attack")!.data).toEqual(rowData);
    expect(row("math-attack")!.updatedAt).toBe(rowTime);
    // The device keeps its save (nothing is lost): in memory and on disk.
    expect(useMathAttackStore.getState().getProgress()).toEqual(expect.objectContaining({ highScore: 300, totalCorrect: 80 }));
    expect(JSON.parse(localStorage.getItem("math-attack-progress")!).state).toEqual(
      expect.objectContaining({ highScore: 300, totalCorrect: 80 })
    );
    // No loop: the refused save went at most twice (the sync and one auto-save).
    expect(posts().map((p) => p.status)).toEqual(Array(postsAfterSync).fill(409));
    expect(postsAfterSync).toBeGreaterThanOrEqual(1);
    expect(postsAfterSync).toBeLessThanOrEqual(2);

    // The kid plays: the change is newer than the row, so it is stored, and
    // the row's best score folds in.
    act(() => {
      useMathAttackStore.getState().addScore(10, "+");
      useMathAttackStore.getState().endGame();
    });
    await settle(10_000);
    view.unmount();
    expect(posts().at(-1)?.status).toBe(200);
    const stored = row("math-attack")!.data as Record<string, unknown>;
    expect(stored.totalCorrect).toBe(81);
    expect(stored.highScore).toBe(900);
    expect((stored.settings as Record<string, unknown>).difficulty).toBe(mathDefaults.settings.difficulty);
  });

  it("older row + newer device save (merge too long): the device's save is stored with the row's records, and the device keeps it", async () => {
    const now = Date.now();
    putRow(
      "cookie-clicker",
      {
        ...cookieDefaults,
        cookies: 7_000,
        totalCookiesBaked: 1_000,
        totalClicks: 9_000,
        unlockedAchievements: ids("row-", 300),
        lastTick: now - HOUR,
        lastModified: now - HOUR,
      },
      new Date(now - HOUR)
    );
    const device = {
      ...cookieDefaults,
      cookies: 3,
      totalCookiesBaked: 200,
      totalClicks: 10,
      unlockedAchievements: ids("dev-", 300),
      lastTick: now - 1_000,
      lastModified: now - 1_000,
    };
    useCookieClickerStore.getState().setProgress(device as never);

    const view = mountSync("cookie-clicker", "cookie-clicker-storage", useCookieClickerStore);
    await settle(10_000);
    const postsAfterSync = posts().length;
    await settle(60_000);
    view.unmount();

    const stored = row("cookie-clicker")!.data as Record<string, unknown>;
    expect(stored.cookies).toBe(3);
    expect(stored.unlockedAchievements).toEqual(ids("dev-", 300));
    expect(stored.totalClicks).toBe(9_000);
    expect(stored.totalCookiesBaked).toBe(1_000);
    const onDevice = useCookieClickerStore.getState().getProgress() as Record<string, unknown>;
    expect(onDevice.cookies).toBe(3);
    expect(onDevice.unlockedAchievements).toEqual(ids("dev-", 300));
    expect(onDevice.totalClicks).toBe(9_000);
    expect(posts().every((p) => p.status === 200)).toBe(true);
    expect(postsAfterSync).toBeGreaterThanOrEqual(1);
    expect(postsAfterSync).toBeLessThanOrEqual(2);
    expect(posts().length).toBe(postsAfterSync);
  });
});
