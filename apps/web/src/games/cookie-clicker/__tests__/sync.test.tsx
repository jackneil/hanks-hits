/**
 * Cookie Clicker and the account (review wave 4 of #26i), with the real
 * game, the real useAuthSync and a server that runs the real validation and
 * merge (src/__tests__/fake-progress-server.ts).
 *
 * The bake runs 20 times a second while the page is open. It must never
 * move the progress time: an idle bakery whose time moved forward replaced
 * every purchase that the kid made on another device. The ticker starts
 * only after the first sync (and the bake while away), so a tick never
 * bakes onto an old copy of the bakery or eats the time away.
 */
import { vi } from "vitest";

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-20T13:00:00Z"));
});

const session = vi.hoisted(() => ({
  current: { data: null as null | { user: { id: string } }, status: "unauthenticated" as string },
}));
vi.mock("next-auth/react", () => ({
  useSession: () => session.current,
  signOut: vi.fn(async () => undefined),
  signIn: vi.fn(async () => undefined),
  SessionProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/shared/components/FullscreenButton", () => ({ FullscreenButton: () => null }));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CookieClickerGame } from "../Game";
import { useCookieClickerStore, type CookieClickerProgress } from "../lib/store";
import { installAudioMock } from "@/__tests__/audio-mock";
import { createProgressServer } from "@/__tests__/fake-progress-server";
import { READY_FALLBACK_MS, __unsafeResetForeignPurgeLockForTests } from "@/shared/hooks/useAuthSync";
import { syncedStore } from "@/__tests__/synced-stores";
import { PROGRESS_OWNER_KEY, syncLineageKey } from "@/lib/storage-keys";

const server = createProgressServer(session);
const HOUR = 3_600_000;

const settle = async (ms: number) => {
  for (let left = ms; left > 0; left -= 100) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(100, left));
    });
  }
};
const signIn = () => {
  session.current = { data: { user: { id: "user-1" } }, status: "authenticated" };
};
const progress = () => JSON.parse(JSON.stringify(useCookieClickerStore.getState().getProgress())) as CookieClickerProgress;
const row = () => server.row("cookie-clicker") as CookieClickerProgress | undefined;

/** A bakery saved on this device (on disk), last changed `ago` ms before now. */
async function deviceBakery(ago: number, buildings: Partial<CookieClickerProgress["buildings"]>) {
  const store = useCookieClickerStore.getState();
  store.setProgress({
    ...store.getProgress(),
    cookies: 1_000,
    totalCookiesBaked: 5_000,
    totalClicks: 300,
    buildings: { ...store.getProgress().buildings, ...buildings },
    lastTick: Date.now() - ago,
    lastModified: Date.now() - ago,
  });
  await useCookieClickerStore.persist.rehydrate();
  return progress();
}

beforeEach(() => {
  localStorage.clear();
  server.reset();
  syncedStore("cookie-clicker").reset();
  installAudioMock();
  __unsafeResetForeignPurgeLockForTests();
  session.current = { data: null, status: "unauthenticated" };
  server.install(vi.stubGlobal);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  syncedStore("cookie-clicker").reset();
});

describe("Cookie Clicker: the bake and the account", () => {
  it("the bake never moves the progress time", () => {
    const store = useCookieClickerStore.getState();
    store.setProgress({ ...store.getProgress(), buildings: { ...store.getProgress().buildings, grandma: 5 }, lastModified: 1_000 });
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(50);
      useCookieClickerStore.getState().tick();
    }
    expect(useCookieClickerStore.getState().cookies).toBeGreaterThan(0);
    expect(progress().lastModified).toBe(1_000);
  });

  it("a stale device that taps Play and clicks during the first sync takes the account's newer purchases", async () => {
    // The account: 5 grandmas and a bakery, bought at 12:00 on another device.
    const account = {
      ...(await deviceBakery(HOUR, { grandma: 5, bakery: 1, cursor: 2 })),
      lastModified: Date.parse("2026-10-20T12:00:00Z"),
    };
    server.rows.set("user-1:cookie-clicker", { data: account, updatedAt: new Date() });
    // This device: yesterday's bakery (2 cursors), on disk.
    syncedStore("cookie-clicker").reset();
    localStorage.clear();
    await deviceBakery(24 * HOUR, { cursor: 2 });

    signIn();
    server.net.getDelayMs = 1_500;
    render(<CookieClickerGame />);
    await settle(300);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    for (let i = 0; i < 5; i++) useCookieClickerStore.getState().clickCookie();
    await settle(15_000);

    expect(server.rejected).toEqual([]);
    expect(row()?.buildings.grandma).toBe(5);
    expect(row()?.buildings.bakery).toBe(1);
    expect(useCookieClickerStore.getState().buildings.grandma).toBe(5);
  });

  it("an idle bakery on one device never replaces purchases made on another", async () => {
    // This device: signed in, synced, baking with 10 cursors.
    await deviceBakery(HOUR, { cursor: 10 });
    server.rows.set("user-1:cookie-clicker", { data: progress(), updatedAt: new Date() });
    signIn();
    render(<CookieClickerGame />);
    await settle(1_000);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    await settle(2_000);
    // Another device buys 3 grandmas now.
    const elsewhere = { ...row()!, buildings: { ...row()!.buildings, grandma: 3 }, lastModified: Date.now() };
    server.rows.set("user-1:cookie-clicker", { data: elsewhere, updatedAt: new Date() });
    // This page keeps baking for a minute; its saves go out.
    const postsBefore = server.posts.length;
    await settle(60_000);

    expect(server.posts.length).toBeGreaterThan(postsBefore);
    expect(row()?.buildings.grandma).toBe(3);
    // The records still merge: the baked total is the larger one.
    expect(row()!.totalCookiesBaked).toBeGreaterThan(elsewhere.totalCookiesBaked);
  });

  it.each([[0], [1_500]])(
    "signed in, first GET takes %i ms, Play at once: the bake while away (4 hours) is applied",
    async (latency) => {
      const saved = await deviceBakery(4 * HOUR, { cursor: 10, grandma: 5 });
      server.rows.set("user-1:cookie-clicker", { data: saved, updatedAt: new Date(Date.now() - 4 * HOUR) });
      const cps = useCookieClickerStore.getState().calculateCps();
      signIn();
      server.net.getDelayMs = latency;
      render(<CookieClickerGame />);
      await settle(200);
      fireEvent.click(screen.getByRole("button", { name: /play/i }));
      await settle(10_000);
      const away = cps * 4 * 3600;
      expect(useCookieClickerStore.getState().cookies).toBeGreaterThan(saved.cookies + away * 0.9);
    }
  );

  it("the account cannot be reached: after READY_FALLBACK_MS the bakery bakes on this device", async () => {
    await deviceBakery(HOUR, { cursor: 10 });
    signIn();
    server.net.failGets = 1_000;
    render(<CookieClickerGame />);
    await settle(200);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    const before = useCookieClickerStore.getState().cookies;
    await settle(READY_FALLBACK_MS - 1_000);
    // Not yet: the sync may still bring the account's bakery.
    expect(useCookieClickerStore.getState().cookies).toBe(before);
    await settle(3_000);
    expect(useCookieClickerStore.getState().cookies).toBeGreaterThan(before);
  });
});

/** This device synced the account before (the owner key and the save's lineage key). */
function thisAccountsDevice() {
  localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");
  localStorage.setItem(syncLineageKey("cookie-clicker-storage"), "1");
}

/** The account's bakery: 5 grandmas and a bakery, bought at 12:00 on another device. */
function accountBakery(): CookieClickerProgress {
  const at12 = Date.parse("2026-10-20T12:00:00Z");
  const store = useCookieClickerStore.getState();
  const base = store.getProgress();
  return JSON.parse(
    JSON.stringify({
      ...base,
      cookies: 50_000,
      totalCookiesBaked: 90_000,
      totalClicks: 300,
      buildings: { ...base.buildings, cursor: 2, grandma: 5, bakery: 1 },
      lastTick: at12,
      lastModified: at12,
    })
  );
}

describe("Cookie Clicker: an outage and the account (review wave 5)", () => {
  it("F2: an old device of this account opened during an outage: the bake while away keeps the time of the old copy, and the account's purchases win", async () => {
    server.rows.set("user-1:cookie-clicker", { data: accountBakery(), updatedAt: new Date("2026-10-20T12:00:00Z") });
    // This device: yesterday's bakery (2 cursors), on disk.
    await deviceBakery(24 * HOUR, { cursor: 2 });
    const yesterday = progress().lastModified;
    thisAccountsDevice();

    signIn();
    server.net.failGets = 1_000;
    render(<CookieClickerGame />);
    await settle(READY_FALLBACK_MS + 2_000);
    // The page runs on the old copy: the time away bakes, with no stamp.
    expect(useCookieClickerStore.getState().cookies).toBeGreaterThan(1_000);
    expect(progress().lastModified).toBe(yesterday);
    server.net.failGets = 0;
    await settle(45_000);

    expect(server.rejected).toEqual([]);
    expect(row()?.buildings.grandma).toBe(5);
    expect(row()?.buildings.bakery).toBe(1);
    expect(useCookieClickerStore.getState().buildings.grandma).toBe(5);
  });

  it("F2: the session cannot be read (the page looks like a guest's), then a reload: the old copy on disk keeps its time", async () => {
    server.rows.set("user-1:cookie-clicker", { data: accountBakery(), updatedAt: new Date("2026-10-20T12:00:00Z") });
    await deviceBakery(24 * HOUR, { cursor: 2 });
    const yesterday = progress().lastModified;
    thisAccountsDevice();
    // next-auth's session fetch fails: the status is "unauthenticated".
    session.current = { data: null, status: "unauthenticated" };
    const view = render(<CookieClickerGame />);
    await settle(3_000);
    view.unmount();
    const disk = JSON.parse(localStorage.getItem("cookie-clicker-storage")!).state as CookieClickerProgress;
    expect(disk.lastModified).toBe(yesterday);
    // A reload with the session back.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await useCookieClickerStore.persist.rehydrate();
    signIn();
    render(<CookieClickerGame />);
    await settle(20_000);
    expect(row()?.buildings.grandma).toBe(5);
  });

  it.each([
    ["the start card", false],
    ["Play tapped, the ticker running", true],
  ])("F2 (P4): a blank device during an outage: when the late sync takes the account's bakery, its time away bakes on it (%s)", async (_label, play) => {
    // The account: 10 cursors and 5 grandmas, last baked 6 hours ago.
    await deviceBakery(6 * HOUR, { cursor: 10, grandma: 5 });
    const account = progress();
    const cps = useCookieClickerStore.getState().calculateCps();
    server.rows.set("user-1:cookie-clicker", { data: account, updatedAt: new Date(Date.now() - 6 * HOUR) });
    syncedStore("cookie-clicker").reset();
    localStorage.clear();

    signIn();
    server.net.failGets = 1_000;
    render(<CookieClickerGame />);
    await settle(300);
    if (play) fireEvent.click(screen.getByRole("button", { name: /play/i }));
    await settle(READY_FALLBACK_MS + 2_000);
    server.net.failGets = 0;
    await settle(40_000);
    const away = cps * 6 * 3600;
    expect(useCookieClickerStore.getState().buildings.grandma).toBe(5);
    expect(useCookieClickerStore.getState().cookies).toBeGreaterThan(account.cookies + away * 0.9);
  });

  it.each([
    [3, 1],
    [10, 1],
    [20, 0.25],
  ])("F6: idle %i h with the page open, closed, reopened %f h later: no bake is lost", async (idleHours, awayHours) => {
    // 12:00: the kid's bakery, signed in, synced.
    await deviceBakery(0, { cursor: 10, grandma: 5 });
    server.rows.set("user-1:cookie-clicker", { data: progress(), updatedAt: new Date() });
    signIn();
    const view = render(<CookieClickerGame />);
    await settle(1_000);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    await settle(1_000);
    const cps = useCookieClickerStore.getState().calculateCps();
    // The page sits open: hours of the ticker, as tick() writes them (no stamp).
    const s = useCookieClickerStore.getState();
    const earned = cps * idleHours * 3600;
    vi.setSystemTime(Date.now() + idleHours * HOUR);
    useCookieClickerStore.setState({ cookies: s.cookies + earned, totalCookiesBaked: s.totalCookiesBaked + earned, lastTick: Date.now() });
    await settle(8_000);
    const onDevice = useCookieClickerStore.getState().cookies;
    view.unmount();
    await settle(100);
    // The account holds the idle bake (a save with the row's time is the same line of play).
    expect(row()!.cookies).toBeGreaterThanOrEqual(onDevice * 0.999);

    vi.setSystemTime(Date.now() + awayHours * HOUR);
    await useCookieClickerStore.persist.rehydrate();
    render(<CookieClickerGame />);
    await settle(5_000);
    const expected = onDevice + cps * Math.min(awayHours, 8) * 3600;
    expect(useCookieClickerStore.getState().cookies).toBeGreaterThanOrEqual(expected * 0.999);
  });
});
