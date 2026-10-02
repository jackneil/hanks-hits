import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";

import type { AppProgressData } from "@hank-neil/db";
import { PROGRESS_SCHEMAS } from "@/lib/progress-schemas";
import { PROGRESS_FIELD_RULES, type FieldDirection } from "@/lib/progress-field-rules";
import { mergeForSave, __legacyNameRulesForTests } from "@/lib/progress-merge";
import { extractGameStats } from "@/shared/lib/gameStatExtractor";
import { LEADERBOARD_EXTRACTORS } from "@/lib/leaderboard-extractors";
import { sampleBlob, schemaUnits, unitOf, type Unit } from "./schema-units";

/**
 * The reviewed direction table (progress-field-rules.ts) against the schemas.
 *
 * The server's old merge kept only the fields whose NAME matched a pattern
 * (high..., best..., games...). It missed every highest... field, most
 * total... counters, every record inside an object, and every best time.
 * A merge then put an older save's better values back to the newer save's
 * (wave 3 F1: hill-climb totalCoinsEarned 9000 became 110). The table names
 * every field instead, and these tests keep it complete and honest.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type AppId = keyof typeof PROGRESS_FIELD_RULES;
const APPS = Object.keys(PROGRESS_SCHEMAS) as AppId[];

const schemaOf = (appId: AppId) => PROGRESS_SCHEMAS[appId] as z.ZodType;
const tableOf = (appId: AppId): Record<string, FieldDirection> => PROGRESS_FIELD_RULES[appId];
const subtreesOf = (appId: AppId) =>
  new Set(Object.entries(tableOf(appId)).filter(([, d]) => d.subtree).map(([p]) => p));
const unitsOf = (appId: AppId): Unit[] => schemaUnits(schemaOf(appId), subtreesOf(appId));

/**
 * A name that reads like a record or a tally. A field with such a name that
 * keeps the base's value must say, with a store line, what makes it go down.
 */
const RECORD_NAME =
  /^(high|highest|best|max|longest|most|biggest|fastest|top|total|games|lowest|shortest|min|perfect|successful)(?=[A-Z0-9_]|$)|(Won|Wins|Played|Completed|Collected|Destroyed|Defeated|Killed|Hit|Earned|Caught|Reached|Created|Solved|Matched|Spawned|Dropped|Placed|Captured|Crossed|Encountered|Hunted|Landings|Losses|Lost|Drawn|Streak|Stars|Points|Viewed|Copied|Shared|Answered|Correct|Traveled|Rested|Count|Counts)$|^(trophies|crashes|medals|unlocked|achievements|trophyCounts)$/;

const CITATION = /([\w./-]+\.tsx?):(\d+)(?: `([^`]+)`)?/;

const looksLikeRecord = (unitPath: string) =>
  unitPath
    .split(".")
    .filter((seg) => seg !== "*")
    .some((seg) => RECORD_NAME.test(seg));

describe("progress field rules: the table names every field of every schema", () => {
  it("has a table for exactly the apps that have a schema", () => {
    expect(Object.keys(PROGRESS_FIELD_RULES).sort()).toEqual([...APPS].sort());
  });

  it.each(APPS)("%s: every schema field is in the table, and every table entry is a schema field", (appId) => {
    const unitPaths = unitsOf(appId).map((unit) => unit.path).sort();
    expect(Object.keys(tableOf(appId)).sort()).toEqual(unitPaths);
  });

  it.each(APPS)("%s: each rule fits the type of its field", (appId) => {
    const table = tableOf(appId);
    for (const unit of unitsOf(appId)) {
      const { rule } = table[unit.path];
      const fits: Record<FieldDirection["rule"], Unit["kind"][]> = {
        max: ["number", "boolean", "numberList"],
        minPositive: ["number"],
        earliest: ["number"],
        union: ["primitiveList"],
        neither: ["number", "boolean", "text", "any", "numberList", "primitiveList", "list", "subtree"],
      };
      expect(fits[rule], `${appId} ${unit.path} (${unit.kind}) cannot take ${rule}`).toContain(unit.kind);
    }
  });

  it.each(APPS)("%s: a field named like a record either merges as one, or cites the line that makes it go down", (appId) => {
    const table = tableOf(appId);
    for (const unit of unitsOf(appId)) {
      if (!looksLikeRecord(unit.path)) continue;
      const direction = table[unit.path];
      if (direction.rule !== "neither") continue;
      expect(direction.why, `${appId} ${unit.path} is named like a record but keeps the base's value with no proof`).toMatch(CITATION);
    }
  });

  it.each(APPS)("%s: each proof cites a real store line and code that is in that file", (appId) => {
    for (const [unitPath, direction] of Object.entries(tableOf(appId))) {
      const match = CITATION.exec(direction.why);
      if (direction.rule !== "neither") {
        expect(match, `${appId} ${unitPath}: a ${direction.rule} entry needs "file:line \`code\`"`).not.toBeNull();
        expect(match?.[3], `${appId} ${unitPath}: cite the code in backticks`).toBeTruthy();
      }
      if (!match) continue;
      const [, file, line, code] = match;
      const full = path.join(SRC, file);
      expect(existsSync(full), `${appId} ${unitPath}: ${file} does not exist`).toBe(true);
      const text = readFileSync(full, "utf8");
      expect(Number(line), `${appId} ${unitPath}: ${file} has no line ${line}`).toBeLessThanOrEqual(text.split("\n").length);
      if (code) expect(text, `${appId} ${unitPath}: ${file} no longer has \`${code}\``).toContain(code);
    }
  });

  it("keeps every merge that the old name rules made (the table only adds)", () => {
    const { isMonotonicKey, UNLOCKABLE_KEY, UNLOCKABLE_RECORD_KEY } = __legacyNameRulesForTests;
    for (const appId of APPS) {
      const table = tableOf(appId);
      for (const unit of unitsOf(appId)) {
        const segs = unit.path.split(".");
        const top = segs[0];
        const where = `${appId} ${unit.path}`;
        if (segs.length === 1 && unit.kind === "number" && top === "bestRaceTimeMs") {
          expect(table[unit.path].rule, where).toBe("minPositive");
        } else if (segs.length === 1 && unit.kind === "number" && isMonotonicKey(top)) {
          expect(table[unit.path].rule, where).toBe("max");
        } else if (segs.length === 1 && unit.kind === "primitiveList" && UNLOCKABLE_KEY.test(top)) {
          expect(table[unit.path].rule, where).toBe("union");
        } else if (segs.length === 2 && segs[1] === "*" && unit.kind === "number" && UNLOCKABLE_RECORD_KEY.test(top)) {
          expect(table[unit.path].rule, where).toBe("earliest");
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The merge does what the table says, for every field
// ---------------------------------------------------------------------------

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Set a unit's value in a sample blob ("*" is the sample key "k"). */
function setAt(blob: Record<string, unknown>, unitPath: string, value: unknown) {
  const segs = unitPath.split(".").map((seg) => (seg === "*" ? "k" : seg));
  let node = blob;
  for (const seg of segs.slice(0, -1)) node = node[seg] as Record<string, unknown>;
  node[segs[segs.length - 1]] = value;
}

function getAt(blob: Record<string, unknown>, unitPath: string): unknown {
  return unitPath
    .split(".")
    .map((seg) => (seg === "*" ? "k" : seg))
    .reduce<unknown>((node, seg) => (node as Record<string, unknown>)[seg], blob);
}

/** The newer save holds `worse`, the older save holds `better`; the merge result at the path. */
function mergeWorseNewerBetterOlder(appId: AppId, unitPath: string, worse: unknown, better: unknown) {
  const sample = sampleBlob(schemaOf(appId)) as Record<string, unknown>;
  const newer = clone(sample);
  const older = clone(sample);
  setAt(newer, unitPath, worse);
  setAt(older, unitPath, better);
  newer.lastModified = 2_000;
  older.lastModified = 1_000;
  delete newer.updatedAt;
  delete older.updatedAt;
  // The older save arrives; the newer one is the stored row.
  const result = mergeForSave(older as AppProgressData, { data: newer as AppProgressData, updatedAt: new Date(2_000) }, appId);
  expect(result.base).toBe("server");
  return getAt(result.data as Record<string, unknown>, unitPath);
}

describe("progress merge follows the table for every field", () => {
  const cases = APPS.flatMap((appId) =>
    unitsOf(appId)
      .filter((unit) => unit.path !== "lastModified" && unit.path !== "updatedAt")
      .map((unit) => [appId, unit.path, unit.kind, tableOf(appId)[unit.path].rule] as const)
  );

  it.each(cases.filter(([, , kind, rule]) => rule === "max" && kind === "number"))(
    "%s %s: max keeps the older save's larger number",
    (appId, unitPath) => {
      expect(mergeWorseNewerBetterOlder(appId, unitPath, 3, 900)).toBe(900);
    }
  );

  it.each(cases.filter(([, , kind, rule]) => rule === "max" && kind === "boolean"))(
    "%s %s: max keeps a flag that the older save turned on",
    (appId, unitPath) => {
      expect(mergeWorseNewerBetterOlder(appId, unitPath, false, true)).toBe(true);
    }
  );

  it.each(cases.filter(([, , kind, rule]) => rule === "max" && kind === "numberList"))(
    "%s %s: max keeps the larger count at each place",
    (appId, unitPath) => {
      expect(mergeWorseNewerBetterOlder(appId, unitPath, [0, 4, 1], [0, 2, 9])).toEqual([0, 4, 9]);
    }
  );

  it.each(cases.filter(([, , , rule]) => rule === "minPositive"))(
    "%s %s: minPositive keeps the older save's better (lower) record, and a record over none",
    (appId, unitPath) => {
      expect(mergeWorseNewerBetterOlder(appId, unitPath, 500, 120)).toBe(120);
      expect(mergeWorseNewerBetterOlder(appId, unitPath, 0, 120)).toBe(120);
      expect(mergeWorseNewerBetterOlder(appId, unitPath, 120, 0)).toBe(120);
    }
  );

  it.each(cases.filter(([, , , rule]) => rule === "earliest"))(
    "%s %s: earliest keeps the older save's earlier time",
    (appId, unitPath) => {
      expect(mergeWorseNewerBetterOlder(appId, unitPath, 500, 120)).toBe(120);
    }
  );

  it.each(cases.filter(([, , , rule]) => rule === "union"))(
    "%s %s: union keeps the items that only the older save has",
    (appId, unitPath) => {
      expect(mergeWorseNewerBetterOlder(appId, unitPath, ["a"], ["a", "b"])).toEqual(["a", "b"]);
    }
  );

  it.each(cases.filter(([, , kind, rule]) => rule === "neither" && kind === "number"))(
    "%s %s: neither keeps the newer save's number",
    (appId, unitPath) => {
      expect(mergeWorseNewerBetterOlder(appId, unitPath, 3, 900)).toBe(3);
    }
  );

  it("copies a record entry that only the older save has (a level, a stage, a trophy)", () => {
    const platformer = sampleBlob(schemaOf("platformer")) as Record<string, unknown>;
    const newer = { ...clone(platformer), levels: {}, lastModified: 2_000 };
    const older = {
      ...clone(platformer),
      levels: { "1-1": { completed: true, starsCollected: 3, bestTime: 40_000, coinsCollected: 12 } },
      lastModified: 1_000,
    };
    const result = mergeForSave(older as AppProgressData, { data: newer as AppProgressData, updatedAt: new Date(2_000) }, "platformer");
    expect(result.data.levels).toEqual(older.levels);
  });

  it("a hostile __proto__ key in a record cannot reach Object.prototype", () => {
    const hostile = JSON.parse(
      '{"bestDistancePerStage":{"__proto__":{"polluted":1},"desert":5},"lastModified":1000}'
    );
    const result = mergeForSave(hostile, { data: { bestDistancePerStage: { countryside: 3 }, lastModified: 2000 }, updatedAt: new Date(2000) }, "hill-climb");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(Object.keys(result.data.bestDistancePerStage as object).sort()).toEqual(["__proto__", "countryside", "desert"]);
  });
});

// ---------------------------------------------------------------------------
// Every field that the profile page and the leaderboards read is in the table
// ---------------------------------------------------------------------------

/** A deep proxy that writes down the path of every field that is read. */
function recordReads(blob: Record<string, unknown>, reads: Set<string>, prefix = ""): Record<string, unknown> {
  return new Proxy(blob, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string") return value;
      const at = prefix ? `${prefix}.${prop}` : prop;
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return recordReads(value as Record<string, unknown>, reads, at);
      }
      reads.add(at);
      return value;
    },
  });
}

describe("every field that gameStatExtractor and the leaderboards read is in the table", () => {
  for (const [label, read] of [
    ["gameStatExtractor", (appId: AppId, data: Record<string, unknown>) => extractGameStats(appId, data, new Date(0).toISOString())],
    ["leaderboard-extractors", (appId: AppId, data: Record<string, unknown>) => LEADERBOARD_EXTRACTORS[appId]?.(data)],
  ] as const) {
    it.each(APPS)(`${label}: %s`, (appId) => {
      const reads = new Set<string>();
      read(appId, recordReads(sampleBlob(schemaOf(appId)) as Record<string, unknown>, reads));
      const units = unitsOf(appId);
      const table = tableOf(appId);
      // The Trophy Case has no card of its own: it falls to the generic
      // default of extractGameStats, which tries highScore, then score.
      if (label === "gameStatExtractor" && appId === "achievements") {
        expect([...reads].sort()).toEqual(["highScore", "score"]);
        return;
      }
      for (const concrete of reads) {
        const unit = unitOf(units, concrete);
        expect(unit, `${label} reads ${appId} "${concrete}", a field that the schema does not have`).toBeDefined();
        expect(table[unit!.path], `${label} reads ${appId} "${concrete}", which the table does not name`).toBeDefined();
      }
    });
  }
});
