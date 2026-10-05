/** Real shared revision client against the actual route and DB stand-in.
 * Unknown ancestry retains both saves for explicit choice; invalid canonical
 * data cannot authorize overwriting either copy. */
import { vi } from "vitest";
import { setTimeout as realDelay } from "node:timers/promises";
import { progressSyncPresentation } from "@/shared/lib/progressSyncPresentation";

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
      await realDelay(5);
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

describe("the live revision client against the real route", () => {
  it.each(["server", "local"] as const)("retains both overflowing achievement lists and writes only the explicit %s choice", async selected => {
    const now = Date.now();
    const cloud = { ...cookieDefaults, cookies: 7000, totalCookiesBaked: 1000, totalClicks: 9000,
      unlockedAchievements: ids("row-", 300), lastTick: now - 60000, lastModified: now - 60000 };
    const device = { ...cookieDefaults, cookies: 3, totalCookiesBaked: 5000, totalClicks: 10,
      unlockedAchievements: ids("dev-", 300), lastTick: now - HOUR, lastModified: now - HOUR };
    putRow("cookie-clicker", cloud, new Date(now - 60000));
    useCookieClickerStore.getState().setProgress(device as never);
    const view = mountSync("cookie-clicker", "cookie-clicker-storage", useCookieClickerStore);
    await settle(10000);
    expect(posts()).toEqual([]); expect(row("cookie-clicker")!.data).toEqual(cloud);
    const entry = progressSyncPresentation.getSnapshot().find(item => item.appId === "cookie-clicker")!;
    expect(entry.status).toBe("conflict");
    const dialog = entry.open()!;
    expect(dialog.options.find(option => option.id === "local")!.data).toEqual(device);
    expect(dialog.options.find(option => option.id === "server")!.data).toEqual(cloud);
    await act(async () => { expect(await dialog.choose(selected)).toMatchObject({ ok: true }); });
    const expected = selected === "local" ? device : cloud;
    expect(row("cookie-clicker")!.data).toEqual(expected);
    expect(useCookieClickerStore.getState().getProgress()).toEqual(expected);
    const after = posts().length;
    await settle(60000); view.unmount();
    expect(posts()).toHaveLength(after); expect(after).toBe(1);
    expect(posts()[0].status).toBe(200);
  });

  it("rejects malformed canonical data, preserves local play and never fabricates a writable revision", async () => {
    const now = Date.now();
    const cloud = { ...mathDefaults, highScore: 900, gamesPlayed: 40,
      settings: { soundEnabled: true, difficulty: "13yo" }, lastModified: now - 60000 };
    putRow("math-attack", cloud, new Date(now - 60000));
    const device = { ...mathDefaults, highScore: 300, gamesPlayed: 12, totalCorrect: 80, lastModified: now - HOUR };
    useMathAttackStore.getState().setProgress(device as never);
    const view = mountSync("math-attack", "math-attack-progress", useMathAttackStore);
    await settle(70000);
    expect(row("math-attack")!.data).toEqual(cloud); expect(posts()).toEqual([]);
    expect(useMathAttackStore.getState().getProgress()).toMatchObject({ highScore: 300, totalCorrect: 80 });
    act(() => { useMathAttackStore.getState().addScore(10, "+"); useMathAttackStore.getState().endGame(); });
    await settle(10000);
    expect(useMathAttackStore.getState().getProgress().totalCorrect).toBe(81);
    expect(JSON.parse(localStorage.getItem("math-attack-progress")!).state.totalCorrect).toBe(81);
    expect(row("math-attack")!.data).toEqual(cloud); expect(posts()).toEqual([]);
    expect(view.result.current.syncStatus).not.toBe("synced"); view.unmount();
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
