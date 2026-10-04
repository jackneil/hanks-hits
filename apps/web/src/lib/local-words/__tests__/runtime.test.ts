import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createOwnerBoundProgress, PROGRESS_NAMESPACE, PROGRESS_QUARANTINE, GUEST_CANDIDATE_PREFIX } from "../../owner-bound-progress";
import { ownerKeyFor } from "@/shared/clips/library/ownerKey";
import { LocalWordsDatabase, type WordRecord } from "../database";
import { createLocalWordsRuntime, LocalWordDeletionError } from "../runtime";
import { WORD_DELETION_PENDING } from "../preservation";
import { sha256 } from "@/shared/clips/library/ownerKey";
import * as inventory from "../inventory";

const app = "toy-finder";
const logical = "toy-finder-progress";
const edit = (value: string) => ({ entityKey: JSON.stringify(["toy", "t1"]), field: "notes", value });
const envelope = (notes: string) => JSON.stringify({ state: { wishlistItems: [{ id: "t1", notes }] }, version: 0 });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function fixture(withLocks = true, fetch?: typeof globalThis.fetch) {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, key: (i: number) => [...values.keys()][i] ?? null, get length() { return values.size; } };
  const authority = createOwnerBoundProgress({ storage: () => storage, sessionStorage: () => undefined });
  const database = new LocalWordsDatabase(new IDBFactory());
  const runtime = createLocalWordsRuntime({ authority, database, storage: () => storage, sessionStorage: () => undefined,
    fetch, locks: () => withLocks ? { request: async (_key, action) => action() } : undefined });
  const start = async (user?: string) => {
    runtime.install();
    await authority.updateSession(user ? "authenticated" : "unauthenticated", user);
    const lease = authority.captureLease()!;
    await runtime.prepare(app, lease);
    return lease;
  };
  return { values, storage, authority, database, runtime, start };
}

describe("local words runtime", () => {
  it("reports a synchronous database read failure and reuses preparation during notification", async () => {
    const f = fixture(); const lease = await f.start();
    const read = vi.spyOn(f.database, "readWords").mockImplementation(() => { throw Error("read unavailable"); });
    let nested: Promise<unknown> | undefined;
    const unsubscribe = f.runtime.subscribe(() => { nested = f.runtime.prepare(app, lease); });
    const preparing = f.runtime.prepare(app, lease);
    expect(nested).toBe(preparing);
    expect(await preparing).toBe("memory-only");
    unsubscribe();
    expect(read).toHaveBeenCalledOnce();
    expect(f.runtime.getSnapshot().apps[app].status).toBe("memory-only");
  });

  it("does no storage, database or authentication I/O at construction", () => {
    const storage = vi.fn(() => { throw Error("not installed"); });
    const db = new LocalWordsDatabase(new IDBFactory());
    const read = vi.spyOn(db, "ownerEpoch");
    const runtime = createLocalWordsRuntime({ storage, database: db });
    expect(runtime.getSnapshot().status).toBe("unresolved");
    expect(storage).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps edits accepted before an older read even after their pending write becomes durable", async () => {
    const f = fixture();
    const lease = await f.start();
    const old: WordRecord = { ...edit("disk"), appId: app, ownerKey: lease.ownerKey };
    const gate = deferred<void>();
    const originalWrite = f.database.writeWords.bind(f.database);
    vi.spyOn(f.database, "writeWords").mockImplementationOnce(async (records, epoch) => { await gate.promise; await originalWrite(records, epoch); });
    const save = f.runtime.write(app, [edit("new")], lease);
    const read = deferred<WordRecord[]>();
    vi.spyOn(f.database, "readWords").mockReturnValueOnce(read.promise);
    const prepare = f.runtime.prepare(app, lease);
    gate.resolve();
    expect(await save).toBe("durable");
    read.resolve([old]);
    expect(await prepare).toBe("durable");
    expect(f.runtime.read(app, lease)[0].value).toBe("new");
    expect((await f.database.readWords(lease.ownerKey, app))[0].value).toBe("new");
  });

  it.each(["new", ""])("keeps an edit/clear accepted after the read started: %j", async value => {
    const f = fixture(); const lease = await f.start();
    const read = deferred<WordRecord[]>();
    vi.spyOn(f.database, "readWords").mockReturnValueOnce(read.promise);
    const preparing = f.runtime.prepare(app, lease);
    expect(await f.runtime.write(app, [edit(value)], lease)).toBe("durable");
    read.resolve([{ ...edit("old"), ownerKey: lease.ownerKey, appId: app }]);
    await preparing;
    expect(f.runtime.read(app, lease)[0].value).toBe(value);
  });

  it("does not let a stalled app read block another app or an accepted edit", async () => {
    const f = fixture(); const lease = await f.start();
    vi.spyOn(f.database, "readWords").mockReturnValueOnce(new Promise(() => undefined));
    void f.runtime.prepare(app, lease);
    expect(await f.runtime.prepare("weather", lease)).toBe("durable");
    expect(await f.runtime.write(app, [edit("still playing")], lease)).toBe("durable");
    expect(f.runtime.getSnapshot().apps[app].status).toBe("loading");
    expect(f.runtime.read(app, lease)[0].value).toBe("still playing");
  });

  it("clones accepted mutable values and returns frozen defensive views", async () => {
    const f = fixture(); const lease = await f.start();
    const value = ["one"];
    const pending = f.runtime.write(app, [{ ...edit(""), value }], lease);
    value[0] = "mutated";
    await pending;
    const output = f.runtime.read(app, lease);
    expect(output[0].value).toEqual(["one"]);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output[0].value)).toBe(true);
  });

  it("keeps failed edits retryable and resumes only the same owner after auth refresh", async () => {
    const f = fixture(); const lease = await f.start("A");
    vi.spyOn(f.database, "writeWords").mockRejectedValueOnce(Error("quota"));
    expect(await f.runtime.write(app, [edit("kept")], lease)).toBe("memory-only");
    expect(f.runtime.getSnapshot().apps[app]).toMatchObject({ status: "memory-only", pendingWrites: true });
    await f.authority.updateSession("loading");
    expect(f.runtime.read(app, lease)).toEqual([]);
    await f.authority.updateSession("authenticated", "A");
    const current = f.runtime.captureLease()!;
    await f.runtime.retry(current);
    expect(f.runtime.read(app, current)[0].value).toBe("kept");
    expect(f.runtime.read(app, lease)).toEqual([]);
    await f.authority.updateSession("authenticated", "B");
    expect(f.runtime.captureLease()).toBeNull();
  });

  it("captures frozen legacy plus v2 and quarantine without exposing guest words to account", async () => {
    const f = fixture(); const owner = await ownerKeyFor("A");
    f.values.set(logical, envelope("guest legacy"));
    const physical = PROGRESS_NAMESPACE + JSON.stringify([owner, logical]);
    const bytes = JSON.stringify({ version: 2, ownerKey: owner, logicalKey: logical, raw: envelope("account") });
    f.values.set(physical, bytes);
    const quarantine = PROGRESS_QUARANTINE + JSON.stringify([owner, logical, "old"]);
    f.values.set(quarantine, bytes);
    const lease = await f.start("A");
    const candidates = f.runtime.candidates(app, lease);
    expect(candidates.map(source => source.sourceKey)).toEqual(expect.arrayContaining([physical, quarantine]));
    expect(candidates.every(source => source.ownerKey === owner)).toBe(true);
    expect((await f.database.listSources("guest"))[0].raw).toBe(envelope("guest legacy"));
    expect(f.values.get(quarantine)).toBe(bytes);
  });

  it("refuses automatic mapping over a deliberate clear and retains its candidate", async () => {
    const f = fixture(); f.values.set(logical, envelope("legacy"));
    const lease = await f.start();
    await f.runtime.write(app, [edit("")], lease);
    f.runtime.registerMapper(app, () => [edit("legacy")]);
    await f.runtime.prepare(app, lease);
    expect(f.runtime.read(app, lease)[0].value).toBe("");
    expect(f.runtime.candidates(app, lease)).toHaveLength(1);
    const source = f.runtime.candidates(app, lease)[0];
    expect(await f.runtime.commitCandidate(app, source.id, [edit("chosen")], lease, "confirmed-choice")).toBe("durable");
    expect(f.runtime.read(app, lease)[0].value).toBe("chosen");
    expect((await f.database.listCommittedSources("guest"))[0].raw).toBe(envelope("legacy"));
  });

  it("captures the exact original before namespace replacement and emits durable completion", async () => {
    const f = fixture(); const lease = await f.start();
    const key = PROGRESS_NAMESPACE + JSON.stringify(["guest", logical]);
    const original = JSON.stringify({ version: 2, ownerKey: "guest", logicalKey: logical, raw: envelope("old") });
    f.values.set(key, original);
    const captured = deferred<void>();
    const capture = f.database.capture.bind(f.database);
    vi.spyOn(f.database, "capture").mockImplementationOnce(async (source, epoch) => { await captured.promise; await capture(source, epoch); });
    const listener = vi.fn(); f.authority.subscribe(listener);
    expect(f.authority.writeScoped(logical, envelope(""), lease)).toBe(false);
    expect(f.authority.isLatestDurable(logical, lease)).toBe(false);
    expect(f.values.get(key)).toBe(original);
    captured.resolve();
    await vi.waitFor(() => expect(f.authority.isLatestDurable(logical, lease)).toBe(true));
    expect(listener).toHaveBeenCalled();
    expect((await f.database.listSources("guest")).some(source => source.raw === original)).toBe(true);
  });

  it("preserves original namespaces on capture failure and without Web Locks", async () => {
    for (const withLocks of [true, false]) {
      const f = fixture(withLocks); const lease = await f.start();
      const key = PROGRESS_NAMESPACE + JSON.stringify(["guest", logical]);
      const original = JSON.stringify({ version: 2, ownerKey: "guest", logicalKey: logical, raw: envelope("old") });
      f.values.set(key, original);
      if (withLocks) vi.spyOn(f.database, "capture").mockRejectedValue(Error("quota"));
      f.authority.writeScoped(logical, envelope(""), lease);
      await vi.waitFor(() => expect(f.runtime.getSnapshot().apps[app].status).toBe("memory-only"));
      expect(f.values.get(key)).toBe(original);
      expect(f.authority.readScoped(logical, lease)).toBe(envelope(""));
      expect(f.authority.isLatestDurable(logical, lease)).toBe(false);
    }
  });

  it("re-captures a changed physical version before writing", async () => {
    const f = fixture(); const lease = await f.start();
    const key = PROGRESS_NAMESPACE + JSON.stringify(["guest", logical]);
    const raw = (notes: string) => JSON.stringify({ version: 2, ownerKey: "guest", logicalKey: logical, raw: envelope(notes) });
    f.values.set(key, raw("one"));
    const capture = f.database.capture.bind(f.database);
    vi.spyOn(f.database, "capture").mockImplementationOnce(async (source, epoch) => { await capture(source, epoch); f.values.set(key, raw("two")); });
    f.authority.writeScoped(logical, envelope(""), lease);
    await vi.waitFor(() => expect(f.authority.isLatestDurable(logical, lease)).toBe(true));
    expect((await f.database.listSources("guest")).map(source => source.raw)).toEqual(expect.arrayContaining([raw("one"), raw("two")]));
  });

  it("hides synchronously on deletion and never resurrects after a new runtime", async () => {
    const f = fixture(); const lease = await f.start("A");
    await f.runtime.write(app, [edit("private")], lease);
    const deletion = f.runtime.forget("A");
    expect(f.runtime.read(app, lease)).toEqual([]);
    await deletion;
    expect(await f.database.ownerEpoch(lease.ownerKey)).toBeGreaterThan(0);
    expect(await f.runtime.write(app, [edit("late")], lease)).toBe("deleted");
    const authority = createOwnerBoundProgress({ storage: () => f.storage });
    const runtime = createLocalWordsRuntime({ authority, database: f.database, storage: () => f.storage });
    runtime.install(); await authority.updateSession("authenticated", "A");
    const next = authority.captureLease();
    if (next) expect(await runtime.prepare(app, next)).toBe("deleted");
    expect(runtime.captureLease()).toBeNull();
  });

  it("retains a retryable deletion receipt on failed tombstone and leaves other owners alone", async () => {
    const f = fixture(); const lease = await f.start("B");
    await f.runtime.write(app, [edit("B")], lease);
    vi.spyOn(f.database, "deleteOwner").mockRejectedValueOnce(Error("blocked"));
    await expect(f.runtime.forget("A")).rejects.toBeInstanceOf(LocalWordDeletionError);
    expect(f.runtime.read(app, lease)[0].value).toBe("B");
    expect(f.values.get(WORD_DELETION_PENDING + await ownerKeyFor("A"))).toBe("1");
    await f.runtime.forget("A");
    expect(f.values.has(WORD_DELETION_PENDING + await ownerKeyFor("A"))).toBe(false);
  });

  it("deletes only account-private candidates while preserving independent guest words", async () => {
    const f = fixture(); const lease = await f.start("A");
    await f.database.writeWords([{ ...edit("guest"), appId: app, ownerKey: "guest" }], 0);
    const key = GUEST_CANDIDATE_PREFIX + JSON.stringify([lease.ownerKey, "candidate"]);
    f.values.set(key, "private copy");
    await f.runtime.forget("A");
    expect(f.values.has(key)).toBe(false);
    expect((await f.database.readWords("guest", app))[0].value).toBe("guest");
  });
  it("shows accepted edits immediately while the owner epoch is unresolved or fails", async () => {
    const f = fixture();
    const epoch = deferred<number>();
    vi.spyOn(f.database, "ownerEpoch").mockReturnValue(epoch.promise);
    f.runtime.install(); await f.authority.updateSession("unauthenticated");
    const lease = f.runtime.captureLease()!;
    const writing = f.runtime.write(app, [edit("live draft")], lease);
    expect(f.runtime.read(app, lease)[0].value).toBe("live draft");
    epoch.resolve(0);
    await writing;
    const read = f.runtime.read(app, lease);
    expect(f.runtime.read(app, lease)).toBe(read);
  });

  it("keeps durable local status on a network-only recovery failure", async () => {
    const f = fixture(true, vi.fn().mockRejectedValue(Error("offline")));
    const lease = await f.start("A");
    await f.runtime.write(app, [edit("durable")], lease);
    expect(await f.runtime.recover(app, "A", lease)).toBe("unavailable");
    expect(f.runtime.getSnapshot().apps[app].status).toBe("ready");
    expect(f.runtime.read(app, lease)[0].value).toBe("durable");
  });

  it("revokes only a still-current owner after authoritative cloud mismatch", async () => {
    const reply = deferred<Response>();
    const f = fixture(true, vi.fn(() => reply.promise));
    const lease = await f.start("A");
    await f.runtime.write(app, [edit("private")], lease);
    const recovering = f.runtime.recover(app, "A", lease);
    reply.resolve(new Response(JSON.stringify({ code: "owner_changed" }), { status: 409 }));
    expect(await recovering).toBe("owner-changed");
    expect(f.runtime.read(app, lease)).toEqual([]);
    expect(f.authority.getSnapshot().status).toBe("revoked");
  });

  it("refreshes a cloud capture made after an already-running preparation read candidates", async () => {
    const response = { appId: app, candidates: [{ sourceRevision: "a".repeat(64), extractionVersion: 1, payload: { fields: [{ path: "wishlistItems[].notes", identity: { id: "t1" }, value: "cloud" }] } }] };
    const f = fixture(true, vi.fn(async () => new Response(JSON.stringify(response))));
    const lease = await f.start("A");
    // Hold mapping after prepare has already captured its candidate list.
    const raw = envelope("original");
    const digest = [...sha256(new TextEncoder().encode(raw))].map(n => n.toString(16).padStart(2, "0")).join("");
    const source = { id: JSON.stringify([lease.ownerKey, app, "test", 1, digest]), ownerKey: lease.ownerKey, appId: app, sourceKey: "test", sourceVersion: 1, digest, raw, fields: [{ path: "wishlistItems[].notes", value: "original", identity: { id: "t1" } }] };
    await f.database.capture(source, 0);
    f.runtime.registerMapper(app, () => [edit("original")]);
    const gate = deferred<void>();
    const entered = deferred<void>();
    const commit = f.database.commitSource.bind(f.database);
    vi.spyOn(f.database, "commitSource").mockImplementationOnce(async (...args) => { entered.resolve(); await gate.promise; return commit(...args); });
    const preparing = f.runtime.prepare(app, lease);
    await entered.promise;
    const recovering = f.runtime.recover(app, "A", lease);
    await vi.waitFor(async () => expect((await f.database.listSources(lease.ownerKey)).some(row => row.sourceKey.startsWith("cloud:"))).toBe(true));
    gate.resolve();
    await preparing;
    expect(await recovering).toBe("captured");
    expect(f.runtime.candidates(app, lease).some(row => row.sourceKey.startsWith("cloud:"))).toBe(true);
  });

  it("does not block owner readiness when browser storage getters throw", async () => {
    const authority = createOwnerBoundProgress({ storage: () => { throw Error("denied"); } });
    const runtime = createLocalWordsRuntime({ authority, database: new LocalWordsDatabase(new IDBFactory()), storage: () => { throw Error("denied"); } });
    expect(() => runtime.install()).not.toThrow();
    await authority.updateSession("unauthenticated");
    expect(authority.getSnapshot().status).toBe("ready");
  });

  it("keeps a failed edit warning when an older preparation read finishes afterward", async () => {
    const f = fixture();
    const lease = await f.start();
    const old: WordRecord = { ...edit("older disk words"), ownerKey: lease.ownerKey, appId: app };
    const read = deferred<WordRecord[]>();
    vi.spyOn(f.database, "readWords").mockReturnValueOnce(read.promise);
    const preparing = f.runtime.prepare(app, lease);
    vi.spyOn(f.database, "writeWords").mockRejectedValueOnce(Error("quota"));
    expect(await f.runtime.write(app, [edit("unsaved player edit")], lease)).toBe("memory-only");
    read.resolve([old]);
    expect(await preparing).toBe("memory-only");
    expect(f.runtime.getSnapshot().apps[app]).toMatchObject({ status: "memory-only", pendingWrites: true });
    expect(f.runtime.read(app, lease)[0].value).toBe("unsaved player edit");
    expect(await f.runtime.retry(lease, app)).toBe("durable");
    expect(f.runtime.getSnapshot().apps[app]).toMatchObject({ status: "ready", pendingWrites: false });
    expect((await f.database.readWords(lease.ownerKey, app))[0].value).toBe("unsaved player edit");
  });

  it("retries one app without waiting for another app's unresolved source capture", async () => {
    const f = fixture();
    const lease = await f.start();
    await f.runtime.prepare("weather", lease);
    const locationEdit = { entityKey: JSON.stringify(["locations"]), field: "lastLocation", value: { name: "Home", latitude: 1, longitude: 2 } };
    vi.spyOn(f.database, "writeWords").mockRejectedValueOnce(Error("quota"));
    expect(await f.runtime.write("weather", [locationEdit], lease)).toBe("memory-only");
    const key = PROGRESS_NAMESPACE + JSON.stringify([lease.ownerKey, logical]);
    const original = JSON.stringify({ version: 2, ownerKey: lease.ownerKey, logicalKey: logical, raw: envelope("original toy notes") });
    f.values.set(key, original);
    const entered = deferred<void>();
    const gate = deferred<void>();
    const capture = f.database.capture.bind(f.database);
    vi.spyOn(f.database, "capture").mockImplementationOnce(async (...args) => {
      entered.resolve();
      await gate.promise;
      return capture(...args);
    });
    f.authority.writeScoped(logical, envelope(""), lease);
    await entered.promise;
    let result: string | undefined;
    const retrying = f.runtime.retry(lease, "weather").then(value => { result = value; });
    try {
      await vi.waitFor(() => expect(result).toBe("durable"));
      expect(f.runtime.getSnapshot().apps.weather).toMatchObject({ status: "ready", pendingWrites: false });
      expect((await f.database.readWords(lease.ownerKey, "weather"))[0].value).toEqual(locationEdit.value);
      expect(f.values.get(key)).toBe(original);
      expect(f.authority.isLatestDurable(logical, lease)).toBe(false);
    } finally {
      gate.resolve();
      await retrying;
    }
    await vi.waitFor(() => expect(f.authority.isLatestDurable(logical, lease)).toBe(true));
  });

  it("waits for an explicit retry after a namespace capture fails instead of retrying each frame", async () => {
    const f = fixture(); const lease = await f.start();
    const key = PROGRESS_NAMESPACE + JSON.stringify([lease.ownerKey, logical]);
    f.values.set(key, JSON.stringify({ version: 2, ownerKey: lease.ownerKey, logicalKey: logical, raw: envelope("old note") }));
    vi.spyOn(f.database, "capture").mockRejectedValueOnce(Error("quota"));
    f.authority.writeScoped(logical, envelope(""), lease);
    await vi.waitFor(() => expect(f.runtime.getSnapshot().apps[app].status).toBe("memory-only"));
    const epoch = vi.spyOn(f.database, "ownerEpoch");
    for (let frame = 0; frame < 120; frame++) f.authority.writeScoped(logical, envelope(""), lease);
    expect(epoch).not.toHaveBeenCalled();
    expect(await f.runtime.retry(lease, app)).toBe("durable");
    expect(f.authority.isLatestDurable(logical, lease)).toBe(true);
  });

  it("does not repeatedly extract an unchanged original while its namespace write waits for capture", async () => {
    const f = fixture();
    const lease = await f.start();
    const key = PROGRESS_NAMESPACE + JSON.stringify([lease.ownerKey, logical]);
    const original = JSON.stringify({ version: 2, ownerKey: lease.ownerKey, logicalKey: logical, raw: envelope("old note") });
    f.values.set(key, original);
    const entered = deferred<void>();
    const gate = deferred<void>();
    const capture = f.database.capture.bind(f.database);
    vi.spyOn(f.database, "capture").mockImplementationOnce(async (...args) => {
      entered.resolve();
      await gate.promise;
      return capture(...args);
    });
    const next = envelope("");
    f.authority.writeScoped(logical, next, lease);
    await entered.promise;
    const extract = vi.spyOn(inventory, "extractLegacyWordSource");
    try {
      for (let frame = 0; frame < 120; frame++) expect(f.authority.writeScoped(logical, next, lease)).toBe(false);
      expect(extract).not.toHaveBeenCalled();
      expect(f.values.get(key)).toBe(original);
      expect(f.authority.readScoped(logical, lease)).toBe(next);
    } finally {
      extract.mockRestore();
      gate.resolve();
    }
    await vi.waitFor(() => expect(f.authority.isLatestDurable(logical, lease)).toBe(true));
    expect((await f.database.listSources(lease.ownerKey)).filter(source => source.raw === original)).toHaveLength(1);
  });

  it("reports a namespace commit failure that arrives after a retry has begun", async () => {
    const f = fixture();
    const lease = await f.start();
    const key = PROGRESS_NAMESPACE + JSON.stringify([lease.ownerKey, logical]);
    const original = JSON.stringify({ version: 2, ownerKey: lease.ownerKey, logicalKey: logical, raw: envelope("source survives") });
    f.values.set(key, original);
    const epoch = deferred<number>();
    vi.spyOn(f.database, "ownerEpoch").mockResolvedValue(0).mockReturnValueOnce(epoch.promise);
    vi.spyOn(f.database, "readWords").mockResolvedValue([]);
    vi.spyOn(f.database, "listSources").mockResolvedValue([]);
    vi.spyOn(f.database, "listCommittedSources").mockResolvedValue([]);
    const setItem = f.storage.setItem.bind(f.storage);
    vi.spyOn(f.storage, "setItem").mockImplementation((name, value) => {
      if (name === key) throw new DOMException("Denied", "QuotaExceededError");
      setItem(name, value);
    });
    f.authority.writeScoped(logical, envelope(""), lease);
    const retrying = f.runtime.retry(lease, app);
    // Drain the immediate mocked reads while the namespace epoch is still held.
    // This makes an early prepare appear successful before the physical failure.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    epoch.resolve(0);
    expect(await retrying).toBe("memory-only");
    expect(f.runtime.getSnapshot().apps[app].status).toBe("memory-only");
    expect(f.values.get(key)).toBe(original);
    expect(f.authority.isLatestDurable(logical, lease)).toBe(false);
  });

  it("keeps the retryable failure visible while a subsequent preparation read stalls", async () => {
    const f = fixture();
    const lease = await f.start();
    vi.spyOn(f.database, "writeWords").mockRejectedValueOnce(Error("quota"));
    expect(await f.runtime.write(app, [edit("unsaved")], lease)).toBe("memory-only");
    const read = deferred<WordRecord[]>();
    vi.spyOn(f.database, "readWords").mockReturnValueOnce(read.promise);
    const preparing = f.runtime.prepare(app, lease);
    try {
      expect(f.runtime.getSnapshot().apps[app]).toMatchObject({ status: "memory-only", pendingWrites: true });
      expect(f.runtime.read(app, lease)[0].value).toBe("unsaved");
    } finally { read.resolve([]); }
    expect(await preparing).toBe("memory-only");
  });

});
