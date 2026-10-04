import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ signIn: vi.fn(), signOut: vi.fn(), revoke: vi.fn(), handoff: vi.fn(), cancel: vi.fn(), proof: vi.fn(), authorize: vi.fn(), failure: vi.fn() }));
vi.mock("next-auth/react", () => ({ signIn: mock.signIn, signOut: mock.signOut, useSession: vi.fn(), SessionProvider: vi.fn() }));
vi.mock("../owner-bound-progress", () => ({ ownerBoundProgress: { revoke: mock.revoke, prepareGuestHandoff: mock.handoff, cancelGuestHandoff: mock.cancel, getGuestHandoffProof: mock.proof, authorizeGuestHandoff: mock.authorize, reportGuestHandoffFailure: mock.failure } }));
import { consumeGuestHandoffNavigation, GUEST_HANDOFF_PARAM, isAuthNavigationPending, reloadProgressPage, signInWithCredentials, signInWithGoogle, signOutAndClear } from "../auth-client";

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  assign = vi.fn(); vi.stubGlobal("window", { location: { assign, reload: vi.fn(), origin: "https://example.test" } });
  mock.signIn.mockResolvedValue({ ok: true, error: null }); mock.signOut.mockResolvedValue(undefined);
  mock.proof.mockReturnValue(null);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("owner-bound authentication transitions", () => {
  it("records explicit guest handoff, revokes, then hard navigates to the intended return path", async () => {
    const order: string[] = [];
    mock.handoff.mockImplementation(() => order.push("handoff"));
    mock.signIn.mockImplementation(async () => { order.push("signin"); return { ok: true }; });
    mock.revoke.mockImplementation(() => order.push("revoke"));
    assign.mockImplementation(() => order.push("navigate"));
    await signInWithCredentials("test@example.test", "password", "/games/snake");
    expect(order).toEqual(["handoff", "signin", "revoke", "navigate"]);
    expect(assign).toHaveBeenCalledWith("https://example.test/games/snake");
  });

  it("cancels a failed sign-in handoff without revoking guest play", async () => {
    mock.signIn.mockResolvedValue({ ok: false, error: "CredentialsSignin" });
    await signInWithCredentials("test@example.test", "wrong");
    expect(mock.cancel).toHaveBeenCalledOnce();
    expect(mock.revoke).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("carries only the fresh opaque proof through both auth paths, preserving clip query and hash", async () => {
    const nonce = "a".repeat(48); mock.proof.mockReturnValue(nonce);
    const target = `/games/snake?from=clip&${GUEST_HANDOFF_PARAM}=${nonce}#play`;
    await signInWithCredentials("test@example.test", "password", `/games/snake?from=clip&${GUEST_HANDOFF_PARAM}=stale#play`);
    expect(assign).toHaveBeenLastCalledWith(`https://example.test${target}`);
    reloadProgressPage(); // Back restores the original revoked source document.
    expect(assign).toHaveBeenLastCalledWith("https://example.test/games/snake?from=clip#play");
    await signInWithGoogle("/games/snake?from=clip#play");
    expect(mock.signIn).toHaveBeenLastCalledWith("google", { callbackUrl: target });
    reloadProgressPage();
    expect(assign).toHaveBeenLastCalledWith("https://example.test/games/snake?from=clip#play");
  });

  it.each(["https://other.test/steal", "//other.test/steal", "/\\other.test/steal"])("keeps unsafe callback %s on this origin", async callback => {
    await signInWithCredentials("test@example.test", "password", callback);
    expect(assign).toHaveBeenLastCalledWith("https://example.test/");
  });

  it("removes the proof before authorization while preserving other URL parts and history state", () => {
    const nonce = "b".repeat(48), state = { scroll: 5 };
    const replaceState = vi.fn(() => { expect(mock.authorize).not.toHaveBeenCalled(); });
    vi.stubGlobal("window", { location: { href: `https://example.test/games/snake?from=clip&${GUEST_HANDOFF_PARAM}=${nonce}#play` }, history: { state, replaceState } });
    consumeGuestHandoffNavigation();
    expect(replaceState).toHaveBeenCalledWith(state, "", "/games/snake?from=clip#play");
    expect(mock.authorize).toHaveBeenCalledExactlyOnceWith(nonce);
  });

  it("does not authorize when history cannot consume the proof", () => {
    const replace = vi.fn(() => { throw new Error("navigation denied"); });
    vi.stubGlobal("window", { location: { origin: "https://example.test", assign, replace, href: `https://example.test/?from=clip&${GUEST_HANDOFF_PARAM}=${"b".repeat(48)}#play` }, history: { state: null, replaceState: vi.fn(() => { throw new Error("denied"); }) } });
    consumeGuestHandoffNavigation();
    expect(mock.authorize).not.toHaveBeenCalled();
    expect(mock.failure).toHaveBeenCalledOnce();
    expect(mock.cancel).toHaveBeenCalledOnce();
    expect(mock.revoke).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("https://example.test/?from=clip#play");
    reloadProgressPage();
    expect(assign).toHaveBeenCalledWith("https://example.test/?from=clip#play");
  });

  it("cancels network-failed authentication handoff", async () => {
    mock.signIn.mockRejectedValue(new Error("network"));
    await expect(signInWithCredentials("test@example.test", "password")).rejects.toThrow("network");
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it("revokes before OAuth navigation and clears the handoff if it fails", async () => {
    mock.signIn.mockImplementation(async () => { expect(mock.revoke).toHaveBeenCalledOnce(); throw new Error("offline"); });
    await expect(signInWithGoogle()).rejects.toThrow("offline");
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it("signs out despite denied broadcast storage and never removes legacy saves", async () => {
    localStorage.setItem("oregon-trail-storage", "original");
    localStorage.setItem("hanks-hits-progress-owner", "A");
    const remove = vi.spyOn(localStorage, "removeItem");
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("denied"); });
    const post = vi.fn();
    vi.stubGlobal("BroadcastChannel", class { postMessage = post; close = vi.fn(); });
    mock.signOut.mockImplementation(async () => { expect(mock.revoke).toHaveBeenCalledOnce(); });
    await signOutAndClear("/");
    expect(mock.signOut).toHaveBeenCalledWith({ callbackUrl: "/", redirect: false });
    expect(post).toHaveBeenCalledWith("signout");
    expect(remove).not.toHaveBeenCalled();
    expect(localStorage.getItem("oregon-trail-storage")).toBe("original");
    expect(localStorage.getItem("hanks-hits-progress-owner")).toBe("A");
  });

  it("waits for sign-out completion then ignores the canonical server redirect host", async () => {
    let finish!: (result: { url: string }) => void;
    mock.signOut.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = signOutAndClear("/games/snake?from=clip#play");
    expect(mock.revoke).toHaveBeenCalledOnce();
    expect(isAuthNavigationPending()).toBe(true);
    expect(assign).not.toHaveBeenCalled();
    const result = { url: "http://0.0.0.0:3117/" };
    finish(result);
    expect(await pending).toBe(result);
    expect(assign).toHaveBeenCalledExactlyOnceWith("https://example.test/games/snake?from=clip#play");
  });

  it("keeps a clean same-origin retry after a failed sign-out request", async () => {
    mock.signOut.mockRejectedValue(new Error("offline"));
    await expect(signOutAndClear(`/?from=clip&${GUEST_HANDOFF_PARAM}=stale#play`)).rejects.toThrow("offline");
    expect(mock.revoke).toHaveBeenCalledOnce();
    expect(isAuthNavigationPending()).toBe(true);
    expect(assign).not.toHaveBeenCalled();
    reloadProgressPage();
    expect(assign).toHaveBeenCalledWith("https://example.test/?from=clip#play");
  });

  it("rejects an external callback and retains Reload if navigation is denied", async () => {
    mock.signOut.mockResolvedValue({ url: "https://other.test/" });
    assign.mockImplementationOnce(() => { throw new Error("navigation denied"); });
    await signOutAndClear("https://other.test/");
    expect(mock.signOut).toHaveBeenCalledWith({ callbackUrl: "/", redirect: false });
    expect(assign).toHaveBeenCalledWith("https://example.test/");
    expect(isAuthNavigationPending()).toBe(true);
    reloadProgressPage();
    expect(assign).toHaveBeenLastCalledWith("https://example.test/");
  });

  it.each(["/#play", "/"])("forces a fresh document for same-page fragment navigation to %s", async target => {
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { assign, reload, origin: "https://example.test", pathname: "/", search: "", hash: "#old" } });
    await signOutAndClear(target);
    expect(assign).toHaveBeenCalledWith(`https://example.test${target}`);
    expect(reload).toHaveBeenCalledOnce();
  });
});
