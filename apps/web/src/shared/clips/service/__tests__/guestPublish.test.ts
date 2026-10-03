import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClipRecord } from "../../protocol";
import type { IoClient } from "../ioClient";

const clientRef = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../ioClient", async importOriginal => ({ ...await importOriginal<typeof import("../ioClient")>(), getIoClient: () => clientRef.current }));
import { prepareGuestPublish, resumeGuestPublish } from "../guestPublish";

const KEY = "hh-clip-publish-intent";
const A = "u_aaaaaaaaaaaaaaaaaaaa";
const B = "u_bbbbbbbbbbbbbbbbbbbb";
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function clip(id = "chosen", ownerKey = "guest", storage: ClipRecord["storage"] = "opfs"): ClipRecord {
  return { id, ownerKey, storage, kept: false } as ClipRecord;
}
function setup() {
  let key = "guest", generation = 0, confirmed = true;
  const records = new Map([["chosen", clip()], ["other", clip("other")]]);
  const io = {
    get sessionGeneration() { return generation; },
    resolveOwner: vi.fn(async () => ({ key, confirmed })),
    read: vi.fn(async (id: string) => {
      const record = records.get(id);
      if (!record) throw new Error("not found");
      return { record: { ...record }, file: new File(["video"], "game.mp4") };
    }),
    updateForSession: vi.fn(async (id: string, patch: Partial<ClipRecord>, owner: string, version: number) => {
      if (key !== owner || generation !== version) throw new Error("player changed");
      const record = records.get(id)!;
      if (record.ownerKey !== "guest" && patch.ownerKey && record.ownerKey !== patch.ownerKey) throw new Error("cross-owner change");
      const updated = { ...record, ...patch };
      records.set(id, updated);
      return updated;
    }),
  };
  clientRef.current = io as unknown as IoClient;
  return { io, records, switchTo(next: string) { key = next; generation++; }, offline() { confirmed = false; } };
}
let state: ReturnType<typeof setup>;
beforeEach(() => { sessionStorage.clear(); state = setup(); });
afterEach(() => { clientRef.current = null; vi.restoreAllMocks(); });
function intent(id = "chosen", owner?: string) {
  sessionStorage.setItem(KEY, JSON.stringify({ id, created: Date.now(), ...(owner ? { owner } : {}) }));
}

// A gate for every await in the continuation, including the initial owner read.
function gate(stage: "owner1" | "read" | "owner2" | "update" | "owner3") {
  const entered = deferred(), release = deferred();
  if (stage.startsWith("owner")) {
    const index = Number(stage.slice(-1));
    const original = state.io.resolveOwner.getMockImplementation()!;
    let count = 0;
    state.io.resolveOwner.mockImplementation(async () => {
      if (++count === index) { entered.resolve(); await release.promise; }
      return original();
    });
  } else if (stage === "read") {
    const original = state.io.read.getMockImplementation()!;
    state.io.read.mockImplementation(async id => { entered.resolve(); await release.promise; return original(id); });
  } else {
    const original = state.io.updateForSession.getMockImplementation()!;
    state.io.updateForSession.mockImplementation(async (...args) => {
      // The transfer has been posted: it can finish for its captured owner,
      // but a switched session must never receive a successful continuation.
      const result = await original(...args);
      entered.resolve(); await release.promise;
      return result;
    });
  }
  return { entered: entered.promise, release: () => release.resolve() };
}

describe("guest publication selection", () => {
  it("keeps only the chosen durable video and writes a reload-safe intent", async () => {
    await prepareGuestPublish("chosen");
    expect(state.records.get("chosen")?.kept).toBe(true);
    expect(state.records.get("other")?.kept).toBe(false);
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toMatchObject({ id: "chosen" });
    expect(state.io.updateForSession).toHaveBeenCalledWith("chosen", { kept: true }, "guest", 0);
  });
  it.each(["memory", "other-owner", "offline"])("refuses %s without creating an intent", async mode => {
    if (mode === "memory") state.records.set("chosen", clip("chosen", "guest", "memory"));
    if (mode === "other-owner") state.records.set("chosen", clip("chosen", B));
    if (mode === "offline") state.offline();
    await expect(prepareGuestPublish("chosen")).rejects.toThrow();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(state.io.updateForSession).not.toHaveBeenCalled();
  });
  it.each(["owner1", "read", "owner2", "update", "owner3"] as const)("rejects guest-account-guest switches during %s", async stage => {
    const paused = gate(stage);
    const result = prepareGuestPublish("chosen").catch(error => error);
    await paused.entered;
    state.switchTo(A); state.switchTo("guest");
    paused.release();
    expect(await result).toBeInstanceOf(Error);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
  it("does not let a slower old selection replace a newer tap", async () => {
    const paused = gate("read");
    const old = prepareGuestPublish("chosen").catch(error => error);
    await paused.entered;
    // The second read may finish immediately while the first is held.
    state.io.read.mockImplementation(async id => ({ record: state.records.get(id)!, file: new File([], "game.mp4") }));
    await prepareGuestPublish("other");
    paused.release();
    expect(await old).toBeInstanceOf(Error);
    expect(JSON.parse(sessionStorage.getItem(KEY)!).id).toBe("other");
  });
  it("does not promise sign-in continuation when storage cannot save the intent", async () => {
    vi.spyOn(sessionStorage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await expect(prepareGuestPublish("chosen")).rejects.toThrow();
  });
});

describe("guest publication continuation", () => {
  it("transfers only the selected clip, reopens it once, and never publishes", async () => {
    await prepareGuestPublish("chosen");
    state.switchTo(A);
    const fetcher = vi.spyOn(globalThis, "fetch");
    expect(await resumeGuestPublish()).toBe("chosen");
    expect(state.records.get("chosen")?.ownerKey).toBe(A);
    expect(state.records.get("other")?.ownerKey).toBe("guest");
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(await resumeGuestPublish()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains an unbound intent offline and while still a guest", async () => {
    intent();
    expect(await resumeGuestPublish()).toBeNull();
    state.switchTo(A); state.offline();
    expect(await resumeGuestPublish()).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).not.toHaveProperty("owner");
    expect(state.io.read).not.toHaveBeenCalled();
  });
  it.each(["owner1", "read", "owner2", "update", "owner3"] as const)("rejects A-B-A switches during %s without opening a viewer", async stage => {
    intent(); state.switchTo(A);
    const paused = gate(stage);
    const result = resumeGuestPublish().catch(error => error);
    await paused.entered;
    state.switchTo(B); state.switchTo(A);
    paused.release();
    expect(await result).toBeInstanceOf(Error);
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    expect(state.records.get("chosen")?.ownerKey).not.toBe(B);
  });
  it("binds a failed transfer to its original account and safely retries after commit", async () => {
    intent(); state.switchTo(A);
    const original = state.io.updateForSession.getMockImplementation()!;
    state.io.updateForSession.mockImplementationOnce(async (...args) => { await original(...args); throw new Error("lost acknowledgement"); });
    await expect(resumeGuestPublish()).rejects.toThrow("lost acknowledgement");
    state.switchTo(B);
    await expect(resumeGuestPublish()).rejects.toThrow("player who started");
    state.switchTo(A);
    expect(await resumeGuestPublish()).toBe("chosen");
    expect(state.io.updateForSession).toHaveBeenCalledTimes(1);
  });
  it("does not steal another player's clip or a volatile memory record", async () => {
    state.switchTo(A); intent();
    state.records.set("chosen", clip("chosen", B));
    await expect(resumeGuestPublish()).rejects.toThrow("another player");
    state.records.set("chosen", clip("chosen", "guest", "memory"));
    await expect(resumeGuestPublish()).rejects.toThrow("not saved");
    expect(state.io.updateForSession).not.toHaveBeenCalled();
  });
  it.each(["owner1", "read", "update"] as const)("preserves a newer intent selected while awaiting %s", async stage => {
    state.switchTo(A); intent();
    const paused = gate(stage);
    const result = resumeGuestPublish();
    await paused.entered;
    intent("other");
    const newer = sessionStorage.getItem(KEY);
    paused.release();
    expect(await result).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBe(newer);
  });
  it("coalesces concurrent UI subscribers into one transfer and consumes once", async () => {
    state.switchTo(A); intent();
    const paused = gate("read");
    const one = resumeGuestPublish();
    const two = resumeGuestPublish();
    expect(two).toBe(one);
    await paused.entered;
    paused.release();
    expect(await one).toBe("chosen");
    expect(await two).toBe("chosen");
    expect(state.io.updateForSession).toHaveBeenCalledTimes(1);
    expect(await resumeGuestPublish()).toBeNull();
  });
  it.each(["bad-json", "old", "future", "bad-owner", "bad-id"])("discards %s intents without touching video bytes", async kind => {
    state.switchTo(A);
    sessionStorage.setItem(KEY, kind === "bad-json" ? "{" : JSON.stringify({ id: kind === "bad-id" ? "../clip" : "chosen", created: Date.now() + (kind === "future" ? 10_000 : kind === "old" ? -86_400_001 : 0), ...(kind === "bad-owner" ? { owner: "guest" } : {}) }));
    expect(await resumeGuestPublish()).toBeNull();
    expect(state.io.read).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
