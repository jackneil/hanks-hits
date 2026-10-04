/**
 * Part B1 comparison against master, including approved legacy load decisions.
 *
 * Every cell of no-worse/harness.ts (the wave-3 deploy matrix: 33 stores x
 * two legacy save formats x a played or untouched device x a missing,
 * older, equal, newer or untouched account row; and per store a guest with a lot
 * of play, a blank device during an outage, play during the first GET,
 * a second tab, a session that changes to another kid, and a device after
 * an old-code sign-out) runs here with this checkout's useAuthSync and
 * stores. fixtures/no-worse-master.json holds the same cells run with
 * master's real code (scripts/legacy-saves/no-worse.sh). The bar:
 * - in every cell, the kid-visible values that this checkout loses are a
 *   subset of the values that master loses, except the four explicitly
 *   approved no-time legacy load decisions recorded in the fixture;
 * - in every cell with an untouched device, an untouched account row, a
 *   second tab or a second kid, this checkout loses fewer values than
 *   master, when master loses any.
 * Part C moves only reviewed personal fields to device storage. The test-side
 * boundary checks their remaining cloud-owned fields against the same original
 * leaf IDs; no-worse-local-words proves exact frozen sources and typed recovery
 * with the real owner authority and IndexedDB. A rename-only default pet keeps
 * its automatic birth anchor locally until gameplay gives it a cloud save.
 * The test prints the counts of each cell.
 */
import { vi } from "vitest";

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-20T13:00:00Z"));
});

const session = vi.hoisted(() => ({
  current: { data: null as null | { user: { id: string } }, status: "unauthenticated" as string },
}));
vi.mock("next-auth/react", () => ({
  useSession: () => session.current,
  signOut: vi.fn(async () => undefined),
  signIn: vi.fn(async () => undefined),
  SessionProvider: ({ children }: { children: unknown }) => children,
}));

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { ROLLBACK_COMMIT } from "@/__tests__/rollback-commit";
import approvedLegacyLoadDifferences from "@/__tests__/fixtures/approved-legacy-load-differences.json";
import masterFile from "@/__tests__/fixtures/no-worse-master.json";
import {
  afterCell,
  allCells,
  beforeCell,
  createContext,
  harnessHash,
  lostValues,
  type CellResult,
  type Family,
  type Inputs,
} from "@/__tests__/no-worse/harness";

const RERUN = "Run bash apps/web/scripts/legacy-saves/no-worse.sh (the master side of this test).";
const master = masterFile as unknown as {
  commit: string;
  harness: string;
  inputs: Inputs;
  results: Record<string, CellResult | { error: string }>;
};

import { cloudComparable, cloudApprovedLosses, remainingCloudLosses } from "./no-worse/word-boundary";

const ctx = createContext(session);
const cells = allCells();
const rows: Array<{ id: string; family: Family; master: number; b1: number }> = [];
// NO_WORSE_OUT=<file>: also write each cell's lost values here (to read a failure).
const lostHere: Record<string, string[]> = {};

beforeEach(() => beforeCell(ctx));
afterEach(() => afterCell());

afterAll(() => {
  if (process.env.NO_WORSE_OUT) writeFileSync(process.env.NO_WORSE_OUT, JSON.stringify(lostHere, null, 1) + "\n");
  if (rows.length === 0) return;
  const families = new Map<Family, { cells: number; master: number; b1: number; fewer: number }>();
  for (const row of rows) {
    const sum = families.get(row.family) ?? { cells: 0, master: 0, b1: 0, fewer: 0 };
    sum.cells += 1;
    sum.master += row.master;
    sum.b1 += row.b1;
    if (row.b1 < row.master) sum.fewer += 1;
    families.set(row.family, sum);
  }
  const lines = [
    `no-worse-than-master: ${rows.length} cells (master ${master.commit}); lost kid-visible values per cell: master -> this checkout`,
    ...rows.map((row) => `  ${row.id}: ${row.master} -> ${row.b1}`),
    "Approved legacy-load decisions: 4 cells, 18 original recorded differences; device-word retention has a separate real-runtime proof. All other cloud-owned losses fail.",
    "per family (cells, values lost by master, values lost here, cells with fewer losses here):",
    ...[...families].map(([family, sum]) => `  ${family}: ${sum.cells} cells, ${sum.master} -> ${sum.b1}, fewer in ${sum.fewer}`),
  ];
  // stdout directly: the cells mock console.log.
  process.stdout.write(lines.join("\n") + "\n");
});

describe("the master side", () => {
  it("comes from the master commit of the rollback proof, and from this harness", () => {
    expect(master.commit, RERUN).toBe(ROLLBACK_COMMIT);
    expect(master.harness, RERUN).toBe(harnessHash());
    expect(Object.keys(master.results).sort(), RERUN).toEqual(cells.map((cell) => cell.id).sort());
    const errors = Object.entries(master.results).filter(([, result]) => "error" in result);
    expect(errors).toEqual([]);
  });
});

describe("comparison with master and the approved legacy load decisions", () => {
  it.each(cells.map((cell) => [cell.id, cell] as const))("%s", async (id, cell) => {
    const before = master.results[id];
    if (!before || "error" in before) throw new Error(`${id}: no master result. ${RERUN}`);
    const previousDebug = process.env.NO_WORSE_DEBUG;
    process.env.NO_WORSE_DEBUG = "1";
    let now: CellResult;
    try { now = await cell.run(ctx, master.inputs[cell.appId]); }
    finally {
      if (previousDebug === undefined) delete process.env.NO_WORSE_DEBUG;
      else process.env.NO_WORSE_DEBUG = previousDebug;
    }
    if (!now.debug) throw new Error("The cloud-boundary comparison requires original sources and final evidence.");
    const input = master.inputs[cell.appId];
    now.lost = remainingCloudLosses(cell.appId, now.lost, now.debug, input.defaults,
      cell.family === "tab" ? [input.account] : []);
    for (const post of ctx.server.posts) expect(post.data, `${id}: outgoing progress excludes only reviewed device words`)
      .toEqual(cloudComparable(post.appId, post.data as Record<string, unknown>));
    rows.push({ id, family: cell.family, master: before.lost.length, b1: now.lost.length });
    lostHere[id] = now.lost;
    const known = new Set(before.lost);
    const worse = now.lost.filter((value) => !known.has(value));
    // Jack approved one timestamp on load for these no-time legacy saves on
    // 2026-10-02. Only the exact four recorded differences are accepted.
    // This is not a generic exemption for conflicting wallets or journeys.
    const approved = cloudApprovedLosses(cell.appId, (approvedLegacyLoadDifferences as Record<string, string[]>)[id] ?? [], input.defaults);
    expect(worse, `${id}: differences from master beyond the approved decision`).toEqual(approved);
    if (cell.untouchedOrTab && before.lost.length > 0) {
      expect(now.lost.length, `${id}: an untouched device, a second tab or a second kid loses fewer values`).toBeLessThan(
        before.lost.length
      );
    }
  });
});

describe("per family", () => {
  it("each family loses no more values than master in total", () => {
    expect(rows.length, "the cells ran first").toBe(cells.length);
    const totals = new Map<Family, { master: number; here: number }>();
    for (const row of rows) {
      const sum = totals.get(row.family) ?? { master: 0, here: 0 };
      sum.master += row.master;
      sum.here += row.b1;
      totals.set(row.family, sum);
    }
    for (const [family, sum] of totals) {
      // Touched/guest and deferred B2 gap cases retain master's LWW behavior.
      // Strict improvement for genuinely untouched and tab cells is checked above.
      expect(sum.here, `${family}: values lost here, against master`).toBeLessThanOrEqual(sum.master);
    }
  });
});


describe("loss comparison follows field meaning", () => {
  it("does not call a reversed purchase preserved because the wallet grew", () => {
    expect(lostValues("cookie-clicker", { kid: { cookies: 13 } }, { cookies: 83 }, { cookies: 0 }))
      .toEqual(["kid:cookies=13"]);
  });
  it("keeps higher scores and lower positive best times", () => {
    expect(lostValues("snake", { kid: { highScore: 13 } }, { highScore: 83 }, { highScore: 0 })).toEqual([]);
    expect(lostValues("memory-match", { kid: { bestTimes: { easy: 13 } } }, { bestTimes: { easy: 10 } }, { bestTimes: { easy: null } })).toEqual([]);
    expect(lostValues("memory-match", { kid: { bestTimes: { easy: 13 } } }, { bestTimes: { easy: 20 } }, { bestTimes: { easy: null } })).toEqual(["kid:bestTimes.easy=13"]);
  });
});

describe("the Part C comparison retains every cloud-owned field guard", () => {
  it("keeps only an otherwise-default renamed pet's automatic birth anchor device-local", () => {
    const defaults = master.inputs["virtual-pet"].defaults;
    const renamed = structuredClone(defaults) as Record<string, unknown>;
    renamed.pet = { ...(renamed.pet as Record<string, unknown>), name: "Local nickname", bornAt: "2026-09-01T12:00:00.000Z", lastChecked: "2026-09-01T12:00:00.000Z" };
    renamed.settings = { ...(renamed.settings as Record<string, unknown>), petName: "Local nickname" };
    renamed.lastModified = 123;
    const sources = { device: renamed };
    const losses = lostValues("virtual-pet", sources, null, defaults);
    expect(losses).toContain('device:pet.bornAt="2026-09-01T12:00:00.000Z"');
    expect(remainingCloudLosses("virtual-pet", losses, { sources, final: null }, defaults)).toEqual([]);
    const played = [
      { ...renamed, coins: Number(renamed.coins) + 1 },
      { ...renamed, stats: { ...(renamed.stats as Record<string, unknown>), totalPlaySessions: 1 } },
      { ...renamed, pet: { ...(renamed.pet as Record<string, unknown>), speciesId: "pupper" } },
      { ...renamed, inventory: [{ itemId: "apple", quantity: 1 }] },
    ];
    for (const source of played) {
      const lost = lostValues("virtual-pet", { device: source }, null, defaults);
      expect(remainingCloudLosses("virtual-pet", lost, { sources: { device: source }, final: null }, defaults))
        .toContain('device:pet.bornAt="2026-09-01T12:00:00.000Z"');
    }
  });

  it("does not count a retained local name as lost from an otherwise intact cloud party", () => {
    const sources = { device: { party: [{ id: "m0", name: "Personal name", health: "good", sickDays: 0 }] } };
    const final = { party: [{ id: "m0", name: "", health: "good", sickDays: 0 }] };
    const original = lostValues("oregon-trail", sources, final, { party: [] });
    expect(original).toHaveLength(1);
    expect(remainingCloudLosses("oregon-trail", original, { sources, final }, { party: [] })).toEqual([]);
    expect(remainingCloudLosses("oregon-trail", original, { sources, final: { party: [] } }, { party: [] })).toEqual(original);
    expect(remainingCloudLosses("oregon-trail", original, { sources, final: { party: [{ ...final.party[0], health: "poor" }] } }, { party: [] })).toEqual(original);
  });

  it("keeps pet birth identity and list IDs in the original loss measure", () => {
    const sources = { device: { pet: { speciesId: "blobby", bornAt: "2026-09-01T12:00:00.000Z", name: "Personal name" } } };
    const final = { pet: { speciesId: "blobby", bornAt: "2026-10-01T12:00:00.000Z", name: "" } };
    const original = lostValues("virtual-pet", sources, final, {});
    expect(remainingCloudLosses("virtual-pet", original, { sources, final }, {})).toEqual(['device:pet.bornAt="2026-09-01T12:00:00.000Z"']);
    const toySources = { device: { wishlistItems: [{ toyId: "toy-one", notes: "Personal note", priority: "want" }] } };
    const toyLost = lostValues("toy-finder", toySources, { wishlistItems: [] }, {});
    expect(remainingCloudLosses("toy-finder", toyLost, { sources: toySources, final: { wishlistItems: [] } }, {})).toEqual(toyLost);
  });
});

// This recorded B1 oracle compares reconciliation using the same legacy saves
// and cells as master. Real namespace/auth lifecycle coverage lives separately;
// the hashed cross-version harness and its loss assertions stay unchanged.
vi.mock("@/lib/owner-bound-progress", async () => {
  const { useSession: readSession } = await import("next-auth/react");
  const { createSyncOwnerFixture } = await import("@/shared/hooks/__tests__/ownerProgressFixture");
  return createSyncOwnerFixture(readSession);
});
vi.mock("@/lib/owner-bound-progress/persistStorage", async () => {
  const { createJSONStorage } = await import("zustand/middleware");
  return { createOwnerPersistStorage: () => createJSONStorage(() => localStorage) };
});


// Historical cells model cloud reconciliation and use raw fixture owner IDs.
// The real local-word authority cannot run against that mocked owner controller.
// Exact frozen bytes and typed device recovery are proven by the companion
// no-worse-local-words test, with the real authority and real IndexedDB adapter.
vi.mock("@/lib/local-words/consumer", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/local-words/consumer")>(),
  bindWordConsumer: () => () => {},
}));
