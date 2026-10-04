/** Companion to B1's unchanged frozen bytes: Part C must retain device words. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import old86 from "./fixtures/legacy-saves.json";
import old904 from "./fixtures/legacy-saves-904bc09.json";
import master from "./fixtures/no-worse-master.json";
import { cloudComparable } from "./no-worse/cloud-word-contract";
import type { WordAppId, WordEdit } from "@/lib/local-words/contracts";
import type { SourceRecord, WordRecord } from "@/lib/local-words/database";

const loaders = {
  "oregon-trail": async () => (await import("@/games/oregon-trail/lib/store")).useOregonTrailStore,
  weather: async () => (await import("@/apps/weather/lib/store")).useWeatherStore,
  "toy-finder": async () => (await import("@/apps/toy-finder/lib/store")).useToyFinderStore,
  "drawing-app": async () => (await import("@/apps/drawing-app/lib/store")).useDrawingStore,
  "drum-machine": async () => (await import("@/apps/drum-machine/lib/store")).useDrumMachineStore,
  "virtual-pet": async () => (await import("@/apps/virtual-pet/lib/store")).useVirtualPetStore,
  "four-wheeler-3d": async () => (await import("@/games/four-wheeler-3d/lib/store")).useFourWheeler3dStore,
};
const apps = Object.keys(loaders) as WordAppId[];
const old = { "86a1fe0": old86.saves, "904bc09": old904.saves } as Record<string, Record<string, Record<string, unknown>>>;
const inputs = master.inputs as Record<string, { guestRaw: string; account: Record<string, unknown> }>;
const cases = Object.entries(old).flatMap(([format, saves]) => apps.flatMap(app =>
  ["played", "untouched"].map(kind => ({ label: `${format} ${app} ${kind}`, app, raw: JSON.stringify(saves[app][kind]) }))));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function containsEdits(records: readonly WordRecord[], edits: readonly WordEdit[]) {
  for (const edit of edits) expect(records).toContainEqual(expect.objectContaining(edit));
}

async function begin(app: WordAppId, raw?: string, sourceIsGuest = false) {
  const { localWords } = await import("@/lib/local-words");
  const { ownerBoundProgress } = await import("@/lib/owner-bound-progress");
  const { legacyWordSources } = await import("@/lib/local-words/inventory");
  const { LocalWordsDatabase } = await import("@/lib/local-words/database");
  const key = legacyWordSources[app];
  if (raw !== undefined) localStorage.setItem(key, raw);
  if (!sourceIsGuest) localStorage.setItem("hanks-hits-progress-owner", "user-1");
  localWords.install();
  const store = await loaders[app]();
  await ownerBoundProgress.updateSession("authenticated", "user-1");
  await ownerBoundProgress.whenHydrated(key);
  const lease = localWords.captureLease()!;
  expect(await localWords.prepare(app, lease)).toBe("durable");
  const database = new LocalWordsDatabase();
  return { localWords, ownerBoundProgress, store, lease, database, key };
}

async function proveTypedRecovery(app: WordAppId, source: SourceRecord, context: Awaited<ReturnType<typeof begin>>) {
  const { wordRecoveryActions, markWordRecoverySynced } = await import("@/shared/lib/localWordRecovery");
  const actions = wordRecoveryActions(app)!;
  const mapped = actions.mapCandidate(source);
  if (mapped?.length) containsEdits(context.localWords.read(app, context.lease), mapped);
  else if (source.fields.length && actions.confirmUnmatched && actions.previewCandidate?.(source)?.length) {
    // Legacy Oregon IDs remain absent until a real explicit recovery choice.
    expect(context.store.getState()).not.toHaveProperty("journeyId", expect.any(String));
    markWordRecoverySynced(app, context.lease);
    expect(await actions.confirmUnmatched(source, context.lease)).toBe("durable");
    const state = context.store.getState() as unknown as { journeyId: string };
    expect(state.journeyId).toMatch(/^[0-9a-f]{32}$/);
    const chosen = actions.mapCandidate({ ...source, fields: source.fields.map(field => ({ ...field, identity: { ...field.identity, journeyId: state.journeyId } })) });
    expect(chosen?.length).toBeGreaterThan(0);
    containsEdits(context.localWords.read(app, context.lease), chosen!);
  } else if (source.fields.length) {
    const choices = actions.candidateChoices?.(source);
    if (choices?.length) {
      expect(await context.localWords.commitCandidate(app, source.id, choices[0].edits, context.lease, "confirmed-choice")).toBe("durable");
      containsEdits(context.localWords.read(app, context.lease), choices[0].edits);
    } else {
      // Unsupported identities remain exact recoverable evidence, never guessed.
      expect(context.localWords.candidates(app, context.lease)).toContainEqual(source);
    }
  }
  const retained = [...await context.database.listSources(context.lease.ownerKey), ...await context.database.listCommittedSources(context.lease.ownerKey)];
  expect(retained).toContainEqual(source);
}

describe("Part C preservation of the exact B1 frozen sources", () => {
  it.each(cases)("$label", async ({ app, raw }) => {
    const f = await begin(app, raw);
    try {
      const sources = [...await f.database.listSources(f.lease.ownerKey), ...await f.database.listCommittedSources(f.lease.ownerKey)];
      const source = sources.find(value => value.sourceKey === f.key);
      expect(source).toBeDefined();
      expect(source!.raw).toBe(raw);
      expect(localStorage.getItem(f.key)).toBe(raw);
      const { extractLegacyWordSource } = await import("@/lib/local-words/inventory");
      expect(source!.fields).toEqual(extractLegacyWordSource(app, raw)?.fields ?? []);
      await proveTypedRecovery(app, source!, f);
      const progress = f.store.getState().getProgress() as Record<string, unknown>;
      expect(progress).toEqual(cloudComparable(app, progress));
      if (app === "virtual-pet") {
        const original = JSON.parse(raw).state.progress as { pet: { name: string; bornAt: string }; lastModified?: number };
        const petStore = f.store as unknown as {
          getState(): { progress: { pet: { name: string; bornAt: string }; stats: unknown }; setProgress(data: Record<string, unknown>): void };
          persist: { rehydrate(): Promise<void> | void };
        };
        expect(petStore.getState().progress.pet).toMatchObject({ name: original.pet.name, bornAt: original.pet.bornAt });
        expect(f.ownerBoundProgress.flushStore(f.key, f.lease)).toBe(true);
        const physical = "hh-progress:v2:" + JSON.stringify([f.lease.ownerKey, f.key]);
        const inner = JSON.parse(JSON.parse(localStorage.getItem(physical)!).raw).state.progress;
        expect(inner.pet).toMatchObject({ name: "", bornAt: original.pet.bornAt });
        await petStore.persist.rehydrate();
        expect(petStore.getState().progress.pet).toMatchObject({ name: original.pet.name, bornAt: original.pet.bornAt });
        // A real account pet wins independently; the previous local name remains
        // bound to its original birth and cannot rename the account's other pet.
        const canonical = cloudComparable(app, inputs[app].account);
        petStore.getState().setProgress(canonical);
        expect(petStore.getState().progress.pet.bornAt).toBe((canonical.pet as Record<string, unknown>).bornAt);
        expect(petStore.getState().progress.stats).toEqual(canonical.stats);
        expect(await f.database.readWords(f.lease.ownerKey, app)).toContainEqual(expect.objectContaining({
          entityKey: JSON.stringify(["pet", (original.pet as unknown as { speciesId: string }).speciesId, original.pet.bornAt]),
          field: "name", value: original.pet.name,
        }));
        expect(f.localWords.candidates(app, f.lease)).toContainEqual(source);
      }
    } finally { f.database.close(); }
  });

  it.each(apps)("keeps %s frozen guest bytes private instead of admitting their words to an account", async app => {
    const raw = inputs[app].guestRaw;
    const f = await begin(app, raw, true);
    try {
      const sources = [...await f.database.listSources("guest"), ...await f.database.listCommittedSources("guest")];
      expect(sources).toContainEqual(expect.objectContaining({ ownerKey: "guest", appId: app, sourceKey: f.key, raw }));
      expect(f.localWords.candidates(app, f.lease).every(source => source.ownerKey === f.lease.ownerKey)).toBe(true);
      expect(await f.database.readWords(f.lease.ownerKey, app)).toEqual([]);
      expect(localStorage.getItem(f.key)).toBe(raw);
    } finally { f.database.close(); }
  });

  it.each(apps)("retains the frozen %s account's personal fields through owner-checked cloud recovery", async app => {
    const f = await begin(app);
    try {
      const { extractProgressWords } = await import("@/lib/progress-words");
      const fields = extractProgressWords(app, inputs[app].account).fields;
      const payload = { fields };
      const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({ "x-hh-expected-owner": "user-1" });
        return new Response(JSON.stringify({ appId: app, candidates: [{ sourceRevision: "a".repeat(64), extractionVersion: 1, payload }] }));
      });
      vi.stubGlobal("fetch", fetch);
      expect(await f.localWords.recover(app, "user-1", f.lease)).toBe(fields.length ? "captured" : "empty");
      if (fields.length) {
        const source = f.localWords.candidates(app, f.lease).find(source => source.sourceKey.startsWith("cloud:"));
        expect(source).toMatchObject({ raw: JSON.stringify(payload), fields });
        await proveTypedRecovery(app, source!, f);
      }
    } finally { f.database.close(); }
  });
});
