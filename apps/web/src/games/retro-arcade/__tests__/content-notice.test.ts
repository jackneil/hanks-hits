// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { renderNoticeModule } from "../../../../scripts/contentNoticeGen";
import {
  CONTENT_RULE_DATA,
  CONTENT_RULES,
  SAFE_LOOKALIKE_TITLES,
  findBlockRule,
  findContentRule,
  findNoticeRule,
} from "../lib/content-rules";
import { CONTENT_NOTICE_TEXT, findOpenNoticeRule } from "../lib/contentNotice";
import { SNES_CATALOG } from "../lib/snes-catalog";
import { ATARI_2600_CATALOG } from "../lib/atari-2600-catalog";

/**
 * The heads-up card (Jack, 2026-10-02) reads the notice rules in the
 * browser. These tests keep the browser's copy the same as the rule data,
 * keep the block rules out of the browser, and keep one gate in front of
 * every game start.
 */

const WEB_DIR = resolve(__dirname, "..", "..", "..", "..");
const SRC_DIR = join(WEB_DIR, "src");
const ARCADE_DIR = join(SRC_DIR, "games", "retro-arcade");
const REPO_DIR = resolve(WEB_DIR, "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules" && name !== "__tests__") out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.(test|spec)\.[a-z]+$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

describe("Retro Arcade notice rules in the browser", () => {
  it("has the generated file of the notice rules that content-rules.json holds", () => {
    const committed = readFileSync(join(ARCADE_DIR, "lib", "content-notice.generated.ts"), "utf-8");
    // On a failure, run: pnpm --filter web generate:content-notice
    expect(committed).toBe(renderNoticeModule(CONTENT_RULE_DATA));
  });

  it("puts every notice rule, and no block rule, in the browser's copy", () => {
    const generated = readFileSync(join(ARCADE_DIR, "lib", "content-notice.generated.ts"), "utf-8");
    for (const rule of CONTENT_RULES) {
      const listed = generated.includes(`id: ${JSON.stringify(rule.id)},`);
      expect(listed, rule.id).toBe(rule.action === "notice");
    }
  });

  it("finds the same notice titles in the browser as the full rules do", () => {
    const titles = [
      ...SNES_CATALOG,
      ...ATARI_2600_CATALOG,
      ...SAFE_LOOKALIKE_TITLES.map((displayName) => ({ displayName })),
      ...CONTENT_RULES.filter((rule) => rule.action === "notice").flatMap((rule) =>
        rule.examples.map((displayName) => ({ displayName }))
      ),
    ];
    const differ = titles.filter((title) => Boolean(findOpenNoticeRule(title)) !== Boolean(findNoticeRule(title)));
    expect(differ.map((title) => title.displayName)).toEqual([]);
    // 12 SNES and 4 Atari classics are in the catalogs (Jack, 2026-10-02).
    expect(SNES_CATALOG.filter((game) => findOpenNoticeRule(game))).toHaveLength(12);
    expect(ATARI_2600_CATALOG.filter((game) => findOpenNoticeRule(game))).toHaveLength(4);
  });

  it("reads the name of an uploaded file", () => {
    for (const name of ["Mortal Kombat II (USA).sfc", "doom.smc", "DOOM (Europe).sfc", "halloween.bin"]) {
      expect(findOpenNoticeRule({ displayName: name, filename: name }), name).not.toBeNull();
    }
    for (const name of ["bucket.smc", "Super Mario World (USA).sfc", "room_of_doom.bin"]) {
      expect(findOpenNoticeRule({ displayName: name, filename: name }), name).toBeNull();
    }
  });

  // A ROM dump name ends in tags: No-Intro "Halloween (USA).a26", GoodTools
  // "Halloween (1983) (Wizard Video Games) [!].a26". The rules were written
  // for catalog names, so a rule anchored at the end ("^halloween$") missed
  // the dump name of an upload, and the game opened with no card.
  const dumpNames = (title: string) => [
    `${title} (USA).sfc`,
    `${title} (1983) (Wizard Video Games) [!].a26`,
    `${title} [!].bin`,
  ];

  it("reads a dump name with its tags, for every notice rule example", () => {
    for (const rule of CONTENT_RULES.filter((entry) => entry.action === "notice")) {
      for (const example of rule.examples) {
        for (const name of dumpNames(example)) {
          expect(findOpenNoticeRule({ displayName: name, filename: name })?.id, name).toBe(rule.id);
        }
      }
    }
  });

  it("matches no safe title with dump tags, and blocks every block example with them", () => {
    for (const title of SAFE_LOOKALIKE_TITLES) {
      for (const name of dumpNames(title)) {
        expect(findContentRule({ displayName: name, filename: name })?.id ?? null, name).toBeNull();
      }
    }
    for (const rule of CONTENT_RULES.filter((entry) => entry.action === "block")) {
      for (const example of rule.examples) {
        for (const name of dumpNames(example)) {
          expect(findBlockRule({ displayName: name, filename: name })?.id, name).toBe(rule.id);
        }
      }
    }
  });

  it("keeps the block rules out of the browser bundle", () => {
    // Only the ROM proxy (server code) and content-rules.ts itself may
    // import the full rules. A client module that imports them would ship
    // the sexual-content rules to every player.
    const allowed = new Set([
      join(SRC_DIR, "app", "api", "roms", "[...path]", "route.ts"),
      join(ARCADE_DIR, "lib", "content-rules.ts"),
    ]);
    const importers = sourceFiles(SRC_DIR)
      .filter((file) => /from\s+["'][^"']*content-rules(\.json)?["']/.test(readFileSync(file, "utf-8")))
      .filter((file) => !allowed.has(file))
      .map((file) => relative(SRC_DIR, file));
    expect(importers).toEqual([]);
  });

  it("has one caller of startGame: the gate in Game.tsx", () => {
    // Every way to open a game goes through openGame and the heads-up card.
    // A second caller of startGame could start a violent classic with no
    // card. store.ts defines startGame, so it does not count.
    const callers: string[] = [];
    for (const file of sourceFiles(ARCADE_DIR)) {
      if (file.endsWith(join("lib", "store.ts"))) continue;
      const count = readFileSync(file, "utf-8").match(/\.startGame\(/g)?.length ?? 0;
      for (let i = 0; i < count; i++) callers.push(relative(ARCADE_DIR, file));
    }
    expect(callers).toEqual(["Game.tsx"]);
    // No module outside the arcade imports the arcade and starts a game.
    const outside = sourceFiles(SRC_DIR)
      .filter((file) => !file.startsWith(ARCADE_DIR))
      .filter((file) => {
        const text = readFileSync(file, "utf-8");
        return /games\/retro-arcade/.test(text) && /\.startGame\(/.test(text);
      })
      .map((file) => relative(SRC_DIR, file));
    expect(outside).toEqual([]);
    const game = readFileSync(join(ARCADE_DIR, "Game.tsx"), "utf-8");
    expect(game).toMatch(
      /const launchGame = \(request: OpenRequest\) => \{\s*setPendingOpen\(null\);\s*store\.startGame\(request\.rom, request\.name, request\.system\);\s*\};/
    );
  });

  it("writes the card with no em-dash and no en-dash", () => {
    for (const [key, text] of Object.entries(CONTENT_NOTICE_TEXT)) {
      expect(text, key).not.toMatch(/[–—]/);
    }
  });
});

describe("the content rules that the Python generators read", () => {
  const python = readFileSync(join(REPO_DIR, "scripts", "retro_content_rules.py"), "utf-8");

  it("reads content-rules.json", () => {
    const path = /RULES_PATH = \(\s*([\s\S]*?)\n\)/.exec(python)?.[1] ?? "";
    const parts = [...path.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(parts).toEqual(["apps", "web", "src", "games", "retro-arcade", "lib", "content-rules.json"]);
    const data = JSON.parse(readFileSync(join(REPO_DIR, ...parts), "utf-8")) as {
      rules: { id: string; category: string; action: string }[];
    };
    expect(data.rules.length).toBe(CONTENT_RULES.length);
    for (const rule of data.rules) {
      expect(["block", "notice"], rule.id).toContain(rule.action);
      if (rule.category === "sexual") expect(rule.action, rule.id).toBe("block");
    }
  });

  it("refuses only block rules in blocked_rule(), with block before notice", () => {
    const blocked = /def blocked_rule\([^)]*\):\n([\s\S]*?)\n\n/.exec(python)?.[1] ?? "";
    expect(blocked).toMatch(/rule\["action"\] == "block"/);
    const content = /def content_rule\([^)]*\):\n([\s\S]*?)\n\n/.exec(python)?.[1] ?? "";
    expect(content).toMatch(/if rule\["action"\] == "block":\s*\n\s*return rule/);
  });

  it("normalizes a title the same way as normalizeTitle()", () => {
    const normalize = /def normalize\(text: str\) -> str:\n([\s\S]*?)\n\n/.exec(python)?.[1] ?? "";
    expect(normalize).toContain('re.sub(r"[_-]+", " ", text.lower())');
    expect(normalize).toContain('re.sub(r"\\s+", " ", text).strip()');
  });

  it("removes the dump tags the same way as content-match.ts", () => {
    // The same pattern in both: from the first "(" or "[" to the end.
    const tags = /def without_dump_tags\(text: str\) -> str:\n([\s\S]*?)\n\n/.exec(python)?.[1] ?? "";
    expect(tags).toContain('re.sub(r"\\s*[(\\[].*$", "", text)');
    const match = readFileSync(join(ARCADE_DIR, "lib", "content-match.ts"), "utf-8");
    expect(match).toContain('text.replace(/\\s*[([].*$/, "")');
    // Each name is read twice: as it is, and with no tags.
    const texts = /def candidate_texts\([^)]*\) -> list:\n([\s\S]*?)\n\n/.exec(python)?.[1] ?? "";
    expect(texts).toMatch(/normalize\(text\), normalize\(without_dump_tags\(text\)\)/);
    const content = /def content_rule\([^)]*\):\n([\s\S]*?)\n\n/.exec(python)?.[1] ?? "";
    expect(content).toContain("candidate_texts(display_name, filename, game_id)");
  });
});
