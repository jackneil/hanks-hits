import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { isClearedOnSignOut } from "../storage-keys";

/**
 * Every localStorage key a game/app hands to useAuthSync MUST be cleared by
 * signOutAndClear() — otherwise the next kid to sign in on a shared family
 * computer inherits (and uploads) the previous kid's progress. This test scans
 * the real source tree so a new game can't silently reintroduce the leak
 * (2026-07-10 review: five "-state" keys had slipped through the suffix nets).
 *
 * Scope: the scan matches STRING-LITERAL localStorageKey values (every synced
 * game today uses one). A key passed via a const/variable would evade the
 * regex — if that pattern ever appears, extend the scan.
 */

const SRC_ROOTS = [
  join(__dirname, "..", "..", "games"),
  join(__dirname, "..", "..", "apps"),
];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function collectSyncKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const root of SRC_ROOTS) {
    for (const file of collectSourceFiles(root)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/localStorageKey:\s*["']([^"']+)["']/g)) {
        keys.set(match[1], file);
      }
    }
  }
  return keys;
}

describe("signOutAndClear coverage", () => {
  it("clears every localStorage key wired into useAuthSync", () => {
    const keys = collectSyncKeys();

    // Sanity: the scan itself works (30+ synced games/apps exist)
    expect(keys.size).toBeGreaterThan(20);

    const leaked = [...keys.entries()].filter(
      ([key]) => !isClearedOnSignOut(key)
    );
    expect(
      leaked,
      `These sync keys survive logout and would leak the previous user's progress: ${leaked
        .map(([key, file]) => `${key} (${file})`)
        .join(", ")} — add them to GAME_STORAGE_KEYS in storage-keys.ts`
    ).toEqual([]);
  });

  it("covers the five bare '-state' keys that slipped past the suffix nets", () => {
    for (const key of [
      "arkanoid-state",
      "bomberman-state",
      "drum-machine-state",
      "hank-chess-state",
      "virtual-pet-state",
    ]) {
      expect(isClearedOnSignOut(key), key).toBe(true);
    }
  });
});
