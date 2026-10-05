import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  session: { status: "authenticated", data: { user: { id: "A" } } },
  snapshot: { status: "ready", ownerKey: "owner-A" as string | null, generation: 1, needsNavigation: false, memoryOnly: false },
  pathname: "/games/snake", matches: true, listeners: new Set<() => void>(),
  updateSession: vi.fn(), revoke: vi.fn(), reload: vi.fn(), pending: false,
}));
vi.mock("next-auth/react", () => ({ getSession: vi.fn(), useSession: () => mock.session, SessionProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("next/navigation", () => ({ usePathname: () => mock.pathname }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/shared/clips/service/ClipSessionWatcher", () => ({ ClipSessionWatcher: () => null }));
vi.mock("@/lib/auth-client", () => ({ consumeGuestHandoffNavigation: vi.fn(), isAuthNavigationPending: () => mock.pending, PROGRESS_SESSION_CHANNEL: "test-progress-session", reloadProgressPage: mock.reload }));
vi.mock("@/lib/owner-bound-progress", () => ({ ownerBoundProgress: {
  getSnapshot: () => mock.snapshot,
  subscribe: (listener: () => void) => { mock.listeners.add(listener); return () => mock.listeners.delete(listener); },
  matchesSession: () => mock.matches, updateSession: mock.updateSession, revoke: mock.revoke,
} }));
vi.mock("../ProgressHydrationBoundary", () => ({
  ProgressHydrationBoundary: () => null,
  ProgressReloadNotice: () => <button>Reload</button>,
}));
import { ProgressSessionBoundary } from "../AuthProvider";

beforeEach(() => {
  vi.clearAllMocks(); mock.session = { status: "authenticated", data: { user: { id: "A" } } };
  mock.snapshot = { status: "ready", ownerKey: "owner-A", generation: 1, needsNavigation: false, memoryOnly: false };
  mock.matches = true; mock.pathname = "/games/snake"; mock.pending = false;
});
afterEach(cleanup);

describe("progress session boundary", () => {
  it("masks the previous owner on the mismatched render even if the session effect is deferred", () => {
    mock.updateSession.mockImplementation(() => new Promise(() => {}));
    const view = render(<ProgressSessionBoundary><p>A private progress</p></ProgressSessionBoundary>);
    expect(screen.getByText("A private progress")).toBeVisible();
    mock.session = { status: "authenticated", data: { user: { id: "B" } } }; mock.matches = false;
    view.rerender(<ProgressSessionBoundary><p>A private progress</p></ProgressSessionBoundary>);
    expect(screen.queryByText("A private progress")).toBeNull();
  });

  it("keeps login available during initial unresolved auth without treating loading as guest", () => {
    mock.pathname = "/login"; mock.matches = false; mock.session.status = "loading";
    mock.snapshot = { ...mock.snapshot, status: "unresolved", ownerKey: null };
    render(<ProgressSessionBoundary><button>Sign In</button></ProgressSessionBoundary>);
    expect(screen.getByRole("button", { name: "Sign In" })).toBeVisible();
    expect(mock.updateSession).toHaveBeenCalledWith("loading", "A");
  });

  it("keeps an existing login form available during temporary session loading", () => {
    mock.pathname = "/login"; mock.matches = false; mock.session.status = "loading";
    mock.snapshot = { ...mock.snapshot, status: "unresolved", ownerKey: "guest" };
    render(<ProgressSessionBoundary><button>Sign In</button></ProgressSessionBoundary>);
    expect(screen.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  it("keeps owned play visible and reports unavailable reload recovery on storage failure", () => {
    mock.snapshot = { ...mock.snapshot, memoryOnly: true };
    render(<ProgressSessionBoundary><button>Play</button></ProgressSessionBoundary>);
    expect(screen.getByRole("button", { name: "Play" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Some device saves are unavailable");
  });

  it("keeps revoked consumers hidden and retries no automatic navigation twice", async () => {
    render(<ProgressSessionBoundary><p>A private progress</p></ProgressSessionBoundary>);
    await act(async () => { mock.snapshot = { ...mock.snapshot, status: "revoked", needsNavigation: true, generation: 2 }; mock.listeners.forEach(listener => listener()); });
    expect(mock.reload).toHaveBeenCalledOnce();
    expect(screen.queryByText("A private progress")).toBeNull();
    expect(screen.getByRole("button", { name: "Reload" })).toBeVisible();
    await act(async () => { mock.snapshot = { ...mock.snapshot }; mock.listeners.forEach(listener => listener()); });
    expect(mock.reload).toHaveBeenCalledOnce();
  });

  it("does not race an in-flight authentication navigation with a reload", () => {
    mock.pending = true; mock.snapshot = { ...mock.snapshot, status: "revoked", needsNavigation: true };
    render(<ProgressSessionBoundary><p>Private</p></ProgressSessionBoundary>);
    expect(mock.reload).not.toHaveBeenCalled();
    expect(screen.queryByText("Private")).toBeNull();
  });

  it("revokes leases on the cross-tab sign-out event", () => {
    render(<ProgressSessionBoundary><p>Private</p></ProgressSessionBoundary>);
    window.dispatchEvent(new StorageEvent("storage", { key: "hanks-hits-signout-broadcast", newValue: "1" }));
    expect(mock.revoke).toHaveBeenCalledOnce();
  });
});
