import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";

beforeEach(() => { vi.restoreAllMocks(); vi.resetModules(); localStorage.clear(); sessionStorage.clear(); });
async function fixture() {
  const { ownerBoundProgress: authority } = await import("../index");
  const { createOwnerPersistStorage } = await import("../persistStorage");
  const store = createStore<{ progress: { score: number }; selected: string }>()(persist(() => ({ progress: { score: 0 }, selected: "red" }), {
    name: "snake-game-state", skipHydration: true,
    storage: createOwnerPersistStorage("snake-game-state", "snake"),
  }));
  authority.bindPersistedStore("snake-game-state", store.persist);
  await authority.updateSession("authenticated", "alice"); await authority.whenHydrated("snake-game-state");
  return { authority, store };
}

describe("real persist wrapper owner lifecycle", () => {
  it("retains and flushes paused-session cleanup without rehydrating over live state", async () => {
    const { authority, store } = await fixture();
    store.setState({ progress: { score: 2 } });
    const old = authority.captureLease()!;
    await authority.updateSession("loading");
    store.setState({ progress: { score: 8 } });
    await authority.updateSession("authenticated", "alice");
    expect(authority.isCurrent(old)).toBe(false);
    expect(store.getState().progress.score).toBe(8);
    expect(JSON.parse(authority.readScoped("snake-game-state")!).state.progress.score).toBe(8);
  });

  it("does not flush paused-session cleanup after account replacement", async () => {
    const { authority, store } = await fixture();
    store.setState({ progress: { score: 2 } });
    const before = [...Array(localStorage.length)].map((_, i) => [localStorage.key(i), localStorage.getItem(localStorage.key(i)!)]);
    await authority.updateSession("loading"); store.setState({ progress: { score: 8 } });
    await authority.updateSession("authenticated", "bob");
    expect(authority.getSnapshot().status).toBe("revoked");
    expect([...Array(localStorage.length)].map((_, i) => [localStorage.key(i), localStorage.getItem(localStorage.key(i)!)])).toEqual(before);
  });

  it("deduplicates unchanged complete envelopes before stringify but retains flat changes", async () => {
    const { authority, store } = await fixture();
    store.setState({ progress: { score: 2 } });
    const stringify = vi.spyOn(JSON, "stringify");
    store.setState({});
    // Physical key construction serializes the owner/key tuple. The persisted
    // payload and outer value should not be serialized for unchanged state.
    expect(stringify.mock.calls.some(([value]) => typeof value === "object" && value !== null && "state" in value)).toBe(false);
    store.setState({ selected: "blue" });
    expect(JSON.parse(authority.readScoped("snake-game-state")!).state.selected).toBe("blue");
  });

  it("does not treat an older durable row as proof that a failed newer write succeeded", async () => {
    const { authority, store } = await fixture();
    store.setState({ progress: { score: 2 } });
    const original = localStorage.setItem.bind(localStorage);
    let fail = true;
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => { if (fail) throw Error("quota"); original(key, value); });
    store.setState({ progress: { score: 8 } });
    expect(JSON.parse(authority.readScoped("snake-game-state")!).state.progress.score).toBe(8);
    fail = false; store.setState({});
    const saved = localStorage.getItem(localStorage.key(0)!);
    expect(JSON.parse(JSON.parse(saved!).raw).state.progress.score).toBe(8);
  });

  it("serializes a pending save once across frames and accepts only its latest durable completion", async () => {
    const { authority, store } = await fixture();
    const { PROGRESS_NAMESPACE } = await import("../index");
    store.setState({ progress: { score: 2 } });
    const commits: Array<() => boolean> = [];
    authority.registerWordPersistenceGuard({
      handles: key => key === "snake-game-state",
      snapshotOwner: () => {}, beforeHydrate: () => {},
      replace: (key, _raw, lease, commit) => {
        const previous = localStorage.getItem(PROGRESS_NAMESPACE + JSON.stringify([lease.ownerKey, key]));
        commits.push(() => commit(previous));
        return false;
      },
    });
    const stringify = vi.spyOn(JSON, "stringify");
    const writes = vi.spyOn(localStorage, "setItem");
    const payloadCalls = () => stringify.mock.calls.filter(([value]) => typeof value === "object" && value !== null && "state" in value).length;
    store.setState({ progress: { score: 8 } });
    for (let frame = 0; frame < 120; frame++) store.setState({});
    expect(payloadCalls()).toBe(1);
    expect(writes).not.toHaveBeenCalled();
    expect(authority.isLatestDurable("snake-game-state")).toBe(false);
    const oldCommit = commits[0];
    store.setState({ selected: "blue" });
    expect(payloadCalls()).toBe(2);
    expect(oldCommit()).toBe(false);
    expect(authority.isLatestDurable("snake-game-state")).toBe(false);
    expect(commits.at(-1)!()).toBe(true);
    expect(authority.isLatestDurable("snake-game-state")).toBe(true);
    stringify.mockClear(); writes.mockClear();
    for (let frame = 0; frame < 120; frame++) store.setState({});
    expect(payloadCalls()).toBe(0);
    expect(writes).not.toHaveBeenCalled();
    expect(JSON.parse(authority.readScoped("snake-game-state")!).state).toEqual({ progress: { score: 8 }, selected: "blue" });
  });
});
