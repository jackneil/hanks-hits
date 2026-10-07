// @vitest-environment node
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import { ProgressJournalDatabase } from "@/shared/lib/progressJournalDatabase";
import { createOwnerBoundProgress } from "../../owner-bound-progress/core";
import { PROGRESS_OWNER_KEY } from "../../storage-keys";
import { WORD_EXTRACTION_VERSION } from "../../progress-words";
import { LocalWordsDatabase, type SourceRecord } from "../database";
import { legacyWordSources } from "../inventory";
import { createWordOwnerPreparation } from "../ownerPreparation";
import { createSelectedSourceAdmission, type SelectedSourceAdmissionDependencies,
  type SelectedSourceAdmissionOutcome, type SelectedSourceAdmissionScope, type SelectedSourceObservation } from "../selectedSourceAdmission";

class PhysicalStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  snapshot() { return [...this.values.entries()]; }
}

const ownerId = "admission-owner-A";
const version = `preservation:v1:legacy-parser:v1:extraction:${WORD_EXTRACTION_VERSION}`;
const fingerprint = (raw: string) => [...sha256(new TextEncoder().encode(JSON.stringify(raw)))]
  .map(byte => byte.toString(16).padStart(2, "0")).join("");
const persisted = (state: object, persistVersion = 0) => JSON.stringify({ state, version: persistVersion }, null, 2);
const toy = { wishlistItems: [{ toyId: "truck", notes: "My note", priority: "high" }], coins: 7, lastModified: 8, progressTimeV: 1 };
const toyExpected = { wishlistItems: [{ toyId: "truck", priority: "high" }], coins: 7, lastModified: 8, progressTimeV: 1 };
const artwork = { id: "art-1", name: "My picture", dataUrl: "data:image/png;base64,personal", thumbnail: "personal-thumbnail" };
const oregon = { journeyId: "journey-1", leaderName: "Traveler", party: [{ id: "friend-1", name: "Friend", health: 91 }],
  // Released Oregon FNV-1a checksum of its selected progress, excluding time.
  milesTraveled: 7, lastModified: 8, progressTimeV: 1, progressTimeSum: "d89f5058" };

// Explicit persist payloads and independent expected views. Nested apps compare
// the inner progress only; flat apps retain persist-only metadata in that domain.
interface PersistExample {
  appId: string;
  state: Record<string, unknown>;
  progress: Record<string, unknown>;
  expected: Record<string, unknown>;
  persistVersion?: number;
}
const cases: PersistExample[] = [
  { appId: "toy-finder", state: toy, progress: toy, expected: toyExpected },
  { appId: "oregon-trail", state: oregon, progress: oregon, persistVersion: 1,
    expected: { ...oregon, leaderName: "", party: [{ id: "friend-1", name: "", health: 91 }] } },
  { appId: "weather", state: { savedLocations: [{ name: "Town", latitude: 3 }], lastLocation: { name: "Place", longitude: 4 }, units: "celsius", progressTimeV: 1 },
    progress: { savedLocations: [{ name: "Town", latitude: 3 }], lastLocation: { name: "Place", longitude: 4 }, units: "celsius", progressTimeV: 1 },
    expected: { savedLocations: [], lastLocation: null, units: "celsius", progressTimeV: 1 } },
  { appId: "drawing-app", state: { savedArtworks: [artwork], brushSize: 4, progressTimeV: 1 },
    progress: { savedArtworks: [artwork], brushSize: 4, progressTimeV: 1 }, expected: { brushSize: 4, progressTimeV: 1 } },
  { appId: "drum-machine", state: { progress: { savedBeats: [{ id: "beat", name: "Jam", bpm: 90 }], lastModified: 3 }, playing: false, progressTimeV: 1 },
    progress: { savedBeats: [{ id: "beat", name: "Jam", bpm: 90 }], lastModified: 3 },
    expected: { savedBeats: [{ id: "beat", name: "", bpm: 90 }], lastModified: 3 } },
  { appId: "virtual-pet", state: { progress: { pet: { name: "Fluffy", speciesId: "cat", bornAt: "2026-01-01", health: 90 }, settings: { petName: "Fluffy", sound: true } }, loading: false },
    progress: { pet: { name: "Fluffy", speciesId: "cat", bornAt: "2026-01-01", health: 90 }, settings: { petName: "Fluffy", sound: true } },
    expected: { pet: { name: "", speciesId: "cat", bornAt: "2026-01-01", health: 90 }, settings: { petName: "", sound: true } } },
  { appId: "four-wheeler-3d", state: { progress: { adventure: { outfit: { text: "Racer", color: "blue" }, feeders: [{ id: "feeder", label: "Back yard", food: 30 }] }, distance: 20 }, speed: 0 },
    progress: { adventure: { outfit: { text: "Racer", color: "blue" }, feeders: [{ id: "feeder", label: "Back yard", food: 30 }] }, distance: 20 },
    expected: { adventure: { outfit: { text: "", color: "blue" }, feeders: [{ id: "feeder", label: "", food: 30 }] }, distance: 20 } },
];

const cleanup: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); cleanup.splice(0).forEach(close => close()); });
async function fixture(example: PersistExample = cases[0]) {
  const local = new PhysicalStorage(), factory = new IDBFactory(), storage = () => local;
  const logical = legacyWordSources[example.appId], raw = persisted(example.state, example.persistVersion ?? 0);
  local.setItem(logical, raw); local.setItem(PROGRESS_OWNER_KEY, ownerId);
  const authority = createOwnerBoundProgress({ storage, sessionStorage: () => new PhysicalStorage() });
  const persist = { rehydrate: () => {}, hasHydrated: () => true, onFinishHydration: () => () => {} };
  const unbind = authority.bindPersistedStore(logical, persist);
  cleanup.push(unbind);
  await authority.updateSession("authenticated", ownerId);
  await authority.whenHydrated(logical);
  const lease = authority.captureLease()!;
  const words = new LocalWordsDatabase(factory, "admission-words"), journals = new ProgressJournalDatabase(factory, "admission-journals");
  cleanup.push(() => { words.close(); journals.close(); });
  const preparation = createWordOwnerPreparation({ authority, storage, words, journals });
  const prepared = await preparation.prepare(ownerId, lease);
  if (!("context" in prepared)) throw new Error("Expected a real captured preparation context.");
  const context = prepared.context;
  const source = (await words.listSources(lease.ownerKey)).find(row => row.appId === example.appId && row.sourceVersion === version);
  if (!source) throw new Error("Expected a real released legacy fields capture.");
  const observation: SelectedSourceObservation = { persistedState: structuredClone(example.progress),
    storeInstance: {}, clockInstance: {}, acceptedRevision: 0, hasUnsettledAcceptedWrites: false };
  const readObservation = vi.fn(() => observation);
  const dependencies: SelectedSourceAdmissionDependencies = { authority, words, readObservation };
  const scope: SelectedSourceAdmissionScope = { ownerId, lease, appId: example.appId, prepared: context };
  const make = (dependencyPatch: Partial<SelectedSourceAdmissionDependencies> = {}, scopePatch: Partial<SelectedSourceAdmissionScope> = {}) =>
    createSelectedSourceAdmission({ ...dependencies, ...dependencyPatch }, { ...scope, ...scopePatch });
  return { local, factory, authority, lease, logical, words, journals, context, source, raw, observation,
    readObservation, dependencies, scope, make, unbind, persist };
}
type Harness = Awaited<ReturnType<typeof fixture>>;
function admitted(result: SelectedSourceAdmissionOutcome) {
  expect(result.status).toBe("admitted");
  if (result.status !== "admitted") throw new Error("Expected conditional admitted evidence.");
  return result;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function pause(h: Harness, stage: "read" | "projection") {
  const entered = deferred(), release = deferred();
  if (stage === "read") {
    const real = h.words.readCapturedSource.bind(h.words);
    vi.spyOn(h.words, "readCapturedSource").mockImplementationOnce(async (...args) => {
      const result = await real(...args); entered.resolve(); await release.promise; return result;
    });
  } else {
    const real = h.context.projectLegacySource.bind(h.context);
    vi.spyOn(h.context, "projectLegacySource").mockImplementationOnce(async id => {
      const result = await real(id); entered.resolve(); await release.promise; return result;
    });
  }
  const pending = h.make().admit(h.source.id);
  await entered.promise;
  return { pending, release };
}
function rowWithRaw(h: Harness, raw: string, patch: Partial<SourceRecord> = {}): SourceRecord {
  const row = { ...h.source, raw, digest: fingerprint(raw), ...patch };
  return { ...row, id: JSON.stringify([row.ownerKey, row.appId, row.sourceKey, row.sourceVersion, row.digest]) };
}

function ownKeyExample(nested: boolean, present: boolean): PersistExample {
  const state: Record<string, unknown> = structuredClone(toy);
  const target: Record<string, unknown> = nested ? state.extra = {} : state;
  if (present) Object.defineProperty(target, "__proto__", { value: {}, enumerable: true, configurable: true, writable: true });
  return { ...cases[0], state, progress: state };
}
const ownKeyCases = [
  { label: "top-level removal", nested: false, present: true },
  { label: "top-level insertion", nested: false, present: false },
  { label: "nested removal", nested: true, present: true },
  { label: "nested insertion", nested: true, present: false },
];

describe("unused selected-source admission", () => {
  it("imports and constructs without storage, auth or observation I/O", async () => {
    const access = vi.fn(() => { throw new Error("PRIVATE dependency."); });
    const dependencies: SelectedSourceAdmissionDependencies = {
      authority: { isCurrent: access, matchesSession: access, isHydrated: access }, words: { readCapturedSource: access }, readObservation: access,
    };
    vi.stubGlobal("window", undefined); vi.stubGlobal("indexedDB", undefined); vi.resetModules();
    const admissionModule = await import("../selectedSourceAdmission");
    const admission = admissionModule.createSelectedSourceAdmission(dependencies, { ownerId, appId: "toy-finder",
      lease: { ownerKey: "u_aaaaaaaaaaaaaaaaaaaa", generation: 1 }, prepared: { projectLegacySource: access } });
    expect(typeof admission.admit).toBe("function");
    expect(access).not.toHaveBeenCalled();
  });

  it.each(cases)("admits the full released $appId persist domain and retains original evidence", async example => {
    const h = await fixture(example), before = h.local.snapshot(), sources = await h.words.listSources(h.lease.ownerKey);
    const writes = vi.spyOn(h.words, "writeWords"), capture = vi.spyOn(h.words, "capture"), commit = vi.spyOn(h.words, "commitSource");
    const result = admitted(await h.make().admit(h.source.id));
    expect(result).toMatchObject({ ownerKey: h.lease.ownerKey, appId: example.appId, sourceId: h.source.id, progress: example.expected });
    expect(result.isObservationCurrent()).toBe(true);
    expect(h.local.snapshot()).toEqual(before);
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual(sources);
    expect(await h.words.readWords(h.lease.ownerKey, example.appId)).toEqual([]);
    expect(writes).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });

  it.each(["progressTimeV", "progressTimeSum"])("does not discard differing or missing %s metadata to force equality", async key => {
    const h = await fixture(cases[1]), state = h.observation.persistedState as Record<string, unknown>;
    state[key] = "different";
    const project = vi.spyOn(h.context, "projectLegacySource");
    expect(await h.make().admit(h.source.id)).toEqual({ status: "mismatch" });
    delete state[key];
    expect(await h.make().admit(h.source.id)).toEqual({ status: "mismatch" });
    expect(project).not.toHaveBeenCalled();
  });

  it.each(ownKeyCases)("rejects own JSON key $label before projection", async ({ nested, present }) => {
    const h = await fixture(ownKeyExample(nested, present)), project = vi.spyOn(h.context, "projectLegacySource");
    const captured = JSON.parse(h.raw).state;
    expect(Object.hasOwn(nested ? captured.extra : captured, "__proto__")).toBe(present);
    h.observation.persistedState = ownKeyExample(nested, !present).progress;
    expect(await h.make().admit(h.source.id)).toEqual({ status: "mismatch" });
    expect(project).not.toHaveBeenCalled();
    expect((await h.words.readCapturedSource(h.lease.ownerKey, h.source.id, 0))?.raw).toBe(h.raw);
  });

  it.each(ownKeyCases)("fences own JSON key $label during projection", async ({ nested, present }) => {
    const h = await fixture(ownKeyExample(nested, present)), { pending, release } = await pause(h, "projection");
    h.observation.persistedState = ownKeyExample(nested, !present).progress;
    release.resolve();
    expect(await pending).toEqual({ status: "changed" });
    expect(h.local.getItem(h.logical)).toBe(h.raw);
  });

  it.each(ownKeyCases)("permanently invalidates local evidence after own JSON key $label", async ({ nested, present }) => {
    const h = await fixture(ownKeyExample(nested, present)), result = admitted(await h.make().admit(h.source.id));
    h.observation.persistedState = ownKeyExample(nested, !present).progress;
    expect(result.isObservationCurrent()).toBe(false);
    h.observation.persistedState = ownKeyExample(nested, present).progress;
    expect(result.isObservationCurrent()).toBe(false);
  });

  it.each([false, true])("retains matching own JSON keys, nested=%s", async nested => {
    const h = await fixture(ownKeyExample(nested, true)), result = admitted(await h.make().admit(h.source.id));
    const view = result.progress as Record<string, unknown>;
    const target = nested ? view.extra as Record<string, unknown> : view;
    expect(Object.hasOwn(target, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(target, "__proto__")?.value).toEqual({});
    expect(result.isObservationCurrent()).toBe(true);
    expect((view.wishlistItems as Array<Record<string, unknown>>)[0]).not.toHaveProperty("notes");
    expect(h.local.getItem(h.logical)).toBe(h.raw);
  });

  it("admits matching JSON values despite object key ordering", async () => {
    const h = await fixture();
    h.observation.persistedState = { progressTimeV: 1, lastModified: 8, coins: 7,
      wishlistItems: [{ priority: "high", notes: "My note", toyId: "truck" }] };
    expect(admitted(await h.make().admit(h.source.id)).progress).toEqual(toyExpected);
  });

  it("rejects another original word value even when the derived word-free gameplay is identical", async () => {
    const h = await fixture(), state = h.observation.persistedState as typeof toy;
    state.wishlistItems[0].notes = "A newer private note";
    const project = vi.spyOn(h.context, "projectLegacySource");
    expect(await h.make().admit(h.source.id)).toEqual({ status: "mismatch" });
    expect(project).not.toHaveBeenCalled(); expect(h.local.getItem(h.logical)).toBe(h.raw);
  });

  it("validates the first raw provenance before equality or a corrected later projection", async () => {
    const h = await fixture(), different = { ...toy, wishlistItems: [{ ...toy.wishlistItems[0], notes: "Different original B" }] };
    h.observation.persistedState = different;
    vi.spyOn(h.words, "readCapturedSource").mockResolvedValueOnce({ ...h.source, raw: persisted(different) });
    const project = vi.spyOn(h.context, "projectLegacySource");
    expect(await h.make().admit(h.source.id)).toEqual({ status: "unavailable" });
    expect(project).not.toHaveBeenCalled();
    expect(await h.words.readCapturedSource(h.lease.ownerKey, h.source.id, 0)).toEqual(h.source);
  });

  it("hashes and decodes the same once-read raw string from an injected accessor-shaped row", async () => {
    const h = await fixture(), row = { ...h.source }, raw = vi.fn().mockReturnValueOnce(h.raw).mockReturnValue("PRIVATE alternating raw");
    Object.defineProperty(row, "raw", { get: raw, enumerable: true });
    vi.spyOn(h.words, "readCapturedSource").mockResolvedValueOnce(row);
    expect(admitted(await h.make().admit(h.source.id)).progress).toEqual(toyExpected);
    expect(raw).toHaveBeenCalledOnce();
  });

  it.each(["id", "owner", "app", "sourceKey", "version", "digest", "raw"])("rejects a malformed first-read %s without projection", async field => {
    const h = await fixture(), row = { ...h.source };
    if (field === "id") row.id = "wrong";
    if (field === "owner") row.ownerKey = "u_bbbbbbbbbbbbbbbbbbbb";
    if (field === "app") row.appId = "weather";
    if (field === "sourceKey") row.sourceKey = undefined as unknown as string;
    if (field === "version") row.sourceVersion = NaN;
    if (field === "digest") row.digest = h.source.digest.toUpperCase();
    if (field === "raw") row.raw = undefined;
    vi.spyOn(h.words, "readCapturedSource").mockResolvedValueOnce(row);
    const project = vi.spyOn(h.context, "projectLegacySource");
    expect(await h.make().admit(h.source.id)).toEqual({ status: "unavailable" });
    expect(project).not.toHaveBeenCalled();
  });

  it("keeps missing, malformed and unsupported captured sources conservative", async () => {
    const h = await fixture();
    expect(await h.make().admit("not-captured")).toEqual({ status: "missing" });
    for (const raw of ["PRIVATE malformed {", JSON.stringify({ state: null }), persisted(toy, 99)]) {
      const row = rowWithRaw(h, raw); await h.words.capture(row, 0);
      expect(await h.make().admit(row.id)).toEqual({ status: "unprojectable" });
      expect((await h.words.readCapturedSource(h.lease.ownerKey, row.id, 0))?.raw).toBe(raw);
    }
  });

  it("reads a real immutable source after its pending-to-receipt transfer between the two reads", async () => {
    const h = await fixture(), project = h.context.projectLegacySource.bind(h.context);
    const records = [{ ownerKey: h.lease.ownerKey, appId: "toy-finder", entityKey: "truck", field: "notes", value: "My note" }];
    vi.spyOn(h.context, "projectLegacySource").mockImplementationOnce(async id => {
      expect(await h.words.commitSource(id, records, 0)).toBe("committed");
      return project(id);
    });
    expect(admitted(await h.make().admit(h.source.id)).progress).toEqual(toyExpected);
    expect(await h.words.listCommittedSources(h.lease.ownerKey)).toContainEqual(h.source);
    expect(await h.words.readCapturedSource(h.lease.ownerKey, h.source.id, 0)).toEqual(h.source);
    expect(h.local.getItem(h.logical)).toBe(h.raw);
  });

  it("continues through an aborted real receipt transfer without losing original bytes", async () => {
    const h = await fixture(), project = h.context.projectLegacySource.bind(h.context), add = IDBObjectStore.prototype.add;
    const records = [{ ownerKey: h.lease.ownerKey, appId: "toy-finder", entityKey: "truck", field: "notes", value: "My note" }];
    vi.spyOn(h.context, "projectLegacySource").mockImplementationOnce(async id => {
      const abort = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["add"]>) {
        const request = add.apply(this, args);
        if (this.name === "receipts") this.transaction.abort();
        return request;
      });
      await expect(h.words.commitSource(id, records, 0)).rejects.toThrow(); abort.mockRestore();
      return project(id);
    });
    expect(admitted(await h.make().admit(h.source.id)).progress).toEqual(toyExpected);
    expect(await h.words.listCommittedSources(h.lease.ownerKey)).toEqual([]);
    expect(await h.words.readWords(h.lease.ownerKey, "toy-finder")).toEqual([]);
    expect(await h.words.readCapturedSource(h.lease.ownerKey, h.source.id, 0)).toEqual(h.source);
  });

  it("refuses an initially unsettled accepted write before reading even if it later settles", async () => {
    const h = await fixture(), read = vi.spyOn(h.words, "readCapturedSource");
    h.observation.hasUnsettledAcceptedWrites = true;
    const pending = h.make().admit(h.source.id);
    h.observation.hasUnsettledAcceptedWrites = false;
    expect(await pending).toEqual({ status: "changed" }); expect(read).not.toHaveBeenCalled();
    expect(admitted(await h.make().admit(h.source.id)).isObservationCurrent()).toBe(true);
  });

  for (const stage of ["read", "projection"] as const) {
    it.each(["word edit", "empty clear", "equal-valued clear", "gameplay edit", "remove/readd", "reorder/restore", "edit/revert ABA"])(
      `rejects an accepted %s during ${stage} even when its final JSON is identical`, async action => {
        const original = { ...toy, wishlistItems: [{ ...toy.wishlistItems[0],
          notes: action.includes("clear") ? "" : "My note" }, { toyId: "doll", notes: "Other private note", priority: "low" }] };
        const h = await fixture({ ...cases[0], state: original, progress: original }), { pending, release } = await pause(h, stage);
        // The injected caller advances before publication. The adapter cannot
        // install or verify coverage of production game actions in this slice.
        const accept = (state: typeof original) => {
          h.observation.acceptedRevision++;
          h.observation.persistedState = state;
        };
        const edited = structuredClone(original);
        if (action.includes("clear")) {
          edited.wishlistItems[0].notes = "";
          accept(edited); // Explicit accepted clear still counts when empty.
        } else {
          if (action === "gameplay edit") edited.coins++;
          else if (action === "remove/readd") edited.wishlistItems.pop();
          else if (action === "reorder/restore") edited.wishlistItems.reverse();
          else edited.wishlistItems[0].notes = "Edited private note";
          accept(edited);
          accept(structuredClone(original));
        }
        expect(h.observation.persistedState).toEqual(original);
        expect(h.observation.acceptedRevision).toBeGreaterThan(0);
        release.resolve();
        expect(await pending).toEqual({ status: "changed" });
        expect(h.local.getItem(h.logical)).toBe(h.raw);
      });

    it.each(["pending", "failed", "settled"])(`rejects a newly accepted %s write during ${stage}`, async outcome => {
      const h = await fixture(), { pending, release } = await pause(h, stage);
      h.observation.acceptedRevision++; h.observation.hasUnsettledAcceptedWrites = outcome !== "settled";
      release.resolve(); expect(await pending).toEqual({ status: "changed" });
    });

    it.each(["storeInstance", "clockInstance"] as const)(`rejects replacement of %s during ${stage} at the same numeric revision`, async key => {
      const h = await fixture(), { pending, release } = await pause(h, stage);
      h.observation[key] = {}; release.resolve();
      expect(await pending).toEqual({ status: "changed" });
    });

    it.each(["loading", "revoke", "owner change", "unhydrate", "rebind"])(`fences %s during ${stage}`, async transition => {
      const h = await fixture(), { pending, release } = await pause(h, stage);
      if (transition === "loading") await h.authority.updateSession("loading");
      if (transition === "revoke") h.authority.revoke();
      if (transition === "owner change") await h.authority.updateSession("authenticated", "admission-owner-B");
      if (transition === "unhydrate") h.unbind();
      if (transition === "rebind") {
        h.unbind(); h.observation.storeInstance = {};
        cleanup.push(h.authority.bindPersistedStore(h.logical, { ...h.persist }));
        await h.authority.whenHydrated(h.logical);
      }
      release.resolve(); expect(await pending).toEqual({ status: "changed" });
    });
  }

  it("checks original full data after awaits even for an external change without accepted-edit coverage", async () => {
    const h = await fixture(), { pending, release } = await pause(h, "projection");
    (h.observation.persistedState as typeof toy).coins++;
    release.resolve(); expect(await pending).toEqual({ status: "changed" });
  });

  it("uses canonical hydration and the immutable original scope and lease", async () => {
    const h = await fixture(), lease = { ...h.lease }, scope = { ...h.scope, lease };
    const hydrated = vi.spyOn(h.authority, "isHydrated"), admission = createSelectedSourceAdmission(h.dependencies, scope);
    lease.ownerKey = "u_bbbbbbbbbbbbbbbbbbbb"; lease.generation++;
    scope.ownerId = "admission-owner-B"; scope.appId = "weather";
    const replacement = vi.fn(() => { throw new Error("Replacement context must remain unused."); });
    scope.prepared = { projectLegacySource: replacement };
    expect(admitted(await admission.admit(h.source.id)).appId).toBe("toy-finder");
    expect(replacement).not.toHaveBeenCalled();
    expect(hydrated.mock.calls.every(([key]) => key === "toy-finder-progress")).toBe(true);
    expect(await h.make({}, { ownerId: "" }).admit(h.source.id)).toEqual({ status: "unavailable" });
    expect(await h.make({}, { ownerId: "admission-owner-B" }).admit(h.source.id)).toEqual({ status: "changed" });
    expect(await h.make({}, { appId: "unknown-app" }).admit(h.source.id)).toEqual({ status: "unprojectable" });
  });

  it("does not expose a foreign owner's exact source or touch its words", async () => {
    const h = await fixture(), foreignOwner = await ownerKeyFor("admission-owner-B"), foreign = rowWithRaw(h, h.raw, { ownerKey: foreignOwner });
    await h.words.capture(foreign, 0);
    expect(await h.make().admit(foreign.id)).toEqual({ status: "missing" });
    expect(await h.words.listSources(foreignOwner)).toEqual([foreign]);
    expect(await h.words.readWords(foreignOwner, "toy-finder")).toEqual([]);
  });

  it.each(["words", "journals"])("refuses %s deletion before the prepared context completes", async target => {
    const h = await fixture(), project = h.context.projectLegacySource.bind(h.context);
    vi.spyOn(h.context, "projectLegacySource").mockImplementationOnce(async id => {
      if (target === "words") await h.words.deleteOwner(h.lease.ownerKey);
      else await h.journals.deleteOwner(h.lease.ownerKey);
      return project(id);
    });
    expect(await h.make().admit(h.source.id)).toEqual({ status: "changed" });
    expect(h.local.getItem(h.logical)).toBe(h.raw);
  });

  it("labels returned revalidation as local evidence, without a new durable epoch read", async () => {
    const h = await fixture(), result = admitted(await h.make().admit(h.source.id));
    await h.words.deleteOwner(h.lease.ownerKey);
    const wordEpoch = vi.spyOn(h.words, "ownerEpoch"), journalEpoch = vi.spyOn(h.journals, "ownerEpoch");
    expect(result.isObservationCurrent()).toBe(true);
    expect(wordEpoch).not.toHaveBeenCalled(); expect(journalEpoch).not.toHaveBeenCalled();
    expect(await h.make().admit(h.source.id)).toEqual({ status: "changed" });
  });

  it.each(["read", "observation", "authority", "projection"])("redacts a %s dependency exception", async failing => {
    const h = await fixture(), fail = () => { throw new DOMException("PRIVATE original words and owner", "QuotaExceededError"); };
    if (failing === "read") vi.spyOn(h.words, "readCapturedSource").mockImplementation(fail);
    if (failing === "observation") h.readObservation.mockImplementation(fail);
    if (failing === "authority") vi.spyOn(h.authority, "isHydrated").mockImplementation(fail);
    if (failing === "projection") vi.spyOn(h.context, "projectLegacySource").mockImplementation(fail);
    expect(await h.make().admit(h.source.id)).toEqual({ status: "unavailable" });
    expect(h.local.getItem(h.logical)).toBe(h.raw);
  });

  it.each(["missing", "unprojectable", "changed", "unavailable"] as const)("forwards a conservative prepared %s outcome", async status => {
    const h = await fixture();
    vi.spyOn(h.context, "projectLegacySource").mockResolvedValueOnce({ status });
    expect(await h.make().admit(h.source.id)).toEqual({ status });
  });

  it.each(["source", "app"])("rejects a projected %s identity mismatch", async key => {
    const h = await fixture();
    vi.spyOn(h.context, "projectLegacySource").mockResolvedValueOnce({ status: "projected",
      sourceId: key === "source" ? "other-source" : h.source.id, appId: key === "app" ? "weather" : "toy-finder", progress: toyExpected });
    expect(await h.make().admit(h.source.id)).toEqual({ status: "unavailable" });
  });

  it("defensively separates returned data from the private observation and evidence", async () => {
    const h = await fixture(), result = admitted(await h.make().admit(h.source.id));
    (result.progress as typeof toyExpected).wishlistItems[0].priority = "low";
    result.ownerKey = "u_bbbbbbbbbbbbbbbbbbbb"; result.sourceId = "mutated-public-id";
    expect(result.isObservationCurrent()).toBe(true);
    expect(h.observation.persistedState).toEqual(toy);
    expect(await h.words.readCapturedSource(h.lease.ownerKey, h.source.id, 0)).toEqual(h.source);
    expect(admitted(await h.make().admit(h.source.id)).progress).toEqual(toyExpected);
  });

  it.each(["revision", "pending", "data", "store", "clock", "owner", "exception"])("permanently invalidates local revalidation after observed %s failure", async failure => {
    const h = await fixture(), result = admitted(await h.make().admit(h.source.id)), original = { ...h.observation };
    if (failure === "revision") h.observation.acceptedRevision++;
    if (failure === "pending") h.observation.hasUnsettledAcceptedWrites = true;
    if (failure === "data") h.observation.persistedState = { ...toy, coins: 99 };
    if (failure === "store") h.observation.storeInstance = {};
    if (failure === "clock") h.observation.clockInstance = {};
    if (failure === "owner") await h.authority.updateSession("loading");
    if (failure === "exception") h.readObservation.mockImplementationOnce(() => { throw new Error("PRIVATE observation"); });
    expect(result.isObservationCurrent()).toBe(false);
    Object.assign(h.observation, original);
    if (failure === "owner") await h.authority.updateSession("authenticated", ownerId);
    expect(result.isObservationCurrent()).toBe(false);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid acceptedRevision %s before lookup", async revision => {
    const h = await fixture(), read = vi.spyOn(h.words, "readCapturedSource");
    h.observation.acceptedRevision = revision;
    expect(await h.make().admit(h.source.id)).toEqual({ status: "unavailable" }); expect(read).not.toHaveBeenCalled();
  });

  it("rejects missing identities, non-boolean pending state and accessor observation fields without invoking getters", async () => {
    const h = await fixture(), read = vi.spyOn(h.words, "readCapturedSource"), getter = vi.fn(() => 0);
    for (const observation of [
      { ...h.observation, storeInstance: null }, { ...h.observation, clockInstance: "reused-token" },
      { ...h.observation, hasUnsettledAcceptedWrites: 0 },
      Object.defineProperty({ ...h.observation }, "acceptedRevision", { get: getter }),
    ]) {
      h.readObservation.mockReturnValueOnce(observation as SelectedSourceObservation);
      expect(await h.make().admit(h.source.id)).toEqual({ status: "unavailable" });
    }
    expect(getter).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });

  it.each(["map", "date", "undefined", "non-finite", "cycle", "accessor", "symbol", "hidden", "sparse", "array-property", "prototype", "function", "bigint"])(
    "rejects %s-shaped persisted data instead of treating it as JSON evidence", async kind => {
      const h = await fixture(), state: Record<string, unknown> = {}, getter = vi.fn(() => "PRIVATE getter");
      if (kind === "map") state.empty = new Map();
      if (kind === "date") state.empty = new Date(0);
      if (kind === "undefined") state.empty = undefined;
      if (kind === "non-finite") state.empty = NaN;
      if (kind === "cycle") state.empty = state;
      if (kind === "accessor") Object.defineProperty(state, "empty", { get: getter, enumerable: true });
      if (kind === "symbol") Object.defineProperty(state, Symbol("private"), { value: "PRIVATE" });
      if (kind === "hidden") Object.defineProperty(state, "empty", { value: "PRIVATE", enumerable: false });
      if (kind === "sparse") state.empty = Array(1);
      if (kind === "array-property") { const array: unknown[] = []; Object.defineProperty(array, "custom", { value: "PRIVATE", enumerable: true }); state.empty = array; }
      if (kind === "prototype") state.empty = Object.create({ inherited: "PRIVATE" });
      if (kind === "function") state.empty = () => {};
      if (kind === "bigint") state.empty = BigInt(1);
      h.observation.persistedState = state;
      const read = vi.spyOn(h.words, "readCapturedSource");
      expect(await h.make().admit(h.source.id)).toEqual({ status: "unavailable" });
      expect(getter).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    });

  it("does not let Date or Map-shaped data masquerade as matching empty JSON objects", async () => {
    const h = await fixture(), state = { ...toy, extra: {} }, row = rowWithRaw(h, persisted(state));
    await h.words.capture(row, 0);
    for (const extra of [new Date(0), new Map()]) {
      h.observation.persistedState = { ...state, extra };
      expect(await h.make().admit(row.id)).toEqual({ status: "unavailable" });
    }
  });
});
