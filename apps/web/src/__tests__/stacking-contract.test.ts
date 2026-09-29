import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { EMULATOR_VIEW_Z } from "@/games/retro-arcade/Game";
import { CLIP_SHEET_Z_INDEX } from "@/shared/clips/ui/Sheet";
import { TOAST_SLOT_Z_INDEX } from "@/shared/clips/ui/ToastSlot";
import { RESULT_CHIP_Z_INDEX } from "@/shared/components/ResultChip";

// The stacking contract of the site lives in one list, in
// design/ARCHITECTURE.md ("Stacking order"). Two branches once drifted from
// it: the achievement celebration took z-[1100], the level of the Retro
// Arcade's full-screen emulator view, so page order alone decided which one
// drew on top, and the comment next to EMULATOR_VIEW_Z said the opposite of
// what the page did. This test reads the list and the code and fails when
// they disagree, or when code uses a level that the list does not name.

const SRC = path.resolve(__dirname, "..");
const DOC = path.resolve(SRC, "../../../design/ARCHITECTURE.md");

interface DocLevel {
  level: number;
  /** "60 or less": the game tier, any level up to this one. */
  orLess: boolean;
  text: string;
}

/** The "Stacking order" list of design/ARCHITECTURE.md, in doc order. */
function documentedLevels(): DocLevel[] {
  const lines = readFileSync(DOC, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("**Stacking order (z-index, low to high):**"));
  expect(start, "design/ARCHITECTURE.md has no Stacking order list").toBeGreaterThan(-1);
  const levels: DocLevel[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" && levels.length === 0) continue;
    const entry = /^- (\d+)( or less)?: (.*)$/.exec(line);
    if (entry) {
      levels.push({ level: Number(entry[1]), orLess: Boolean(entry[2]), text: entry[3] });
    } else if (line.startsWith("  ") && levels.length > 0) {
      levels[levels.length - 1].text += ` ${line.trim()}`;
    } else {
      break;
    }
  }
  return levels;
}

/** Source text without comments, so a level named in prose does not count. */
function code(file: string): string {
  return readFileSync(path.join(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every z level in the text: Tailwind z-[n], inline zIndex: n, CSS z-index: n. */
function zLevels(text: string): number[] {
  return [...text.matchAll(/\bz-\[(\d+)\]|\bzIndex:\s*["']?(\d+)|\bz-index:\s*(\d+)/g)].map((m) =>
    Number(m[1] ?? m[2] ?? m[3]),
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx|css)$/.test(entry.name) ? [full] : [];
  });
}

/** Each named layer: the file that draws it, its level, and a phrase of its doc line. */
const LAYERS = [
  { name: "GameShell header", file: "shared/components/GameShell.tsx", z: 1000, doc: "GameShell header" },
  { name: "clip confirmation", file: "shared/clips/ui/InPlayConfirm.tsx", z: 1000, doc: "InPlayConfirm" },
  { name: "clip toast slot", file: "shared/clips/ui/ToastSlot.tsx", z: 1050, doc: "ToastSlot" },
  { name: "emulator view", file: "games/retro-arcade/Game.tsx", z: 1100, doc: "Retro Arcade emulator view" },
  { name: "celebrations", file: "shared/components/AchievementCelebrations.tsx", z: 1150, doc: "AchievementCelebrations" },
  { name: "result chip", file: "shared/components/ResultChip.tsx", z: 1200, doc: "ResultChip" },
  { name: "leaderboard", file: "shared/components/LeaderboardModal.tsx", z: 1500, doc: "LeaderboardModal" },
  { name: "pause menu", file: "shared/components/PauseMenu.tsx", z: 2000, doc: "PauseMenu" },
  { name: "clip sheets", file: "shared/clips/ui/Sheet.tsx", z: 2500, doc: "clip sheets" },
  { name: "requested install steps", file: "shared/components/IOSInstallPrompt.tsx", z: 2500, doc: "install steps" },
  { name: "restart question", file: "shared/components/RestartConfirmationDialog.tsx", z: 3000, doc: "RestartConfirmationDialog" },
] as const;

describe("stacking contract (design/ARCHITECTURE.md)", () => {
  it("lists each level once, low to high", () => {
    const levels = documentedLevels().map((l) => l.level);
    expect(levels.length).toBeGreaterThan(5);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
  });

  it.each(LAYERS)("$name: the code uses z-[$z] and the list names it at $z", ({ file, z, doc }) => {
    expect(zLevels(code(file))).toContain(z);
    const entry = documentedLevels().find((l) => l.level === z);
    expect(entry, `no line for ${z} in the Stacking order list`).toBeDefined();
    expect(entry?.text).toContain(doc);
  });

  it("every z level in the app code (classes, inline styles, CSS) is a level of the list", () => {
    const levels = documentedLevels();
    const gameTier = Math.max(...levels.filter((l) => l.orLess).map((l) => l.level));
    const named = new Set(levels.map((l) => l.level));
    const stray = sourceFiles(SRC).flatMap((file) =>
      zLevels(code(path.relative(SRC, file)))
        .filter((z) => z > gameTier && !named.has(z))
        .map((z) => `${path.relative(SRC, file)}: z-[${z}]`),
    );
    expect(stray).toEqual([]);
  });

  it("the exported levels match the list", () => {
    expect(TOAST_SLOT_Z_INDEX).toBe(1050);
    expect(EMULATOR_VIEW_Z).toBe(1100);
    expect(RESULT_CHIP_Z_INDEX).toBe(1200);
    expect(CLIP_SHEET_Z_INDEX).toBe(2500);
  });

  it("keeps the clip layers where the contract puts them, next to the emulator view and the celebrations", () => {
    // The level that the code draws, read from the file of a one-level layer.
    const at = (name: (typeof LAYERS)[number]["name"]) => {
      const layer = LAYERS.find((l) => l.name === name);
      if (!layer) throw new Error(name);
      const levels = zLevels(code(layer.file));
      expect(levels, `${layer.file} draws more than one level`).toHaveLength(1);
      return levels[0];
    };
    // The emulator view covers the header row (with the clip confirmation)
    // and the toasts (with the clip toast slot).
    expect(at("clip confirmation")).toBeLessThan(EMULATOR_VIEW_Z);
    expect(TOAST_SLOT_Z_INDEX).toBeLessThan(EMULATOR_VIEW_Z);
    // A celebration shows over the emulator view, and never ties with it.
    expect(at("celebrations")).toBeGreaterThan(EMULATOR_VIEW_Z);
    // A celebration never covers the result chip, a clip sheet or the
    // restart question.
    expect(at("celebrations")).toBeLessThan(RESULT_CHIP_Z_INDEX);
    expect(at("celebrations")).toBeLessThan(CLIP_SHEET_Z_INDEX);
    expect(at("celebrations")).toBeLessThan(at("restart question"));
  });
});
