import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { PROGRESS_SCHEMAS } from "@/lib/progress-schemas";
import { STREAK_ALIASES } from "../definitions";
import { emptyWatermarks, evaluate } from "../evaluate";

/**
 * The streak trophies read ONLY the field names in STREAK_ALIASES. A game
 * that stores its best streak under a new name silently never awards them:
 * chess, checkers and quoridor stored "bestWinStreak" and their kids never
 * got a streak trophy (issue #30). These tests fix the class, not the one
 * name: they scan every progress schema and every game/app source file for
 * monotonic best-streak fields and require each one to be an alias.
 */

/** Monotonic "best ever" streak names: best*Streak, longest*Streak, max*Streak (and close kin). */
const MONOTONIC_STREAK = /^(?:best|longest|max|highest|top|biggest)[A-Za-z0-9]*Streak$/;

const SRC = join(__dirname, "..", "..", "..", "..");

type FoundField = { appId: string; path: string[] };

type ZodDefLike = {
  type?: string;
  shape?: Record<string, unknown>;
  innerType?: unknown;
  in?: unknown;
  out?: unknown;
  valueType?: unknown;
  element?: unknown;
  options?: unknown[];
  left?: unknown;
  right?: unknown;
};

function defOf(schema: unknown): ZodDefLike | undefined {
  return (schema as { _zod?: { def?: ZodDefLike } } | undefined)?._zod?.def;
}

/**
 * Walk a Zod 4 schema and report every object key, with its path. Record
 * values show as "*" and array items as "[]" in the path.
 */
function collectKeys(schema: unknown, path: string[], out: string[][], depth = 0): void {
  const def = defOf(schema);
  if (!def || depth > 20) return;
  switch (def.type) {
    case "object":
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        out.push([...path, key]);
        collectKeys(child, [...path, key], out, depth + 1);
      }
      return;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "catch":
    case "nonoptional":
      collectKeys(def.innerType, path, out, depth + 1);
      return;
    case "pipe":
      collectKeys(def.in, path, out, depth + 1);
      collectKeys(def.out, path, out, depth + 1);
      return;
    case "record":
      collectKeys(def.valueType, [...path, "*"], out, depth + 1);
      return;
    case "array":
      collectKeys(def.element, [...path, "[]"], out, depth + 1);
      return;
    case "union":
      for (const option of def.options ?? []) collectKeys(option, path, out, depth + 1);
      return;
    case "intersection":
      collectKeys(def.left, path, out, depth + 1);
      collectKeys(def.right, path, out, depth + 1);
      return;
    default:
      return;
  }
}

function schemaStreakFields(): FoundField[] {
  const found: FoundField[] = [];
  for (const [appId, schema] of Object.entries(PROGRESS_SCHEMAS)) {
    const paths: string[][] = [];
    collectKeys(schema, [], paths);
    for (const path of paths) {
      if (MONOTONIC_STREAK.test(path[path.length - 1])) found.push({ appId, path });
    }
  }
  return found;
}

/**
 * evaluate() reads the top level of the progress blob and one level into
 * plain nested objects (drum-machine's stats.padsHit). Anything deeper, or
 * inside a record or an array, it never sees.
 */
function evaluatorCanRead(path: string[]): boolean {
  if (path.some((part) => part === "*" || part === "[]")) return false;
  return path.length <= 2;
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Property names declared or set in game/app code: `name:` or `name?:` at the start of a line. */
function sourceStreakFields(): Map<string, string> {
  const fields = new Map<string, string>();
  const property = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/gm;
  for (const root of [join(SRC, "games"), join(SRC, "apps")]) {
    for (const file of collectSourceFiles(root)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(property)) {
        if (MONOTONIC_STREAK.test(match[1]) && !fields.has(match[1])) {
          fields.set(match[1], relative(SRC, file));
        }
      }
    }
  }
  return fields;
}

const aliases = new Set<string>(STREAK_ALIASES);

describe("STREAK_ALIASES covers every best-streak field (issue #30)", () => {
  it("the pattern means best-ever streaks, never a streak that can shrink", () => {
    for (const name of ["bestStreak", "bestWinStreak", "longestStreak", "maxStreak", "maxComboStreak"]) {
      expect(MONOTONIC_STREAK.test(name), name).toBe(true);
    }
    for (const name of ["currentStreak", "currentWinStreak", "streak", "streakBonus", "bestScore"]) {
      expect(MONOTONIC_STREAK.test(name), name).toBe(false);
    }
  });

  it("every alias is a best-ever streak name (a shrinking streak would re-award forever)", () => {
    for (const alias of STREAK_ALIASES) {
      expect(MONOTONIC_STREAK.test(alias), alias).toBe(true);
    }
  });

  it("every best-streak field in a progress schema is an alias the evaluator can read", () => {
    const found = schemaStreakFields();

    // Sanity: the scan works. These games carry best streaks today.
    const scannedApps = new Set(found.map((field) => field.appId));
    for (const appId of ["chess", "checkers", "quoridor", "wordle", "trivia", "virtual-pet"]) {
      expect(scannedApps.has(appId), `${appId} streak field not found by the scan`).toBe(true);
    }

    const missing = found.filter((field) => !aliases.has(field.path[field.path.length - 1]));
    expect(
      missing.map((field) => `${field.appId}: ${field.path.join(".")}`),
      "Add these best-streak fields to STREAK_ALIASES in shared/lib/achievements/definitions.ts"
    ).toEqual([]);

    const unreadable = found.filter((field) => !evaluatorCanRead(field.path));
    expect(
      unreadable.map((field) => `${field.appId}: ${field.path.join(".")}`),
      "evaluate() reads only the top level and one plain object deep; move these fields up or extend evaluate()"
    ).toEqual([]);
  });

  it("every best-streak field in game and app source is an alias", () => {
    const fields = sourceStreakFields();

    // Sanity: the scan works.
    expect(fields.has("bestWinStreak")).toBe(true);
    expect(fields.has("maxStreak")).toBe(true);

    const missing = [...fields.entries()]
      .filter(([name]) => !aliases.has(name))
      .map(([name, file]) => `${name} (${file})`);
    expect(
      missing,
      "Add these best-streak fields to STREAK_ALIASES in shared/lib/achievements/definitions.ts"
    ).toEqual([]);
  });
});

describe("board-game streak trophies (issue #30)", () => {
  for (const appId of ["chess", "checkers", "quoridor"]) {
    it(`${appId}: a best win streak of 3 awards the first streak trophy`, () => {
      const result = evaluate(
        appId,
        { gamesPlayed: 5, gamesWon: 4, currentWinStreak: 0, bestWinStreak: 3 },
        new Set(),
        emptyWatermarks()
      );
      expect(result.newUnlocks).toContain(`streak:${appId}:3`);
      expect(result.newUnlocks).not.toContain(`streak:${appId}:7`);
      expect(result.watermarks.apps[appId]).toMatchObject({ streak: 3, hasStreak: true });
    });
  }

  it("a current win streak alone awards nothing: it can shrink", () => {
    const result = evaluate(
      "chess",
      { gamesPlayed: 5, currentWinStreak: 9 },
      new Set(),
      emptyWatermarks()
    );
    expect(result.newUnlocks.some((id) => id.startsWith("streak:"))).toBe(false);
  });
});
