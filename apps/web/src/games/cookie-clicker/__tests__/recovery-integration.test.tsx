import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnerBoundProgress, type OwnerBoundProgress } from "@/lib/owner-bound-progress/core";
import { createProgressServer } from "@/__tests__/fake-progress-server";
import { progressSyncPresentation } from "@/shared/lib/progressSyncPresentation";
import { ProgressRecoveryNotice } from "@/shared/components/ProgressRecoveryNotice";
import { useShellOverlays } from "@/shared/lib/shellOverlays";
import { CookieClickerGame } from "../Game";
import { useCookieClickerStore } from "../lib/store";
import { cookieRecoveryPaused } from "../lib/recoveryPause";
import { VirtualPet } from "@/apps/virtual-pet/VirtualPet";
import { useVirtualPetStore } from "@/apps/virtual-pet/lib/store";

const auth = vi.hoisted(() => ({ status: "authenticated", data: { user: { id: "bakery-owner" } } }));
const authority = vi.hoisted(() => ({ current: null as unknown as OwnerBoundProgress }));
vi.mock("next-auth/react", () => ({ useSession: () => auth }));
vi.mock("@/lib/owner-bound-progress", async () => {
  const { createOwnerBoundProgress } = await import("@/lib/owner-bound-progress/core");
  authority.current = createOwnerBoundProgress();
  return {
    ownerBoundProgress: new Proxy({}, { get: (_target, key) => authority.current[key as keyof OwnerBoundProgress] }),
    createOwnerBoundStorage: (key: string, appId?: string) => ({
      getItem: (name: string) => authority.current.createStorage(key, appId).getItem(name),
      setItem: (name: string, raw: string) => authority.current.createStorage(key, appId).setItem(name, raw),
      removeItem: (name: string) => authority.current.createStorage(key, appId).removeItem(name),
    }),
    bindPersistedStore: (key: string, handle: Parameters<OwnerBoundProgress["bindPersistedStore"]>[1], flush?: () => void) => authority.current.bindPersistedStore(key, handle, flush),
  };
});
vi.mock("@/shared/clips/replay/useSemanticClips", () => ({ useSemanticClips: () => {} }));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

let server: ReturnType<typeof createProgressServer>;
let fetchSpy: ReturnType<typeof vi.fn>;
const entry = () => progressSyncPresentation.getSnapshot().find(row => row.appId === "cookie-clicker")!;
const pause = async (ms = 100) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); };

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); vi.stubGlobal("indexedDB", new IDBFactory());
  authority.current = createOwnerBoundProgress();
  authority.current.bindPersistedStore("cookie-clicker-storage", useCookieClickerStore.persist, () => useCookieClickerStore.setState({}));
  await authority.current.updateSession("authenticated", "bakery-owner");
  await authority.current.whenHydrated("cookie-clicker-storage");
  useCookieClickerStore.setState(useCookieClickerStore.getInitialState(), true);
  const initial = useCookieClickerStore.getState();
  useCookieClickerStore.setState({ cookies: 20, totalCookiesBaked: 20, lastModified: 20, lastTick: Date.now(),
    buildings: { ...initial.buildings, cursor: 10 }, cookiesPerSecond: 1 });
  server = createProgressServer({ current: auth });
  const local = useCookieClickerStore.getState().getProgress();
  server.rows.set("bakery-owner:cookie-clicker", { data: { ...local, cookies: 50, totalCookiesBaked: 50,
    buildings: { ...local.buildings, cursor: 20 }, lastModified: 50 }, updatedAt: new Date(50) });
  fetchSpy = vi.fn(server.fetch); vi.stubGlobal("fetch", fetchSpy);
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: vi.fn(() => false) });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(async () => {
  cleanup(); vi.useRealTimers(); await pause(30); vi.restoreAllMocks(); vi.unstubAllGlobals();
  expect(cookieRecoveryPaused()).toBe(false);
  expect(useShellOverlays.getState().count).toBe(0);
});

async function openGame(strict = false) {
  const game = <><CookieClickerGame /><ProgressRecoveryNotice /></>;
  const view = render(strict ? <StrictMode>{game}</StrictMode> : game);
  await waitFor(() => expect(entry()?.status).toBe("conflict"));
  fireEvent.click(screen.getByRole("button", { name: /play/i }));
  await pause();
  fireEvent.click(screen.getByRole("button", { name: "Review saves" }));
  expect(screen.getByRole("dialog", { name: "Choose a save" })).toBeVisible();
  expect(cookieRecoveryPaused()).toBe(true);
  return view;
}

describe("Cookie Clicker through the real recovery dialog and shared hook", () => {
  it("keeps a visible choice authorized and paused through StrictMode effect replay", async () => {
    await openGame(true);
    fireEvent.click(screen.getByRole("button", { name: "Use cloud save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useCookieClickerStore.getState().buildings.cursor).toBe(20);
  });
  it("holds positive production while the choice GET waits, then applies the cloud and catches up once", async () => {
    await openGame();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    fetchSpy.mockImplementationOnce(async (...args: Parameters<typeof server.fetch>) => { await waiting; return server.fetch(...args); });
    const frozen = useCookieClickerStore.getState().getProgress();
    fireEvent.click(screen.getByRole("button", { name: "Use cloud save" }));
    await pause(150);
    expect(useCookieClickerStore.getState().getProgress()).toEqual(frozen);
    expect(useCookieClickerStore.getState().applyOfflineProgress()).toBe(0);
    await act(async () => { release(); });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(cookieRecoveryPaused()).toBe(false);
    expect(useCookieClickerStore.getState().buildings.cursor).toBe(20);
    expect(useCookieClickerStore.getState().cookies).toBeGreaterThanOrEqual(50);
    expect(server.rejected).toEqual([]);
    const after = useCookieClickerStore.getState().cookies;
    await pause(150);
    expect(useCookieClickerStore.getState().cookies).toBeGreaterThan(after);
    expect(useCookieClickerStore.getState().cookies - after).toBeLessThan(2);
  });

  it("can refresh stale choices without stale modal cleanup releasing the new pause", async () => {
    await openGame();
    const cloud = server.rows.get("bakery-owner:cookie-clicker")!;
    server.rows.set("bakery-owner:cookie-clicker", { data: { ...cloud.data, cookies: 80, totalCookiesBaked: 80 }, updatedAt: new Date(80) });
    fireEvent.click(screen.getByRole("button", { name: "Use cloud save" }));
    await screen.findByText("The saves changed. Refresh the choices before choosing again.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh choices" }));
    await pause();
    expect(cookieRecoveryPaused()).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use cloud save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useCookieClickerStore.getState().cookies).toBeGreaterThanOrEqual(80);
  });

  it("keeps failed choices paused until Decide later releases local production", async () => {
    await openGame(); server.net.failGets = 1;
    const frozen = useCookieClickerStore.getState().getProgress();
    fireEvent.click(screen.getByRole("button", { name: "Use cloud save" }));
    await screen.findByText("The save could not finish. Keep this page open and try again.");
    await pause(); expect(useCookieClickerStore.getState().getProgress()).toEqual(frozen);
    fireEvent.click(screen.getByRole("button", { name: "Decide later" }));
    expect(cookieRecoveryPaused()).toBe(false);
    await pause(); expect(useCookieClickerStore.getState().cookies).toBeGreaterThan(frozen.cookies);
    expect(useCookieClickerStore.getState().buildings.cursor).toBe(10);
    expect(server.posts).toEqual([]);
  });

  it("releases the pause on owner revocation without baking or applying the in-flight cloud choice", async () => {
    const view = await openGame();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    fetchSpy.mockImplementationOnce(async (...args: Parameters<typeof server.fetch>) => { await waiting; return server.fetch(...args); });
    const frozen = useCookieClickerStore.getState().getProgress();
    fireEvent.click(screen.getByRole("button", { name: "Use cloud save" }));
    await act(async () => { authority.current.revoke(); }); view.unmount();
    expect(cookieRecoveryPaused()).toBe(false);
    await act(async () => { release(); }); await pause();
    expect(useCookieClickerStore.getState().getProgress()).toEqual(frozen);
    expect(server.posts).toEqual([]);
  });
});

it("holds Virtual Pet's active minigame timer and rewards while recovery remains open", async () => {
  authority.current.bindPersistedStore("virtual-pet-state", useVirtualPetStore.persist, () => useVirtualPetStore.setState({}));
  await authority.current.whenHydrated("virtual-pet-state");
  useVirtualPetStore.setState(useVirtualPetStore.getInitialState(), true);
  const progress = useVirtualPetStore.getState().getProgress();
  useVirtualPetStore.setState({ progress: { ...progress, coins: 60, lastModified: 10,
    pet: { ...progress.pet, happiness: 60, lastChecked: new Date().toISOString() }, settings: { ...progress.settings, soundEnabled: false } } });
  server.rows.set("bakery-owner:virtual-pet", { data: { ...useVirtualPetStore.getState().getProgress(), coins: 90, lastModified: 20 }, updatedAt: new Date(20) });
  render(<><VirtualPet /><ProgressRecoveryNotice /></>);
  await waitFor(() => expect(progressSyncPresentation.getSnapshot().find(row => row.appId === "virtual-pet")?.status).toBe("conflict"));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  act(() => useVirtualPetStore.getState().startMiniGame());
  expect(screen.getByText("Time: 15s")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Review saves" }));
  const frozen = useVirtualPetStore.getState().getProgress();
  for (let second = 0; second < 16; second++) await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(screen.getByText("Time: 15s")).toBeVisible();
  expect(useVirtualPetStore.getState().isPlaying).toBe(true);
  expect(useVirtualPetStore.getState().getProgress()).toEqual(frozen);
  fireEvent.click(screen.getByRole("button", { name: "Decide later" }));
  for (let second = 0; second < 2; second++) await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(screen.getByText("Time: 13s")).toBeVisible();
});
