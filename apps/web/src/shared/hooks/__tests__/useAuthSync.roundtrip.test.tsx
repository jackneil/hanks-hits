/** All 33 production stores: original legacy fixtures, real owner storage,
 * IndexedDB journals, and the revision-aware wire contract. Unknown lineage is
 * resolved explicitly; timestamps alone may not authorize replacing a save. */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { createOwnerBoundProgress, type OwnerBoundProgress, type PersistHandle } from "@/lib/owner-bound-progress/core";
import { createProgressServer } from "@/__tests__/fake-progress-server";
import { SYNCED_STORES, type SyncedStoreEntry } from "@/__tests__/synced-stores";
import legacy from "@/__tests__/fixtures/legacy-saves.json";
import { progressSyncPresentation } from "@/shared/lib/progressSyncPresentation";
import { signOutAndClear } from "@/lib/auth-client";
import { PROGRESS_OWNER_KEY } from "@/lib/storage-keys";
import { useVirtualPetStore } from "@/apps/virtual-pet/lib/store";
import { useAuthSync } from "../useAuthSync";

const auth = vi.hoisted(() => ({ status: "authenticated", data: { user: { id: "matrix-owner" } } }));
const fixture = vi.hoisted(() => ({ current: null as unknown as OwnerBoundProgress,
  bindings: new Map<string, { handle: PersistHandle; flush?: () => void }>() }));
vi.mock("next-auth/react", () => ({ useSession: () => auth, signOut: vi.fn(async () => undefined) }));
vi.mock("@/lib/owner-bound-progress", async () => {
  const { createOwnerBoundProgress } = await import("@/lib/owner-bound-progress/core");
  fixture.current = createOwnerBoundProgress();
  return {
    ownerBoundProgress: new Proxy({}, { get: (_target, key) => fixture.current[key as keyof OwnerBoundProgress] }),
    createOwnerBoundStorage: (key: string, appId?: string) => ({
      getItem: (name: string) => fixture.current.createStorage(key, appId).getItem(name),
      setItem: (name: string, raw: string) => fixture.current.createStorage(key, appId).setItem(name, raw),
      removeItem: (name: string) => fixture.current.createStorage(key, appId).removeItem(name),
    }),
    bindPersistedStore: (key: string, handle: PersistHandle, flush?: () => void) => {
      fixture.bindings.set(key, { handle, flush }); return fixture.current.bindPersistedStore(key, handle, flush);
    },
  };
});

const saves = legacy.saves as Record<string, { played: unknown; untouched: unknown }>;
let server: ReturnType<typeof createProgressServer>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const progress = (entry: SyncedStoreEntry) => clone(entry.store.getState().getProgress()) as AppProgressData;
const tick = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
async function confirm() {
  await fixture.current.updateSession("authenticated", "matrix-owner");
  await Promise.all(SYNCED_STORES.map(entry => fixture.current.whenHydrated(entry.key)));
}
async function load(entry: SyncedStoreEntry, save: unknown) {
  fixture.current.writeScoped(entry.key, JSON.stringify(save));
  await entry.store.persist.rehydrate();
  return progress(entry);
}
function mount(entry: SyncedStoreEntry) {
  return renderHook(() => useAuthSync({ appId: entry.appId as ValidAppId, localStorageKey: entry.key,
    getState: () => progress(entry), setState: data => entry.store.getState().setProgress(data), debounceMs: 10_000 }));
}
const presentation = (entry: SyncedStoreEntry) => progressSyncPresentation.getSnapshot().find(row => row.appId === entry.appId);
async function settled(entry: SyncedStoreEntry) {
  await waitFor(() => expect(presentation(entry)).toBeDefined());
  await waitFor(() => expect(presentation(entry)?.status).not.toBe("saving"));
}
function documentReset() {
  fixture.current = createOwnerBoundProgress();
  for (const [key, { handle, flush }] of fixture.bindings) fixture.current.bindPersistedStore(key, handle, flush);
}
beforeEach(async () => {
  for (const entry of SYNCED_STORES) entry.reset();
  localStorage.clear(); sessionStorage.clear(); vi.stubGlobal("indexedDB", new IDBFactory());
  documentReset(); await confirm();
  server = createProgressServer({ current: auth }); vi.stubGlobal("fetch", server.fetch);
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: vi.fn(() => false) });
});
afterEach(async () => { cleanup(); await tick(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each(SYNCED_STORES.map(entry => [entry.appId, entry] as const))("%s real store and revision protocol", (_appId, entry) => {
  it("uploads played progress and preserves it through sign-out and a new same-owner document", async () => {
    const played = await load(entry, saves[entry.appId].played);
    const first = mount(entry); await settled(entry);
    expect(first.result.current.syncStatus).toBe("synced");
    expect(server.rejected).toEqual([]);
    expect(server.row(entry.appId, "matrix-owner")).toEqual(played);
    first.unmount(); await tick();
    const lease = fixture.current.captureLease()!, durable = fixture.current.readScoped(entry.key);
    await signOutAndClear("/");
    expect(fixture.current.isCurrent(lease)).toBe(false);
    documentReset(); await confirm();
    expect(fixture.current.readScoped(entry.key)).toBe(durable);
    const posted = server.posts.length;
    const second = mount(entry); await settled(entry);
    expect(second.result.current.syncStatus).toBe("synced");
    expect(progress(entry)).toEqual(played);
    expect(server.posts).toHaveLength(posted);
  });

  it("loads a played cloud save on a fresh second device without uploading defaults", async () => {
    const played = await load(entry, saves[entry.appId].played);
    server.rows.set(`matrix-owner:${entry.appId}`, { data: played, updatedAt: new Date() });
    entry.reset(); localStorage.clear(); vi.stubGlobal("indexedDB", new IDBFactory()); documentReset(); await confirm();
    const view = mount(entry); await settled(entry);
    expect(view.result.current.syncStatus).toBe("synced");
    expect(progress(entry)).toEqual(played);
    expect(server.row(entry.appId, "matrix-owner")).toEqual(played);
    expect(server.posts).toEqual([]);
  });

  it("does not replace cloud play with the old code's newer page-load defaults", async () => {
    const played = await load(entry, saves[entry.appId].played);
    server.rows.set(`matrix-owner:${entry.appId}`, { data: played, updatedAt: new Date(100) });
    await load(entry, saves[entry.appId].untouched);
    const view = mount(entry); await settled(entry);
    expect(view.result.current.syncStatus).toBe("synced");
    expect(progress(entry)).toEqual(played);
    expect(server.posts).toEqual([]);
  });

  it("keeps local play when cloud contains old defaults and saves the player's explicit device choice", async () => {
    await load(entry, saves[entry.appId].untouched);
    const untouched = { ...progress(entry), [entry.timeKey]: Date.now() };
    server.rows.set(`matrix-owner:${entry.appId}`, { data: untouched, updatedAt: new Date() });
    const played = await load(entry, saves[entry.appId].played);
    const view = mount(entry); await settled(entry);
    expect(progress(entry)).toEqual(played);
    expect(server.posts).toEqual([]);
    expect(presentation(entry)?.status).toBe("conflict");
    const dialog = presentation(entry)!.open()!;
    await act(async () => { expect(await dialog.choose("local")).toMatchObject({ ok: true }); });
    expect(server.rejected).toEqual([]);
    expect(view.result.current.syncStatus).toBe("synced");
    expect(progress(entry)).toEqual(played);
    expect(server.row(entry.appId, "matrix-owner")).toEqual(played);
  });
});

it.each(["hill-climb", "monster-truck", "oregon-trail"])("preserves %s legacy bytes without a timestamp and saves only an explicit choice", async appId => {
  const entry = SYNCED_STORES.find(row => row.appId === appId)!;
  const played = await load(entry, saves[appId].played);
  const account = { ...played, ...(appId === "oregon-trail" ? { pace: "grueling" } : { coins: 5, totalCoinsEarned: 5 }), lastModified: 100 };
  server.rows.set(`matrix-owner:${appId}`, { data: account, updatedAt: new Date(100) });
  entry.reset(); localStorage.clear();
  const original = JSON.stringify(saves[appId].played);
  localStorage.setItem(entry.key, original); localStorage.setItem(PROGRESS_OWNER_KEY, "matrix-owner");
  documentReset(); await confirm();
  const local = progress(entry), view = mount(entry); await settled(entry);
  expect(presentation(entry)?.status).toBe("conflict"); expect(server.posts).toEqual([]);
  await act(async () => { expect(await presentation(entry)!.open()!.choose("local")).toMatchObject({ ok: true }); });
  expect(view.result.current.syncStatus).toBe("synced");
  expect(server.row(appId, "matrix-owner")).toEqual(local);
  expect(localStorage.getItem(entry.key)).toBe(original);
  expect(localStorage.getItem(PROGRESS_OWNER_KEY)).toBe("matrix-owner");
});

it("offers a guest's record alongside the returning account and acknowledges only the explicit resolved source", async () => {
  const entry = SYNCED_STORES.find(row => row.appId === "flappy-bird")!;
  const played = await load(entry, saves[entry.appId].played);
  const account = { ...played, highScore: 50, gamesPlayed: 5, lastModified: 50 };
  entry.store.getState().setProgress(account);
  server.rows.set("matrix-owner:flappy-bird", { data: account, updatedAt: new Date(50) });
  const guestProgress = { ...played, highScore: 100, gamesPlayed: 1, lastModified: 100 };
  const guest = createOwnerBoundProgress(); await guest.updateSession("unauthenticated");
  guest.writeScoped(entry.key, JSON.stringify({ state: { progress: guestProgress, progressTimeV: 1 }, version: 0 }));
  expect(guest.prepareGuestHandoff()).toBe(true);
  const proof = guest.getGuestHandoffProof()!;
  documentReset(); fixture.current.authorizeGuestHandoff(proof); await confirm();
  const view = mount(entry); await settled(entry);
  expect(server.posts).toEqual([]); expect(fixture.current.readGuestCandidate(entry.key)).not.toBeNull();
  const dialog = presentation(entry)!.open()!;
  const choice = dialog.options.find(option => option.data.highScore === 100)!;
  expect(choice).toBeDefined();
  await act(async () => { expect(await dialog.choose(choice.id)).toMatchObject({ ok: true }); });
  expect(view.result.current.syncStatus).toBe("synced");
  expect(server.row(entry.appId, "matrix-owner")).toEqual(guestProgress);
  expect(fixture.current.readGuestCandidate(entry.key)).toBeNull();
});

it("advances a synced pet's next-day visit without replacing the account's pet", async () => {
  const entry = SYNCED_STORES.find(row => row.appId === "virtual-pet")!;
  await load(entry, saves[entry.appId].played);
  const played = useVirtualPetStore.getState().getProgress(), yesterday = new Date(Date.now() - 86_400_000);
  const account = { ...played, lastModified: yesterday.getTime(), pet: { ...played.pet, lastChecked: yesterday.toISOString() },
    stats: { ...played.stats, currentStreak: 5, lastPlayDate: yesterday.toDateString() } };
  useVirtualPetStore.getState().setProgress(account);
  server.rows.set("matrix-owner:virtual-pet", { data: account, updatedAt: yesterday });
  const view = mount(entry); await settled(entry);
  act(() => useVirtualPetStore.getState().updateFromTime(true));
  await act(async () => { await view.result.current.forceSync(); });
  expect(server.rejected).toEqual([]);
  expect(server.row(entry.appId, "matrix-owner")).toMatchObject({ pet: { name: account.pet.name },
    stats: { currentStreak: 6, lastPlayDate: new Date().toDateString() } });
});
