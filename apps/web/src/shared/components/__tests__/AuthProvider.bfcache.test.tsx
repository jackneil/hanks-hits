vi.mock("@/lib/local-words", () => ({ localWords: { install: vi.fn() } }));
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";

const mock = vi.hoisted(() => ({
  session: { status: "authenticated", data: { user: { id: "A" } } },
  getSession: vi.fn(), reload: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ getSession: mock.getSession, useSession: () => mock.session, SessionProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/shared/clips/service/ClipSessionWatcher", () => ({ ClipSessionWatcher: () => null }));
vi.mock("@/lib/auth-client", () => ({ consumeGuestHandoffNavigation: vi.fn(), isAuthNavigationPending: () => false, PROGRESS_SESSION_CHANNEL: "test-progress-session", reloadProgressPage: mock.reload }));
vi.mock("../ProgressHydrationBoundary", () => ({ ProgressHydrationBoundary: () => null, ProgressReloadNotice: () => <button>Reload</button> }));

beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); localStorage.clear(); sessionStorage.clear(); mock.session = { status: "authenticated", data: { user: { id: "A" } } }; });
afterEach(cleanup);
function deferred() {
  let resolve!: (session: { user: { id: string } } | null) => void;
  const promise = new Promise<{ user: { id: string } } | null>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture() {
  const { ownerBoundProgress: authority } = await import("@/lib/owner-bound-progress");
  const { createOwnerPersistStorage } = await import("@/lib/owner-bound-progress/persistStorage");
  const { ProgressSessionBoundary } = await import("../AuthProvider");
  const key = "snake-game-state";
  const store = createStore<{ score: number }>()(persist(() => ({ score: 0 }), {
    name: key, skipHydration: true, storage: createOwnerPersistStorage(key, "snake"),
  }));
  authority.bindPersistedStore(key, store.persist);
  await authority.updateSession("authenticated", "A"); await authority.whenHydrated(key);
  store.setState({ score: 27 });
  const rehydrate = vi.spyOn(store.persist, "rehydrate");
  const view = render(<ProgressSessionBoundary><p>A private progress</p></ProgressSessionBoundary>);
  return { authority, store, rehydrate, view, ProgressSessionBoundary };
}

describe("bfcache owner revalidation with a real persistence authority", () => {
  it("suspends A before restored listeners and navigates when the cookie now belongs to B", async () => {
    const fresh = deferred(); mock.getSession.mockReturnValue(fresh.promise);
    const { authority, store } = await fixture();
    const lease = authority.captureLease()!;
    const observed: boolean[] = [];
    const observer = () => observed.push(authority.isCurrent(lease));
    window.addEventListener("pageshow", observer);
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    window.removeEventListener("pageshow", observer);
    expect(observed).toEqual([false]);
    expect(authority.getSnapshot().status).toBe("unresolved");
    expect(screen.queryByText("A private progress")).toBeNull();
    expect(mock.getSession).toHaveBeenCalledWith({ broadcast: false });
    await act(async () => fresh.resolve({ user: { id: "B" } }));
    expect(authority.getSnapshot().status).toBe("revoked");
    expect(store.getState().score).toBe(27);
    expect(mock.reload).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Reload" })).toBeVisible();
  });

  it("resumes A's existing in-memory store without rehydration when the fresh session is still A", async () => {
    const fresh = deferred(); mock.getSession.mockReturnValue(fresh.promise);
    const { authority, store, rehydrate } = await fixture();
    const lease = authority.captureLease()!;
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    expect(screen.queryByText("A private progress")).toBeNull();
    await act(async () => fresh.resolve({ user: { id: "A" } }));
    await waitFor(() => expect(authority.getSnapshot().status).toBe("ready"));
    expect(authority.isCurrent(lease)).toBe(false);
    expect(store.getState().score).toBe(27);
    expect(rehydrate).not.toHaveBeenCalled();
    expect(mock.reload).not.toHaveBeenCalled();
    expect(screen.getByText("A private progress")).toBeVisible();
  });

  it("ignores an old refresh reply after a newer context owner observation", async () => {
    const fresh = deferred(); mock.getSession.mockReturnValue(fresh.promise);
    const { authority, view, ProgressSessionBoundary } = await fixture();
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    mock.session = { status: "authenticated", data: { user: { id: "B" } } };
    view.rerender(<ProgressSessionBoundary><p>A private progress</p></ProgressSessionBoundary>);
    expect(authority.getSnapshot().status).toBe("revoked");
    await act(async () => fresh.resolve({ user: { id: "A" } }));
    expect(authority.getSnapshot().status).toBe("revoked");
    expect(screen.queryByText("A private progress")).toBeNull();
  });

  it("does not let an older B reply override a newer A session object", async () => {
    const fresh = deferred(); mock.getSession.mockReturnValue(fresh.promise);
    const { authority, view, ProgressSessionBoundary } = await fixture();
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    mock.session = { status: "authenticated", data: { user: { id: "A" } } };
    view.rerender(<ProgressSessionBoundary><p>A private progress</p></ProgressSessionBoundary>);
    await waitFor(() => expect(authority.getSnapshot().status).toBe("ready"));
    await act(async () => fresh.resolve({ user: { id: "B" } }));
    expect(authority.getSnapshot().status).toBe("ready");
    expect(mock.reload).not.toHaveBeenCalled();
  });

  it("offers reload without exposing stale progress when fresh-session lookup rejects", async () => {
    mock.getSession.mockRejectedValue(new Error("offline"));
    const { authority } = await fixture();
    await act(async () => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    expect(authority.getSnapshot().status).toBe("revoked");
    expect(screen.queryByText("A private progress")).toBeNull();
    expect(screen.getByRole("button", { name: "Reload" })).toBeVisible();
  });

  it("lets only the newest restore request confirm the owner", async () => {
    const old = deferred(), latest = deferred(); mock.getSession.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const { authority } = await fixture();
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await act(async () => old.resolve({ user: { id: "A" } }));
    expect(authority.getSnapshot().status).toBe("unresolved");
    await act(async () => latest.resolve({ user: { id: "B" } }));
    expect(authority.getSnapshot().status).toBe("revoked");
  });
});
