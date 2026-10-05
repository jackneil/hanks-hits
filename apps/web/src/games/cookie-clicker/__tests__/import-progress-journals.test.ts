import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnerBoundProgress } from "@/lib/owner-bound-progress/core";
import { LocalWordsDatabase } from "@/lib/local-words/database";
import { cloneProgress, parseProgressJournal } from "@/shared/lib/progressJournal";
import { ProgressJournalDatabase } from "@/shared/lib/progressJournalDatabase";
import { ProgressJournalRepository } from "@/shared/lib/progressJournalRepository";
import { resolvedJournalSources } from "@/shared/lib/progressJournalRecovery";
import { ProgressSyncRuntime } from "@/shared/lib/progressSyncRuntime";
import { useCookieClickerStore } from "../lib/store";
import { bakeryJournalKey, type BakeryJournal } from "../lib/sync-session";
import { importBakeryJournal, inventoryBakeryJournals } from "../lib/import-progress-journals";

const APP = "cookie-clicker", OWNER = "owner";
const bakery = (cookies = 1000) => cloneProgress({ ...useCookieClickerStore.getState().getProgress(), cookies,
  totalCookiesBaked: 5000, lastModified: 100, lastTick: 100 });
const cloud = (cookies = 1000, digit = "a") => ({ data: bakery(cookies), revision: digit.repeat(64) });
function journal(writer = "old", cookies = 1100): BakeryJournal {
  return { version: 1, ownerId: OWNER, writerId: writer, serial: 3, acknowledged: cloud(),
    sent: { id: "old-request", base: cloud(), data: bakery(1050) }, live: bakery(cookies), conflict: null,
    resolving: false, choiceBackup: null };
}
const closes: Array<() => void> = [];
afterEach(() => { closes.splice(0).forEach(close => close()); vi.restoreAllMocks(); });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(initial = bakery(1100)) {
  const bytes = new Map<string, string>();
  const local = { get length() { return bytes.size; }, key: (i: number) => [...bytes.keys()][i] ?? null,
    getItem: (key: string) => bytes.get(key) ?? null, setItem: (key: string, raw: string) => { bytes.set(key, raw); },
    removeItem: (key: string) => { bytes.delete(key); } };
  const authority = createOwnerBoundProgress({ storage: () => local, sessionStorage: () => local });
  await authority.updateSession("authenticated", OWNER);
  const lease = authority.captureLease()!, factory = new IDBFactory();
  const database = new ProgressJournalDatabase(factory), words = new LocalWordsDatabase(factory, "bakery-import-words");
  closes.push(() => { database.close(); words.close(); });
  const inventory = () => inventoryBakeryJournals(authority, lease, OWNER);
  const create = (writerId: string) => ProgressJournalRepository.create({ authority, lease, database, words,
    appId: APP, ownerId: OWNER, writerId, maySave: () => authority.isCurrent(lease), additionalRecovery: inventory });
  let live = cloneProgress(initial), canonical = cloud(900, "b"), serial = 20;
  const write = vi.fn(async (body: { data: typeof live; baseRevision: string | null }) => {
    if (body.baseRevision !== canonical.revision) return { status: 409, body: { protocol: 1, code: "revision_conflict", ...canonical } };
    canonical = { data: cloneProgress(body.data), revision: (++serial).toString(16).padStart(64, "0") };
    return { status: 200, body: { protocol: 1, ...canonical } };
  });
  const runtime = async (writerId: string) => {
    const { repository } = await create(writerId);
    const sync = new ProgressSyncRuntime({ appId: APP, ownerId: OWNER, ownerKey: lease.ownerKey, writerId,
      repository, maySave: () => authority.isCurrent(lease), getLive: () => live,
      applyLive: data => { live = cloneProgress(data); }, isUntouched: data => data.lastModified <= 0,
      requestId: () => crypto.randomUUID(), transport: { read: async () => ({ status: 200, body: { protocol: 1, ...canonical } }), write } });
    return { sync, repository };
  };
  return { bytes, local, authority, lease, database, words, inventory, create, runtime, write,
    canonical: () => cloneProgress(canonical), live: () => cloneProgress(live), edit: (data: typeof live) => { live = cloneProgress(data); } };
}

describe("read-only bakery compatibility import", () => {
  it("preserves exact raw, immutable sent request, backup, guest IDs and retirement evidence", async () => {
    const h = await fixture();
    const old = journal();
    old.choiceBackup = { live: bakery(750), acknowledged: cloud(700, "c"),
      sent: { id: "backup-request", base: cloud(700, "c"), data: bakery(720) } };
    old.guestCandidateIds = ["exact-guest-id"];
    old.resolvedCopies = [["old-physical-key", 2]];
    const raw = JSON.stringify(old, null, 2), key = bakeryJournalKey(old.writerId);
    h.bytes.set(key, raw);
    const inventory = h.inventory();
    expect(inventory.unavailable).toBe(false); expect(inventory.copies).toHaveLength(1);
    const source = inventory.copies[0], row = parseProgressJournal(source.envelope.current, APP, OWNER)!;
    expect(row.imported).toEqual({ kind: "bakery-v1", sourceKey: key, raw });
    expect(row.sent).toEqual(old.sent);
    expect(row.conflict!.reason).toBe("unknown-lineage");
    const backup = parseProgressJournal(source.envelope.originals[0].raw, APP, OWNER)!;
    expect(backup).toMatchObject(old.choiceBackup);
    expect(h.bytes.get(key)).toBe(raw);
    expect(h.inventory().copies[0].sourceId).toBe(source.sourceId);
  });

  it("inventories distinct scoped and legacy copies without exposing a foreign legacy owner", async () => {
    const h = await fixture();
    h.bytes.set(bakeryJournalKey("one"), JSON.stringify(journal("one", 100)));
    h.authority.writeScoped(bakeryJournalKey("two"), JSON.stringify(journal("two", 200)), h.lease);
    h.bytes.set(bakeryJournalKey("foreign"), JSON.stringify({ ...journal("foreign"), ownerId: "other" }));
    const result = h.inventory();
    expect(result.unavailable).toBe(false); expect(result.copies).toHaveLength(2);
    expect(new Set(result.copies.map(source => source.sourceId)).size).toBe(2);
    expect(inventoryBakeryJournals(h.authority, h.lease, "other").unavailable).toBe(true);
    expect(importBakeryJournal("key", JSON.stringify(journal()), OWNER, "u_wrong")).toBeNull();
  });

  it.each(["broken JSON", "{\"version\":1}"])("blocks automatic recovery for unclassifiable legacy bytes %s", async raw => {
    const h = await fixture(), key = bakeryJournalKey("bad"); h.bytes.set(key, raw);
    expect(h.inventory().unavailable).toBe(true);
    const { sync } = await h.runtime("mounted");
    expect(await sync.initialize(h.canonical())).toBe(false);
    expect(h.write).not.toHaveBeenCalled(); expect(h.bytes.get(key)).toBe(raw);
  });

  it("refuses malformed backup.sent and lossy nested progress while leaving original bytes intact", async () => {
    const h = await fixture(), old = journal();
    old.choiceBackup = { live: bakery(750), acknowledged: cloud(), sent: { id: "bad", base: cloud(), data: null as never } };
    const raw = JSON.stringify(old), key = bakeryJournalKey("bad"); h.bytes.set(key, raw);
    expect(h.inventory().unavailable).toBe(true); expect(h.bytes.get(key)).toBe(raw);
    const lossy = journal(); (lossy.live as unknown as Record<string, unknown>).unexpected = true;
    h.bytes.set(key, JSON.stringify(lossy));
    expect(h.inventory().unavailable).toBe(true);
  });

  it("returns an unavailable conversion for a missing nested backup request field", async () => {
    const h = await fixture(), old = journal();
    old.choiceBackup = { live: bakery(750), acknowledged: cloud() } as BakeryJournal["choiceBackup"];
    expect(importBakeryJournal(bakeryJournalKey("old"), JSON.stringify(old), OWNER, h.lease.ownerKey)).toBeNull();
  });

  it("does not treat failed enumeration or reads as an empty recovery inventory", async () => {
    const h = await fixture(), key = bakeryJournalKey("old"); h.bytes.set(key, JSON.stringify(journal()));
    const listing = vi.spyOn(h.local, "key").mockImplementation(() => { throw Error("unavailable"); });
    expect(h.inventory()).toEqual({ copies: [], unavailable: true });
    listing.mockRestore();
    vi.spyOn(h.local, "getItem").mockImplementation(() => { throw Error("unavailable"); });
    expect(h.inventory().unavailable).toBe(true);
  });

  it("ignores clean acknowledged copies but retains backup and guest evidence for choice", async () => {
    const h = await fixture(), clean = { ...journal(), sent: null, live: bakery() };
    const key = bakeryJournalKey("old"); h.bytes.set(key, JSON.stringify(clean));
    expect(h.inventory().copies).toEqual([]);
    h.bytes.set(key, JSON.stringify({ ...clean, guestCandidateIds: ["guest"] }));
    expect(h.inventory().copies).toHaveLength(1);
    h.bytes.set(key, JSON.stringify({ ...clean, choiceBackup: { live: bakery(750), acknowledged: cloud(), sent: null } }));
    expect(h.inventory().copies).toHaveLength(1);
  });

  it("retains pending legacy copies even when another old journal lists them as retired", async () => {
    const h = await fixture(), first = journal("first"), second = journal("second");
    second.resolvedCopies = [[bakeryJournalKey("first"), first.serial!]];
    h.bytes.set(bakeryJournalKey("first"), JSON.stringify(first));
    h.bytes.set(bakeryJournalKey("second"), JSON.stringify(second));
    expect(h.inventory().copies).toHaveLength(2);
  });

  it("requires an explicit choice, then suppresses exactly resolved sources on cold reload", async () => {
    const h = await fixture();
    const raw = JSON.stringify(journal()), key = bakeryJournalKey("old"); h.bytes.set(key, raw);
    const { sync, repository } = await h.runtime("first");
    expect(await sync.initialize(h.canonical())).toBe(true);
    expect(sync.status()).toBe("conflict"); expect(h.write).not.toHaveBeenCalled();
    const sourceId = sync.choice()!.copies[0].sourceId;
    expect((await sync.choose(sync.choice()!, "local")).ok).toBe(true);
    expect(h.bytes.get(key)).toBe(raw);
    const resolved = resolvedJournalSources((await repository.recover()).copies, APP, h.lease.ownerKey)!;
    expect(resolved.has(sourceId)).toBe(true);
    const archives = await h.database.archivedSources(h.lease.ownerKey, APP, sourceId, 0);
    expect(JSON.parse(JSON.parse(archives[0].raw).current).imported.raw).toBe(raw);
    const cold = await h.runtime("second");
    expect(await cold.sync.initialize(h.canonical())).toBe(true);
    expect(cold.sync.choice()).toBeNull();
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it("retains local edits made while legacy source adoption waits on archival", async () => {
    const h = await fixture(), raw = JSON.stringify(journal()); h.bytes.set(bakeryJournalKey("old"), raw);
    const { sync } = await h.runtime("mounted"), entered = deferred(), release = deferred();
    const archive = h.database.archive.bind(h.database);
    vi.spyOn(h.database, "archive").mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return archive(...args);
    });
    const loading = sync.initialize(h.canonical()); await entered.promise;
    h.edit(bakery(1500)); release.resolve();
    expect(await loading).toBe(true);
    expect(h.live().cookies).toBe(1500); expect(sync.choice()!.local.cookies).toBe(1500);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("rejects an old displayed source when legacy bytes change during archival", async () => {
    const h = await fixture(bakery(2500)), key = bakeryJournalKey("old"); h.bytes.set(key, JSON.stringify(journal()));
    const { sync } = await h.runtime("mounted"); await sync.initialize(h.canonical());
    const entered = deferred(), release = deferred(), archive = h.database.archive.bind(h.database);
    vi.spyOn(h.database, "archive").mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return archive(...args);
    });
    const choosing = sync.choose(sync.choice()!, "local"); await entered.promise;
    h.bytes.set(key, JSON.stringify(journal("old", 1600))); release.resolve();
    expect((await choosing).ok).toBe(false); expect(h.write).not.toHaveBeenCalled();
    expect(sync.alternatives().some(copy => copy.data.cookies === 1600)).toBe(true);
    expect((await sync.choose(sync.choice()!, "local")).ok).toBe(true);
  });

  it("does not publish an inventory or adopt data after owner revocation", async () => {
    const h = await fixture(); h.bytes.set(bakeryJournalKey("old"), JSON.stringify(journal()));
    h.authority.revoke();
    expect(h.inventory()).toEqual({ copies: [], unavailable: true });
  });
});
