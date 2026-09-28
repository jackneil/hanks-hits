import { describe, expect, it, vi } from "vitest";
import { hasRafDispatcher, installRafDispatcher } from "../rafDispatcher";
import { FakeRealm } from "./fakeRealm";

describe("installRafDispatcher", () => {
  it("runs pre hooks, then game callbacks in order, then post hooks, in one frame", () => {
    const realm = new FakeRealm();
    const d = installRafDispatcher(realm);
    const order: string[] = [];
    d.addPreHook((t) => order.push(`pre@${t}`));
    d.addPostHook((t) => order.push(`post@${t}`));
    realm.requestAnimationFrame((t) => order.push(`a@${t}`));
    realm.requestAnimationFrame((t) => order.push(`b@${t}`));
    realm.frame(16);
    expect(order).toEqual(["pre@16", "a@16", "b@16", "post@16"]);
    expect(d.gameFrames()).toBe(1);
    expect(d.lastFrameTs()).toBe(16);
  });

  it("gives ids from the native counter, so they never collide, and cancels a wrapped callback", () => {
    const realm = new FakeRealm();
    const before = realm.nativeRaf(() => undefined);
    installRafDispatcher(realm);
    const ran: string[] = [];
    const id1 = realm.requestAnimationFrame(() => ran.push("one"));
    const id2 = realm.requestAnimationFrame(() => ran.push("two"));
    const after = realm.nativeRaf(() => undefined);
    const ids = [before, id1, id2, after];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => Number.isInteger(id) && id > 0)).toBe(true);
    realm.cancelAnimationFrame(id1);
    realm.frame(1);
    expect(ran).toEqual(["two"]);
  });

  it("a cancel during a frame stops a later callback of the same frame", () => {
    const realm = new FakeRealm();
    installRafDispatcher(realm);
    const ran: string[] = [];
    let second = 0;
    realm.requestAnimationFrame(() => {
      ran.push("first");
      realm.cancelAnimationFrame(second);
    });
    second = realm.requestAnimationFrame(() => ran.push("second"));
    realm.frame(1);
    expect(ran).toEqual(["first"]);
  });

  it("keeps callbacks that were queued natively before the install working and cancelable", () => {
    const realm = new FakeRealm();
    const ran: string[] = [];
    const nativeId = realm.requestAnimationFrame(() => ran.push("native-kept"));
    const nativeId2 = realm.requestAnimationFrame(() => ran.push("native-cancelled"));
    expect(nativeId2).toBe(nativeId + 1);
    installRafDispatcher(realm);
    realm.cancelAnimationFrame(nativeId2);
    realm.requestAnimationFrame(() => ran.push("wrapped"));
    realm.frame(1);
    expect(ran).toContain("native-kept");
    expect(ran).toContain("wrapped");
    expect(ran).not.toContain("native-cancelled");
  });

  it("isolates a throwing callback and a throwing hook", () => {
    const realm = new FakeRealm();
    const d = installRafDispatcher(realm);
    const ran: string[] = [];
    d.addPreHook(() => {
      throw new Error("hook");
    });
    d.addPostHook(() => ran.push("post"));
    realm.requestAnimationFrame(() => {
      throw new Error("game");
    });
    realm.requestAnimationFrame(() => ran.push("after"));
    realm.frame(1);
    expect(ran).toEqual(["after", "post"]);
    expect(realm.errors.map((e) => (e as Error).message)).toEqual(["hook", "game"]);
  });

  it("uses a custom onError when given", () => {
    const realm = new FakeRealm();
    const onError = vi.fn();
    installRafDispatcher(realm, { onError });
    realm.requestAnimationFrame(() => {
      throw new Error("x");
    });
    realm.frame(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(realm.errors).toHaveLength(0);
  });

  it("runs a callback queued during a frame in the next frame (nested registration)", () => {
    const realm = new FakeRealm();
    installRafDispatcher(realm);
    const seen: number[] = [];
    const loop = (t: number) => {
      seen.push(t);
      if (seen.length < 3) realm.requestAnimationFrame(loop);
    };
    realm.requestAnimationFrame(loop);
    realm.frame(10);
    expect(seen).toEqual([10]);
    realm.frame(20);
    realm.frame(30);
    realm.frame(40);
    expect(seen).toEqual([10, 20, 30]);
  });

  it("does not schedule a native frame when nothing is queued, and wake() forces one", () => {
    const realm = new FakeRealm();
    const d = installRafDispatcher(realm);
    const post = vi.fn();
    d.addPostHook(post);
    expect(realm.pendingNative).toBe(0);
    d.wake();
    expect(realm.pendingNative).toBe(1);
    realm.frame(5);
    expect(post).toHaveBeenCalledWith(5);
    expect(d.gameFrames()).toBe(0);
    realm.frame(6);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("is idempotent per realm and reference counted", () => {
    const realm = new FakeRealm();
    const a = installRafDispatcher(realm);
    const wrapped = realm.requestAnimationFrame;
    const b = installRafDispatcher(realm);
    expect(realm.requestAnimationFrame).toBe(wrapped);
    const hookA = vi.fn();
    const hookB = vi.fn();
    a.addPostHook(hookA);
    b.addPostHook(hookB);
    a.uninstall();
    expect(hasRafDispatcher(realm)).toBe(true);
    expect(realm.requestAnimationFrame).toBe(wrapped);
    realm.requestAnimationFrame(() => undefined);
    realm.frame(1);
    expect(hookA).not.toHaveBeenCalled();
    expect(hookB).toHaveBeenCalledTimes(1);
    b.uninstall();
    expect(hasRafDispatcher(realm)).toBe(false);
    expect(realm.requestAnimationFrame).toBe(realm.nativeRaf);
    expect(realm.cancelAnimationFrame).toBe(realm.nativeCaf);
  });

  it("uninstall re-queues pending callbacks natively so the game loop keeps running", () => {
    const realm = new FakeRealm();
    const d = installRafDispatcher(realm);
    const hook = vi.fn();
    d.addPostHook(hook);
    const seen: number[] = [];
    const loop = (t: number) => {
      seen.push(t);
      realm.requestAnimationFrame(loop);
    };
    realm.requestAnimationFrame(loop);
    realm.frame(1);
    d.uninstall();
    // One native entry: the pending game callback's trampoline. The dispatch was cancelled.
    expect(realm.pendingNative).toBe(1);
    realm.frame(2);
    realm.frame(3);
    expect(seen).toEqual([1, 2, 3]);
    expect(hook).toHaveBeenCalledTimes(1);
    // A second uninstall is a no-op.
    d.uninstall();
    expect(d.active).toBe(false);
  });

  it("after uninstall, a native cancel with the old id still stops a pending callback", () => {
    const realm = new FakeRealm();
    const d = installRafDispatcher(realm);
    const ran: string[] = [];
    const id = realm.requestAnimationFrame(() => ran.push("pending"));
    d.uninstall();
    realm.cancelAnimationFrame(id);
    realm.frame(1);
    expect(ran).toEqual([]);
  });

  it("uninstall from inside a frame keeps the callbacks queued in that frame", () => {
    const realm = new FakeRealm();
    const d = installRafDispatcher(realm);
    const seen: number[] = [];
    const loop = (t: number) => {
      seen.push(t);
      realm.requestAnimationFrame(loop);
    };
    d.addPostHook(() => d.uninstall());
    realm.requestAnimationFrame(loop);
    realm.frame(1);
    realm.frame(2);
    realm.frame(3);
    expect(seen).toEqual([1, 2, 3]);
    expect(hasRafDispatcher(realm)).toBe(false);
  });

  it("becomes a pass-through when another script wrapped the functions after it", () => {
    const realm = new FakeRealm();
    const d = installRafDispatcher(realm);
    const ours = realm.requestAnimationFrame;
    const outer = (cb: FrameRequestCallback) => ours(cb);
    realm.requestAnimationFrame = outer;
    d.uninstall();
    expect(realm.requestAnimationFrame).toBe(outer);
    const seen: number[] = [];
    realm.requestAnimationFrame((t) => seen.push(t));
    realm.frame(7);
    expect(seen).toEqual([7]);
  });

  it("a hook added through an uninstalled handle does nothing", () => {
    const realm = new FakeRealm();
    const keep = installRafDispatcher(realm);
    const d = installRafDispatcher(realm);
    d.uninstall();
    const hook = vi.fn();
    const remove = d.addPreHook(hook);
    remove();
    keep.wake();
    realm.frame(1);
    expect(hook).not.toHaveBeenCalled();
  });

  it("a hook can remove itself during a frame", () => {
    const realm = new FakeRealm();
    const d = installRafDispatcher(realm);
    const calls: number[] = [];
    const remove = d.addPreHook((t) => {
      calls.push(t);
      remove();
    });
    realm.requestAnimationFrame(() => undefined);
    realm.frame(1);
    realm.requestAnimationFrame(() => undefined);
    realm.frame(2);
    expect(calls).toEqual([1]);
  });

  it("wraps each realm separately (iframe realm)", () => {
    const page = new FakeRealm(0);
    const iframe = new FakeRealm(250);
    const dp = installRafDispatcher(page);
    const di = installRafDispatcher(iframe);
    const pageHook = vi.fn();
    const frameHook = vi.fn();
    dp.addPostHook(pageHook);
    di.addPostHook(frameHook);
    iframe.requestAnimationFrame(() => undefined);
    iframe.frame(100);
    expect(frameHook).toHaveBeenCalledWith(100);
    expect(pageHook).not.toHaveBeenCalled();
    expect(page.requestAnimationFrame).not.toBe(iframe.requestAnimationFrame);
    di.uninstall();
    expect(hasRafDispatcher(page)).toBe(true);
    expect(iframe.requestAnimationFrame).toBe(iframe.nativeRaf);
  });

  it("falls back to a rethrow in a new task when the realm has no reportError", () => {
    vi.useFakeTimers();
    try {
      const realm = new FakeRealm();
      const bare = {
        requestAnimationFrame: realm.requestAnimationFrame,
        cancelAnimationFrame: realm.cancelAnimationFrame,
      };
      installRafDispatcher(bare);
      bare.requestAnimationFrame(() => {
        throw new Error("late");
      });
      realm.frame(1);
      expect(() => vi.runAllTimers()).toThrow("late");
    } finally {
      vi.useRealTimers();
    }
  });
});
