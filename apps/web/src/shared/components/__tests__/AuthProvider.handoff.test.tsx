import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ session: { status: "authenticated", data: { user: { id: "A" } } } }));
vi.mock("next-auth/react", () => ({ getSession: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), useSession: () => mock.session, SessionProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/shared/clips/service/ClipSessionWatcher", () => ({ ClipSessionWatcher: () => null }));
vi.mock("../ProgressHydrationBoundary", () => ({ ProgressHydrationBoundary: () => null, ProgressReloadNotice: () => <button>Reload</button> }));

beforeEach(() => {
  vi.resetModules(); localStorage.clear(); sessionStorage.clear();
  history.replaceState(null, "", "/");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); history.replaceState(null, "", "/"); });

async function fixture() {
  const { createOwnerBoundProgress, GUEST_HANDOFF_KEY } = await import("@/lib/owner-bound-progress/core");
  const { ownerBoundProgress } = await import("@/lib/owner-bound-progress");
  const { GUEST_HANDOFF_PARAM } = await import("@/lib/auth-client");
  const { ProgressSessionBoundary } = await import("../AuthProvider");
  const guest = createOwnerBoundProgress();
  await guest.updateSession("unauthenticated");
  const raw = JSON.stringify({ state: { progress: { bestScore: 17, lastModified: 100 } }, version: 0 });
  guest.writeScoped("snake-game-state", raw);
  expect(guest.prepareGuestHandoff()).toBe(true);
  const nonce = guest.getGuestHandoffProof()!;
  history.replaceState({ original: true }, "", `/?from=clip&${GUEST_HANDOFF_PARAM}=${nonce}#play`);
  return { createOwnerBoundProgress, GUEST_HANDOFF_KEY, GUEST_HANDOFF_PARAM, ownerBoundProgress, ProgressSessionBoundary, guest, raw };
}

describe("sign-in navigation proof before owner binding", () => {
  it("consumes the URL proof before claiming an unbound receipt and preserves return context", async () => {
    const { ownerBoundProgress, ProgressSessionBoundary, GUEST_HANDOFF_KEY, raw } = await fixture();
    const write = sessionStorage.setItem.bind(sessionStorage);
    vi.spyOn(sessionStorage, "setItem").mockImplementation((key, value) => {
      if (key === GUEST_HANDOFF_KEY) {
        expect(location.search).toBe("?from=clip");
        expect(location.hash).toBe("#play");
      }
      write(key, value);
    });
    render(<ProgressSessionBoundary><p>Home</p></ProgressSessionBoundary>);
    await waitFor(() => expect(ownerBoundProgress.getSnapshot().status).toBe("ready"));
    expect(ownerBoundProgress.readGuestCandidate("snake-game-state")?.raw).toBe(raw);
    expect(history.state).toEqual({ original: true });
  });

  it("never lets B claim an unbound receipt after A's initial binding write fails", async () => {
    const { ownerBoundProgress, ProgressSessionBoundary, GUEST_HANDOFF_KEY, createOwnerBoundProgress, guest, raw } = await fixture();
    const write = sessionStorage.setItem.bind(sessionStorage);
    const denied = vi.spyOn(sessionStorage, "setItem").mockImplementation((key, value) => {
      if (key === GUEST_HANDOFF_KEY) throw new DOMException("full", "QuotaExceededError");
      write(key, value);
    });
    render(<ProgressSessionBoundary><p>Home</p></ProgressSessionBoundary>);
    await waitFor(() => expect(ownerBoundProgress.getSnapshot().status).toBe("ready"));
    expect(ownerBoundProgress.readGuestCandidate("snake-game-state")).toBeNull();
    expect(screen.getByText(/Guest progress could not be carried/)).toBeVisible();
    expect(location.search).toBe("?from=clip");
    cleanup(); denied.mockRestore();
    const later = createOwnerBoundProgress(); await later.updateSession("authenticated", "B");
    expect(later.readGuestCandidate("snake-game-state")).toBeNull();
    expect(guest.readScoped("snake-game-state")).toBe(raw);
  });

  it("cancels only the unbound receipt and keeps a clean retry when history and navigation are denied", async () => {
    const { ownerBoundProgress, ProgressSessionBoundary, guest, raw, createOwnerBoundProgress, GUEST_HANDOFF_KEY } = await fixture();
    const replace = vi.fn(() => { throw new Error("navigation denied"); });
    const browser = window;
    vi.stubGlobal("window", new Proxy(browser, { get(target, key) {
      if (key === "location") return { href: target.location.href, origin: target.location.origin, replace };
      if (key === "addEventListener" || key === "removeEventListener") return target[key].bind(target);
      return Reflect.get(target, key, target);
    } }));
    vi.spyOn(history, "replaceState").mockImplementation(() => { throw new Error("denied"); });
    render(<ProgressSessionBoundary><p>Account progress</p></ProgressSessionBoundary>);
    await waitFor(() => expect(ownerBoundProgress.getSnapshot().status).toBe("revoked"));
    expect(ownerBoundProgress.readGuestCandidate("snake-game-state")).toBeNull();
    expect(guest.readScoped("snake-game-state")).toBe(raw);
    expect(sessionStorage.getItem(GUEST_HANDOFF_KEY)).toBeNull();
    expect(screen.queryByText("Account progress")).toBeNull();
    expect(screen.getByRole("button", { name: "Reload" })).toBeVisible();
    expect(replace).toHaveBeenCalledWith(`${location.origin}/?from=clip#play`);
    const later = createOwnerBoundProgress(); await later.updateSession("authenticated", "B");
    expect(later.readGuestCandidate("snake-game-state")).toBeNull();
  });
});
