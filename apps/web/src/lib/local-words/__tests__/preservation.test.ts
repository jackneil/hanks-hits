// @vitest-environment node
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import { progressJournalKey } from "@/shared/lib/progressJournal";
import { ProgressJournalDatabase } from "@/shared/lib/progressJournalDatabase";
import { emptyJournalRecovery, journalOriginalId, journalSourceId } from "@/shared/lib/progressJournalRecovery";
import {
  createOwnerBoundProgress, GUEST_CANDIDATE_PREFIX, GUEST_HANDOFF_KEY,
  PROGRESS_NAMESPACE, PROGRESS_QUARANTINE,
} from "../../owner-bound-progress/core";
import { PROGRESS_OWNER_KEY } from "../../storage-keys";
import { WORD_EXTRACTION_VERSION, type WordField } from "../../progress-words";
import { LocalWordsDatabase, type SourceRecord } from "../database";
import { legacyWordSources } from "../inventory";
import { captureWordPreservation, type WordPreservationOptions } from "../preservation";

class PhysicalStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(name: string) { return this.values.get(name) ?? null; }
  setItem(name: string, value: string) { this.values.set(name, value); }
  removeItem(name: string) { this.values.delete(name); }
  clear() { this.values.clear(); }
  snapshot() { return [...this.values.entries()]; }
}

const ownerId = "preservation-owner-A", journalApp = "drawing-app" as const;
const oregonKey = "oregon-trail-storage", weatherKey = "weather-app-progress";
const digest = (raw: string) => [...sha256(new TextEncoder().encode(raw))]
  .map(byte => byte.toString(16).padStart(2, "0")).join("");
const exactDigest = (raw: string) => digest(JSON.stringify(raw));
const persist = (state: Record<string, unknown>, version: number | null = 0) =>
  JSON.stringify({ state, ...(version === null ? {} : { version }) }, null, 2);
const oregonState = { journeyId: "journey-1", leaderName: "Traveler", party: [{ id: "friend-1", name: "Friend", health: 91 }], coins: 7 };
const oregonRaw = persist(oregonState, 1);
const artwork = (id: string) => ({ id, name: `${id} title`, dataUrl: `data:image/png;base64,${id}`, thumbnail: id });
const drawing = (id: string) => ({ savedArtworks: [artwork(id)] });
function journal(writerId = "writer", prefix = "", patch: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 1, appId: journalApp, ownerId, writerId, serial: 7,
    acknowledged: { data: drawing(`${prefix}ack`), revision: "a".repeat(64) },
    sent: { id: "immutable-request", base: { data: drawing(`${prefix}base`), revision: "b".repeat(64) }, data: drawing(`${prefix}sent`) },
    live: drawing(`${prefix}live`), conflict: { remote: { data: drawing(`${prefix}conflict`), revision: "c".repeat(64) } },
    forceWrite: false, ...patch }, null, 2);
}
function envelope(current = journal(), originals: string[] = [], generation = 3) {
  return JSON.stringify({ format: "hh-progress-journal", version: 3, generation, current,
    originals: originals.map(raw => ({ raw, choice: false })), recovery: emptyJournalRecovery() }, null, 2);
}

// These are persisted flat/nested gameplay shapes, with explicit expected
// fields rather than calling the extractor to manufacture the assertions.
const legacyCases: Array<{ appId: string; key: string; state: Record<string, unknown>; fields: WordField[] }> = [
  { appId: "oregon-trail", key: oregonKey, state: oregonState, fields: [
    { path: "leaderName", value: "Traveler", identity: { journeyId: "journey-1" } },
    { path: "party[0].name", value: "Friend", identity: { journeyId: "journey-1", index: 0, id: "friend-1" } },
  ] },
  { appId: "weather", key: weatherKey,
    state: { savedLocations: [{ name: "Town", latitude: 3 }], lastLocation: { name: "Place", longitude: 4 }, lastModified: 8 }, fields: [
      { path: "savedLocations", value: [{ name: "Town", latitude: 3 }], identity: {} },
      { path: "lastLocation", value: { name: "Place", longitude: 4 }, identity: {} },
    ] },
  { appId: "toy-finder", key: "toy-finder-progress", state: { wishlistItems: [{ toyId: "truck", notes: "My note", priority: "high" }] },
    fields: [{ path: "wishlistItems[0].notes", value: "My note", identity: { index: 0, toyId: "truck" } }] },
  { appId: "drawing-app", key: "drawing-app-progress", state: { savedArtworks: [artwork("art")] },
    fields: [{ path: "savedArtworks", value: [artwork("art")], identity: {} }] },
  { appId: "drum-machine", key: "drum-machine-state", state: { progress: { savedBeats: [{ id: "beat", name: "Jam", bpm: 90 }] }, playing: false },
    fields: [{ path: "savedBeats[0].name", value: "Jam", identity: { index: 0, id: "beat" } }] },
  { appId: "virtual-pet", key: "virtual-pet-state",
    state: { progress: { pet: { name: "Fluffy", speciesId: "cat", bornAt: "2026-01-01" }, settings: { petName: "Fluffy" } }, loading: false }, fields: [
      { path: "pet.name", value: "Fluffy", identity: { speciesId: "cat", bornAt: "2026-01-01" } },
      { path: "settings.petName", value: "Fluffy", identity: { speciesId: "cat", bornAt: "2026-01-01" } },
    ] },
  { appId: "four-wheeler-3d", key: "four-wheeler-3d-game-state",
    state: { progress: { adventure: { outfit: { text: "Racer", color: "blue" }, feeders: [{ id: "feeder", label: "Back yard", food: 30 }] } }, speed: 0 }, fields: [
      { path: "adventure.outfit.text", value: "Racer", identity: {} },
      { path: "adventure.feeders[0].label", value: "Back yard", identity: { index: 0, id: "feeder" } },
    ] },
];

const close: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  close.splice(0).forEach(done => done());
});
async function fixture() {
  const local = new PhysicalStorage(), factory = new IDBFactory(), storage = () => local;
  const authority = createOwnerBoundProgress({ storage, sessionStorage: () => new PhysicalStorage() });
  await authority.updateSession("authenticated", ownerId);
  const lease = authority.captureLease()!;
  local.setItem(PROGRESS_OWNER_KEY, ownerId);
  const words = new LocalWordsDatabase(factory, "preservation-words"), journals = new ProgressJournalDatabase(factory, "preservation-journals");
  close.push(() => { words.close(); journals.close(); });
  const options: WordPreservationOptions = { ownerId, authority, lease, storage, words, journals };
  const physical = (logical = oregonKey, key = lease.ownerKey) => PROGRESS_NAMESPACE + JSON.stringify([key, logical]);
  const outer = (raw: string | null, logical = oregonKey, patch: Record<string, unknown> = {}) =>
    JSON.stringify({ version: 2, ownerKey: lease.ownerKey, logicalKey: logical, raw, ...patch }, null, 2);
  const quarantine = (raw: string, logical = oregonKey, key = lease.ownerKey, checksum = digest(raw)) =>
    PROGRESS_QUARANTINE + JSON.stringify([key, logical, checksum]);
  const put = (raw: string, writerId = "writer", generation = 3) =>
    journals.put({ ownerKey: lease.ownerKey, appId: journalApp, writerId, generation, raw }, 0);
  const archive = (raw: string, current = journal(), writerId = "writer") =>
    journals.archive({ ownerKey: lease.ownerKey, appId: journalApp,
      sourceId: journalSourceId(lease.ownerKey, journalApp, writerId, current), raw }, 0);
  return { local, factory, storage, authority, lease, words, journals, options, physical, outer, quarantine, put, archive };
}
type Harness = Awaited<ReturnType<typeof fixture>>;
const typed = (sources: SourceRecord[]) => sources.filter(source => source.fields.length);
const capturedAt = (sources: SourceRecord[], name: string) => sources.filter(source => {
  const key = JSON.parse(source.sourceKey) as unknown[];
  return key[0] === "word-preservation" && key[2] === name;
});
async function assertNoProjection(h: Harness) {
  expect(await h.words.listCommittedSources(h.lease.ownerKey)).toEqual([]);
  for (const { appId } of legacyCases) expect(await h.words.readWords(h.lease.ownerKey, appId)).toEqual([]);
}
async function seedBoundaries(h: Harness) {
  h.local.setItem(h.physical(), h.outer(oregonRaw));
  await h.put(envelope()); await h.archive(envelope());
}

const wordEpochStages = { "word-pin": 1, "delegate-word-pin": 2, "delegate-final-word-epoch": 3, "final-word-epoch": 4 } as const;
const journalEpochStages = { "journal-pin": 1, "delegate-journal-pin": 2, "delegate-final-journal-epoch": 3, "final-journal-epoch": 4 } as const;
const boundaryStages = [
  "word-pin", "journal-pin", "legacy-outer", "legacy-inner", "legacy-fields",
  "delegate-word-pin", "delegate-journal-pin", "checkpoint-page", "archive-page", "journal-section",
  "delegate-final-journal-epoch", "delegate-final-word-epoch", "final-journal-epoch", "final-word-epoch",
] as const;
type BoundaryStage = typeof boundaryStages[number];

// Scheduling wrappers are synthetic; every underlying read, capture and
// deletion uses a real isolated IndexedDB transaction and the actual authority.
function atBoundary(h: Harness, stage: BoundaryStage, change: () => void | Promise<unknown>, beforeWordEpoch = false) {
  let triggered = false;
  const mutate = async () => { if (!triggered) { triggered = true; await change(); } };
  if (stage in wordEpochStages) {
    const target = wordEpochStages[stage as keyof typeof wordEpochStages], real = h.words.ownerEpoch.bind(h.words);
    let reads = 0;
    vi.spyOn(h.words, "ownerEpoch").mockImplementation(async key => {
      const selected = ++reads === target;
      if (selected && beforeWordEpoch) await mutate();
      const epoch = await real(key);
      if (selected && !beforeWordEpoch) await mutate();
      return epoch;
    });
  } else if (stage in journalEpochStages) {
    const target = journalEpochStages[stage as keyof typeof journalEpochStages], real = h.journals.ownerEpoch.bind(h.journals);
    let reads = 0;
    vi.spyOn(h.journals, "ownerEpoch").mockImplementation(async key => {
      const epoch = await real(key);
      if (++reads === target) await mutate();
      return epoch;
    });
  } else if (stage === "checkpoint-page") {
    const real = h.journals.checkpointPage.bind(h.journals);
    vi.spyOn(h.journals, "checkpointPage").mockImplementation(async (...args) => { const page = await real(...args); await mutate(); return page; });
  } else if (stage === "archive-page") {
    const real = h.journals.archivePage.bind(h.journals);
    vi.spyOn(h.journals, "archivePage").mockImplementation(async (...args) => { const page = await real(...args); await mutate(); return page; });
  } else {
    const real = h.words.capture.bind(h.words);
    vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      await real(...args);
      const source = args[0], key = JSON.parse(source.sourceKey) as unknown[];
      const matches = stage === "journal-section" ? source.appId === journalApp && source.fields.length > 0
        : key[0] === "word-preservation" && key[4] === stage.slice("legacy-".length);
      if (matches) await mutate();
    });
  }
  return () => triggered;
}

describe("account-only raw word preservation capture", () => {
  it("imports without window, storage observation or opening a database", async () => {
    const access = vi.fn(() => { throw new Error("must remain lazy"); }), open = vi.fn();
    vi.stubGlobal("indexedDB", { open });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: access });
    try {
      vi.resetModules(); await import("../preservation");
      expect(access).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it.each(["", "preservation-owner-B"])("requires the supplied account ID %j to match the current lease", async suppliedOwner => {
    const h = await fixture(); h.local.setItem(oregonKey, oregonRaw);
    const capture = vi.spyOn(h.words, "capture"), read = vi.spyOn(h.local, "getItem");
    expect(await captureWordPreservation({ ...h.options, ownerId: suppliedOwner })).toBe("changed");
    expect(capture).not.toHaveBeenCalled(); expect(read.mock.calls.some(([name]) => name === oregonKey)).toBe(false);
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]);
  });

  it("does not turn an actual current guest lease into an account capture", async () => {
    const h = await fixture(), guest = createOwnerBoundProgress({ storage: h.storage, sessionStorage: () => new PhysicalStorage() });
    await guest.updateSession("unauthenticated");
    const lease = guest.captureLease()!;
    expect(guest.isCurrent(lease)).toBe(true); expect(lease.ownerKey).toBe("guest");
    expect(await captureWordPreservation({ ...h.options, authority: guest, lease })).toBe("changed");
    expect(await h.words.listSources("guest")).toEqual([]);
  });

  it("returns empty only after successful physical and both journal page inventories", async () => {
    const h = await fixture(), before = h.local.snapshot();
    const checkpoints = vi.spyOn(h.journals, "checkpointPage"), archives = vi.spyOn(h.journals, "archivePage");
    const writes = vi.spyOn(h.local, "setItem"), removals = vi.spyOn(h.local, "removeItem"), commit = vi.spyOn(h.words, "commitSource");
    expect(await captureWordPreservation(h.options)).toBe("empty");
    expect(checkpoints).toHaveBeenCalledWith(h.lease.ownerKey, 0, { cursor: null });
    expect(archives).toHaveBeenCalledWith(h.lease.ownerKey, 0, { cursor: null });
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]);
    expect(h.local.snapshot()).toEqual(before); expect(writes).not.toHaveBeenCalled(); expect(removals).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
    await assertNoProjection(h);
  });

  it("preserves exact seven-app gameplay envelopes and independently expected fields without committing words", async () => {
    const h = await fixture();
    expect(Object.fromEntries(legacyCases.map(row => [row.appId, row.key]))).toEqual(legacyWordSources);
    const raws = legacyCases.map(row => persist(row.state, row.appId === "oregon-trail" ? 1 : 0));
    legacyCases.forEach((row, index) => h.local.setItem(row.key, raws[index]));
    const before = h.local.snapshot(), writes = vi.spyOn(h.local, "setItem"), removals = vi.spyOn(h.local, "removeItem");
    const commit = vi.spyOn(h.words, "commitSource"), deleteWords = vi.spyOn(h.words, "deleteOwner"), deleteJournals = vi.spyOn(h.journals, "deleteOwner");
    expect(await captureWordPreservation(h.options)).toBe("captured");
    const sources = await h.words.listSources(h.lease.ownerKey);
    for (let index = 0; index < legacyCases.length; index++) {
      const row = legacyCases[index], records = capturedAt(sources, row.key);
      expect(records.some(source => source.raw === raws[index] && source.appId === "preservation-inventory" && source.fields.length === 0)).toBe(true);
      expect(typed(records)).toHaveLength(1);
      expect(typed(records)[0]).toMatchObject({ ownerKey: h.lease.ownerKey, appId: row.appId, raw: raws[index], fields: row.fields });
    }
    for (const source of sources) {
      expect(source.id).toBe(JSON.stringify([h.lease.ownerKey, source.appId, source.sourceKey, source.sourceVersion, source.digest]));
      expect(source.digest).toBe(exactDigest(source.raw!));
    }
    expect(h.local.snapshot()).toEqual(before); expect(writes).not.toHaveBeenCalled(); expect(removals).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled(); expect(deleteWords).not.toHaveBeenCalled(); expect(deleteJournals).not.toHaveBeenCalled();
    await assertNoProjection(h);
  });

  it.each(legacyCases)("supports an absent persist version for $appId", async row => {
    const h = await fixture(), raw = persist(row.state, null);
    h.local.setItem(row.key, raw);
    expect(await captureWordPreservation(h.options)).toBe("captured");
    expect(typed(await h.words.listSources(h.lease.ownerKey))).toEqual([
      expect.objectContaining({ appId: row.appId, raw, fields: row.fields }),
    ]);
    expect(h.local.getItem(row.key)).toBe(raw);
  });

  it("keeps Oregon setup names without inventing a journey identity", async () => {
    const h = await fixture(), raw = persist({ gamePhase: "setup", leaderName: "Draft leader", party: [{ name: "Draft friend" }], occupation: "banker" });
    h.local.setItem(oregonKey, raw);
    expect(await captureWordPreservation(h.options)).toBe("captured");
    expect(typed(await h.words.listSources(h.lease.ownerKey))[0].fields).toEqual([
      { path: "leaderName", value: "Draft leader", identity: {} },
      { path: "party[0].name", value: "Draft friend", identity: { index: 0 } },
    ]);
    expect(h.local.getItem(oregonKey)).toBe(raw);
  });

  it("captures outer then exact inner then fields for every physical spelling", async () => {
    const h = await fixture(), raw = ` \n${oregonRaw}\n `, outer = h.outer(raw);
    const names = [h.physical(), PROGRESS_NAMESPACE + `[ "${h.lease.ownerKey}" , "${oregonKey}" ]`,
      h.physical().replace("oregon", "\\u006fregon")];
    names.forEach(name => h.local.setItem(name, outer));
    const before = h.local.snapshot(), capture = vi.spyOn(h.words, "capture");
    expect(await captureWordPreservation(h.options)).toBe("captured");
    const sources = await h.words.listSources(h.lease.ownerKey);
    for (const name of names) {
      const records = capturedAt(sources, name);
      expect(records).toHaveLength(3);
      expect(records.some(source => source.raw === outer && source.fields.length === 0)).toBe(true);
      expect(records.some(source => source.raw === raw && source.fields.length === 0)).toBe(true);
      expect(typed(records)[0]).toMatchObject({ raw, fields: legacyCases[0].fields });
      const captures = capture.mock.calls.map(([source]) => source).filter(source => capturedAt([source], name).length);
      expect(captures.map(source => JSON.parse(source.sourceKey)[4])).toEqual(["outer", "inner", "fields"]);
    }
    expect(new Set(sources.map(source => source.id)).size).toBe(sources.length);
    const ids = sources.map(source => source.id);
    expect(await captureWordPreservation(h.options)).toBe("captured");
    expect((await h.words.listSources(h.lease.ownerKey)).map(source => source.id)).toEqual(ids);
    expect(h.local.snapshot()).toEqual(before); await assertNoProjection(h);
  });

  it("preserves quarantine bytes actually written by the mounted authority before replacing an unsupported save", async () => {
    const h = await fixture(), future = h.outer(persist(oregonState, 99));
    h.local.setItem(h.physical(), future);
    expect(h.authority.writeScoped(oregonKey, oregonRaw)).toBe(true);
    const quarantineName = h.quarantine(future), before = h.local.snapshot();
    expect(h.local.getItem(quarantineName)).toBe(future);
    expect(await captureWordPreservation(h.options)).toBe("captured");
    const records = capturedAt(await h.words.listSources(h.lease.ownerKey), quarantineName);
    expect(records.some(source => source.raw === future && !source.fields.length)).toBe(true);
    expect(typed(records)).toEqual([]); expect(h.local.snapshot()).toEqual(before);
  });

  it("retains independent quarantine variants and validates the old address against its whole outer string", async () => {
    const h = await fixture(), first = h.outer(oregonRaw), second = h.outer(persist({ ...oregonState, leaderName: "Second leader" }, 1));
    const names = [h.quarantine(first), h.quarantine(second)];
    h.local.setItem(names[0], first); h.local.setItem(names[1], second);
    const before = h.local.snapshot();
    expect(await captureWordPreservation(h.options)).toBe("captured");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(typed(capturedAt(sources, names[0]))[0].fields[0].value).toBe("Traveler");
    expect(typed(capturedAt(sources, names[1]))[0].fields[0].value).toBe("Second leader");
    expect(capturedAt(sources, names[0]).some(source => source.raw === first)).toBe(true);
    expect(capturedAt(sources, names[1]).some(source => source.raw === second)).toBe(true);
    expect(h.local.snapshot()).toEqual(before);
  });

  it.each([
    { label: "owner", patch: { ownerKey: "guest" } },
    { label: "logical key", patch: { logicalKey: weatherKey } },
  ])("retains a contradictory wrapper $label opaque and returns unavailable", async ({ patch }) => {
    const h = await fixture(), outer = h.outer(oregonRaw, oregonKey, patch);
    h.local.setItem(h.physical(), outer);
    expect(await captureWordPreservation(h.options)).toBe("unavailable");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(sources.some(source => source.raw === outer && !source.fields.length)).toBe(true);
    expect(typed(sources)).toEqual([]); expect(h.local.getItem(h.physical())).toBe(outer);
  });

  it("retains a quarantine digest contradiction but does not expose its otherwise valid words", async () => {
    const h = await fixture(), outer = h.outer(oregonRaw), name = h.quarantine(outer, oregonKey, h.lease.ownerKey, "0".repeat(64));
    h.local.setItem(name, outer);
    expect(await captureWordPreservation(h.options)).toBe("unavailable");
    const records = capturedAt(await h.words.listSources(h.lease.ownerKey), name);
    expect(records.some(source => source.raw === outer && !source.fields.length)).toBe(true);
    expect(typed(records)).toEqual([]); expect(h.local.getItem(name)).toBe(outer);
  });

  it.each([
    { label: "empty string", raw: "" }, { label: "malformed", raw: "{broken exact bytes" },
    { label: "future version", raw: persist(oregonState, 42) },
    { label: "word-free", raw: persist({ leaderName: "", party: [], coins: 27 }) },
  ])("durably captures $label globals and supported-wrapper inners as opaque data", async ({ raw }) => {
    const h = await fixture(), outer = h.outer(raw);
    h.local.setItem(oregonKey, raw); h.local.setItem(h.physical(), outer);
    const before = h.local.snapshot();
    expect(await captureWordPreservation(h.options)).toBe("captured");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(capturedAt(sources, oregonKey).some(source => source.raw === raw)).toBe(true);
    expect(capturedAt(sources, h.physical()).some(source => source.raw === outer)).toBe(true);
    expect(capturedAt(sources, h.physical()).some(source => source.raw === raw)).toBe(true);
    expect(typed(sources)).toEqual([]); expect(h.local.snapshot()).toEqual(before); await assertNoProjection(h);
  });

  it.each([
    { label: "null inner", raw: null }, { label: "malformed wrapper", raw: "{broken" },
    { label: "future wrapper", raw: JSON.stringify({ version: 99, raw: oregonRaw }) },
  ])("captures a $label outer without inventing inner fields", async ({ label, raw }) => {
    const h = await fixture(), outer = label === "null inner" ? h.outer(null) : raw!;
    h.local.setItem(h.physical(), outer);
    expect(await captureWordPreservation(h.options)).toBe("captured");
    expect(capturedAt(await h.words.listSources(h.lease.ownerKey), h.physical())).toEqual([
      expect.objectContaining({ raw: outer, appId: "preservation-inventory", fields: [] }),
    ]);
    expect(h.local.getItem(h.physical())).toBe(outer);
  });

  it("never interprets version one for the other six apps or version two for Oregon", async () => {
    const h = await fixture();
    legacyCases.forEach(row => h.local.setItem(row.key, persist(row.state, row.appId === "oregon-trail" ? 2 : 1)));
    const before = h.local.snapshot();
    expect(await captureWordPreservation(h.options)).toBe("captured");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(typed(sources)).toEqual([]);
    expect(sources.filter(source => source.appId === "preservation-inventory")).toHaveLength(7);
    expect(h.local.snapshot()).toEqual(before);
  });

  it("preserves one oversized artwork intact and distinguishes exact lone-surrogate retries", async () => {
    const h = await fixture(), art = { ...artwork("huge"), dataUrl: "data:image/png;base64," + "x".repeat(256 * 1024 + 1) };
    const huge = persist({ savedArtworks: [art] });
    h.local.setItem("drawing-app-progress", huge); h.local.setItem(oregonKey, "\ud800");
    expect(await captureWordPreservation(h.options)).toBe("captured");
    h.local.setItem(oregonKey, "\ud801");
    expect(await captureWordPreservation(h.options)).toBe("captured");
    const before = await h.words.listSources(h.lease.ownerKey), surrogates = before.filter(source => source.raw === "\ud800" || source.raw === "\ud801");
    expect(surrogates).toHaveLength(2); expect(new Set(surrogates.map(source => source.digest)).size).toBe(2);
    expect(surrogates.every(source => source.digest === exactDigest(source.raw!))).toBe(true);
    expect(typed(before).find(source => source.appId === "drawing-app")).toMatchObject({ raw: huge, fields: [{ path: "savedArtworks", value: [art], identity: {} }] });
    expect(await captureWordPreservation(h.options)).toBe("captured");
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual(before);
    expect(h.local.getItem("drawing-app-progress")).toBe(huge); expect(h.local.getItem(oregonKey)).toBe("\ud801");
  });

  it("adds new extractor-version records on unchanged bytes while keeping earlier captures", async () => {
    const h = await fixture(); h.local.setItem(oregonKey, oregonRaw);
    expect(await captureWordPreservation(h.options)).toBe("captured");
    const before = await h.words.listSources(h.lease.ownerKey);
    vi.doMock("../../progress-words", async () => ({
      ...await vi.importActual<typeof import("../../progress-words")>("../../progress-words"),
      WORD_EXTRACTION_VERSION: WORD_EXTRACTION_VERSION + 1,
    }));
    try {
      vi.resetModules();
      const bumped = await import("../preservation");
      expect(await bumped.captureWordPreservation(h.options)).toBe("captured");
      const after = await h.words.listSources(h.lease.ownerKey);
      expect(after).toEqual(expect.arrayContaining(before)); expect(typed(after)).toHaveLength(2);
      expect(new Set(typed(after).map(source => source.sourceVersion)).size).toBe(2);
      expect(typed(after).every(source => source.raw === oregonRaw)).toBe(true);
      expect(after.filter(source => source.appId === "preservation-inventory")).toHaveLength(1);
      expect(h.local.getItem(oregonKey)).toBe(oregonRaw);
    } finally { vi.doUnmock("../../progress-words"); vi.resetModules(); }
  });

  it.each(["missing", "foreign"])("never reads unscoped legacy values under a %s marker", async marker => {
    const h = await fixture(); h.local.setItem(oregonKey, "excluded-global-private");
    if (marker === "missing") h.local.removeItem(PROGRESS_OWNER_KEY);
    else h.local.setItem(PROGRESS_OWNER_KEY, "preservation-owner-B");
    const before = h.local.snapshot(), read = vi.spyOn(h.local, "getItem");
    expect(await captureWordPreservation(h.options)).toBe("empty");
    expect(read.mock.calls.some(([name]) => name === oregonKey)).toBe(false);
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]); expect(h.local.snapshot()).toEqual(before);
  });

  it("never reads foreign, guest, unaddressed or excluded physical values or changes their words", async () => {
    const h = await fixture(), ownerB = await ownerKeyFor("preservation-owner-B");
    const forbidden = [h.physical(oregonKey, ownerB), h.physical(oregonKey, "guest"),
      h.quarantine("B-quarantine-private", oregonKey, ownerB), h.quarantine("guest-quarantine-private", oregonKey, "guest"),
      PROGRESS_NAMESPACE + JSON.stringify([h.lease.ownerKey, oregonKey, "extra"]),
      PROGRESS_NAMESPACE + "{broken", h.physical("unknown-progress"),
      PROGRESS_QUARANTINE + JSON.stringify([h.lease.ownerKey, oregonKey, "A".repeat(64)]),
      PROGRESS_QUARANTINE + JSON.stringify([h.lease.ownerKey, progressJournalKey(journalApp, "writer"), "a".repeat(64)]),
      GUEST_CANDIDATE_PREFIX + JSON.stringify([h.lease.ownerKey, "candidate"]), GUEST_HANDOFF_KEY];
    forbidden.forEach(name => h.local.setItem(name, "excluded-physical-private"));
    await h.journals.put({ ownerKey: ownerB, appId: journalApp, writerId: "writer", generation: 0, raw: "B-journal-private" }, 0);
    await h.journals.put({ ownerKey: "guest", appId: journalApp, writerId: "writer", generation: 0, raw: "guest-journal-private" }, 0);
    await h.words.writeWords([{ ownerKey: ownerB, appId: journalApp, entityKey: "B", field: "name", value: "B words" }], 0);
    await h.words.writeWords([{ ownerKey: "guest", appId: journalApp, entityKey: "guest", field: "name", value: "guest words" }], 0);
    const before = h.local.snapshot(), real = h.local.getItem.bind(h.local);
    const read = vi.spyOn(h.local, "getItem").mockImplementation(name => {
      if (forbidden.includes(name)) throw new Error("must never read an excluded value");
      return real(name);
    });
    expect(await captureWordPreservation(h.options)).toBe("empty");
    expect(read.mock.calls.some(([name]) => forbidden.includes(name))).toBe(false);
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]); expect(h.local.snapshot()).toEqual(before);
    expect((await h.journals.get(ownerB, journalApp, "writer", 0))?.raw).toBe("B-journal-private");
    expect((await h.journals.get("guest", journalApp, "writer", 0))?.raw).toBe("guest-journal-private");
    expect((await h.words.readWords(ownerB, journalApp))[0].value).toBe("B words");
    expect((await h.words.readWords("guest", journalApp))[0].value).toBe("guest words");
    await assertNoProjection(h);
  });

  it.each(["always denied", "initially denied"])("retains marker %s as unavailable while preserving proven scoped and IDB sources", async failure => {
    const h = await fixture(), outer = h.outer(oregonRaw);
    h.local.setItem(oregonKey, "excluded-global-private"); h.local.setItem(h.physical(), outer); await h.put(envelope());
    const before = h.local.snapshot(), real = h.local.getItem.bind(h.local); let markerReads = 0;
    const read = vi.spyOn(h.local, "getItem").mockImplementation(name => {
      if (name === PROGRESS_OWNER_KEY && (++markerReads === 1 || failure === "always denied")) throw new DOMException("PRIVATE marker", "SecurityError");
      return real(name);
    });
    expect(await captureWordPreservation(h.options)).toBe("unavailable");
    expect(read.mock.calls.some(([name]) => name === oregonKey)).toBe(false);
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(typed(sources).filter(source => source.appId === "oregon-trail")).toHaveLength(1);
    expect(typed(sources).filter(source => source.appId === journalApp)).toHaveLength(5);
    expect(sources.some(source => source.raw === outer)).toBe(true);
    expect(sources.some(source => source.raw === "excluded-global-private")).toBe(false);
    expect(h.local.snapshot()).toEqual(before); await assertNoProjection(h);
  });

  it("stops marker-dependent field capture after marker access is denied following a durable raw copy", async () => {
    const h = await fixture(); h.local.setItem(oregonKey, oregonRaw); h.local.setItem(h.physical(weatherKey), h.outer(persist(legacyCases[1].state), weatherKey));
    const before = h.local.snapshot(), realCapture = h.words.capture.bind(h.words), realRead = h.local.getItem.bind(h.local);
    let denied = false;
    vi.spyOn(h.local, "getItem").mockImplementation(name => {
      if (denied && name === PROGRESS_OWNER_KEY) throw new DOMException("PRIVATE marker denied later", "SecurityError");
      return realRead(name);
    });
    vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      await realCapture(...args);
      if (capturedAt([args[0]], oregonKey).length) denied = true;
    });
    expect(await captureWordPreservation(h.options)).toBe("unavailable");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(capturedAt(sources, oregonKey)).toEqual([expect.objectContaining({ raw: oregonRaw, fields: [] })]);
    expect(typed(sources).filter(source => source.appId === "weather")).toHaveLength(1);
    expect(h.local.snapshot()).toEqual(before);
  });

  it("uses the caller's copied owner, lease and dependency references through legacy and journal capture", async () => {
    const h = await fixture(); await seedBoundaries(h);
    const before = h.local.snapshot(), options = { ...h.options, lease: { ...h.lease } };
    const pending = captureWordPreservation(options);
    options.ownerId = "preservation-owner-B"; options.lease.ownerKey = "guest"; options.lease.generation++;
    options.storage = () => undefined; options.authority = { isCurrent: () => false };
    options.words = { ownerEpoch: async () => 99, capture: async () => { throw new Error("mutated client"); } };
    options.journals = { ownerEpoch: async () => 99, isOwnerDeleted: () => true,
      checkpointPage: async () => { throw new Error("mutated client"); }, archivePage: async () => { throw new Error("mutated client"); } };
    expect(await pending).toBe("captured");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(typed(sources).some(source => source.appId === "oregon-trail")).toBe(true);
    expect(typed(sources).filter(source => source.appId === journalApp)).toHaveLength(10);
    expect(await h.words.listSources("guest")).toEqual([]); expect(h.local.snapshot()).toEqual(before);
  });

  it.each(["lease", "marker"])("checks an actual %s change while the account key resolves before observing values", async change => {
    const h = await fixture(); h.local.setItem(oregonKey, oregonRaw);
    const read = vi.spyOn(h.local, "getItem"), capture = vi.spyOn(h.words, "capture"), epoch = vi.spyOn(h.words, "ownerEpoch");
    const pending = captureWordPreservation(h.options);
    if (change === "lease") h.authority.revoke(); else h.local.setItem(PROGRESS_OWNER_KEY, "preservation-owner-B");
    expect(await pending).toBe("changed"); expect(capture).not.toHaveBeenCalled(); expect(epoch).not.toHaveBeenCalled();
    expect(read.mock.calls.some(([name]) => name === oregonKey)).toBe(false); expect(h.local.getItem(oregonKey)).toBe(oregonRaw);
  });

  it.each(boundaryStages)("checks an actual owner lease change after awaited %s", async stage => {
    const h = await fixture(); await seedBoundaries(h); const before = h.local.snapshot();
    const triggered = atBoundary(h, stage, () => h.authority.updateSession("authenticated", "preservation-owner-B"));
    expect(await captureWordPreservation(h.options)).toBe("changed"); expect(triggered()).toBe(true);
    expect(h.authority.isCurrent(h.lease)).toBe(false); expect(h.local.snapshot()).toEqual(before);
    const completed = await h.words.listSources(h.lease.ownerKey);
    expect(completed.every(source => source.ownerKey === h.lease.ownerKey)).toBe(true);
    expect(await h.words.listSources(await ownerKeyFor("preservation-owner-B"))).toEqual([]);
    await assertNoProjection(h);
  });

  it.each(boundaryStages)("checks a marker change after awaited %s without claiming the new marker's data", async stage => {
    const h = await fixture(); await seedBoundaries(h);
    const triggered = atBoundary(h, stage, () => h.local.setItem(PROGRESS_OWNER_KEY, "preservation-owner-B"));
    expect(await captureWordPreservation(h.options)).toBe("changed"); expect(triggered()).toBe(true);
    expect(h.authority.isCurrent(h.lease)).toBe(true);
    expect(h.local.getItem(PROGRESS_OWNER_KEY)).toBe("preservation-owner-B"); expect(h.local.getItem(h.physical())).toBe(h.outer(oregonRaw));
    expect(await h.words.listSources(await ownerKeyFor("preservation-owner-B"))).toEqual([]); await assertNoProjection(h);
  });

  it.each(["missing", "foreign"])("also fences a changed initially %s marker while scoped capture awaits", async initial => {
    const h = await fixture(); h.local.setItem(h.physical(), h.outer(oregonRaw));
    if (initial === "missing") h.local.removeItem(PROGRESS_OWNER_KEY); else h.local.setItem(PROGRESS_OWNER_KEY, "preservation-owner-B");
    const triggered = atBoundary(h, "legacy-outer", () => h.local.setItem(PROGRESS_OWNER_KEY, ownerId));
    expect(await captureWordPreservation(h.options)).toBe("changed"); expect(triggered()).toBe(true);
    expect(typed(await h.words.listSources(h.lease.ownerKey))).toEqual([]);
  });

  it.each(["words", "journals"] as const)("honors an existing real %s tombstone without a capture", async store => {
    const h = await fixture(); await seedBoundaries(h); await h[store].deleteOwner(h.lease.ownerKey);
    const capture = vi.spyOn(h.words, "capture");
    expect(await captureWordPreservation(h.options)).toBe("changed"); expect(capture).not.toHaveBeenCalled();
    expect(h.local.getItem(h.physical())).toBe(h.outer(oregonRaw));
  });

  it.each(boundaryStages.flatMap(stage => (["words", "journals"] as const).map(store => ({ stage, store }))))(
    "fences a real $store deletion at awaited $stage without resurrecting deleted sources", async ({ stage, store }) => {
      const h = await fixture(); await seedBoundaries(h); const before = h.local.snapshot();
      const triggered = atBoundary(h, stage, () => h[store].deleteOwner(h.lease.ownerKey), store === "words");
      expect(await captureWordPreservation(h.options)).toBe("changed"); expect(triggered()).toBe(true);
      expect(h.authority.isCurrent(h.lease)).toBe(true); expect(h.local.snapshot()).toEqual(before);
      if (store === "words") {
        expect(await h.words.ownerEpoch(h.lease.ownerKey)).toBe(1);
        expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]);
        expect(h.journals.isOwnerDeleted(h.lease.ownerKey)).toBe(false);
      } else {
        expect(h.journals.isOwnerDeleted(h.lease.ownerKey)).toBe(true);
        expect(await h.words.ownerEpoch(h.lease.ownerKey)).toBe(0);
      }
      expect(await captureWordPreservation(h.options)).toBe("changed");
      await assertNoProjection(h);
    },
  );

  it("detects actual word deletion during the outer final journal epoch read", async () => {
    const h = await fixture(); await seedBoundaries(h); const before = h.local.snapshot();
    const real = h.journals.ownerEpoch.bind(h.journals); let reads = 0, capturedBeforeDeletion = 0;
    vi.spyOn(h.journals, "ownerEpoch").mockImplementation(async key => {
      const epoch = await real(key);
      if (++reads === 4) {
        capturedBeforeDeletion = (await h.words.listSources(key)).length;
        await h.words.deleteOwner(key);
      }
      return epoch;
    });
    const result = await captureWordPreservation(h.options);
    expect(reads).toBe(4); expect(capturedBeforeDeletion).toBeGreaterThan(0);
    expect(h.authority.isCurrent(h.lease)).toBe(true); expect(h.journals.isOwnerDeleted(h.lease.ownerKey)).toBe(false);
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual([]); expect(h.local.snapshot()).toEqual(before);
    expect((await h.journals.get(h.lease.ownerKey, journalApp, "writer", 0))?.raw).toBe(envelope());
    expect(result).toBe("changed");
  });

  it.each([
    { label: "delegated helper", read: 3, doubleQueue: true },
    { label: "outer direct await", read: 4, doubleQueue: false },
  ])("checks actual queued journal deletion before the $label final word continuation", async ({ read, doubleQueue }) => {
    const h = await fixture(); await seedBoundaries(h); const before = h.local.snapshot();
    const real = h.words.ownerEpoch.bind(h.words); let reads = 0, deletion: Promise<void> | undefined;
    vi.spyOn(h.words, "ownerEpoch").mockImplementation(async key => {
      const epoch = await real(key);
      if (++reads === read) {
        const deleteOwner = () => { deletion = h.journals.deleteOwner(key); };
        queueMicrotask(() => { if (doubleQueue) queueMicrotask(deleteOwner); else deleteOwner(); });
      }
      return epoch;
    });
    const result = await captureWordPreservation(h.options);
    expect(deletion).toBeDefined(); await deletion;
    expect(h.authority.isCurrent(h.lease)).toBe(true); expect(await h.words.ownerEpoch(h.lease.ownerKey)).toBe(0);
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(sources.length).toBeGreaterThan(0); expect(sources.some(source => source.raw === oregonRaw)).toBe(true);
    expect(sources.some(source => source.raw === envelope())).toBe(true); expect(h.journals.isOwnerDeleted(h.lease.ownerKey)).toBe(true);
    const connection = (h.journals as unknown as { connection: IDBDatabase }).connection;
    const checkpointCount = await new Promise<number>((resolve, reject) => {
      const request = connection.transaction(["checkpoints"], "readonly").objectStore("checkpoints").index("owner").count(h.lease.ownerKey);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    expect(checkpointCount).toBe(0); expect(h.local.snapshot()).toEqual(before); expect(result).toBe("changed"); await assertNoProjection(h);
  });

  it.each(["value", "disappearance", "matching name", "previously absent global"])("detects a changed %s during the journal delegate", async change => {
    const h = await fixture(); await seedBoundaries(h);
    const triggered = atBoundary(h, "archive-page", () => {
      if (change === "value") h.local.setItem(h.physical(), "new exact bytes");
      else if (change === "disappearance") h.local.removeItem(h.physical());
      else if (change === "matching name") h.local.setItem(h.physical(weatherKey), h.outer("new variant", weatherKey));
      else h.local.setItem(weatherKey, persist(legacyCases[1].state));
    });
    expect(await captureWordPreservation(h.options)).toBe("changed"); expect(triggered()).toBe(true);
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(sources.some(source => source.raw === h.outer(oregonRaw))).toBe(true);
    expect(sources.some(source => source.raw === "new exact bytes" || source.raw === "new variant")).toBe(false);
    if (change === "value") expect(h.local.getItem(h.physical())).toBe("new exact bytes");
    else if (change === "disappearance") expect(h.local.getItem(h.physical())).toBeNull();
    await assertNoProjection(h);
  });

  it("rechecks physical fingerprints after the outer final word epoch await", async () => {
    const h = await fixture(); await seedBoundaries(h);
    const triggered = atBoundary(h, "final-word-epoch", () => h.local.setItem(h.physical(), "late replacement"));
    expect(await captureWordPreservation(h.options)).toBe("changed"); expect(triggered()).toBe(true);
    expect(h.local.getItem(h.physical())).toBe("late replacement");
    expect((await h.words.listSources(h.lease.ownerKey)).some(source => source.raw === h.outer(oregonRaw))).toBe(true);
  });

  it.each(["undefined getter", "throwing getter", "length", "index", "read"])("keeps physical %s failure unavailable and copies readable IDB sources", async failure => {
    const h = await fixture(); await h.put(envelope()); h.local.setItem(h.physical(), h.outer(oregonRaw));
    const before = h.local.snapshot(), checkpoints = vi.spyOn(h.journals, "checkpointPage");
    if (failure === "undefined getter") h.options.storage = () => undefined;
    else if (failure === "throwing getter") h.options.storage = () => { throw new DOMException("PRIVATE getter", "SecurityError"); };
    else if (failure === "length") vi.spyOn(h.local, "length", "get").mockImplementation(() => { throw new Error("PRIVATE length"); });
    else if (failure === "index") vi.spyOn(h.local, "key").mockImplementation(() => { throw new Error("PRIVATE index"); });
    else vi.spyOn(h.local, "getItem").mockImplementation(() => { throw new Error("PRIVATE read"); });
    expect(await captureWordPreservation(h.options)).toBe("unavailable"); expect(checkpoints).toHaveBeenCalled();
    expect(typed(await h.words.listSources(h.lease.ownerKey)).filter(source => source.appId === journalApp)).toHaveLength(5);
    expect(h.local.snapshot()).toEqual(before);
  });

  it.each(["null index", "duplicate index", "denied index"])("cannot report exhaustion for a %s and still preserves independently readable entries", async failure => {
    const h = await fixture(), name = h.physical(), outer = h.outer(oregonRaw);
    h.local.setItem(name, outer); h.local.setItem(h.physical(weatherKey), h.outer(persist(legacyCases[1].state), weatherKey));
    const before = h.local.snapshot(), real = h.local.key.bind(h.local);
    vi.spyOn(h.local, "key").mockImplementation(index => {
      if (index !== 2) return real(index);
      if (failure === "null index") return null;
      if (failure === "duplicate index") return name;
      throw new Error("PRIVATE denied index");
    });
    expect(await captureWordPreservation(h.options)).toBe("unavailable");
    expect((await h.words.listSources(h.lease.ownerKey)).some(source => source.raw === outer)).toBe(true);
    expect(h.local.snapshot()).toEqual(before);
  });

  it("treats a changing enumerated length as changed rather than silently exhausting it", async () => {
    const h = await fixture(); h.local.setItem(h.physical(), h.outer(oregonRaw));
    const length = h.local.length; let reads = 0;
    vi.spyOn(h.local, "length", "get").mockImplementation(() => ++reads === 1 ? length : length + 1);
    expect(await captureWordPreservation(h.options)).toBe("changed");
    expect(h.local.getItem(h.physical())).toBe(h.outer(oregonRaw));
  });

  it("does not let a denied source read hide an independently readable legacy save", async () => {
    const h = await fixture(), outer = h.outer(oregonRaw);
    h.local.setItem(h.physical(), outer); h.local.setItem(weatherKey, persist(legacyCases[1].state));
    const before = h.local.snapshot(), real = h.local.getItem.bind(h.local);
    vi.spyOn(h.local, "getItem").mockImplementation(name => {
      if (name === h.physical()) throw new DOMException("PRIVATE denied source", "SecurityError");
      return real(name);
    });
    expect(await captureWordPreservation(h.options)).toBe("unavailable");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(typed(sources).some(source => source.appId === "weather")).toBe(true);
    expect(sources.some(source => source.raw === outer)).toBe(false); expect(h.local.snapshot()).toEqual(before);
  });

  it("retains partial durable copies after quota failure, stops shared capture, and completes an idempotent retry", async () => {
    const h = await fixture(); await seedBoundaries(h);
    h.local.setItem(h.physical(weatherKey), h.outer(persist(legacyCases[1].state), weatherKey));
    const before = h.local.snapshot(), real = h.words.capture.bind(h.words); let calls = 0;
    const capture = vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      if (++calls === 4) throw new DOMException("PRIVATE raw in quota exception", "QuotaExceededError");
      await real(...args);
    });
    const pages = vi.spyOn(h.journals, "checkpointPage"), warn = vi.spyOn(console, "warn"), error = vi.spyOn(console, "error");
    expect(await captureWordPreservation(h.options)).toBe("unavailable"); expect(capture).toHaveBeenCalledTimes(4); expect(pages).not.toHaveBeenCalled();
    const partial = await h.words.listSources(h.lease.ownerKey);
    expect(partial).toHaveLength(3); expect(h.local.snapshot()).toEqual(before); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    capture.mockRestore();
    expect(await captureWordPreservation(h.options)).toBe("captured");
    const complete = await h.words.listSources(h.lease.ownerKey);
    expect(complete).toEqual(expect.arrayContaining(partial)); expect(new Set(complete.map(source => source.id)).size).toBe(complete.length);
    expect(await captureWordPreservation(h.options)).toBe("captured");
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual(complete); expect(h.local.snapshot()).toEqual(before); await assertNoProjection(h);
  });

  it("does not claim a source when its actual capture transaction aborts after the add request succeeds", async () => {
    const h = await fixture(); h.local.setItem(h.physical(), h.outer(oregonRaw));
    const before = h.local.snapshot(), real = h.words.capture.bind(h.words); let calls = 0;
    const capture = vi.spyOn(h.words, "capture").mockImplementation(async (...args) => {
      if (++calls !== 2) { await real(...args); return; }
      const add = IDBObjectStore.prototype.add;
      const abort = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...values: Parameters<IDBObjectStore["add"]>) {
        const request = add.apply(this, values);
        if (this.name === "sources") request.addEventListener("success", () => this.transaction.abort());
        return request;
      });
      try { await real(...args); } finally { abort.mockRestore(); }
    });
    expect(await captureWordPreservation(h.options)).toBe("unavailable"); expect(capture).toHaveBeenCalledTimes(2);
    const partial = await h.words.listSources(h.lease.ownerKey);
    expect(partial).toHaveLength(1); expect(partial[0]).toMatchObject({ raw: h.outer(oregonRaw), fields: [] });
    capture.mockRestore();
    expect(await captureWordPreservation(h.options)).toBe("captured");
    expect(await h.words.listSources(h.lease.ownerKey)).toEqual(expect.arrayContaining(partial));
    expect(h.local.snapshot()).toEqual(before); await assertNoProjection(h);
  });

  it("delegates all five journal sections, neighboring alternatives, IDB-only orphan variants and both page streams", async () => {
    const h = await fixture(), current = journal(), validOriginal = journal("old-writer", "old-"), future = journal("future", "future-", { version: 99 });
    const raw = envelope(current, [future, validOriginal, "broken retained original"]), outer = h.outer(raw, progressJournalKey(journalApp, "writer"));
    h.local.setItem(h.physical(progressJournalKey(journalApp, "writer")), outer); await h.put(raw);
    for (let index = 0; index < 100; index++) await h.put(`opaque-checkpoint-${index}`, `writer-${index}`, 0);
    const orphan = journal("orphan"), first = envelope(orphan, [], 4), second = envelope(orphan, [journal("old")], 5);
    await h.archive(first, orphan, "orphan"); await h.archive(second, orphan, "orphan");
    for (let index = 0; index < 100; index++) await h.archive(`opaque-archive-${index}`, "gone", `archive-${index}`);
    const before = h.local.snapshot(), checkpointPage = vi.spyOn(h.journals, "checkpointPage"), archivePage = vi.spyOn(h.journals, "archivePage");
    expect(await captureWordPreservation(h.options)).toBe("captured");
    expect(checkpointPage).toHaveBeenCalledTimes(2); expect(archivePage).toHaveBeenCalledTimes(2);
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(sources.filter(source => source.raw?.startsWith("opaque-checkpoint-") && source.sourceKey.includes("envelope"))).toHaveLength(100);
    expect(sources.filter(source => source.raw?.startsWith("opaque-archive-") && source.sourceKey.includes("envelope"))).toHaveLength(100);
    for (const variant of [first, second]) expect(sources.some(source => source.raw === variant && source.sourceKey.includes(journalOriginalId(variant)))).toBe(true);
    expect(typed(sources).filter(source => source.raw === current)).toHaveLength(10);
    expect(typed(sources).filter(source => source.raw === current).map(source => source.fields[0].value)).toEqual(
      expect.arrayContaining(["ack", "base", "sent", "live", "conflict"].map(id => [artwork(id)])),
    );
    expect(typed(sources).filter(source => source.raw === validOriginal)).toHaveLength(10);
    expect(typed(sources).some(source => source.raw === future)).toBe(false);
    for (const preserved of [outer, raw, future, "broken retained original"]) expect(sources.some(source => source.raw === preserved)).toBe(true);
    expect(typed(sources).filter(source => source.raw === current)[0].raw).toContain('"id": "immutable-request"');
    expect((await h.journals.get(h.lease.ownerKey, journalApp, "writer", 0))?.raw).toBe(raw);
    expect(await h.journals.archivedSources(h.lease.ownerKey, journalApp, journalSourceId(h.lease.ownerKey, journalApp, "orphan", orphan), 0)).toHaveLength(2);
    expect(h.local.snapshot()).toEqual(before); await assertNoProjection(h);
  });

  it("copies an oversized IDB-only checkpoint and orphan archive intact through the actual delegate", async () => {
    const h = await fixture(), huge = "opaque journal " + "x".repeat(256 * 1024 + 1);
    await h.put(huge, "huge", 0); await h.archive(huge, "gone", "orphan");
    const before = h.local.snapshot();
    expect(await captureWordPreservation(h.options)).toBe("captured");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(sources.some(source => source.raw === huge && source.sourceKey.includes("checkpoints"))).toBe(true);
    expect(sources.some(source => source.raw === huge && source.sourceKey.includes("archives"))).toBe(true);
    expect(typed(sources)).toEqual([]);
    expect((await h.journals.get(h.lease.ownerKey, journalApp, "huge", 0))?.raw).toBe(huge);
    expect(h.local.snapshot()).toEqual(before); await assertNoProjection(h);
  });

  it.each(["checkpoint", "archive"])("retains delegated %s read failure despite other successful copies", async stream => {
    const h = await fixture(); h.local.setItem(oregonKey, oregonRaw); await h.put(envelope()); await h.archive("opaque orphan", "gone", "orphan");
    const before = h.local.snapshot();
    if (stream === "checkpoint") vi.spyOn(h.journals, "checkpointPage").mockRejectedValue(new Error("PRIVATE checkpoint failure"));
    else vi.spyOn(h.journals, "archivePage").mockRejectedValue(new Error("PRIVATE archive failure"));
    expect(await captureWordPreservation(h.options)).toBe("unavailable");
    const sources = await h.words.listSources(h.lease.ownerKey);
    expect(typed(sources).some(source => source.appId === "oregon-trail")).toBe(true);
    if (stream === "checkpoint") expect(sources.some(source => source.raw === "opaque orphan")).toBe(true);
    else expect(typed(sources).filter(source => source.appId === journalApp)).toHaveLength(5);
    expect(h.local.snapshot()).toEqual(before);
  });

  it("keeps the delegate's known epoch-change result changed and stops further page work", async () => {
    const h = await fixture(); h.local.setItem(oregonKey, oregonRaw);
    const archives = vi.spyOn(h.journals, "archivePage");
    vi.spyOn(h.journals, "checkpointPage").mockRejectedValue(new Error("Journal owner epoch changed"));
    expect(await captureWordPreservation(h.options)).toBe("changed"); expect(archives).not.toHaveBeenCalled();
    expect((await h.words.listSources(h.lease.ownerKey)).some(source => source.raw === oregonRaw)).toBe(true);
  });
});
