import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  CONTENT_RULES,
  SAFE_LOOKALIKE_TITLES,
  findBlockRule,
  findContentRule,
  findNoticeRule,
  normalizeTitle,
  type TitleCandidate,
} from "../lib/content-rules";

/**
 * Guardrail 1: Retro Arcade stays kid-safe. Each content rule has an action
 * (Jack, 2026-10-02):
 * - block (sexual content): no catalog may list the title;
 * - notice (mainstream violent classics): the catalog lists the title like
 *   any other game, and the arcade shows a heads-up card when a player
 *   opens it.
 *
 * The test finds every catalog file in lib/ by its name, so a catalog for a
 * new console is checked with no change to this test. The rules and their
 * sources are in lib/content-rules.json.
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

// The 16 violent classics that issue #25 removed on 2026-09-28 and that Jack
// brought back on 2026-10-02, as they were in the catalogs. Their ROM files
// are the 16 "gore" keys of the bucket.
const NOTICE_ENTRIES: CatalogEntry[] = [
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
  {
    id: "atari2600-bloodyhumanfreeway-ntsc",
    displayName: "BloodyHumanFreeway_NTSC",
    filename: "bloodyhumanfreeway_ntsc.bin",
  },
  { id: "atari2600-halloween", displayName: "Halloween", filename: "halloween.bin" },
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
];

// The 16 adult cartridges that stay out (sexual content). The Atari names
// are old ROM dump names; the Stella ROM database identified each one by MD5.
const BLOCKED_ENTRIES: CatalogEntry[] = [
  { id: "atari2600-bachelor", displayName: "Bachelor", filename: "bachelor.bin" },
  { id: "atari2600-bachelor-party", displayName: "Bachelor Party", filename: "bachelor_party.bin" },
  { id: "atari2600-bachelorette-party", displayName: "Bachelorette Party", filename: "bachelorette_party.bin" },
  { id: "atari2600-beat-em-and-eat-em", displayName: "Beat 'Em & Eat 'Em", filename: "beat_em_and_eat_em.bin" },
  { id: "atari2600-burning-desire", displayName: "Burning Desire", filename: "burning_desire.bin" },
  { id: "atari2600-cathouse-blues", displayName: "Cathouse Blues", filename: "cathouse_blues.bin" },
  { id: "atari2600-custers-revenge", displayName: "Custer's Revenge", filename: "custers_revenge.bin" },
  { id: "atari2600-custerev", displayName: "Custerev", filename: "custerev.bin" },
  { id: "atari2600-general-re-treat", displayName: "General Re-Treat", filename: "general_re_treat.bin" },
  { id: "atari2600-gigolo", displayName: "Gigolo", filename: "gigolo.bin" },
  { id: "atari2600-harem", displayName: "Harem", filename: "harem.bin" },
  { id: "atari2600-jungle-fever", displayName: "Jungle Fever", filename: "jungle_fever.bin" },
  { id: "atari2600-knight-on-the-town", displayName: "Knight on the Town", filename: "knight_on_the_town.bin" },
  { id: "atari2600-lady-in-wading", displayName: "Lady in Wading", filename: "lady_in_wading.bin" },
  { id: "atari2600-philly-flasher", displayName: "Philly Flasher", filename: "philly_flasher.bin" },
  { id: "atari2600-x-man", displayName: "X-Man", filename: "x_man.bin" },
];

// The sexual-content rules as they were before 2026-10-02. Jack kept them
// all: a rule may be added, but none of these may lose its block action or
// change its pattern.
const PINNED_BLOCK_RULES: { id: string; pattern: string }[] = [
  { id: "conkers-bad-fur-day", pattern: "conker\\W*s?\\s*bad\\s*fur\\s*day" },
  { id: "custers-revenge", pattern: "\\bcuster" },
  { id: "general-re-treat", pattern: "general\\s*re\\s*treat" },
  { id: "westward-ho", pattern: "^westward\\s*ho(?!\\w)" },
  { id: "bachelor-party", pattern: "\\bbachelor" },
  { id: "beat-em-and-eat-em", pattern: "beat\\W*em\\W+(?:and\\W+)?eat\\W*em" },
  { id: "philly-flasher", pattern: "philly\\s*flasher" },
  { id: "burning-desire", pattern: "burning\\s*desire" },
  { id: "cathouse-blues", pattern: "cathouse" },
  { id: "gigolo", pattern: "\\bgigolo\\b" },
  { id: "jungle-fever", pattern: "jungle\\s*fever" },
  { id: "knight-on-the-town", pattern: "knight\\s*on\\s*the\\s*town" },
  { id: "lady-in-wading", pattern: "lady\\s*in\\s*wading" },
  { id: "harem", pattern: "\\bharem\\b" },
  { id: "x-man-universal-gamex", pattern: "\\bx\\s*man(?!\\w)" },
  { id: "panesian-adult-nes", pattern: "bubble\\s*bath\\s*babes|peek\\s*a\\s*boo\\s*poker|^hot\\s*slots$" },
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
        const rule = findBlockRule(entry);
        if (rule) offenders.push(`${catalog}: "${entry.displayName}" (${rule.id}: ${rule.reason})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lists none of the 16 adult cartridges, by id or by ROM file", async () => {
    const ids = new Set(BLOCKED_ENTRIES.map((entry) => entry.id));
    const files = new Set(BLOCKED_ENTRIES.map((entry) => entry.filename));
    const found: string[] = [];
    for (const [catalog, entries] of (await scanCatalogs()).catalogs) {
      for (const entry of entries) {
        if (ids.has(entry.id) || files.has(entry.filename)) found.push(`${catalog}: ${entry.id}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("lists the 16 violent classics again, as they were (Jack, 2026-10-02)", async () => {
    const listed = new Map<string, CatalogEntry>();
    for (const entries of (await scanCatalogs()).catalogs.values()) {
      for (const entry of entries) listed.set(entry.id, entry);
    }
    for (const expected of NOTICE_ENTRIES) {
      const entry = listed.get(expected.id);
      expect(entry, expected.id).toBeDefined();
      expect({ id: entry?.id, displayName: entry?.displayName, filename: entry?.filename }).toEqual(expected);
    }
  });

  it("gives each of the 16 violent classics a notice rule, never a block rule", () => {
    for (const entry of NOTICE_ENTRIES) {
      expect(findBlockRule(entry), entry.id).toBeNull();
      expect(findNoticeRule(entry)?.action, entry.id).toBe("notice");
    }
  });

  it("blocks every adult cartridge, including short ROM dump names", () => {
    const missed = BLOCKED_ENTRIES.filter((entry) => findBlockRule(entry) === null);
    expect(missed.map((entry) => entry.displayName)).toEqual([]);
  });

  it("keeps every sexual-content rule a block rule with its old pattern", () => {
    for (const pinned of PINNED_BLOCK_RULES) {
      const rule = CONTENT_RULES.find((candidate) => candidate.id === pinned.id);
      expect(rule, pinned.id).toBeDefined();
      expect(rule?.action, pinned.id).toBe("block");
      expect(rule?.pattern.source, pinned.id).toBe(pinned.pattern);
    }
    // Every rule about sexual content blocks: no rule may only warn.
    const weak = CONTENT_RULES.filter((rule) => rule.category === "sexual" && rule.action !== "block");
    expect(weak.map((rule) => rule.id)).toEqual([]);
  });

  it("applies a block rule before a notice rule", () => {
    const both = { displayName: "Mortal Kombat Bachelor Party", filename: "mk_bachelor.bin" };
    expect(findContentRule(both)?.id).toBe("bachelor-party");
    expect(findBlockRule(both)?.id).toBe("bachelor-party");
    expect(findNoticeRule(both)).toBeNull();
  });

  it("matches no rule on kid-safe titles that look like matched titles", () => {
    const matched = SAFE_LOOKALIKE_TITLES.filter((title) => findContentRule({ displayName: title }));
    expect(matched).toEqual([]);
  });

  it("matches each rule against its own examples", () => {
    const misses: string[] = [];
    for (const rule of CONTENT_RULES) {
      expect(rule.examples.length, `${rule.id} has no examples`).toBeGreaterThan(0);
      for (const example of rule.examples) {
        if (!rule.pattern.test(normalizeTitle(example))) misses.push(`${rule.id}: ${example}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it("gives every rule a unique id, a reason, a web source, a category and an action", () => {
    const ids = CONTENT_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of CONTENT_RULES) {
      expect(rule.reason.trim().length, `${rule.id} has no reason`).toBeGreaterThan(0);
      expect(rule.source, `${rule.id} has no source`).toMatch(/^https?:\/\//);
      expect(["gore", "sexual"]).toContain(rule.category);
      expect(["block", "notice"]).toContain(rule.action);
    }
  });

  it("reads a ROM file name without its extension and an id with its dashes", () => {
    expect(findContentRule({ displayName: "Unknown", filename: "halloween.bin" })).toMatchObject({
      id: "halloween-wizard-video",
      action: "notice",
    });
    expect(findContentRule({ displayName: "Unknown", id: "atari2600-custerev" })).toMatchObject({
      id: "custers-revenge",
      action: "block",
    });
    expect(findContentRule({ displayName: "Room of Doom", filename: "room_of_doom.bin" })).toBeNull();
  });
});
