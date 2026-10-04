import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import * as ownerKeys from "@/shared/clips/library/ownerKey";
import { LocalWordsDatabase, type SourceRecord } from "../database";
import { recoverCloudWords, type RecoveryLease } from "../recovery";

const USER = "account-a";
const revision = "a".repeat(64);
const candidate = (sourceRevision = revision, name = "Old wagon name") => ({
  sourceRevision, extractionVersion: 1,
  payload: { fields: [{ path: "leaderName", value: name, identity: {} }] },
});
const body = (...entries: ReturnType<typeof candidate>[]) => ({ appId: "oregon-trail", candidates: entries });
const response = (value: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(value),
}) as unknown as Response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(value: unknown = body(candidate())) {
  const lease: RecoveryLease = { ownerKey: await ownerKeys.ownerKeyFor(USER), generation: 1 };
  let current = true;
  const rows = new Map<string, SourceRecord>();
  const database = {
    ownerEpoch: vi.fn().mockResolvedValue(0),
    capture: vi.fn(async (source: SourceRecord, epoch: number) => {
      expect(epoch).toBe(0);
      rows.set(source.id, structuredClone(source));
    }),
  };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(value));
  const options = { appId: "oregon-trail", userId: USER, lease, database, fetch,
    isCurrent: (captured: RecoveryLease) => current && captured.generation === 1 && captured.ownerKey === lease.ownerKey };
  return { options, rows, database, fetch, changeOwner: () => { current = false; } };
}
afterEach(() => { vi.restoreAllMocks(); });

describe("owner-bound cloud word recovery", () => {
  it("captures an immutable candidate using the recovery route contract without assigning a journey", async () => {
    const f = await fixture();
    expect(await recoverCloudWords(f.options)).toBe("captured");
    expect(f.fetch).toHaveBeenCalledWith("/api/progress/oregon-trail/legacy-words", {
      method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { Accept: "application/json", "x-hh-expected-owner": USER },
    });
    const source = [...f.rows.values()][0];
    expect(source).toMatchObject({ ownerKey: f.options.lease.ownerKey, appId: "oregon-trail",
      sourceKey: `cloud:oregon-trail:${revision}`, sourceVersion: 1,
      fields: candidate().payload.fields, raw: JSON.stringify(candidate().payload) });
    expect(source.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(source.id).toBe(JSON.stringify([source.ownerKey, source.appId, source.sourceKey, 1, source.digest]));
    expect(source.fields[0].identity).toEqual({});
  });

  it("rejects unknown apps, empty accounts, and an unrelated supplied account", async () => {
    const f = await fixture();
    expect(await recoverCloudWords({ ...f.options, appId: "__proto__" })).toBe("unavailable");
    expect(await recoverCloudWords({ ...f.options, userId: "" })).toBe("unavailable");
    expect(await recoverCloudWords({ ...f.options, userId: "account-b" })).toBe("stale");
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.database.capture).not.toHaveBeenCalled();
  });

  it("stops before hashing when the lease is already stale", async () => {
    const f = await fixture();
    const hash = vi.spyOn(ownerKeys, "ownerKeyFor");
    f.changeOwner();
    expect(await recoverCloudWords(f.options)).toBe("stale");
    expect(hash).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("checks the generation after deferred owner hashing", async () => {
    const f = await fixture();
    const hash = deferred<string>();
    vi.spyOn(ownerKeys, "ownerKeyFor").mockReturnValue(hash.promise);
    const recovery = recoverCloudWords(f.options);
    f.changeOwner();
    hash.resolve(f.options.lease.ownerKey);
    expect(await recovery).toBe("stale");
    expect(f.database.ownerEpoch).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("checks the generation after reading the deletion epoch", async () => {
    const f = await fixture();
    f.database.ownerEpoch.mockImplementationOnce(async () => { f.changeOwner(); return 0; });
    expect(await recoverCloudWords(f.options)).toBe("stale");
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("discards a fetch response when the owner changes during the request", async () => {
    const f = await fixture();
    const reply = response(body(candidate()));
    f.fetch.mockImplementationOnce(async () => { f.changeOwner(); return reply; });
    expect(await recoverCloudWords(f.options)).toBe("stale");
    expect(reply.json).not.toHaveBeenCalled();
    expect(f.database.capture).not.toHaveBeenCalled();
  });

  it("discards parsed JSON when the owner changes while reading it", async () => {
    const f = await fixture();
    f.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => {
      f.changeOwner(); return body(candidate());
    } } as Response);
    expect(await recoverCloudWords(f.options)).toBe("stale");
    expect(f.database.capture).not.toHaveBeenCalled();
  });

  it("does not publish success or capture later candidates after an owner change during capture", async () => {
    const f = await fixture(body(candidate(), candidate("b".repeat(64))));
    f.database.capture.mockImplementationOnce(async (source) => {
      f.rows.set(source.id, structuredClone(source));
      f.changeOwner();
    });
    expect(await recoverCloudWords(f.options)).toBe("stale");
    expect(f.database.capture).toHaveBeenCalledTimes(1);
    expect([...f.rows.values()][0].ownerKey).toBe(f.options.lease.ownerKey);
  });

  it("recognizes only an authoritative current-owner mismatch without capturing words", async () => {
    const f = await fixture();
    const reply = response({ code: "owner_changed" }, 409);
    f.fetch.mockResolvedValueOnce(reply);
    expect(await recoverCloudWords(f.options)).toBe("owner-changed");
    expect(reply.json).toHaveBeenCalledOnce();
    expect(f.database.capture).not.toHaveBeenCalled();
  });

  it("checks the lease again after parsing an owner mismatch", async () => {
    const f = await fixture();
    f.fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => {
      f.changeOwner(); return { code: "owner_changed" };
    } } as Response);
    expect(await recoverCloudWords(f.options)).toBe("stale");
    expect(f.database.capture).not.toHaveBeenCalled();
  });

  it("does not mistake an unrelated conflict for an owner change", async () => {
    const f = await fixture();
    f.fetch.mockResolvedValueOnce(response({ code: "conflict" }, 409));
    expect(await recoverCloudWords(f.options)).toBe("unavailable");
    expect(f.database.capture).not.toHaveBeenCalled();
  });

  it("keeps partial successes durable and uses stable IDs when retrying every source", async () => {
    const f = await fixture(body(candidate(), candidate("b".repeat(64), "Another preserved name")));
    f.database.capture.mockImplementationOnce(async source => { f.rows.set(source.id, structuredClone(source)); })
      .mockRejectedValueOnce(new Error("Storage unavailable"));
    expect(await recoverCloudWords(f.options)).toBe("unavailable");
    const firstId = [...f.rows.keys()][0];
    expect(f.rows.size).toBe(1);
    expect(await recoverCloudWords(f.options)).toBe("captured");
    expect(f.rows.size).toBe(2);
    expect(f.database.capture.mock.calls[2][0].id).toBe(firstId);
    expect(new Set([...f.rows.values()].map(source => source.sourceKey)).size).toBe(2);
    expect(await recoverCloudWords(f.options)).toBe("captured");
    expect(f.rows.size).toBe(2);
  });

  it("reports empty only for a valid response with no word candidates", async () => {
    const f = await fixture(body());
    expect(await recoverCloudWords(f.options)).toBe("empty");
    f.fetch.mockResolvedValueOnce(response(body({ ...candidate(), payload: { fields: [] } })));
    expect(await recoverCloudWords(f.options)).toBe("empty");
    expect(f.database.capture).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { appId: "weather", candidates: [] }, { appId: "oregon-trail", candidates: {} },
    body({ ...candidate(), sourceRevision: "unknown" }),
    body({ ...candidate(), extractionVersion: 2 }),
    { appId: "oregon-trail", candidates: [{ ...candidate(), payload: { fields: [{ path: "leaderName", identity: {} }] } }] },
    { appId: "oregon-trail", candidates: [{ ...candidate(), payload: { fields: [{ path: "leaderName", value: "Name", identity: [] }] } }] },
  ])("refuses malformed or unsupported recovery responses (%#)", async malformed => {
    const f = await fixture(malformed);
    expect(await recoverCloudWords(f.options)).toBe("unavailable");
    expect(f.database.capture).not.toHaveBeenCalled();
  });

  it("validates later candidates before capturing earlier ones", async () => {
    const f = await fixture(body(candidate(), { ...candidate(), extractionVersion: 999 }));
    expect(await recoverCloudWords(f.options)).toBe("unavailable");
    expect(f.database.capture).not.toHaveBeenCalled();
  });

  it("reports database/network/JSON failures without logging typed values", async () => {
    const f = await fixture();
    const error = vi.spyOn(console, "error"), warn = vi.spyOn(console, "warn"), log = vi.spyOn(console, "log");
    f.database.ownerEpoch.mockRejectedValueOnce(new Error("private database details"));
    expect(await recoverCloudWords(f.options)).toBe("unavailable");
    expect(f.fetch).not.toHaveBeenCalled();
    f.fetch.mockRejectedValueOnce(new Error("private request details"));
    expect(await recoverCloudWords(f.options)).toBe("unavailable");
    f.fetch.mockResolvedValueOnce(new Response("{private words", { status: 200 }));
    expect(await recoverCloudWords(f.options)).toBe("unavailable");
    f.fetch.mockResolvedValueOnce(response({}, 503));
    expect(await recoverCloudWords(f.options)).toBe("unavailable");
    expect(f.database.capture).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
  });

  it("retains the epoch read before the network, letting a deletion reject late writes", async () => {
    const f = await fixture();
    f.database.capture.mockRejectedValueOnce(new Error("Owner deleted"));
    expect(await recoverCloudWords(f.options)).toBe("unavailable");
    expect(f.database.ownerEpoch).toHaveBeenCalledTimes(1);
    expect(f.database.capture).toHaveBeenCalledWith(expect.objectContaining({ ownerKey: f.options.lease.ownerKey }), 0);
    expect(f.rows.size).toBe(0);
  });

  it("composes recovery with durable deletion, even when a caller rereads the tombstone", async () => {
    const f = await fixture();
    const database = new LocalWordsDatabase(new IDBFactory(), "recovery-deletion-test");
    try {
      const options = { ...f.options, database };
      expect(await recoverCloudWords(options)).toBe("captured");
      expect(await database.listSources(options.lease.ownerKey)).toHaveLength(1);
      await database.deleteOwner(options.lease.ownerKey);
      expect(await database.ownerEpoch(options.lease.ownerKey)).toBe(1);
      // Simulate a stale mounted caller that still considers its lease current.
      expect(await recoverCloudWords(options)).toBe("unavailable");
      expect(await database.listSources(options.lease.ownerKey)).toEqual([]);
      expect(await database.listCommittedSources(options.lease.ownerKey)).toEqual([]);
    } finally { database.close(); }
  });
});
