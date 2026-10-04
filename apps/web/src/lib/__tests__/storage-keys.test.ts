import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { clearGameStorage, isClearedOnSignOut } from "../storage-keys";

/** Keep the legacy logical-key inventory complete for owner-bound discovery.
 * Classification never grants permission to delete frozen legacy evidence. */

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

describe("legacy progress-key inventory", () => {
  it("retains legacy bytes and owner evidence even through the compatibility clear API", () => {
    localStorage.setItem("oregon-trail-storage", "original");
    localStorage.setItem("hanks-hits-progress-owner", "A");
    clearGameStorage();
    expect(localStorage.getItem("oregon-trail-storage")).toBe("original");
    expect(localStorage.getItem("hanks-hits-progress-owner")).toBe("A");
    localStorage.clear();
  });

  it("recognizes every logical key wired into useAuthSync", () => {
    const keys = collectSyncKeys();

    // Sanity: the scan itself works (30+ synced games/apps exist)
    expect(keys.size).toBeGreaterThan(20);

    const leaked = [...keys.entries()].filter(
      ([key]) => !isClearedOnSignOut(key)
    );
    expect(
      leaked,
      `These sync keys are missing from the legacy inventory: ${leaked
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
