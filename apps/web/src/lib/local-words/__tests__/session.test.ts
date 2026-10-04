import { describe, expect, it, vi } from "vitest";
import { createLocalWordsSession } from "../session";
import { GUEST_OWNER_KEY, ownerKeyFor } from "@/shared/clips/library/ownerKey";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("local words owner session", () => {
  it("starts unresolved and does not hash or touch the browser on construction", () => {
    const hash = vi.fn();
    const session = createLocalWordsSession({ ownerKeyFor: hash });
    expect(session.getSnapshot()).toEqual({ status: "unresolved", generation: 0 });
    expect(session.captureLease()).toBeNull();
    expect(hash).not.toHaveBeenCalled();
  });

  it("uses the shared owner namespace and distinguishes loading from confirmed guest", async () => {
    const session = createLocalWordsSession();
    await session.update("authenticated", "player-a");
    expect(session.getSnapshot()).toMatchObject({ status: "account", ownerKey: await ownerKeyFor("player-a") });
    const account = session.captureLease()!;
    await session.update("loading");
    expect(session.getSnapshot().status).toBe("unresolved");
    expect(session.captureLease()).toBeNull();
    expect(session.isCurrent(account)).toBe(false);
    await session.update("unauthenticated");
    expect(session.getSnapshot()).toMatchObject({ status: "guest", ownerKey: GUEST_OWNER_KEY });
    await session.update("authenticated");
    expect(session.getSnapshot().status).toBe("unresolved");
  });

  it("rejects delayed A hashes after B is confirmed", async () => {
    const a = deferred<string>();
    const session = createLocalWordsSession({ ownerKeyFor: (id) => id === "a" ? a.promise : Promise.resolve("owner-b") });
    const first = session.update("authenticated", "a");
    await session.update("authenticated", "b");
    const b = session.captureLease()!;
    a.resolve("owner-a");
    await first;
    expect(session.isCurrent(b)).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ status: "account", ownerKey: "owner-b" });
  });

  it("invalidates and notifies synchronously before invoking the next hash", async () => {
    const b = deferred<string>();
    const hash = vi.fn((id: string | null) => id === "a" ? Promise.resolve("owner-a") : b.promise);
    const session = createLocalWordsSession({ ownerKeyFor: hash });
    await session.update("authenticated", "a");
    const lease = session.captureLease()!;
    const listener = vi.fn(() => {
      if (session.getSnapshot().status === "unresolved") {
        expect(session.isCurrent(lease)).toBe(false);
        expect(hash).toHaveBeenCalledTimes(1);
      }
    });
    session.subscribe(listener);
    const pending = session.update("authenticated", "b");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.captureLease()).toBeNull();
    b.resolve("owner-b");
    await pending;
  });

  it("keeps snapshot identity, generation and leases stable for the same session", async () => {
    const hash = vi.fn(async () => "owner-a");
    const session = createLocalWordsSession({ ownerKeyFor: hash });
    await session.update("authenticated", "a");
    const snapshot = session.getSnapshot();
    const lease = session.captureLease()!;
    const listener = vi.fn();
    session.subscribe(listener);
    await session.update("authenticated", "a");
    expect(session.getSnapshot()).toBe(snapshot);
    expect(session.isCurrent(lease)).toBe(true);
    expect(hash).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not start duplicate hashes while the same session is pending", async () => {
    const a = deferred<string>();
    const hash = vi.fn(() => a.promise);
    const session = createLocalWordsSession({ ownerKeyFor: hash });
    const pending = session.update("authenticated", "a");
    const snapshot = session.getSnapshot();
    await session.update("authenticated", "a");
    expect(session.getSnapshot()).toBe(snapshot);
    expect(hash).toHaveBeenCalledTimes(1);
    a.resolve("owner-a");
    await pending;
  });

  it("sign-out invalidation rejects an in-flight hash and old leases even on return", async () => {
    const a = deferred<string>();
    const session = createLocalWordsSession({ ownerKeyFor: () => a.promise });
    const pending = session.update("authenticated", "a");
    session.invalidate();
    a.resolve("owner-a");
    await pending;
    expect(session.captureLease()).toBeNull();
    await session.update("authenticated", "a");
    const lease = session.captureLease()!;
    session.invalidate();
    await session.update("authenticated", "a");
    expect(session.isCurrent(lease)).toBe(false);
  });

  it("keeps guest confirmed when an earlier account hash arrives after sign-out", async () => {
    const a = deferred<string>();
    const session = createLocalWordsSession({ ownerKeyFor: (id) => id ? a.promise : Promise.resolve(GUEST_OWNER_KEY) });
    const pending = session.update("authenticated", "a");
    await session.update("unauthenticated");
    const guest = session.captureLease()!;
    a.resolve("owner-a");
    await pending;
    expect(session.isCurrent(guest)).toBe(true);
    expect(session.getSnapshot().status).toBe("guest");
  });

  it("revokes a visible owner immediately and never restores it in this controller", async () => {
    const session = createLocalWordsSession({ ownerKeyFor: async () => "owner-a" });
    await session.update("authenticated", "a");
    const lease = session.captureLease()!;
    session.revoke("owner-a");
    expect(session.captureLease()).toBeNull();
    expect(session.isCurrent(lease)).toBe(false);
    await session.update("authenticated", "a");
    expect(session.captureLease()).toBeNull();
  });

  it("rejects a deleted owner's late hash without invalidating a different current owner", async () => {
    const a = deferred<string>();
    const session = createLocalWordsSession({ ownerKeyFor: (id) => id === "a" ? a.promise : Promise.resolve("owner-b") });
    const pending = session.update("authenticated", "a");
    session.revoke("owner-a");
    a.resolve("owner-a");
    await pending;
    expect(session.captureLease()).toBeNull();
    await session.update("authenticated", "b");
    const snapshot = session.getSnapshot();
    session.revoke("owner-a");
    expect(session.getSnapshot()).toBe(snapshot);
    expect(session.isCurrent(session.captureLease()!)).toBe(true);
  });

  it("fails closed on hash errors, permits retry, and never publishes raw identity", async () => {
    const hash = vi.fn().mockRejectedValueOnce(new Error("private value")).mockResolvedValue("hashed-owner");
    const session = createLocalWordsSession({ ownerKeyFor: hash });
    await session.update("authenticated", "raw-user-id");
    expect(session.captureLease()).toBeNull();
    await session.update("authenticated", "raw-user-id");
    expect(session.getSnapshot()).toMatchObject({ status: "account", ownerKey: "hashed-owner" });
    expect(JSON.stringify(session.getSnapshot())).not.toContain("raw-user-id");
  });

  it("unsubscribes and rejects reentrant session changes before starting an obsolete hash", async () => {
    const hash = vi.fn(async () => "owner-a");
    const session = createLocalWordsSession({ ownerKeyFor: hash });
    const stop = session.subscribe(() => { stop(); session.invalidate(); });
    await session.update("authenticated", "a");
    expect(hash).not.toHaveBeenCalled();
    expect(session.captureLease()).toBeNull();
    await session.update("authenticated", "a");
    expect(hash).toHaveBeenCalledTimes(1);
  });
});
