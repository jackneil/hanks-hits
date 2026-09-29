import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  BLOCKED_TITLE_RULES,
  SAFE_LOOKALIKE_TITLES,
  findBlockedRule,
  normalizeTitle,
  type TitleCandidate,
} from "../lib/content-blocklist";

/**
 * Guardrail 1: Retro Arcade stays kid-safe for ages 6-14. No catalog may
 * list a title with blood, gore or sexual content (decision 2, issue #25).
 *
 * The test finds every catalog file in lib/ by its name, so a catalog for a
 * new console is checked with no change to this test. The rules and their
 * sources are in lib/content-blocklist.json.
 */

const LIB_DIR = join(__dirname, "..", "lib");

interface CatalogEntry extends TitleCandidate {
  id: string;
  filename: string;
}

function isCatalogEntry(value: unknown): value is CatalogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.displayName === "string" &&
    typeof entry.filename === "string"
  );
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

interface CatalogScan {
  catalogs: Map<string, CatalogEntry[]>;
  problems: string[];
}

/**
 * Reads the exports of one catalog module. An exported array that holds
 * objects must be a catalog, and every entry must have a string id,
 * displayName and filename. A module must export at least one catalog.
 * The scan reports each gap as a problem. It does not skip an export, so a
 * catalog with a different entry shape cannot pass with nothing checked.
 */
function scanCatalogModule(file: string, mod: Record<string, unknown>): CatalogScan {
  const catalogs = new Map<string, CatalogEntry[]>();
  const problems: string[] = [];
  for (const [exportName, value] of Object.entries(mod)) {
    if (!Array.isArray(value) || !value.some(isObject)) continue;
    const bad = value.filter((entry) => !isCatalogEntry(entry)).length;
    if (bad > 0) {
      problems.push(
        `${file} ${exportName}: ${bad} of ${value.length} entries have no string id, displayName and filename`
      );
      continue;
    }
    catalogs.set(`${file} ${exportName}`, value as CatalogEntry[]);
  }
  if (catalogs.size === 0 && problems.length === 0) {
    problems.push(`${file}: exports no array of catalog entries`);
  }
  return { catalogs, problems };
}

/** Every exported array of catalog entries in every lib/*catalog* module. */
async function scanCatalogs(): Promise<CatalogScan> {
  const catalogs = new Map<string, CatalogEntry[]>();
  const problems: string[] = [];
  const files = readdirSync(LIB_DIR).filter(
    (file) => /catalog/i.test(file) && /\.(ts|tsx|js)$/.test(file) && !file.endsWith(".d.ts")
  );
  for (const file of files) {
    const mod: Record<string, unknown> = await import(join(LIB_DIR, file));
    const scan = scanCatalogModule(file, mod);
    scan.catalogs.forEach((entries, key) => catalogs.set(key, entries));
    problems.push(...scan.problems);
  }
  return { catalogs, problems };
}

// The exact entries that issue #25 removed (2026-09-28). The Atari names are
// old ROM dump names; the Stella ROM database identified each one by MD5.
const REMOVED_ENTRIES: CatalogEntry[] = [
  { id: "snes-alien-3", displayName: "Alien 3", filename: "alien_3.smc" },
  { id: "snes-alien-vs-predator", displayName: "Alien vs. Predator", filename: "alien_vs_predator.smc" },
  { id: "snes-cannon-fodder", displayName: "Cannon Fodder", filename: "cannon_fodder.smc" },
  { id: "snes-doom", displayName: "Doom", filename: "doom.smc" },
  { id: "snes-killer-instinct", displayName: "Killer Instinct", filename: "killer_instinct.smc" },
  { id: "snes-mortal-kombat-1", displayName: "Mortal Kombat 1", filename: "mortal_kombat_1.smc" },
  { id: "snes-mortal-kombat-2", displayName: "Mortal Kombat 2", filename: "mortal_kombat_2.smc" },
  { id: "snes-mortal-kombat-3", displayName: "Mortal Kombat 3", filename: "mortal_kombat_3.smc" },
  { id: "snes-samurai-showdown", displayName: "Samurai Showdown", filename: "samurai_showdown.smc" },
  {
    id: "snes-super-fire-pro-wrestling-x-premium",
    displayName: "Super Fire Pro Wrestling X Premium",
    filename: "super_fire_pro_wrestling_x_premium.smc",
  },
  { id: "snes-super-smash-tv", displayName: "Super Smash TV", filename: "super_smash_tv.smc" },
  { id: "snes-wolfenstein-3d", displayName: "Wolfenstein 3D", filename: "wolfenstein_3d.smc" },
  { id: "atari2600-bachelor", displayName: "Bachelor", filename: "bachelor.bin" },
  { id: "atari2600-bachelor-party", displayName: "Bachelor Party", filename: "bachelor_party.bin" },
  { id: "atari2600-bachelorette-party", displayName: "Bachelorette Party", filename: "bachelorette_party.bin" },
  { id: "atari2600-beat-em-and-eat-em", displayName: "Beat 'Em & Eat 'Em", filename: "beat_em_and_eat_em.bin" },
  {
    id: "atari2600-bloodyhumanfreeway-ntsc",
    displayName: "BloodyHumanFreeway_NTSC",
    filename: "bloodyhumanfreeway_ntsc.bin",
  },
  { id: "atari2600-burning-desire", displayName: "Burning Desire", filename: "burning_desire.bin" },
  { id: "atari2600-cathouse-blues", displayName: "Cathouse Blues", filename: "cathouse_blues.bin" },
  { id: "atari2600-custers-revenge", displayName: "Custer's Revenge", filename: "custers_revenge.bin" },
  { id: "atari2600-custerev", displayName: "Custerev", filename: "custerev.bin" },
  { id: "atari2600-general-re-treat", displayName: "General Re-Treat", filename: "general_re_treat.bin" },
  { id: "atari2600-gigolo", displayName: "Gigolo", filename: "gigolo.bin" },
  { id: "atari2600-halloween", displayName: "Halloween", filename: "halloween.bin" },
  { id: "atari2600-harem", displayName: "Harem", filename: "harem.bin" },
  { id: "atari2600-jungle-fever", displayName: "Jungle Fever", filename: "jungle_fever.bin" },
  { id: "atari2600-knight-on-the-town", displayName: "Knight on the Town", filename: "knight_on_the_town.bin" },
  { id: "atari2600-lady-in-wading", displayName: "Lady in Wading", filename: "lady_in_wading.bin" },
  { id: "atari2600-philly-flasher", displayName: "Philly Flasher", filename: "philly_flasher.bin" },
  {
    id: "atari2600-texas-chainsaw-massacre",
    displayName: "Texas Chainsaw Massacre",
    filename: "texas_chainsaw_massacre.bin",
  },
  {
    id: "atari2600-texas-chainsaw-massacre-the",
    displayName: "Texas Chainsaw Massacre, The",
    filename: "texas_chainsaw_massacre_the.bin",
  },
  { id: "atari2600-x-man", displayName: "X-Man", filename: "x_man.bin" },
];

describe("Retro Arcade catalog content", () => {
  it("finds the catalog of every console that has one", async () => {
    const { catalogs, problems } = await scanCatalogs();
    // Guards the discovery: an empty scan would make the next test pass
    // with nothing checked.
    expect([...catalogs.keys()]).toEqual(
      expect.arrayContaining(["atari-2600-catalog.ts ATARI_2600_CATALOG", "snes-catalog.ts SNES_CATALOG"])
    );
    // A catalog file whose entries have a different shape is a failure,
    // not a file with nothing to check.
    expect(problems).toEqual([]);
  });

  it("reports a catalog module that it cannot check", () => {
    const good = { id: "snes-mario", displayName: "Mario", filename: "mario.smc" };
    expect(scanCatalogModule("ok-catalog.ts", { GAMES: [good], GENRES: ["rpg"], URL: "/api/roms" })).toEqual({
      catalogs: new Map([["ok-catalog.ts GAMES", [good]]]),
      problems: [],
    });
    expect(
      scanCatalogModule("renamed-catalog.ts", { GAMES: [{ id: "n64-doom", name: "Doom", rom: "doom.z64" }] })
        .problems
    ).toEqual(["renamed-catalog.ts GAMES: 1 of 1 entries have no string id, displayName and filename"]);
    expect(
      scanCatalogModule("mixed-catalog.ts", { GAMES: [good, { id: "snes-doom", displayName: "Doom" }] }).problems
    ).toEqual(["mixed-catalog.ts GAMES: 1 of 2 entries have no string id, displayName and filename"]);
    expect(scanCatalogModule("empty-catalog.ts", { GENRES: ["rpg"], GAMES: [] }).problems).toEqual([
      "empty-catalog.ts: exports no array of catalog entries",
    ]);
  });

  it("lists no blocked title in any catalog", async () => {
    const offenders: string[] = [];
    for (const [catalog, entries] of (await scanCatalogs()).catalogs) {
      for (const entry of entries) {
        const rule = findBlockedRule(entry);
        if (rule) offenders.push(`${catalog}: "${entry.displayName}" (${rule.id}: ${rule.reason})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("blocks every entry that issue #25 removed, including short ROM dump names", () => {
    const missed = REMOVED_ENTRIES.filter((entry) => findBlockedRule(entry) === null);
    expect(missed.map((entry) => entry.displayName)).toEqual([]);
  });

  it("does not block kid-safe titles that look like blocked titles", () => {
    const blocked = SAFE_LOOKALIKE_TITLES.filter((title) => findBlockedRule({ displayName: title }));
    expect(blocked).toEqual([]);
  });

  it("matches each rule against its own examples", () => {
    const misses: string[] = [];
    for (const rule of BLOCKED_TITLE_RULES) {
      expect(rule.examples.length, `${rule.id} has no examples`).toBeGreaterThan(0);
      for (const example of rule.examples) {
        if (!rule.pattern.test(normalizeTitle(example))) misses.push(`${rule.id}: ${example}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it("gives every rule a unique id, a reason and a web source", () => {
    const ids = BLOCKED_TITLE_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of BLOCKED_TITLE_RULES) {
      expect(rule.reason.trim().length, `${rule.id} has no reason`).toBeGreaterThan(0);
      expect(rule.source, `${rule.id} has no source`).toMatch(/^https?:\/\//);
      expect(["gore", "sexual"]).toContain(rule.category);
    }
  });

  it("reads a ROM file name without its extension and an id with its dashes", () => {
    expect(findBlockedRule({ displayName: "Unknown", filename: "halloween.bin" })?.id).toBe(
      "halloween-wizard-video"
    );
    expect(findBlockedRule({ displayName: "Unknown", id: "atari2600-custerev" })?.id).toBe(
      "custers-revenge"
    );
    expect(findBlockedRule({ displayName: "Room of Doom", filename: "room_of_doom.bin" })).toBeNull();
  });
});
