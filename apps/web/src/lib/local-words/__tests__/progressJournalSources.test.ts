import { describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { ownerKeyFor } from "@/shared/clips/library/ownerKey";
import { progressJournalKey } from "@/shared/lib/progressJournal";
import { LocalWordsDatabase } from "../database";
import { captureProgressJournalWords, progressJournalWordSources } from "../progressJournalSources";

const appId = "drawing-app" as const;
const logicalKey = progressJournalKey(appId, "writer");
const artwork = (id: string) => ({ id, name: `${id} title`, dataUrl: `data:image/png;base64,${id}`, thumbnail: id });
const data = (id: string) => ({ savedArtworks: [artwork(id)] });
// Historical/future game payloads need not satisfy the CURRENT game schema to
// remain preservation sources. Sync parsing is a separate stricter boundary.
const raw = () => JSON.stringify({
  version: 1, appId, ownerId: "owner", writerId: "writer", serial: 3,
  acknowledged: { data: data("ack"), revision: "r1" },
  sent: { base: { data: data("base"), revision: "r0" }, data: data("sent") },
  live: data("live"), conflict: { remote: { data: data("conflict"), revision: "r2" } },
}, null, 2);
const fixture = async () => {
  const ownerKey = await ownerKeyFor("owner");
  const db = new LocalWordsDatabase(new IDBFactory(), "journal-word-test");
  const lease = { ownerKey, generation: 1 };
  return { db, lease, ownerKey, address: { appId, ownerId: "owner", ownerKey, logicalKey } };
};

describe("progress journal word sources", () => {
  it("captures all five alternatives separately, including original bytes and source identities", async () => {
    const { address } = await fixture(), original = raw();
    const sources = progressJournalWordSources(original, address)!;
    expect(sources).toHaveLength(5);
    expect(sources.map(source => source.sourceKey)).toEqual(
      ["acknowledged", "sent-base", "sent", "live", "conflict"].map(section => `${logicalKey}:${section}`),
    );
    for (const [i, source] of sources.entries()) {
      expect(source.raw).toBe(original);
      expect(source.ownerKey).toBe(address.ownerKey);
      expect(source.id).toBe(JSON.stringify([source.ownerKey, appId, source.sourceKey, source.sourceVersion, source.digest]));
      expect(source.fields).toEqual([{ path: "savedArtworks", value: [artwork(["ack", "base", "sent", "live", "conflict"][i])], identity: {} }]);
    }
    expect(new Set(sources.map(source => source.id)).size).toBe(5);
  });
  it("keeps future journal versions opaque and recoverable", async () => {
    const { address } = await fixture();
    const original = JSON.stringify({ ...JSON.parse(raw()), version: 2, future: "only copy" });
    const sources = progressJournalWordSources(original, address)!;
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ raw: original, fields: [], sourceKey: `${logicalKey}:original` });
  });
  it("preserves opaque future formats even for apps with no currently known word fields", async () => {
    const { db, lease } = await fixture();
    const key = progressJournalKey("snake", "writer");
    const original = JSON.stringify({ version: 2, appId: "snake", ownerId: "owner", writerId: "writer", future: { name: "Only copy" } });
    expect(await captureProgressJournalWords({ raw: original, logicalKey: key, appId: "snake", ownerId: "owner", lease,
      database: db, isCurrent: () => true })).toBe(true);
    const sources = await db.listSources(lease.ownerKey);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ raw: original, fields: [] });
    db.close();
  });
  it("pins the exact raw version instead of treating a reused serial as the same source", async () => {
    const { address } = await fixture();
    const before = progressJournalWordSources(raw(), address)!;
    const changed = JSON.stringify({ ...JSON.parse(raw()), live: data("new") });
    const after = progressJournalWordSources(changed, address)!;
    expect(new Set([...before, ...after].map(source => source.id)).size).toBe(10);
    expect(before[0].raw).toBe(raw());
  });
  it.each([
    { ownerId: "other" }, { appId: "weather" }, { writerId: "other" }, { writerId: "../writer" },
  ])("does not infer ownership or address from a mismatched journal %j", async patch => {
    const { address } = await fixture();
    expect(progressJournalWordSources(JSON.stringify({ ...JSON.parse(raw()), ...patch }), address)).toBeNull();
  });
  it("requires all captures before reporting success, retaining partial captures for retry", async () => {
    const { db, lease, ownerKey } = await fixture();
    let calls = 0;
    const capture = vi.fn(async (...args: Parameters<LocalWordsDatabase["capture"]>) => {
      if (++calls === 3) throw new Error("quota");
      await db.capture(...args);
    });
    const options = { raw: raw(), logicalKey, appId, ownerId: "owner", lease, isCurrent: () => true,
      database: { ownerEpoch: (owner: string) => db.ownerEpoch(owner), capture } };
    expect(await captureProgressJournalWords(options)).toBe(false);
    expect(await db.listSources(ownerKey)).toHaveLength(2);
    expect(await captureProgressJournalWords(options)).toBe(true);
    expect(await db.listSources(ownerKey)).toHaveLength(5);
    expect(capture.mock.calls.every(call => call[1] === 0)).toBe(true);
    db.close();
  });
  it("does not capture a correctly labeled journal into the wrong owner's lease", async () => {
    const { db, lease } = await fixture();
    const wrong = { ...lease, ownerKey: await ownerKeyFor("other") };
    const capture = vi.spyOn(db, "capture");
    expect(await captureProgressJournalWords({ raw: raw(), logicalKey, appId, ownerId: "owner", lease: wrong,
      isCurrent: () => true, database: db })).toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });
  it("stops after owner revocation during a capture without authorizing retirement", async () => {
    const { db, lease, ownerKey } = await fixture();
    let current = true;
    const options = { raw: raw(), logicalKey, appId, ownerId: "owner", lease, isCurrent: () => current,
      database: { ownerEpoch: (owner: string) => db.ownerEpoch(owner), capture: async (...args: Parameters<LocalWordsDatabase["capture"]>) => {
        await db.capture(...args); current = false;
      } } };
    expect(await captureProgressJournalWords(options)).toBe(false);
    expect(await db.listSources(ownerKey)).toHaveLength(1);
    db.close();
  });
  it("rejects a deleted owner's epoch rather than recreating old words", async () => {
    const { db, lease, ownerKey } = await fixture();
    await db.deleteOwner(ownerKey);
    expect(await captureProgressJournalWords({ raw: raw(), logicalKey, appId, ownerId: "owner", lease,
      isCurrent: () => true, database: db })).toBe(false);
    expect(await db.listSources(ownerKey)).toHaveLength(0);
    db.close();
  });
});
