// @vitest-environment node
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import { ProgressJournalDatabase } from "@/shared/lib/progressJournalDatabase";
import { journalSourceId } from "@/shared/lib/progressJournalRecovery";
import { createOwnerBoundProgress, PROGRESS_NAMESPACE, PROGRESS_QUARANTINE } from "../../owner-bound-progress/core";
import { PROGRESS_OWNER_KEY } from "../../storage-keys";
import { WORD_EXTRACTION_VERSION, type WordField } from "../../progress-words";
import { LocalWordsDatabase, type SourceRecord } from "../database";
import { legacyWordSources } from "../inventory";
import { createWordOwnerPreparation, type PreparedWordOwner, type WordOwnerPreparationDependencies } from "../ownerPreparation";
import * as preservation from "../preservation";

class PhysicalStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(name: string) { return this.values.get(name) ?? null; }
  setItem(name: string, value: string) { this.values.set(name, value); }
  removeItem(name: string) { this.values.delete(name); }
  clear() { this.values.clear(); }
  snapshot() { return [...this.values.entries()]; }
}

const ownerId = "preparation-owner-A";
const version = `preservation:v1:legacy-parser:v1:extraction:${WORD_EXTRACTION_VERSION}`;
const fingerprint = (raw: string) => [...sha256(new TextEncoder().encode(JSON.stringify(raw)))]
  .map(byte => byte.toString(16).padStart(2, "0")).join("");
const persist = (state: Record<string, unknown>, persistVersion: number | null = 0) =>
  JSON.stringify({ state, ...(persistVersion === null ? {} : { version: persistVersion }) }, null, 2);
const oregon = { journeyId: "journey-1", leaderName: "Traveler", party: [{ id: "friend-1", name: "Friend", health: 91 }], coins: 7 };
const oregonFields: WordField[] = [
  { path: "leaderName", value: "Traveler", identity: { journeyId: "journey-1" } },
  { path: "party[0].name", value: "Friend", identity: { journeyId: "journey-1", index: 0, id: "friend-1" } },
];
const artwork = { id: "art-1", name: "My art", dataUrl: "data:image/png;base64,original-art", thumbnail: "original-thumbnail" };

// Real persisted envelopes and explicit expected views, not assertions built
// with the production stripper or extractor.
const legacyCases = [
  { appId: "oregon-trail", state: oregon,
    expected: { ...oregon, leaderName: "", party: [{ id: "friend-1", name: "", health: 91 }] } },
  { appId: "weather", state: { savedLocations: [{ name: "Town", latitude: 3 }], lastLocation: { name: "Place", longitude: 4 }, lastModified: 8, units: "celsius" },
    expected: { savedLocations: [], lastLocation: null, lastModified: 8, units: "celsius" } },
  { appId: "toy-finder", state: { wishlistItems: [{ toyId: "truck", notes: "My note", priority: "high" }], coins: 2 },
    expected: { wishlistItems: [{ toyId: "truck", priority: "high" }], coins: 2 } },
  { appId: "drawing-app", state: { savedArtworks: [artwork], brushSize: 4, lastModified: 9 },
    expected: { brushSize: 4, lastModified: 9 } },
  { appId: "drum-machine", state: { progress: { savedBeats: [{ id: "beat", name: "Jam", bpm: 90 }], lastModified: 3 }, playing: false },
    expected: { savedBeats: [{ id: "beat", name: "", bpm: 90 }], lastModified: 3 } },
  { appId: "virtual-pet", state: { progress: { pet: { name: "Fluffy", speciesId: "cat", bornAt: "2026-01-01", health: 90 }, settings: { petName: "Fluffy", sound: true } }, loading: false },
    expected: { pet: { name: "", speciesId: "cat", bornAt: "2026-01-01", health: 90 }, settings: { petName: "", sound: true } } },
  { appId: "four-wheeler-3d", state: { progress: { adventure: { outfit: { text: "Racer", color: "blue" }, feeders: [{ id: "feeder", label: "Back yard", food: 30 }] }, distance: 20 }, speed: 0 },
    expected: { adventure: { outfit: { text: "", color: "blue" }, feeders: [{ id: "feeder", label: "", food: 30 }] }, distance: 20 } },
];

const close: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); close.splice(0).forEach(done => done()); });
async function fixture() {
  const local = new PhysicalStorage(), factory = new IDBFactory(), storage = () => local;
  const authority = createOwnerBoundProgress({ storage, sessionStorage: () => new PhysicalStorage() });
  await authority.updateSession("authenticated", ownerId);
  const lease = authority.captureLease()!;
  local.setItem(PROGRESS_OWNER_KEY, ownerId);
  const words = new LocalWordsDatabase(factory, "preparation-words");
  const journals = new ProgressJournalDatabase(factory, "preparation-journals");
  close.push(() => { words.close(); journals.close(); });
  const dependencies: WordOwnerPreparationDependencies = { authority, storage, words, journals };
  const preparation = createWordOwnerPreparation(dependencies);
  return { local, factory, authority, lease, words, journals, dependencies, preparation };
}
type Harness = Awaited<ReturnType<typeof fixture>>;
async function prepared(h: Harness): Promise<PreparedWordOwner> {
  const result = await h.preparation.prepare(ownerId, h.lease);
  expect(["captured", "empty"]).toContain(result.status);
  if (!("context" in result)) throw new Error("Expected an explicit prepared context");
  return result.context;
}
async function legacySource(h: Harness, appId = "oregon-trail") {
  const source = (await h.words.listSources(h.lease.ownerKey)).find(row => row.appId === appId && row.sourceVersion === version);
  if (!source) throw new Error("Expected a real captured legacy fields source");
  return source;
}
function source(h: Harness, patch: Partial<SourceRecord> = {}): SourceRecord {
  const row = { ownerKey: h.lease.ownerKey, appId: "oregon-trail", sourceKey: JSON.stringify(["word-preservation", "legacy", "oregon-trail-storage", "oregon-trail-storage", "fields"]),
    sourceVersion: version, raw: persist(oregon, 1), fields: oregonFields, ...patch };
  const digest = patch.digest ?? fingerprint(row.raw ?? "");
  return { ...row, digest, id: JSON.stringify([row.ownerKey, row.appId, row.sourceKey, row.sourceVersion, digest]) };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function orphanJournal() {
  return JSON.stringify({ version: 1, appId: "drawing-app", ownerId, writerId: "orphan", serial: 7,
    acknowledged: { data: { savedArtworks: [artwork] }, revision: "a".repeat(64) },
    sent: { id: "immutable-request", base: { data: { savedArtworks: [artwork] }, revision: "b".repeat(64) }, data: { savedArtworks: [artwork] } },
    live: { savedArtworks: [artwork] }, forceWrite: false, conflict: null }, null, 2);
}

describe("unused word owner preparation", () => {
  it("imports and constructs without browser storage or dependency calls", async () => {
    const access = vi.fn(() => { throw new Error("PRIVATE dependency must stay lazy"); });
    const dependencies: WordOwnerPreparationDependencies = {
      authority: { isCurrent: access, matchesSession: access }, storage: access,
      words: { ownerEpoch: access, capture: access, readCapturedSource: access },
      journals: { ownerEpoch: access, isOwnerDeleted: access, checkpointPage: access, archivePage: access },
    };
    vi.stubGlobal("window", undefined); vi.stubGlobal("indexedDB", undefined);
    vi.resetModules();
    const preparationModule = await import("../ownerPreparation");
    const preparation = preparationModule.createWordOwnerPreparation(dependencies);
    expect(typeof preparation.prepare).toBe("function");
    expect(access).not.toHaveBeenCalled();
  });

  it("durably captures original Drawing and a real orphan journal before exposing a view", async () => {
    const h = await fixture(), raw = persist({ savedArtworks: [artwork], brushSize: 4 });
    h.local.setItem("drawing-app-progress", raw);
    const journal = orphanJournal();
    await h.journals.archive({ ownerKey: h.lease.ownerKey, appId: "drawing-app", sourceId: journalSourceId(h.lease.ownerKey, "drawing-app", "orphan", journal), raw: journal }, 0);
    const before = h.local.snapshot(), entered = deferred(), release = deferred();
    const real = h.words.capture.bind(h.words); let first = true;
    vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      if (first) { first = false; entered.resolve(); await release.promise; }
      await real(...args);
    });
    let returned = false;
    const pending = h.preparation.prepare(ownerId, h.lease).then(result => { returned = true; return result; });
    await entered.promise;
    expect(returned).toBe(false);
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]);
    release.resolve();
    const result = await pending;
    expect(result.status).toBe("captured");
    if (!("context" in result)) throw new Error("No context after durable capture");
    const captured = await h.words.listSources(h.lease.ownerKey);
    expect(captured.some(row => row.raw === raw && row.appId === "preservation-inventory")).toBe(true);
    expect(captured.some(row => row.raw === journal)).toBe(true);
    const drawing = await legacySource(h, "drawing-app");
    expect(await result.context.projectLegacySource(drawing.id)).toEqual({ status: "projected", sourceId: drawing.id, appId: "drawing-app", progress: { brushSize: 4 } });
    expect(h.local.snapshot()).toEqual(before);
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual(captured);
    expect(await h.words.listCommittedSources(h.lease.ownerKey)).toEqual([]);
    expect(await h.words.readWords(h.lease.ownerKey, "drawing-app")).toEqual([]);
  });

  it("does not expose a context if the real capture transaction aborts after request success", async () => {
    const h = await fixture(), raw = persist({ savedArtworks: [artwork] });
    h.local.setItem("drawing-app-progress", raw);
    const real = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["add"]>) {
      const request = real.apply(this, args);
      if (this.name === "sources") request.addEventListener("success", () => this.transaction.abort());
      return request;
    });
    expect(await h.preparation.prepare(ownerId, h.lease)).toEqual({ status: "unavailable" });
    expect(h.local.getItem("drawing-app-progress")).toBe(raw);
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]);
  });

  it.each(legacyCases)("projects the exact captured $appId envelope without changing raw or gameplay", async row => {
    const h = await fixture(), raw = persist(row.state, row.appId === "oregon-trail" ? 1 : 0);
    h.local.setItem(legacyWordSources[row.appId], raw);
    const before = h.local.snapshot(), context = await prepared(h), captured = await legacySource(h, row.appId);
    const sources = await h.words.listSources(h.lease.ownerKey), writes = vi.spyOn(h.words, "writeWords"), commits = vi.spyOn(h.words, "commitSource");
    expect(await context.projectLegacySource(captured.id)).toEqual({ status: "projected", sourceId: captured.id, appId: row.appId, progress: row.expected });
    expect(captured.raw).toBe(raw); expect(h.local.snapshot()).toEqual(before);
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual(sources);
    expect(await h.words.listCommittedSources(h.lease.ownerKey)).toEqual([]);
    expect(writes).not.toHaveBeenCalled(); expect(commits).not.toHaveBeenCalled();
  });

  it.each(legacyCases)("accepts the released absent-version $appId envelope", async row => {
    const h = await fixture(); h.local.setItem(legacyWordSources[row.appId], persist(row.state, null));
    const context = await prepared(h), captured = await legacySource(h, row.appId);
    expect(await context.projectLegacySource(captured.id)).toMatchObject({ status: "projected", progress: row.expected });
  });

  it("keeps Oregon setup identities absent and returns defensive derived values", async () => {
    const h = await fixture(), raw = persist({ gamePhase: "setup", leaderName: "Draft", party: [{ name: "Friend", health: 83 }], occupation: "banker" }, 1);
    h.local.setItem("oregon-trail-storage", raw);
    const context = await prepared(h), captured = await legacySource(h);
    expect(captured.fields.every(field => !("journeyId" in field.identity))).toBe(true);
    const projected = await context.projectLegacySource(captured.id);
    expect(projected).toMatchObject({ status: "projected", progress: { gamePhase: "setup", leaderName: "", party: [{ name: "", health: 83 }], occupation: "banker" } });
    if (projected.status !== "projected") throw new Error("No derived view");
    const progress = projected.progress as { leaderName: string; party: Array<{ name: string; health: number }> };
    progress.leaderName = "Changed by caller"; progress.party[0].health = 0;
    expect(await context.projectLegacySource(captured.id)).toMatchObject({ status: "projected", progress: { leaderName: "", party: [{ name: "", health: 83 }] } });
    expect((await h.words.readCapturedSource(h.lease.ownerKey, captured.id, 0))?.raw).toBe(raw);
    expect(h.local.getItem("oregon-trail-storage")).toBe(raw);
  });

  it.each(["scoped", "quarantine"])("recognizes a real released %s legacy fields address", async backend => {
    const h = await fixture(), logical = "oregon-trail-storage", raw = persist(oregon, 1);
    const wrapper = JSON.stringify({ version: 2, ownerKey: h.lease.ownerKey, logicalKey: logical, raw });
    const outerDigest = [...sha256(new TextEncoder().encode(wrapper))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const address = backend === "scoped" ? PROGRESS_NAMESPACE + JSON.stringify([h.lease.ownerKey, logical])
      : PROGRESS_QUARANTINE + JSON.stringify([h.lease.ownerKey, logical, outerDigest]);
    h.local.setItem(address, wrapper);
    const context = await prepared(h), captured = await legacySource(h);
    expect(await context.projectLegacySource(captured.id)).toMatchObject({ status: "projected", progress: legacyCases[0].expected });
    expect(h.local.getItem(address)).toBe(wrapper);
  });

  it("reads the selected source and its receipt, never a newer live save", async () => {
    const h = await fixture(); h.local.setItem("oregon-trail-storage", persist(oregon, 1));
    const context = await prepared(h), original = await legacySource(h);
    const mapped = [{ ownerKey: h.lease.ownerKey, appId: "oregon-trail", entityKey: "journey-1", field: "leaderName", value: "Traveler" }];
    await h.words.commitSource(original.id, mapped, 0);
    const receipts = await h.words.listCommittedSources(h.lease.ownerKey);
    h.local.setItem("oregon-trail-storage", persist({ ...oregon, coins: 99, leaderName: "New leader" }, 1));
    expect(await context.projectLegacySource(original.id)).toMatchObject({ status: "projected", progress: legacyCases[0].expected });
    expect(await h.words.listCommittedSources(h.lease.ownerKey)).toEqual(receipts);
    expect(await h.words.readWords(h.lease.ownerKey, "oregon-trail")).toEqual(mapped);
    const next = await prepared(h), newer = (await h.words.listSources(h.lease.ownerKey)).find(row => row.sourceVersion === version)!;
    expect(newer.id).not.toBe(original.id);
    expect(await next.projectLegacySource(newer.id)).toMatchObject({ status: "projected", progress: { coins: 99, leaderName: "" } });
    expect(await context.projectLegacySource(original.id)).toMatchObject({ status: "projected", progress: { coins: 7 } });
  });

  it("retains opaque, journal, future and cloud fields-only sources without projecting them", async () => {
    const h = await fixture();
    h.local.setItem("oregon-trail-storage", "unreadable-original");
    h.local.setItem("drawing-app-progress", persist({ savedArtworks: [artwork] }, 99));
    const journal = orphanJournal();
    await h.journals.archive({ ownerKey: h.lease.ownerKey, appId: "drawing-app", sourceId: journalSourceId(h.lease.ownerKey, "drawing-app", "orphan", journal), raw: journal }, 0);
    const context = await prepared(h);
    const cloud = source(h, { raw: undefined, sourceVersion: "cloud-fields:v1" });
    await h.words.capture(cloud, 0);
    const before = await h.words.listSources(h.lease.ownerKey);
    expect(before.some(row => row.raw === journal && row.fields.length > 0)).toBe(true);
    for (const row of before) expect(await context.projectLegacySource(row.id)).toEqual({ status: "unprojectable" });
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual(before);
    expect(h.local.getItem("oregon-trail-storage")).toBe("unreadable-original");
    expect(await h.words.listCommittedSources(h.lease.ownerKey)).toEqual([]);
  });

  it.each([
    { label: "future persist version", patch: { raw: persist(oregon, 2) } },
    { label: "future extractor version", patch: { sourceVersion: "preservation:v1:legacy-parser:v1:extraction:99" } },
    { label: "different extraction fields", patch: { fields: [{ path: "leaderName", value: "Wrong", identity: {} }] } },
    { label: "unknown legacy address", patch: { sourceKey: JSON.stringify(["different-source", "legacy", "oregon-trail-storage", "oregon-trail-storage", "fields"]) } },
  ])("keeps a selected $label source unprojectable", async ({ patch }) => {
    const h = await fixture(), context = await prepared(h), record = source(h, patch);
    await h.words.capture(record, 0);
    expect(await context.projectLegacySource(record.id)).toEqual({ status: "unprojectable" });
    expect(await h.words.readCapturedSource(h.lease.ownerKey, record.id, 0)).toEqual(record);
  });

  it("redacts a known captured-content contradiction without changing its record", async () => {
    const h = await fixture(), context = await prepared(h), record = source(h, { digest: "0".repeat(64) });
    await h.words.capture(record, 0);
    expect(await context.projectLegacySource(record.id)).toEqual({ status: "unavailable" });
    expect(await h.words.readCapturedSource(h.lease.ownerKey, record.id, 0)).toEqual(record);
  });

  it("retains distinct lone-surrogate raw IDs without regenerating them", async () => {
    const h = await fixture(); h.local.setItem("oregon-trail-storage", "\ud800");
    const first = await prepared(h); h.local.setItem("oregon-trail-storage", "\ud801");
    await prepared(h);
    const rows = await h.words.listSources(h.lease.ownerKey);
    expect(rows).toHaveLength(2); expect(new Set(rows.map(row => row.id)).size).toBe(2);
    for (const row of rows) expect(await first.projectLegacySource(row.id)).toEqual({ status: "unprojectable" });
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual(rows);
  });

  it("denies missing and foreign IDs while preserving another owner's data", async () => {
    const h = await fixture(), ownerB = await ownerKeyFor("preparation-owner-B"), foreign = source(h, { ownerKey: ownerB });
    await h.words.capture(foreign, 0);
    const word = { ownerKey: ownerB, appId: "oregon-trail", entityKey: "B", field: "name", value: "B private words" };
    await h.words.writeWords([word], 0);
    const context = await prepared(h);
    expect(await context.projectLegacySource(foreign.id)).toEqual({ status: "missing" });
    expect(await context.projectLegacySource("not-a-stored-source")).toEqual({ status: "missing" });
    expect(await h.words.listSources(ownerB)).toEqual([foreign]);
    expect(await h.words.readWords(ownerB, "oregon-trail")).toEqual([word]);
  });

  it("copies caller lease and dependency references before a pending preparation", async () => {
    const h = await fixture(), other = await fixture();
    h.local.setItem("oregon-trail-storage", persist(oregon, 1));
    const dependencies = { ...h.dependencies }, preparation = createWordOwnerPreparation(dependencies);
    const lease = { ...h.lease }, entered = deferred(), release = deferred(), real = h.words.ownerEpoch.bind(h.words);
    vi.spyOn(h.words, "ownerEpoch").mockImplementationOnce(async key => { entered.resolve(); await release.promise; return real(key); });
    const pending = preparation.prepare(ownerId, lease);
    await entered.promise;
    lease.ownerKey = "guest"; lease.generation += 1;
    dependencies.words = other.words; dependencies.storage = () => other.local;
    release.resolve();
    const result = await pending;
    expect(result.status).toBe("captured");
    if (!("context" in result)) throw new Error("No copied context");
    const captured = await legacySource(h);
    expect(await result.context.projectLegacySource(captured.id)).toMatchObject({ status: "projected", progress: { coins: 7 } });
    expect(await other.words.listSources(other.lease.ownerKey)).toEqual([]);
  });

  it.each(["", "preparation-owner-B"])("rejects mismatched identity %s before source reads", async suppliedOwner => {
    const h = await fixture(), read = vi.spyOn(h.local, "getItem"), capture = vi.spyOn(h.words, "capture");
    expect(await h.preparation.prepare(suppliedOwner, h.lease)).toEqual({ status: "changed" });
    expect(read).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled();
  });

  it("rejects guest and authenticated-without-ID authority without adopting an account", async () => {
    const h = await fixture(), guest = createOwnerBoundProgress({ storage: () => new PhysicalStorage() });
    await guest.updateSession("unauthenticated");
    const preparation = createWordOwnerPreparation({ ...h.dependencies, authority: guest });
    expect(await preparation.prepare(ownerId, guest.captureLease()!)).toEqual({ status: "changed" });
    const unresolved = createOwnerBoundProgress({ storage: () => new PhysicalStorage() });
    await unresolved.updateSession("authenticated");
    expect(await createWordOwnerPreparation({ ...h.dependencies, authority: unresolved }).prepare(ownerId, h.lease)).toEqual({ status: "changed" });
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]);
  });

  it.each(["loading", "another account"])("does not expose captured bytes after authority becomes %s", async next => {
    const h = await fixture(), raw = persist(oregon, 1); h.local.setItem("oregon-trail-storage", raw);
    const entered = deferred(), release = deferred(), real = h.words.capture.bind(h.words); let once = true;
    vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      await real(...args);
      if (once) { once = false; entered.resolve(); await release.promise; }
    });
    const pending = h.preparation.prepare(ownerId, h.lease);
    await entered.promise;
    await h.authority.updateSession(next === "loading" ? "loading" : "authenticated", next === "loading" ? undefined : "preparation-owner-B");
    release.resolve();
    expect(await pending).toEqual({ status: "changed" });
    expect((await h.words.listSources(h.lease.ownerKey)).some(row => row.raw === raw)).toBe(true);
    expect(h.local.getItem("oregon-trail-storage")).toBe(raw);
  });

  it.each(["words", "journals"])("rejects a real %s deletion during its initial epoch pin", async target => {
    const h = await fixture();
    if (target === "words") {
      const real = h.words.ownerEpoch.bind(h.words);
      vi.spyOn(h.words, "ownerEpoch").mockImplementationOnce(async key => { const epoch = await real(key); await h.words.deleteOwner(key); return epoch; });
    } else {
      const real = h.journals.ownerEpoch.bind(h.journals);
      vi.spyOn(h.journals, "ownerEpoch").mockImplementationOnce(async key => { const epoch = await real(key); await h.journals.deleteOwner(key); return epoch; });
    }
    expect(await h.preparation.prepare(ownerId, h.lease)).toEqual({ status: "changed" });
  });

  it.each(["words", "journals"])("rejects %s deletion after delegated capture before returning a context", async target => {
    const h = await fixture(); h.local.setItem("oregon-trail-storage", persist(oregon, 1));
    const real = preservation.captureWordPreservation;
    vi.spyOn(preservation, "captureWordPreservation").mockImplementationOnce(async options => {
      const result = await real(options);
      if (target === "words") await h.words.deleteOwner(h.lease.ownerKey);
      else await h.journals.deleteOwner(h.lease.ownerKey);
      return result;
    });
    expect(await h.preparation.prepare(ownerId, h.lease)).toEqual({ status: "changed" });
  });

  it("catches the synchronous journal deletion fence during the last preparation word read", async () => {
    const h = await fixture(), capture = preservation.captureWordPreservation, read = h.words.ownerEpoch.bind(h.words);
    vi.spyOn(preservation, "captureWordPreservation").mockImplementationOnce(async options => {
      const result = await capture(options);
      vi.spyOn(h.words, "ownerEpoch").mockImplementationOnce(async key => { const epoch = await read(key); await h.journals.deleteOwner(key); return epoch; });
      return result;
    });
    expect(await h.preparation.prepare(ownerId, h.lease)).toEqual({ status: "changed" });
  });

  it.each(["words", "journals", "authority"])("permanently invalidates a context when %s changes during exact lookup", async target => {
    const h = await fixture(); h.local.setItem("oregon-trail-storage", persist(oregon, 1));
    const context = await prepared(h), captured = await legacySource(h), real = h.words.readCapturedSource.bind(h.words);
    const entered = deferred(), release = deferred();
    const lookup = vi.spyOn(h.words, "readCapturedSource").mockImplementationOnce(async (...args) => { const row = await real(...args); entered.resolve(); await release.promise; return row; });
    const pending = context.projectLegacySource(captured.id);
    await entered.promise;
    if (target === "words") await h.words.deleteOwner(h.lease.ownerKey);
    else if (target === "journals") await h.journals.deleteOwner(h.lease.ownerKey);
    else await h.authority.updateSession("loading");
    release.resolve();
    expect(await pending).toEqual({ status: "changed" });
    lookup.mockClear();
    expect(await context.projectLegacySource(captured.id)).toEqual({ status: "changed" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("checks word deletion after the final journal read and journal deletion after the final word read", async () => {
    for (const target of ["words", "journals"] as const) {
      const h = await fixture(); h.local.setItem("oregon-trail-storage", persist(oregon, 1));
      const context = await prepared(h), captured = await legacySource(h);
      if (target === "words") {
        const real = h.journals.ownerEpoch.bind(h.journals);
        vi.spyOn(h.journals, "ownerEpoch").mockImplementationOnce(async key => { const epoch = await real(key); await h.words.deleteOwner(key); return epoch; });
      } else {
        const real = h.words.ownerEpoch.bind(h.words);
        vi.spyOn(h.words, "ownerEpoch").mockImplementationOnce(async key => { const epoch = await real(key); await h.journals.deleteOwner(key); return epoch; });
      }
      expect(await context.projectLegacySource(captured.id)).toEqual({ status: "changed" });
    }
  });

  it("returns unavailable on denied storage, retains originals and redacts synchronous dependency errors", async () => {
    const h = await fixture(), raw = persist({ savedArtworks: [artwork] }); h.local.setItem("drawing-app-progress", raw);
    const failure = () => { throw new DOMException("PRIVATE owner, marker and artwork", "SecurityError"); };
    expect(await createWordOwnerPreparation({ ...h.dependencies, storage: failure }).prepare(ownerId, h.lease)).toEqual({ status: "unavailable" });
    const authority = { ...h.authority, matchesSession: failure };
    expect(await createWordOwnerPreparation({ ...h.dependencies, authority }).prepare(ownerId, h.lease)).toEqual({ status: "unavailable" });
    expect(h.local.getItem("drawing-app-progress")).toBe(raw);
  });

  it("keeps completed captures but exposes no context when later capture storage fails", async () => {
    const h = await fixture(), raw = persist(oregon, 1); h.local.setItem("oregon-trail-storage", raw);
    const real = h.words.capture.bind(h.words); let calls = 0;
    vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      if (++calls === 2) throw new DOMException("PRIVATE quota and source", "QuotaExceededError");
      await real(...args);
    });
    expect(await h.preparation.prepare(ownerId, h.lease)).toEqual({ status: "unavailable" });
    expect((await h.words.listSources(h.lease.ownerKey)).some(row => row.raw === raw)).toBe(true);
    expect(h.local.getItem("oregon-trail-storage")).toBe(raw);
  });

  it("redacts temporary lookup failure and retries with the same pins without recapturing", async () => {
    const h = await fixture(); h.local.setItem("oregon-trail-storage", persist(oregon, 1));
    const context = await prepared(h), captured = await legacySource(h), capture = vi.spyOn(h.words, "capture");
    vi.spyOn(h.words, "readCapturedSource").mockRejectedValueOnce(new Error("PRIVATE raw owner and exception text"));
    expect(await context.projectLegacySource(captured.id)).toEqual({ status: "unavailable" });
    expect(await context.projectLegacySource(captured.id)).toMatchObject({ status: "projected", progress: { coins: 7 } });
    expect(capture).not.toHaveBeenCalled();
  });

  it("lets a known word deletion win over an unavailable lookup", async () => {
    const h = await fixture(); h.local.setItem("oregon-trail-storage", persist(oregon, 1));
    const context = await prepared(h), captured = await legacySource(h);
    vi.spyOn(h.words, "readCapturedSource").mockImplementationOnce(async () => { await h.words.deleteOwner(h.lease.ownerKey); throw new Error("PRIVATE lookup unavailable"); });
    expect(await context.projectLegacySource(captured.id)).toEqual({ status: "changed" });
  });

  it("lets a final durable deletion win over collector unavailability", async () => {
    const h = await fixture(), real = preservation.captureWordPreservation;
    const preparation = createWordOwnerPreparation({ ...h.dependencies, storage: () => undefined });
    vi.spyOn(preservation, "captureWordPreservation").mockImplementationOnce(async options => { const result = await real(options); await h.words.deleteOwner(h.lease.ownerKey); return result; });
    expect(await preparation.prepare(ownerId, h.lease)).toEqual({ status: "changed" });
  });
});
