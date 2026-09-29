import { describe, expect, it, vi } from "vitest";

import {
  CAPTURE_LOCK,
  GUEST_KEEP_MS,
  Lifecycle,
  RESUME_GRACE_MS,
  hiddenClosesEncoder,
  ownerChangeAction,
  readSessionUserId,
  type LifecycleEnv,
  type LifecycleListener,
} from "../lifecycle";
import { FakeLockManager, settleLocks } from "./fakeLocks";

/** A tab: a document and a window as event targets, with visibility and focus under test control. */
class FakeTab {
  readonly doc = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
    focused: true,
    hasFocus(): boolean {
      return this.focused;
    },
  });
  readonly win = new EventTarget();
  now = 0;
  readonly events: string[] = [];
  readonly lifecycle: Lifecycle;

  constructor(locks: FakeLockManager | null, id: string) {
    const env: LifecycleEnv = {
      doc: this.doc as unknown as LifecycleEnv["doc"],
      win: this.win as unknown as LifecycleEnv["win"],
      locks: locks ? locks.client(id) : null,
      now: () => this.now,
    };
    this.lifecycle = new Lifecycle(env);
    const listener: LifecycleListener = {
      visibility: (v) => this.events.push(`visible:${v}`),
      pageHide: (p) => this.events.push(`pagehide:${p}`),
      pageShow: (p) => this.events.push(`pageshow:${p}`),
      election: (o) => this.events.push(`owns:${o}`),
    };
    this.lifecycle.start(listener);
  }

  setVisible(visible: boolean): void {
    this.doc.visibilityState = visible ? "visible" : "hidden";
    this.doc.dispatchEvent(new Event("visibilitychange"));
  }

  focus(): void {
    this.doc.focused = true;
    this.win.dispatchEvent(new Event("focus"));
  }

  page(type: "pagehide" | "pageshow", persisted: boolean): void {
    const event = new Event(type) as Event & { persisted: boolean };
    Object.defineProperty(event, "persisted", { value: persisted });
    this.win.dispatchEvent(event);
  }
}

describe("capture election (Web Locks)", () => {
  it("gives the lock to the focused tab that wants to capture", async () => {
    const locks = new FakeLockManager();
    const a = new FakeTab(locks, "a");
    expect(a.lifecycle.ownsCapture).toBe(false);
    a.lifecycle.wantCapture(true);
    await settleLocks();
    expect(a.lifecycle.ownsCapture).toBe(true);
    expect(locks.holderOf(CAPTURE_LOCK)).toBe("a");
    expect(a.events).toEqual(["owns:true"]);
  });

  it("moves capture to the tab that gets focus, and the other tab stops (other-tab)", async () => {
    const locks = new FakeLockManager();
    const a = new FakeTab(locks, "a");
    const b = new FakeTab(locks, "b");
    a.lifecycle.wantCapture(true);
    await settleLocks();
    b.doc.focused = false;
    b.lifecycle.wantCapture(true);
    await settleLocks();
    // b is not focused: it does not take the lock.
    expect(locks.holderOf(CAPTURE_LOCK)).toBe("a");
    a.doc.focused = false;
    b.focus();
    await settleLocks();
    expect(locks.holderOf(CAPTURE_LOCK)).toBe("b");
    expect(a.lifecycle.ownsCapture).toBe(false);
    expect(b.lifecycle.ownsCapture).toBe(true);
    expect(a.events).toEqual(["owns:true", "owns:false"]);
    // Focus back to a: it takes the lock back.
    b.doc.focused = false;
    a.focus();
    await settleLocks();
    expect(locks.holderOf(CAPTURE_LOCK)).toBe("a");
    expect(b.lifecycle.ownsCapture).toBe(false);
  });

  it("lets the lock go when hidden and takes it again when visible and focused", async () => {
    const locks = new FakeLockManager();
    const a = new FakeTab(locks, "a");
    a.lifecycle.wantCapture(true);
    await settleLocks();
    a.setVisible(false);
    await settleLocks();
    expect(locks.holderOf(CAPTURE_LOCK)).toBeNull();
    expect(a.events).toEqual(["owns:true", "visible:false", "owns:false"]);
    a.setVisible(true);
    await settleLocks();
    expect(locks.holderOf(CAPTURE_LOCK)).toBe("a");
    expect(a.events.slice(-2)).toEqual(["visible:true", "owns:true"]);
  });

  it("releases at pagehide (bfcache) and elects again at a persisted pageshow", async () => {
    const locks = new FakeLockManager();
    const a = new FakeTab(locks, "a");
    a.lifecycle.wantCapture(true);
    await settleLocks();
    a.page("pagehide", true);
    await settleLocks();
    expect(locks.holderOf(CAPTURE_LOCK)).toBeNull();
    a.page("pageshow", false);
    await settleLocks();
    expect(locks.holderOf(CAPTURE_LOCK)).toBeNull();
    a.page("pageshow", true);
    await settleLocks();
    expect(locks.holderOf(CAPTURE_LOCK)).toBe("a");
    expect(a.events).toEqual(["owns:true", "pagehide:true", "owns:false", "pageshow:true", "owns:true"]);
  });

  it("lets go when the service no longer wants to capture", async () => {
    const locks = new FakeLockManager();
    const a = new FakeTab(locks, "a");
    a.lifecycle.wantCapture(true);
    await settleLocks();
    a.lifecycle.wantCapture(false);
    await settleLocks();
    expect(locks.holderOf(CAPTURE_LOCK)).toBeNull();
    expect(a.lifecycle.ownsCapture).toBe(false);
  });

  it("captures with no election when the browser refuses the lock request itself", async () => {
    const refusing = {
      request: () => Promise.reject(new DOMException("steal is not supported", "NotSupportedError")),
      query: async () => ({ held: [], pending: [] }),
    };
    const events: string[] = [];
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState, hasFocus: () => true });
    const lifecycle = new Lifecycle({
      doc: doc as unknown as LifecycleEnv["doc"],
      win: new EventTarget() as unknown as LifecycleEnv["win"],
      locks: refusing,
      now: () => 0,
    });
    lifecycle.start({ visibility: () => undefined, pageHide: () => undefined, pageShow: () => undefined, election: (o) => events.push(`owns:${o}`) });
    lifecycle.wantCapture(true);
    await settleLocks();
    expect(lifecycle.ownsCapture).toBe(true);
    // Hidden and back: still no election, still capturing.
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await settleLocks();
    expect(lifecycle.ownsCapture).toBe(true);
    expect(events).toEqual(["owns:true"]);
  });

  it("always captures without Web Locks", () => {
    const a = new FakeTab(null, "a");
    a.lifecycle.wantCapture(true);
    expect(a.lifecycle.ownsCapture).toBe(true);
    a.setVisible(false);
    expect(a.lifecycle.ownsCapture).toBe(true);
  });

  it("stops listening at stop()", async () => {
    const locks = new FakeLockManager();
    const a = new FakeTab(locks, "a");
    a.lifecycle.wantCapture(true);
    await settleLocks();
    a.lifecycle.stop();
    await settleLocks();
    a.setVisible(false);
    expect(a.events).toEqual(["owns:true"]);
    expect(locks.holderOf(CAPTURE_LOCK)).toBeNull();
  });

  it("tells the listener when the browser is online again, and stops at stop()", () => {
    const a = new FakeTab(null, "a");
    const online = vi.fn();
    a.lifecycle.start({ visibility: () => undefined, pageHide: () => undefined, pageShow: () => undefined, election: () => undefined, online });
    a.win.dispatchEvent(new Event("online"));
    expect(online).toHaveBeenCalledTimes(1);
    a.lifecycle.stop();
    a.win.dispatchEvent(new Event("online"));
    expect(online).toHaveBeenCalledTimes(1);
  });
});

describe("resume grace (plan 7.1)", () => {
  it("does not count errors while hidden or in the first seconds after the page shows", () => {
    const a = new FakeTab(null, "a");
    a.now = 100_000;
    a.setVisible(false);
    expect(a.lifecycle.inResumeGrace()).toBe(true);
    a.setVisible(true);
    expect(a.lifecycle.inResumeGrace()).toBe(true);
    a.now += RESUME_GRACE_MS - 1;
    expect(a.lifecycle.inResumeGrace()).toBe(true);
    a.now += 1;
    expect(a.lifecycle.inResumeGrace()).toBe(false);
  });
});

describe("ownerChangeAction (plan 7.1)", () => {
  const base = { nowMs: 100_000, lastRunEndAtMs: 90_000, runActive: false, bfcacheRestore: false };
  const USER = "u_0123456789abcdef0123";
  const OTHER = "u_ffffffffffffffffffff";

  it("keeps a guest run when sign-in completes within 60 s of its end", () => {
    expect(ownerChangeAction({ ...base, from: "guest", to: USER })).toBe("keep");
    expect(ownerChangeAction({ ...base, from: "guest", to: USER, nowMs: 90_000 + GUEST_KEEP_MS })).toBe("keep");
  });

  it("purges a guest run after 60 s, with no run end, or while a new run is on", () => {
    expect(ownerChangeAction({ ...base, from: "guest", to: USER, nowMs: 90_000 + GUEST_KEEP_MS + 1 })).toBe("purge");
    expect(ownerChangeAction({ ...base, from: "guest", to: USER, lastRunEndAtMs: null })).toBe("purge");
    expect(ownerChangeAction({ ...base, from: "guest", to: USER, runActive: true })).toBe("purge");
  });

  it("always purges user to other user and user to guest", () => {
    expect(ownerChangeAction({ ...base, from: USER, to: OTHER })).toBe("purge");
    expect(ownerChangeAction({ ...base, from: USER, to: "guest" })).toBe("purge");
  });

  it("purges a bfcache restore with a different owner, and keeps the same owner", () => {
    expect(ownerChangeAction({ ...base, from: "guest", to: USER, bfcacheRestore: true })).toBe("purge");
    expect(ownerChangeAction({ ...base, from: USER, to: USER, bfcacheRestore: true })).toBe("keep");
  });
});

describe("platform and session helpers", () => {
  it("closes encoders on hide only on iOS and iPadOS", () => {
    expect(hiddenClosesEncoder({ platform: "iPhone" })).toBe(true);
    expect(hiddenClosesEncoder({ platform: "iPad" })).toBe(true);
    expect(hiddenClosesEncoder({ platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(hiddenClosesEncoder({ platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(hiddenClosesEncoder({ platform: "Linux armv8l" })).toBe(false);
    expect(hiddenClosesEncoder(undefined)).toBe(false);
  });

  it("reads the signed-in user id fresh, and null for a guest", async () => {
    const signedIn = vi.fn(async () => new Response(JSON.stringify({ user: { id: "abc" }, expires: "x" })));
    expect(await readSessionUserId(signedIn as unknown as typeof fetch)).toBe("abc");
    expect(signedIn).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({ cache: "no-store" }));
    const guest = vi.fn(async () => new Response("null"));
    expect(await readSessionUserId(guest as unknown as typeof fetch)).toBeNull();
    const down = vi.fn(async () => new Response("", { status: 500 }));
    await expect(readSessionUserId(down as unknown as typeof fetch)).rejects.toThrow();
  });
});
