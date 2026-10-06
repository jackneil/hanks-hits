// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import { PROGRESS_JOURNAL_PREFIX, progressJournalKey } from "@/shared/lib/progressJournal";
import { ProgressJournalDatabase, type JournalPageCursor } from "@/shared/lib/progressJournalDatabase";
import { emptyJournalRecovery, journalOriginalId, journalSourceId } from "@/shared/lib/progressJournalRecovery";
import { createOwnerBoundProgress, PROGRESS_NAMESPACE } from "../../owner-bound-progress/core";
import { LocalWordsDatabase, type SourceRecord } from "../database";
import { captureJournalInventory, type JournalInventoryOptions } from "../journalInventory";
import * as extraction from "../progressJournalSources";

class PhysicalStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(name: string) { return this.values.get(name) ?? null; }
  setItem(name: string, value: string) { this.values.set(name, value); }
  removeItem(name: string) { this.values.delete(name); }
  clear() { this.values.clear(); }
}
const ownerId = "owner-A", appId = "drawing-app" as const;
const artwork = (id: string) => ({ id, name: `${id} title`, dataUrl: `data:image/png;base64,${id}`, thumbnail: id });
const data = (id: string) => ({ savedArtworks: [artwork(id)] });
function journal(writerId = "writer", prefix = "", patch: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 1, appId, ownerId, writerId, serial: 7,
    acknowledged: { data: data(`${prefix}ack`), revision: "a".repeat(64) },
    sent: { id: "immutable-request", base: { data: data(`${prefix}base`), revision: "b".repeat(64) }, data: data(`${prefix}sent`) },
    live: data(`${prefix}live`), conflict: { remote: { data: data(`${prefix}conflict`), revision: "c".repeat(64) } },
    forceWrite: false, ...patch }, null, 2);
}
function envelope(current = journal(), originals: string[] = [], generation = 3, patch: Record<string, unknown> = {}) {
  return JSON.stringify({ format: "hh-progress-journal", version: 3, generation, current,
    originals: originals.map(raw => ({ raw, choice: false })), recovery: emptyJournalRecovery(), ...patch }, null, 2);
}
const close: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); close.splice(0).forEach(done => done()); });
async function fixture() {
  const local = new PhysicalStorage(), factory = new IDBFactory();
  const storage = () => local;
  const authority = createOwnerBoundProgress({ storage, sessionStorage: () => new PhysicalStorage() });
  await authority.updateSession("authenticated", ownerId);
  const lease = authority.captureLease()!;
  const words = new LocalWordsDatabase(factory, "journal-inventory-words");
  const journals = new ProgressJournalDatabase(factory, "journal-inventory-journals");
  close.push(() => { words.close(); journals.close(); });
  const options: JournalInventoryOptions = { ownerId, authority, lease, storage, words, journals };
  const physical = (logical = progressJournalKey(appId, "writer"), key = lease.ownerKey) =>
    PROGRESS_NAMESPACE + JSON.stringify([key, logical]);
  const outer = (raw: string | null, logical = progressJournalKey(appId, "writer")) =>
    JSON.stringify({ version: 2, ownerKey: lease.ownerKey, logicalKey: logical, raw }, null, 2);
  const put = (raw: string, writerId = "writer", generation = 3) =>
    journals.put({ ownerKey: lease.ownerKey, appId, writerId, generation, raw }, 0);
  const archive = (raw: string, current = journal(), writerId = "writer") =>
    journals.archive({ ownerKey: lease.ownerKey, appId, sourceId: journalSourceId(lease.ownerKey, appId, writerId, current), raw }, 0);
  return { local, factory, authority, lease, words, journals, options, physical, outer, put, archive };
}
const typed = (sources: SourceRecord[]) => sources.filter(source => source.fields.length);
const exactDigest = (raw: string) => [...sha256(new TextEncoder().encode(JSON.stringify(raw)))]
  .map(byte => byte.toString(16).padStart(2, "0")).join("");

describe("exact owner-bound journal inventory", () => {
  it("has no import-time storage access and requires an account lease", async () => {
    const access = vi.fn(() => { throw new Error("must stay lazy"); });
    const open = vi.fn(() => { throw new Error("must not open on import"); });
    vi.stubGlobal("indexedDB", { open });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: access });
    try {
      vi.resetModules(); await import("../journalInventory");
      expect(access).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
    }
    finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
    const h = await fixture();
    expect(await captureJournalInventory({ ...h.options, ownerId: "" })).toBe("changed");
    expect(await captureJournalInventory({ ...h.options, lease: { ...h.lease, ownerKey: "guest" } })).toBe("changed");
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]);
  });

  it("reports empty only after successful physical and both database inventories", async () => {
    const h = await fixture();
    const checkpoints = vi.spyOn(h.journals, "checkpointPage"), archives = vi.spyOn(h.journals, "archivePage");
    expect(await captureJournalInventory(h.options)).toBe("empty");
    expect(checkpoints).toHaveBeenCalledWith(h.lease.ownerKey, 0, { cursor: null });
    expect(archives).toHaveBeenCalledWith(h.lease.ownerKey, 0, { cursor: null });
    expect(await h.words.listCommittedSources(h.lease.ownerKey)).toEqual([]);
  });

  it("preserves exact outer and inner spellings and every section without changing journals or requests", async () => {
    const h = await fixture(), current = journal(), inner = envelope(current), outer = h.outer(inner);
    const logical = progressJournalKey(appId, "writer"), canonical = h.physical();
    const alternate = PROGRESS_NAMESPACE + `[ "${h.lease.ownerKey}" , "${logical}" ]`;
    h.local.setItem(canonical, outer); h.local.setItem(alternate, outer);
    await h.put(inner);
    const helperBefore = extraction.progressJournalWordSources(current, { appId, ownerId,
      ownerKey: h.lease.ownerKey, logicalKey: logical });
    const commit = vi.spyOn(h.words, "commitSource"), deleteWords = vi.spyOn(h.words, "deleteOwner");
    const deleteJournals = vi.spyOn(h.journals, "deleteOwner");
    expect(await captureJournalInventory(h.options)).toBe("captured");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(sources.some(source => source.raw === outer && JSON.parse(source.sourceKey)[1] === canonical)).toBe(true);
    expect(sources.some(source => source.raw === outer && JSON.parse(source.sourceKey)[1] === alternate)).toBe(true);
    expect(sources.some(source => source.raw === inner)).toBe(true);
    expect(typed(sources)).toHaveLength(15);
    expect(typed(sources).map(source => source.fields[0].value)).toEqual(expect.arrayContaining(
      ["ack", "base", "sent", "live", "conflict"].map(id => [artwork(id)])));
    for (const source of sources) {
      expect(source.id).toBe(JSON.stringify([h.lease.ownerKey, source.appId, source.sourceKey, source.sourceVersion, source.digest]));
      expect(source.digest).toBe(exactDigest(source.raw!));
    }
    const ids = sources.map(source => source.id);
    expect(await captureJournalInventory(h.options)).toBe("captured");
    expect((await h.words.listSources(h.lease.ownerKey)).map(source => source.id)).toEqual(ids);
    expect(h.local.getItem(canonical)).toBe(outer); expect(h.local.getItem(alternate)).toBe(outer);
    expect((await h.journals.get(h.lease.ownerKey, appId, "writer", 0))?.raw).toBe(inner);
    expect(extraction.progressJournalWordSources(current, { appId, ownerId, ownerKey: h.lease.ownerKey, logicalKey: logical })).toEqual(helperBefore);
    expect(typed(sources).every(source => source.raw?.includes('"id": "immutable-request"'))).toBe(true);
    expect(commit).not.toHaveBeenCalled(); expect(deleteWords).not.toHaveBeenCalled(); expect(deleteJournals).not.toHaveBeenCalled();
    expect(await h.words.readWords(h.lease.ownerKey, appId)).toEqual([]);
    expect(await h.words.listCommittedSources(h.lease.ownerKey)).toEqual([]);
  });

  it("keeps null wrappers, malformed and future bytes, and unknown logical names opaque", async () => {
    const h = await fixture();
    const raws = [h.outer(null, `${PROGRESS_JOURNAL_PREFIX}future-0`), "{broken", JSON.stringify({ version: 42, raw: "future-only" })];
    const names = raws.map((raw, index) => {
      const logical = `${PROGRESS_JOURNAL_PREFIX}future-${index}`;
      const name = h.physical(logical); h.local.setItem(name, raw); return name;
    });
    const logical = `${PROGRESS_JOURNAL_PREFIX}future-app-writer-storage`;
    const unknownInner = journal("writer", "future-", { appId: "future-app" });
    h.local.setItem(h.physical(logical), h.outer(unknownInner, logical));
    await h.put(envelope(journal(), [], 3, { version: 99 }));
    expect(await captureJournalInventory(h.options)).toBe("captured");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(typed(sources)).toEqual([]);
    for (const raw of [...raws, unknownInner]) expect(sources.some(source => source.raw === raw)).toBe(true);
    expect(sources.every(source => source.appId === "journal-inventory")).toBe(true);
    names.forEach((name, index) => expect(h.local.getItem(name)).toBe(raws[index]));
  });

  it("extracts valid current and different-writer originals beside unsupported alternatives", async () => {
    const h = await fixture(), current = journal(), original = journal("adopted-writer", "retained-");
    const future = journal("future-writer", "ignored-", { version: 90 });
    const malformed = "not json, keep exactly";
    const raw = envelope(current, [future, original, malformed, original]);
    await h.put(raw); h.local.setItem(h.physical(), h.outer(raw));
    expect(await captureJournalInventory(h.options)).toBe("captured");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(typed(sources)).toHaveLength(30);
    for (const preserved of [current, original, future, malformed, raw]) expect(sources.some(source => source.raw === preserved)).toBe(true);
    expect(typed(sources).some(source => source.raw === future || source.raw === malformed)).toBe(false);
    const originalSections = typed(sources).filter(source => source.raw === original);
    expect(originalSections).toHaveLength(20);
    expect(new Set(originalSections.map(source => source.id)).size).toBe(20);
    expect(originalSections.every(source => source.sourceKey.includes("adopted-writer"))).toBe(true);
  });

  it("walks both complete page streams, including IDB-only checkpoints, orphan archives and digest variants", async () => {
    const h = await fixture();
    for (let index = 0; index < 101; index++) await h.put(`opaque-checkpoint-${index}`, `writer-${index}`, 0);
    const current = journal("orphan"), first = envelope(current, [], 4), second = envelope(current, [journal("old")], 5);
    await h.archive(first, current, "orphan"); await h.archive(second, current, "orphan");
    for (let index = 0; index < 100; index++) await h.archive(`opaque-archive-${index}`, "gone", `archive-${index}`);
    const checkpointPage = vi.spyOn(h.journals, "checkpointPage"), archivePage = vi.spyOn(h.journals, "archivePage");
    expect(await captureJournalInventory(h.options)).toBe("captured");
    expect(checkpointPage).toHaveBeenCalledTimes(2); expect(archivePage).toHaveBeenCalledTimes(2);
    expect([...checkpointPage.mock.calls, ...archivePage.mock.calls].every(call => call[1] === 0 && Object.keys(call[2]!).join() === "cursor")).toBe(true);
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(sources.filter(source => source.raw?.startsWith("opaque-checkpoint-") && source.sourceKey.includes("envelope"))).toHaveLength(101);
    expect(sources.filter(source => source.raw?.startsWith("opaque-archive-") && source.sourceKey.includes("envelope"))).toHaveLength(100);
    for (const raw of [first, second]) expect(sources.some(source => source.raw === raw && source.sourceKey.includes(journalOriginalId(raw)))).toBe(true);
    expect(typed(sources).filter(source => source.raw === current)).toHaveLength(10);
    expect(await h.journals.archivedSources(h.lease.ownerKey, appId,
      journalSourceId(h.lease.ownerKey, appId, "orphan", current), 0)).toHaveLength(2);
  });

  it("copies an oversized row intact and distinguishes lone-surrogate fingerprints", async () => {
    const h = await fixture(), huge = "x".repeat(256 * 1024 + 1);
    await h.put(huge, "huge", 0); await h.put("\ud800", "surrogate", 0);
    expect(await captureJournalInventory(h.options)).toBe("captured");
    await h.put("\ud801", "surrogate", 1);
    expect(await captureJournalInventory(h.options)).toBe("captured");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(sources.some(source => source.raw === huge)).toBe(true);
    const surrogates = sources.filter(source => source.raw === "\ud800" || source.raw === "\ud801");
    expect(surrogates).toHaveLength(2);
    expect(new Set(surrogates.map(source => source.digest)).size).toBe(2);
    expect(surrogates.every(source => source.digest === exactDigest(source.raw!))).toBe(true);
  });

  it("retains earlier section captures when the helper extraction version changes on unchanged bytes", async () => {
    const h = await fixture(), current = journal(); await h.put(envelope(current));
    expect(await captureJournalInventory(h.options)).toBe("captured");
    const before = await h.words.listSources(h.lease.ownerKey), real = extraction.progressJournalWordSources;
    const originalHelper = real(current, { appId, ownerId, ownerKey: h.lease.ownerKey, logicalKey: progressJournalKey(appId, "writer") })!;
    vi.spyOn(extraction, "progressJournalWordSources").mockImplementation((raw, address) =>
      real(raw, address)?.map(source => {
        const sourceVersion = `${source.sourceVersion}:extraction-version-bump`;
        return { ...source, sourceVersion, id: JSON.stringify([source.ownerKey, source.appId, source.sourceKey, sourceVersion, source.digest]) };
      }) ?? null);
    expect(await captureJournalInventory(h.options)).toBe("captured");
    const after = await h.words.listSources(h.lease.ownerKey);
    expect(after).toEqual(expect.arrayContaining(before));
    expect(typed(after)).toHaveLength(10);
    expect(typed(after).filter(source => String(source.sourceVersion).includes("extraction-version-bump"))).toHaveLength(5);
    expect(typed(before).every(source => String(source.sourceVersion).includes(String(originalHelper[0].sourceVersion)))).toBe(true);
    expect((await h.journals.get(h.lease.ownerKey, appId, "writer", 0))?.raw).toBe(envelope(current));
  });

  it.each([{ ownerId: "owner-B" }, { appId: "weather" }, { writerId: "other" }, { writerId: "../bad" }])(
    "captures contradictory current bytes but exposes no typed fields for %j", async patch => {
      const h = await fixture(), raw = envelope(journal("writer", "", patch));
      await h.put(raw); h.local.setItem(h.physical(), h.outer(raw));
      expect(await captureJournalInventory(h.options)).toBe("unavailable");
      const sources = await h.words.listSources(h.lease.ownerKey);
      expect(sources.some(source => source.raw === raw)).toBe(true); expect(typed(sources)).toEqual([]);
    },
  );

  it("keeps contradictory originals opaque while capturing their valid neighbors", async () => {
    const h = await fixture(), foreign = journal("foreign", "foreign-", { ownerId: "owner-B" }), valid = journal("old", "valid-");
    await h.put(envelope(journal(), [foreign, valid]));
    expect(await captureJournalInventory(h.options)).toBe("unavailable");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(sources.some(source => source.raw === foreign && !source.fields.length)).toBe(true);
    expect(typed(sources).filter(source => source.raw === foreign)).toEqual([]);
    expect(typed(sources).filter(source => source.raw === valid)).toHaveLength(5);
  });

  it("detects wrapper, checkpoint generation, archive source-ID and whole-envelope digest contradictions", async () => {
    const h = await fixture(), raw = envelope();
    h.local.setItem(h.physical(), JSON.stringify({ version: 2, ownerKey: "guest", logicalKey: progressJournalKey(appId, "writer"), raw }));
    await h.put(raw, "writer", 4);
    const wrongCurrent = journal("orphan");
    await h.archive(envelope(wrongCurrent), "a different current raw", "orphan");
    const real = h.journals.archivePage.bind(h.journals);
    vi.spyOn(h.journals, "archivePage").mockImplementation(async (...args) => {
      const page = await real(...args);
      return { ...page, rows: [...page.rows, { ownerKey: h.lease.ownerKey, appId,
        sourceId: journalSourceId(h.lease.ownerKey, appId, "writer", journal()), digest: "0".repeat(64), raw }] };
    });
    expect(await captureJournalInventory(h.options)).toBe("unavailable");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(sources.some(source => source.raw === raw)).toBe(true); expect(typed(sources)).toEqual([]);
  });

  it("never reads another owner's physical values and leaves B and guest data untouched", async () => {
    const h = await fixture(), ownerB = await ownerKeyFor("owner-B");
    const names = [h.physical(undefined, ownerB), h.physical(undefined, "guest")];
    names.forEach(name => h.local.setItem(name, "foreign-physical-private"));
    const malformedNames = [PROGRESS_NAMESPACE + JSON.stringify([h.lease.ownerKey, progressJournalKey(appId, "writer"), "extra"]),
      PROGRESS_NAMESPACE + "{broken"];
    malformedNames.forEach(name => h.local.setItem(name, "unaddressed-private"));
    await h.journals.put({ ownerKey: ownerB, appId, writerId: "writer", generation: 0, raw: "foreign-db-private" }, 0);
    await h.journals.put({ ownerKey: "guest", appId, writerId: "writer", generation: 0, raw: "guest-db-private" }, 0);
    await h.words.writeWords([{ ownerKey: ownerB, appId, entityKey: "B", field: "name", value: "B words" }], 0);
    await h.words.writeWords([{ ownerKey: "guest", appId, entityKey: "guest", field: "name", value: "guest words" }], 0);
    const read = vi.spyOn(h.local, "getItem");
    expect(await captureJournalInventory(h.options)).toBe("empty");
    expect(read.mock.calls.some(([name]) => [...names, ...malformedNames].includes(name))).toBe(false);
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]);
    names.forEach(name => expect(h.local.getItem(name)).toBe("foreign-physical-private"));
    expect((await h.journals.get(ownerB, appId, "writer", 0))?.raw).toBe("foreign-db-private");
    expect((await h.journals.get("guest", appId, "writer", 0))?.raw).toBe("guest-db-private");
    expect((await h.words.readWords(ownerB, appId))[0].value).toBe("B words");
    expect((await h.words.readWords("guest", appId))[0].value).toBe("guest words");
  });

  it("uses copied caller options, lease and pinned dependencies across its first await", async () => {
    const h = await fixture(); await h.put(envelope());
    const options = { ...h.options, lease: { ...h.lease } };
    const pending = captureJournalInventory(options);
    options.ownerId = "owner-B"; options.lease.ownerKey = "guest"; options.lease.generation++;
    options.storage = () => undefined;
    options.authority = { isCurrent: () => false };
    options.words = { ownerEpoch: async () => 99, capture: async () => { throw new Error("mutated"); } };
    options.journals = { ownerEpoch: async () => 99, isOwnerDeleted: () => true,
      checkpointPage: async () => { throw new Error("mutated"); }, archivePage: async () => { throw new Error("mutated"); } };
    expect(await pending).toBe("captured");
    expect(typed(await h.words.listSources(h.lease.ownerKey))).toHaveLength(5);
  });

  it("checks a lease revoked while the owner key resolves before observing sources", async () => {
    const h = await fixture(); await h.put(envelope());
    const capture = vi.spyOn(h.words, "capture"), epoch = vi.spyOn(h.words, "ownerEpoch");
    const pending = captureJournalInventory(h.options); h.authority.revoke();
    expect(await pending).toBe("changed"); expect(capture).not.toHaveBeenCalled(); expect(epoch).not.toHaveBeenCalled();
  });

  it.each(["words", "journals"] as const)("rejects an initial %s tombstone", async store => {
    const h = await fixture(); await h.put(envelope());
    await h[store].deleteOwner(h.lease.ownerKey);
    const capture = vi.spyOn(h.words, "capture");
    expect(await captureJournalInventory(h.options)).toBe("changed"); expect(capture).not.toHaveBeenCalled();
  });

  it.each(["word-epoch", "journal-epoch", "capture", "checkpoint-page", "archive-page", "final-word-epoch", "final-journal-epoch"])(
    "checks the owner lease after awaited %s", async stage => {
      const h = await fixture(); await h.put(envelope()); await h.archive(envelope());
      let epochReads = 0;
      if (stage === "word-epoch" || stage === "final-word-epoch") {
        const real = h.words.ownerEpoch.bind(h.words);
        vi.spyOn(h.words, "ownerEpoch").mockImplementation(async key => {
          const epoch = await real(key);
          if (++epochReads === (stage === "word-epoch" ? 1 : 2)) h.authority.revoke();
          return epoch;
        });
      } else if (stage === "journal-epoch" || stage === "final-journal-epoch") {
        const real = h.journals.ownerEpoch.bind(h.journals);
        vi.spyOn(h.journals, "ownerEpoch").mockImplementation(async key => {
          const epoch = await real(key);
          if (++epochReads === (stage === "journal-epoch" ? 1 : 2)) h.authority.revoke();
          return epoch;
        });
      } else if (stage === "capture") {
        const real = h.words.capture.bind(h.words);
        vi.spyOn(h.words, "capture").mockImplementation(async (...args) => { await real(...args); h.authority.revoke(); });
      } else if (stage === "checkpoint-page") {
        const real = h.journals.checkpointPage.bind(h.journals);
        vi.spyOn(h.journals, "checkpointPage").mockImplementation(async (...args) => { const page = await real(...args); h.authority.revoke(); return page; });
      } else {
        const real = h.journals.archivePage.bind(h.journals);
        vi.spyOn(h.journals, "archivePage").mockImplementation(async (...args) => { const page = await real(...args); h.authority.revoke(); return page; });
      }
      expect(await captureJournalInventory(h.options)).toBe("changed");
    },
  );

  it.each(["word", "journal"])("fences %s deletion during an awaited capture", async store => {
    const h = await fixture(); await h.put(envelope());
    const real = h.words.capture.bind(h.words); let deleted = false;
    vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      await real(...args);
      if (!deleted) { deleted = true; await (store === "word" ? h.words : h.journals).deleteOwner(h.lease.ownerKey); }
    });
    expect(await captureJournalInventory(h.options)).toBe("changed");
    if (store === "word") expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]);
    else expect(await h.words.listSources(h.lease.ownerKey)).toHaveLength(1);
  });

  it.each(["word-epoch", "journal-epoch", "checkpoint-page", "archive-page", "final-word-epoch", "final-journal-epoch"])(
    "fences real durable deletion during awaited %s", async stage => {
      const h = await fixture(); await h.put(envelope()); await h.archive(envelope());
      let epochReads = 0;
      if (stage === "word-epoch" || stage === "final-word-epoch") {
        const real = h.words.ownerEpoch.bind(h.words);
        vi.spyOn(h.words, "ownerEpoch").mockImplementation(async key => {
          if (++epochReads === (stage === "word-epoch" ? 1 : 2)) await h.words.deleteOwner(key);
          return real(key);
        });
      } else if (stage === "journal-epoch" || stage === "final-journal-epoch") {
        const real = h.journals.ownerEpoch.bind(h.journals);
        vi.spyOn(h.journals, "ownerEpoch").mockImplementation(async key => {
          if (++epochReads === (stage === "journal-epoch" ? 1 : 2)) await h.journals.deleteOwner(key);
          return real(key);
        });
      } else if (stage === "checkpoint-page") {
        const real = h.journals.checkpointPage.bind(h.journals);
        vi.spyOn(h.journals, "checkpointPage").mockImplementation(async (...args) => {
          const page = await real(...args); await h.journals.deleteOwner(h.lease.ownerKey); return page;
        });
      } else {
        const real = h.journals.archivePage.bind(h.journals);
        vi.spyOn(h.journals, "archivePage").mockImplementation(async (...args) => {
          const page = await real(...args); await h.words.deleteOwner(h.lease.ownerKey); return page;
        });
      }
      expect(await captureJournalInventory(h.options)).toBe("changed");
    },
  );

  it("checks the synchronous journal deletion fence before a queued delete completes", async () => {
    const h = await fixture(); await h.put(envelope());
    const real = h.words.capture.bind(h.words); let deletion: Promise<void> | undefined;
    vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      await real(...args); deletion = h.journals.deleteOwner(h.lease.ownerKey);
    });
    expect(await captureJournalInventory(h.options)).toBe("changed"); await deletion;
    expect(await h.words.listSources(h.lease.ownerKey)).toHaveLength(1);
  });

  it.each(["value", "names"])("detects observed physical %s changes during capture", async change => {
    const h = await fixture(), outer = h.outer(envelope()); h.local.setItem(h.physical(), outer);
    const real = h.words.capture.bind(h.words); let changed = false;
    vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      await real(...args);
      if (!changed) {
        changed = true;
        h.local.setItem(change === "value" ? h.physical() : h.physical(`${PROGRESS_JOURNAL_PREFIX}new`), "changed bytes");
      }
    });
    expect(await captureJournalInventory(h.options)).toBe("changed");
    expect((await h.words.listSources(h.lease.ownerKey)).some(source => source.raw === outer)).toBe(true);
  });

  it.each(["getter", "enumeration", "read"])("copies readable DB sources despite physical %s failures", async failure => {
    const h = await fixture(); await h.put(envelope()); h.local.setItem(h.physical(), h.outer(envelope()));
    if (failure === "getter") h.options.storage = () => undefined;
    else if (failure === "enumeration") vi.spyOn(h.local, "key").mockImplementation(() => { throw new Error("PRIVATE enumeration bytes"); });
    else vi.spyOn(h.local, "getItem").mockImplementation(() => { throw new Error("PRIVATE read bytes"); });
    expect(await captureJournalInventory(h.options)).toBe("unavailable");
    expect(typed(await h.words.listSources(h.lease.ownerKey))).toHaveLength(5);
  });

  it("redacts capture quota failures, stops that run, and retains partial captures for an idempotent retry", async () => {
    const h = await fixture(), raw = envelope(); h.local.setItem(h.physical(), h.outer(raw)); await h.put(raw);
    const real = h.words.capture.bind(h.words); let calls = 0;
    const capture = vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      if (++calls === 4) throw new DOMException("PRIVATE words in quota error", "QuotaExceededError");
      await real(...args);
    });
    expect(await captureJournalInventory(h.options)).toBe("unavailable"); expect(capture).toHaveBeenCalledTimes(4);
    const partial = await h.words.listSources(h.lease.ownerKey); expect(partial).toHaveLength(3);
    capture.mockRestore();
    expect(await captureJournalInventory(h.options)).toBe("captured");
    const complete = await h.words.listSources(h.lease.ownerKey); expect(complete).toEqual(expect.arrayContaining(partial));
    expect(new Set(complete.map(source => source.id)).size).toBe(complete.length);
    expect(h.local.getItem(h.physical())).toBe(h.outer(raw));
  });

  it("pins epochs on every page and classifies known stale-epoch errors as changed", async () => {
    const h = await fixture();
    const archives = vi.spyOn(h.journals, "archivePage");
    vi.spyOn(h.journals, "checkpointPage").mockRejectedValue(new Error("Journal owner epoch changed"));
    expect(await captureJournalInventory(h.options)).toBe("changed"); expect(archives).not.toHaveBeenCalled();
  });

  it("walks the other database stream after a redacted page-read failure", async () => {
    const h = await fixture(); await h.put(envelope()); await h.archive("orphan opaque", "gone", "orphan");
    const checkpoints = vi.spyOn(h.journals, "checkpointPage").mockRejectedValue(new Error("PRIVATE checkpoint error"));
    expect(await captureJournalInventory(h.options)).toBe("unavailable");
    expect((await h.words.listSources(h.lease.ownerKey)).some(source => source.raw === "orphan opaque")).toBe(true);
    checkpoints.mockRestore();
    vi.spyOn(h.journals, "archivePage").mockRejectedValue(new Error("PRIVATE archive error"));
    expect(await captureJournalInventory(h.options)).toBe("unavailable");
    expect(typed(await h.words.listSources(h.lease.ownerKey))).toHaveLength(5);
  });

  it("rejects invalid or repeated continuation cursors without looping or suppressing the archive stream", async () => {
    const h = await fixture(); await h.archive("orphan opaque", "gone", "orphan");
    const cursor: JournalPageCursor<"checkpoints"> = { kind: "checkpoints", ownerKey: h.lease.ownerKey,
      epoch: 0, primaryKey: [h.lease.ownerKey, appId, "writer"] };
    const pages = vi.spyOn(h.journals, "checkpointPage").mockResolvedValue({ rows: [], rawChars: 0, nextCursor: cursor });
    expect(await captureJournalInventory(h.options)).toBe("unavailable"); expect(pages).toHaveBeenCalledTimes(2);
    expect((await h.words.listSources(h.lease.ownerKey)).some(source => source.raw === "orphan opaque")).toBe(true);
    pages.mockImplementation(async (key, epoch, options) => {
      if (options?.cursor) throw new Error("Invalid journal page cursor");
      return { rows: [], rawChars: 0, nextCursor: { ...cursor, ownerKey: "guest", epoch, primaryKey: [key, appId, "writer"] } };
    });
    expect(await captureJournalInventory(h.options)).toBe("unavailable");
  });

  it.each(["words", "journals"] as const)("requires the final durable %s epoch to equal the pinned epoch", async store => {
    const h = await fixture(); await h.put(envelope());
    const real = h[store].ownerEpoch.bind(h[store]); let reads = 0;
    vi.spyOn(h[store], "ownerEpoch").mockImplementation(async key => { const epoch = await real(key); return ++reads === 2 ? epoch + 1 : epoch; });
    expect(await captureJournalInventory(h.options)).toBe("changed");
  });

  it("returns changed when word deletion completes during the final journal epoch read", async () => {
    const h = await fixture(), raw = envelope(), outer = h.outer(raw);
    await h.put(raw); h.local.setItem(h.physical(), outer);
    const real = h.journals.ownerEpoch.bind(h.journals);
    let reads = 0, capturedBeforeDeletion = 0;
    vi.spyOn(h.journals, "ownerEpoch").mockImplementation(async key => {
      const epoch = await real(key);
      if (++reads === 2) {
        capturedBeforeDeletion = (await h.words.listSources(h.lease.ownerKey)).length;
        await h.words.deleteOwner(h.lease.ownerKey);
      }
      return epoch;
    });
    const result = await captureJournalInventory(h.options);
    expect(capturedBeforeDeletion).toBeGreaterThan(0);
    expect(h.authority.isCurrent(h.lease)).toBe(true);
    expect(h.journals.isOwnerDeleted(h.lease.ownerKey)).toBe(false);
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]);
    expect(h.local.getItem(h.physical())).toBe(outer);
    expect((await h.journals.get(h.lease.ownerKey, appId, "writer", 0))?.raw).toBe(raw);
    expect(result).toBe("changed");
  });

  it("returns changed when journal deletion is queued after the final word epoch read", async () => {
    const h = await fixture(), raw = envelope(), outer = h.outer(raw);
    await h.put(raw); h.local.setItem(h.physical(), outer);
    const wordEpoch = await h.words.ownerEpoch(h.lease.ownerKey);
    const realEpoch = h.words.ownerEpoch.bind(h.words), realCapture = h.words.capture.bind(h.words);
    let reads = 0, completedCaptures = 0, deletion: Promise<void> | undefined;
    vi.spyOn(h.words, "capture").mockImplementation(async (...args) => { await realCapture(...args); completedCaptures++; });
    vi.spyOn(h.words, "ownerEpoch").mockImplementation(async key => {
      const epoch = await realEpoch(key);
      if (++reads === 2) {
        queueMicrotask(() => queueMicrotask(() => { deletion = h.journals.deleteOwner(key); }));
      }
      return epoch;
    });
    const result = await captureJournalInventory(h.options);
    expect(deletion).toBeDefined();
    await deletion;
    expect(completedCaptures).toBeGreaterThan(0);
    expect(h.authority.isCurrent(h.lease)).toBe(true);
    expect(await h.words.ownerEpoch(h.lease.ownerKey)).toBe(wordEpoch);
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some(source => source.raw === raw)).toBe(true);
    expect(sources.some(source => source.raw === outer)).toBe(true);
    expect(h.journals.isOwnerDeleted(h.lease.ownerKey)).toBe(true);
    // The public journal reads are fenced after deletion; inspect the actual
    // isolated database to prove the completed delete removed checkpoints.
    const connection = (h.journals as unknown as { connection: IDBDatabase }).connection;
    const checkpointCount = await new Promise<number>((resolve, reject) => {
      const request = connection.transaction(["checkpoints"], "readonly").objectStore("checkpoints")
        .index("owner").count(h.lease.ownerKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(checkpointCount).toBe(0);
    expect(h.local.getItem(h.physical())).toBe(outer);
    expect(result).toBe("changed");
  });
});
