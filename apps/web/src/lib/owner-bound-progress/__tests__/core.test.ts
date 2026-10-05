import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import { createOwnerBoundProgress, GUEST_HANDOFF_KEY, PROGRESS_NAMESPACE, PROGRESS_QUARANTINE, GUEST_CANDIDATE_PREFIX } from "../core";

class MemoryStorage {
  data = new Map<string, string>();
  failRead = false;
  failWrite = false;
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(key: string) { if (this.failRead) throw Error("unavailable"); return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrite) throw Error("quota"); this.data.set(key, value); }
  removeItem(key: string) { if (this.failWrite) throw Error("quota"); this.data.delete(key); }
}
const marker = "hanks-hits-progress-owner";
const key = "snake-game-state";
const raw = (score: number) => JSON.stringify({ state: { score }, version: 0 });
const physical = (owner: string, logical = key) => PROGRESS_NAMESPACE + JSON.stringify([owner, logical]);
function setup() {
  const local = new MemoryStorage(), session = new MemoryStorage();
  let time = 100;
  const factory = () => createOwnerBoundProgress({ storage: () => local, sessionStorage: () => session,
    ownerKeyFor: async id => id === null ? "guest" : `u_${id}`, now: () => time });
  return { local, session, factory, service: factory(), clock: (value: number) => { time = value; } };
}
function storeFor(service: ReturnType<typeof createOwnerBoundProgress>) {
  const store = createStore<{ score: number }>()(persist(() => ({ score: 0 }), {
    name: key, storage: createJSONStorage(() => service.createStorage(key, "snake")), skipHydration: true,
  }));
  service.bindPersistedStore(key, store.persist);
  return store;
}

describe("owner-bound progress", () => {
  it("distinguishes exact physical bytes from failed-write memory and physical tombstones", async () => {
    const { service, local } = setup();
    await service.updateSession("authenticated", "alice");
    const lease = service.captureLease()!;
    expect(service.readDurableScoped(key, lease)).toEqual({ status: "missing" });
    service.writeScoped(key, raw(1), lease);
    local.failWrite = true;
    expect(service.writeScoped(key, raw(2), lease)).toBe(false);
    expect(service.readScoped(key, lease)).toBe(raw(2));
    expect(service.readDurableScoped(key, lease)).toEqual({ status: "durable", raw: raw(1) });
    local.failWrite = false;
    service.removeScoped(key, lease);
    expect(service.readDurableScoped(key, lease)).toEqual({ status: "durable", raw: null });
    local.failRead = true;
    expect(service.readDurableScoped(key, lease)).toEqual({ status: "unavailable" });
    local.failRead = false; service.revoke();
    expect(service.readDurableScoped(key, lease)).toEqual({ status: "unavailable" });
  });

  it("enumerates unreadable physical rows without leaking another owner or trusting memory", async () => {
    const { service, local } = setup();
    await service.updateSession("authenticated", "alice");
    const lease = service.captureLease()!;
    local.data.set(physical("u_alice", "journal-broken"), "invalid");
    local.data.set(physical("u_bob", "journal-foreign"), "invalid");
    local.failWrite = true;
    service.writeScoped("journal-memory", "pending", lease);
    expect(service.listDurableScoped("journal-", lease)).toEqual({ keys: ["journal-broken"], available: true });
    local.failRead = true;
    vi.spyOn(local, "key").mockImplementation(() => { throw Error("unavailable"); });
    expect(service.listDurableScoped("journal-", lease)).toEqual({ keys: [], available: false });
    service.revoke();
    expect(service.listDurableScoped("journal-", lease)).toEqual({ keys: [], available: false });
  });

  it("keeps legacy bytes and marker frozen while hydrating and writing only the resolved owner", async () => {
    const { service, local, clock } = setup();
    local.setItem(key, raw(3)); local.setItem(marker, "alice");
    const store = storeFor(service);
    expect(store.getState().score).toBe(0);
    clock(1000); local.setItem(key, raw(8));
    await service.updateSession("authenticated", "alice");
    await service.whenHydrated(key);
    expect(store.getState().score).toBe(3);
    expect(service.readEvidence(key)).toMatchObject({ loadAt: 100, raw: raw(3), source: "legacy" });
    store.setState({ score: 9 });
    expect(JSON.parse(local.getItem(physical("u_alice"))!).raw).toBe(raw(9));
    expect(local.getItem(key)).toBe(raw(8));
    expect(local.getItem(marker)).toBe("alice");
  });

  it.each(["bob", "unreadable"])("does not hydrate foreign or unreadable legacy owner evidence: %s", async evidence => {
    const { service, local } = setup();
    local.setItem(key, raw(44)); local.setItem(marker, evidence);
    if (evidence === "unreadable") local.failRead = true;
    const store = storeFor(service);
    local.failRead = false;
    await service.updateSession("authenticated", "alice"); await service.whenHydrated(key);
    expect(store.getState().score).toBe(0);
    expect(service.readEvidence(key).eligible).toBe(false);
    store.setState({ score: 2 });
    expect(service.readScoped(key)).toBe(raw(2));
    expect(local.getItem(key)).toBe(raw(44));
  });

  it("hydrates without importing a game for a registration-free Home read", async () => {
    const { service, local } = setup();
    local.setItem(key, raw(17));
    await service.updateSession("unauthenticated");
    expect(service.readScoped(key)).toBe(raw(17));
    expect(service.isHydrated(key)).toBe(false);
    expect(service.getSnapshot().hydrating).toBe(false);
  });

  it("retains usable memory and cloud authority when local writes fail, and retries writes", async () => {
    const { service, local } = setup(); const store = storeFor(service);
    await service.updateSession("authenticated", "alice"); await service.whenHydrated(key);
    const lease = service.captureLease()!;
    local.failWrite = true; store.setState({ score: 6 });
    expect(service.readScoped(key)).toBe(raw(6)); expect(service.getSnapshot().memoryOnly).toBe(true);
    expect(service.isCurrent(lease)).toBe(true);
    local.failWrite = false; store.setState({ score: 7 });
    expect(service.hasDurable(key)).toBe(true); expect(service.readScoped(key)).toBe(raw(7));
  });

  it("never rebinds a confirmed document, including A-B-A and revoked stale leases", async () => {
    const { service, local } = setup(); const store = storeFor(service);
    await service.updateSession("authenticated", "alice"); await service.whenHydrated(key);
    const lease = service.captureLease()!;
    await service.updateSession("authenticated", "bob");
    expect(service.getSnapshot()).toMatchObject({ status: "revoked", needsNavigation: true });
    expect(service.matchesSession("authenticated", "alice")).toBe(false);
    store.setState({ score: 20 });
    expect(service.writeScoped(key, raw(10), lease)).toBe(false);
    await service.updateSession("authenticated", "alice");
    expect(service.captureLease()).toBe(null); expect(local.data.size).toBe(0);
    expect(service.readEvidence(key).raw).toBe(null);
  });

  it("discards a stale owner hash resolution before binding", async () => {
    const local = new MemoryStorage(); const resolvers: Array<(owner: string) => void> = [];
    const service = createOwnerBoundProgress({ storage: () => local, ownerKeyFor: () => new Promise(resolve => resolvers.push(resolve)) });
    const a = service.updateSession("authenticated", "alice"), b = service.updateSession("authenticated", "bob");
    resolvers[0]("u_alice"); await a; expect(service.captureLease()).toBe(null);
    resolvers[1]("u_bob"); await b; expect(service.captureLease()?.ownerKey).toBe("u_bob");
  });

  it("preserves unsaved in-memory play through same-owner loading without rehydration", async () => {
    const { service } = setup(); const store = storeFor(service);
    await service.updateSession("authenticated", "alice"); await service.whenHydrated(key);
    const old = service.captureLease()!; store.setState({ score: 2 });
    await service.updateSession("loading"); expect(service.isCurrent(old)).toBe(false);
    store.setState({ score: 19 });
    await service.updateSession("authenticated", "alice"); await service.whenHydrated(key);
    expect(store.getState().score).toBe(19);
    store.setState({ score: 20 }); expect(service.readScoped(key)).toBe(raw(20));
  });

  it("waits for actual asynchronous persist completion, even for late registration", async () => {
    const { service } = setup(); let completed = false, resolve!: () => void;
    const rehydrated = new Promise<void>(done => { resolve = done; });
    await service.updateSession("unauthenticated");
    const waiting = service.whenHydrated(key).then(() => { completed = true; });
    const persistHandle = { rehydrate: vi.fn(() => rehydrated), hasHydrated: () => completed, onFinishHydration: () => () => {} };
    service.bindPersistedStore(key, persistHandle);
    await Promise.resolve(); expect(completed).toBe(false); expect(service.getSnapshot().hydrating).toBe(true);
    resolve(); await waiting; expect(completed).toBe(true); expect(service.isHydrated(key)).toBe(true);
  });

  it.each(["not json", '{"version":0}'])("preserves malformed bytes but completes real Zustand hydration with defaults", async malformed => {
    const { service, local } = setup(); local.setItem(key, malformed); const store = storeFor(service);
    await service.updateSession("unauthenticated"); await service.whenHydrated(key);
    expect(store.getState().score).toBe(0); expect(store.persist.hasHydrated()).toBe(true);
    expect(local.getItem(key)).toBe(malformed); expect(service.getSnapshot().memoryOnly).toBe(true);
  });

  it("validates outer ownership and does not fall back through a foreign envelope", async () => {
    const { service, local } = setup(); local.setItem(key, raw(77));
    local.setItem(physical("u_alice"), JSON.stringify({ version: 2, ownerKey: "u_bob", logicalKey: key, raw: raw(12) }));
    const store = storeFor(service); await service.updateSession("authenticated", "alice"); await service.whenHydrated(key);
    expect(store.getState().score).toBe(0);
    expect(service.readEvidence(key).eligible).toBe(false);
  });

  it.each([
    "{broken-json",
    JSON.stringify({ version: 9, ownerKey: "u_alice", logicalKey: key, raw: raw(33) }),
    JSON.stringify({ version: 2, ownerKey: "u_alice", logicalKey: key, raw: "broken inner" }),
    JSON.stringify({ version: 2, ownerKey: "u_alice", logicalKey: key, raw: JSON.stringify({ version: 9, state: { score: 33 } }) }),
  ])("quarantines exact malformed or future-version namespace bytes before replacement: %s", async original => {
    const { service, local } = setup(); local.setItem(physical("u_alice"), original);
    const store = storeFor(service); await service.updateSession("authenticated", "alice"); await service.whenHydrated(key);
    store.setState({ score: 4 });
    const quarantined = [...local.data].filter(([name]) => name.startsWith(PROGRESS_QUARANTINE));
    expect(quarantined).toHaveLength(1); expect(quarantined[0][1]).toBe(original);
    expect(JSON.parse(local.getItem(physical("u_alice"))!).raw).toBe(raw(4));
  });

  it("keeps the sole malformed original when quarantine cannot be made durable, then retries", async () => {
    const { service, local } = setup(); const original = "{do-not-destroy";
    local.setItem(physical("u_alice"), original);
    const store = storeFor(service); await service.updateSession("authenticated", "alice"); await service.whenHydrated(key);
    const set = local.setItem.bind(local);
    const denyQuarantine = vi.spyOn(local, "setItem").mockImplementation((name, value) => {
      if (name.startsWith(PROGRESS_QUARANTINE)) throw Error("quota"); set(name, value);
    });
    store.setState({ score: 8 });
    expect(service.readScoped(key)).toBe(raw(8)); expect(local.getItem(physical("u_alice"))).toBe(original);
    expect(service.getSnapshot().memoryOnly).toBe(true); expect(service.captureLease()).not.toBe(null);
    denyQuarantine.mockRestore(); store.setState({ score: 9 });
    expect([...local.data].some(([name, value]) => name.startsWith(PROGRESS_QUARANTINE) && value === original)).toBe(true);
    expect(JSON.parse(local.getItem(physical("u_alice"))!).raw).toBe(raw(9));
  });

  it("flushes the actual unchanged hydrated projection without inventing a progress timestamp", async () => {
    const { service, local } = setup();
    local.setItem(key, JSON.stringify({ state: { score: 0, lastModified: 0 }, version: 0 }));
    const store = storeFor(service);
    const flush = vi.fn(() => store.setState({}));
    service.bindPersistedStore(key, store.persist, flush);
    expect(service.flushStore(key)).toBe(false); expect(flush).not.toHaveBeenCalled();
    await service.updateSession("unauthenticated"); await service.whenHydrated(key);
    expect(service.hasDurable(key)).toBe(false);
    expect(service.flushStore(key)).toBe(true);
    expect(JSON.parse(service.readScoped(key)!).state).toEqual({ score: 0, lastModified: 0 });
    expect(flush).toHaveBeenCalledOnce();
  });

  it("does not confuse old durable bytes with a failed latest flush or run a stale-owner flush", async () => {
    const { service, local } = setup(); const store = storeFor(service);
    const flush = vi.fn(() => store.setState({})); service.bindPersistedStore(key, store.persist, flush);
    await service.updateSession("authenticated", "alice"); await service.whenHydrated(key);
    store.setState({ score: 3 }); const lease = service.captureLease()!;
    local.failWrite = true; store.setState({ score: 9 });
    expect(service.flushStore(key, lease)).toBe(false);
    expect(JSON.parse(local.getItem(physical("u_alice"))!).raw).toBe(raw(3));
    local.failWrite = false; expect(service.flushStore(key, lease)).toBe(true);
    expect(JSON.parse(local.getItem(physical("u_alice"))!).raw).toBe(raw(9));
    const calls = flush.mock.calls.length; service.revoke();
    expect(service.flushStore(key, lease)).toBe(false); expect(flush).toHaveBeenCalledTimes(calls);
  });

  it("keeps logical deletion durable without deleting the retained legacy source", async () => {
    const { service, local, factory } = setup(); local.setItem(key, raw(3));
    await service.updateSession("unauthenticated"); expect(service.removeScoped(key)).toBe(true);
    expect(service.readScoped(key)).toBe(null); expect(local.getItem(key)).toBe(raw(3));
    const next = factory(); await next.updateSession("unauthenticated"); expect(next.readScoped(key)).toBe(null);
  });

  it("scopes auxiliary journal enumeration/events and retains legacy journal originals", async () => {
    const { service, local, factory } = setup(); const journal = "cookie-clicker-sync-writer-storage";
    local.setItem(journal, '{"ownerId":"alice"}');
    await service.updateSession("authenticated", "alice");
    service.writeScoped(journal, "alice journal");
    const bob = factory(); await bob.updateSession("authenticated", "bob"); bob.writeScoped(journal, "bob journal");
    expect(service.listScoped("cookie-clicker-sync-")).toEqual([journal]);
    expect(service.readScoped(journal)).toBe("alice journal");
    expect(service.listLegacyKeys("cookie-clicker-sync-")).toEqual([journal]);
    expect(service.readLegacy(journal).raw).toBe('{"ownerId":"alice"}');
    expect(service.isScopedStorageEvent({ key: physical("u_bob", journal) }, journal)).toBe(false);
    expect(service.isScopedStorageEvent({ key: physical("u_alice", journal) }, journal)).toBe(true);
  });

  it("admits v2 guest data only through an explicit one-use handoff and strips only transferred words", async () => {
    const { service: guest, local, session, factory } = setup();
    await import("@/apps/drum-machine/lib/store"); // Real normalization/word projection rule.
    const wordKey = "drum-machine-state";
    const wordRaw = JSON.stringify({ version: 0, state: { progress: { savedBeats: [{ id: "beat", name: "Private song", bpm: 80 }], lastModified: 17 } } });
    await guest.updateSession("unauthenticated"); guest.writeScoped(wordKey, wordRaw); guest.writeScoped(key, raw(4));
    const unrelated = factory(); await unrelated.updateSession("authenticated", "bob"); expect(unrelated.readScoped(wordKey)).toBe(null);
    expect(guest.prepareGuestHandoff()).toBe(true); expect(session.getItem(GUEST_HANDOFF_KEY)).not.toBe(null);
    guest.revoke();
    const alice = factory(); alice.authorizeGuestHandoff(guest.getGuestHandoffProof()!); await alice.updateSession("authenticated", "alice");
    expect(JSON.parse(alice.readScoped(wordKey)!).state.progress.savedBeats).toEqual([{ id: "beat", name: "", bpm: 80 }]);
    expect(alice.readScoped(key)).toBe(raw(4)); expect(session.getItem(GUEST_HANDOFF_KEY)).toBe(null);
    expect(JSON.parse(local.getItem(physical("guest", wordKey))!).raw).toBe(wordRaw);
    const later = factory(); await later.updateSession("authenticated", "bob"); expect(later.readScoped(wordKey)).toBe(null);
  });

  it("durably retains unopened game candidates across reload, beside existing account progress", async () => {
    const { service: guest, local, session, factory } = setup();
    const existing = factory(); await existing.updateSession("authenticated", "alice"); existing.writeScoped(key, raw(19));
    await guest.updateSession("unauthenticated"); guest.writeScoped(key, raw(7)); guest.prepareGuestHandoff();
    const alice = factory(); alice.authorizeGuestHandoff(guest.getGuestHandoffProof()!); await alice.updateSession("authenticated", "alice");
    expect(session.getItem(GUEST_HANDOFF_KEY)).toBe(null);
    expect(alice.readScoped(key)).toBe(raw(19));
    const candidate = alice.readGuestCandidate(key)!;
    expect(candidate.raw).toBe(raw(7));
    const reloaded = factory(); await reloaded.updateSession("authenticated", "alice");
    expect(reloaded.readGuestCandidate(key)).toEqual(candidate);
    const durable = [...local.data].find(([name]) => name.startsWith(GUEST_CANDIDATE_PREFIX));
    expect(JSON.parse(durable![1])).toMatchObject({ sourceOwner: "guest", raw: raw(7), acknowledged: false });
    const bob = factory(); await bob.updateSession("authenticated", "bob"); expect(bob.readGuestCandidate(key)).toBe(null);
  });

  it("retries a word projection when its real game module registers after an early Home read", async () => {
    const { service: guest, factory } = setup(); const weatherKey = "weather-app-progress";
    const weatherRaw = JSON.stringify({ version: 0, state: { savedLocations: [{ name: "Private home", lat: 12, lon: 13 }], lastLocation: null, units: "metric", lastModified: 17 } });
    await guest.updateSession("unauthenticated"); guest.writeScoped(weatherKey, weatherRaw); guest.prepareGuestHandoff();
    const alice = factory(); alice.authorizeGuestHandoff(guest.getGuestHandoffProof()!); await alice.updateSession("authenticated", "alice");
    expect(alice.readScoped(weatherKey)).toBe(null);
    expect(alice.readGuestCandidate(weatherKey)).toBe(null);
    await import("@/apps/weather/lib/store");
    const projected = JSON.parse(alice.readScoped(weatherKey)!);
    expect(projected.state.savedLocations).toEqual([]);
    expect(projected.state.units).toBe("metric");
    expect(alice.readGuestCandidate(weatherKey)).not.toBe(null);
  });

  it("binds a failed candidate copy to the first account and retries without another account adopting it", async () => {
    const { service: guest, local, session, factory } = setup();
    await guest.updateSession("unauthenticated"); guest.writeScoped(key, raw(7)); guest.prepareGuestHandoff();
    local.failWrite = true;
    const alice = factory(); alice.authorizeGuestHandoff(guest.getGuestHandoffProof()!); await alice.updateSession("authenticated", "alice");
    expect(alice.readGuestCandidate(key)?.raw).toBe(raw(7));
    expect(JSON.parse(session.getItem(GUEST_HANDOFF_KEY)!).ownerKey).toBe("u_alice");
    expect(guest.prepareGuestHandoff()).toBe(false); guest.cancelGuestHandoff();
    expect(JSON.parse(session.getItem(GUEST_HANDOFF_KEY)!).ownerKey).toBe("u_alice");
    const bob = factory(); await bob.updateSession("authenticated", "bob"); expect(bob.readGuestCandidate(key)).toBe(null);
    local.failWrite = false;
    const retry = factory(); await retry.updateSession("authenticated", "alice");
    expect(retry.readGuestCandidate(key)?.raw).toBe(raw(7)); expect(session.getItem(GUEST_HANDOFF_KEY)).toBe(null);
  });

  it("acknowledges only exact candidates after the latest local result is durable, retaining original provenance", async () => {
    const { service: guest, local, factory } = setup();
    await guest.updateSession("unauthenticated"); guest.writeScoped(key, raw(7)); guest.prepareGuestHandoff();
    const alice = factory(); alice.authorizeGuestHandoff(guest.getGuestHandoffProof()!); await alice.updateSession("authenticated", "alice"); const candidate = alice.readGuestCandidate(key)!;
    expect(alice.acknowledgeGuestCandidate(key, candidate.id)).toBe(false);
    alice.writeScoped(key, raw(3)); local.failWrite = true; alice.writeScoped(key, raw(7));
    expect(alice.acknowledgeGuestCandidate(key, candidate.id)).toBe(false);
    local.failWrite = false; alice.writeScoped(key, raw(7));
    expect(alice.acknowledgeGuestCandidate(key, "wrong id")).toBe(false);
    expect(alice.acknowledgeGuestCandidate(key, candidate.id)).toBe(true);
    const next = factory(); await next.updateSession("authenticated", "alice"); expect(next.readGuestCandidate(key)).toBe(null);
    const record = [...local.data].find(([name]) => name.startsWith(GUEST_CANDIDATE_PREFIX));
    expect(JSON.parse(record![1])).toMatchObject({ sourceOwner: "guest", raw: raw(7), acknowledged: true });
  });

  it("requires the explicit navigation proof, not merely an old readable guest receipt", async () => {
    const { service: guest, session, factory } = setup();
    await guest.updateSession("unauthenticated"); guest.writeScoped(key, raw(7)); guest.prepareGuestHandoff();
    const nonce = guest.getGuestHandoffProof()!;
    expect(nonce).toMatch(/^[a-f0-9]{48}$/);
    const ordinary = factory(); await ordinary.updateSession("authenticated", "bob");
    expect(ordinary.readGuestCandidate(key)).toBe(null);
    expect(JSON.parse(session.getItem(GUEST_HANDOFF_KEY)!).ownerKey).toBe("guest");
    const wrong = factory(); wrong.authorizeGuestHandoff(nonce === "0".repeat(48) ? "1".repeat(48) : "0".repeat(48));
    await wrong.updateSession("authenticated", "bob"); expect(wrong.readGuestCandidate(key)).toBe(null);
    const authorized = factory(); authorized.authorizeGuestHandoff(nonce);
    await authorized.updateSession("authenticated", "alice"); expect(authorized.readGuestCandidate(key)?.raw).toBe(raw(7));
  });

  it("does not hand A's failed claim to a later B document after storage recovers", async () => {
    const { service: guest, session, factory } = setup();
    await guest.updateSession("unauthenticated"); guest.writeScoped(key, raw(7)); guest.prepareGuestHandoff();
    const nonce = guest.getGuestHandoffProof()!;
    session.failWrite = true;
    const alice = factory(); alice.authorizeGuestHandoff(nonce); await alice.updateSession("authenticated", "alice");
    expect(alice.readGuestCandidate(key)).toBe(null);
    expect(alice.getSnapshot()).toMatchObject({ guestHandoffUnavailable: true, memoryOnly: false });
    session.failWrite = false;
    const bob = factory(); await bob.updateSession("authenticated", "bob");
    expect(bob.readScoped(key)).toBe(null); expect(bob.readGuestCandidate(key)).toBe(null);
    expect(JSON.parse(session.getItem(GUEST_HANDOFF_KEY)!).ownerKey).toBe("guest");
    // A same-document auth refresh cannot retry the consumed proof either.
    await alice.updateSession("loading"); await alice.updateSession("authenticated", "alice");
    expect(alice.readGuestCandidate(key)).toBe(null);
  });

  it("cancels failed sign-in handoffs and refuses receipts that cannot be owner-bound", async () => {
    const { service, session, factory } = setup(); await service.updateSession("unauthenticated"); service.writeScoped(key, raw(1));
    service.prepareGuestHandoff(); service.cancelGuestHandoff(); expect(session.getItem(GUEST_HANDOFF_KEY)).toBe(null);
    service.prepareGuestHandoff(); session.failWrite = true;
    const alice = factory(); alice.authorizeGuestHandoff(service.getGuestHandoffProof()!); await alice.updateSession("authenticated", "alice"); expect(alice.readScoped(key)).toBe(null);
  });
});
