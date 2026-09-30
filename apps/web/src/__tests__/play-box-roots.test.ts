import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every game and app root fills the GameShell play box (phone UX audit
// 2026-09-29, S1; design/ARCHITECTURE.md, "The play box"). A root sized in
// screen units (min-h-screen, h-screen, calc(100vh - 3rem)) is taller than
// an iPhone screen while the Safari toolbars show, so the page scrolled on
// every route and a drag on the game panned the page. A root uses h-full
// or min-h-full: the play box has the height, in dvh.
//
// The header height is one CSS variable, --shell-header-h in globals.css:
// 48 px, and 44 px on a short screen. A layer under the header uses
// top-[var(--shell-header-h)]; a literal number drifts (the short header was
// once 40 px with 44 px buttons, so each button hung 2 px off the screen).
// A class keyed on md: for the old md:h-14 header (md:top-14, md:pt-14,
// md:h-14) is stale and puts a layer 8 px low on a desktop.
//
// This test reads the source, because jsdom applies no CSS.

const SRC = path.resolve(__dirname, "..");
// The routes (app/) too: a dynamic import's loading placeholder renders in
// the play box, and a page with no shell (the home page) is one dvh tall.
const SCAN_DIRS = ["games", "apps", "shared/components", "app"].map((dir) => path.join(SRC, dir));

/** Class names and CSS that size to the screen instead of the play box. */
const SCREEN_HEIGHT = [
  // Tailwind: min-h-screen, h-screen, max-h-screen, and the same with a variant (md:h-screen).
  /(?:^|[\s"'`:])(?:min-h|max-h|h)-screen\b/,
  // Tailwind arbitrary values with a viewport height: h-[calc(100vh-3rem)], min-h-[100svh].
  /(?:min-h|max-h|h)-\[[^\]]*\b100(?:vh|svh|lvh)\b/,
  // Inline CSS: height: 100vh, min-height: calc(100vh - 3rem).
  /(?:min-|max-)?height:\s*[^;"']*\b100(?:vh|svh|lvh)\b/,
];

/** Offsets for the old 56 px desktop header. */
const OLD_HEADER = /\bmd:(?:top|pt|h|min-h)-14\b/;

/**
 * A header height written as a number: the old short header (short:top-10,
 * short:pt-10, short:h-10), a fixed layer at top-12, or play box math with
 * 3rem. Each must read --shell-header-h instead.
 */
const LITERAL_HEADER = [
  /\bshort:(?:top|pt|h)-10\b/,
  /\bfixed\b[^"'`]*\btop-12\b/,
  /100dvh-(?:3|2\.5)rem/,
];

/**
 * Files with a screen-height rule that is not a root in the play box.
 * Each entry names the file and the reason. Add nothing here for a game
 * root: give it h-full or min-h-full.
 */
const EXEMPT: { file: string; reason: string }[] = [
  {
    file: "apps/drawing-app/hooks/useCanvas.ts",
    reason:
      "a separate HTML document that the app opens in a new window to save the picture; it is not in the play box",
  },
  {
    file: "app/globals.css",
    reason:
      "the body's min-height: 100vh line is the value for a browser without dvh; the 100dvh line after it wins (touch-defaults.test.ts checks the pair)",
  },
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      sourceFiles(full, out);
      continue;
    }
    if (!/\.(ts|tsx|css)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

type Hit = { file: string; line: number; text: string };

// The line without its comment: a `//` tail, a block-comment span, or a
// line inside a block comment.
function stripComment(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("{/*")) return "";
  return line.replace(/\/\*.*?\*\//g, "").replace(/\s\/\/.*$/, "");
}

function scan(patterns: RegExp[]): Hit[] {
  const hits: Hit[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(dir)) {
      const rel = path.relative(SRC, file);
      if (EXEMPT.some((e) => e.file === rel)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((raw, index) => {
        // Words in a comment are not a class: a comment may name the old
        // classes to say why they are gone.
        const line = stripComment(raw);
        if (patterns.some((p) => p.test(line))) {
          hits.push({ file: rel, line: index + 1, text: line.trim().slice(0, 100) });
        }
      });
    }
  }
  return hits;
}

const report = (hits: Hit[]) => hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join("\n");

describe("game and app roots fill the play box", () => {
  it("no root in games/**, apps/** or shared/components/** is sized in screen units", () => {
    const hits = scan(SCREEN_HEIGHT);
    expect(
      hits,
      `Screen-height sizing outside the play box contract. Use h-full or min-h-full (the play box has the height, in dvh):\n${report(hits)}`
    ).toEqual([]);
  });

  it("no layer is keyed on the old 56 px desktop header (md:top-14, md:pt-14, md:h-14)", () => {
    const hits = scan([OLD_HEADER]);
    expect(
      hits,
      `The header is --shell-header-h, never md:h-14. Use top-[var(--shell-header-h)], or fill the play box:\n${report(hits)}`
    ).toEqual([]);
  });

  it("no layer writes the header height as a number (it reads --shell-header-h)", () => {
    const hits = scan(LITERAL_HEADER);
    expect(
      hits,
      `Use top-[var(--shell-header-h)] (or pt-/h- with the variable) for a layer under the header:\n${report(hits)}`
    ).toEqual([]);
  });

  it("the header variable is 48 px, and 44 px (a whole button) on a short screen", () => {
    const css = readFileSync(path.join(SRC, "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/:root\s*\{[^}]*--shell-header-h:\s*3rem/);
    expect(css).toMatch(/@media\s*\(max-height:\s*480px\)\s*\{\s*:root\s*\{[^}]*--shell-header-h:\s*2\.75rem/);
  });

  it("every exemption still has a screen-height rule (a stale entry hides a new root)", () => {
    for (const { file } of EXEMPT) {
      const text = readFileSync(path.join(SRC, file), "utf8");
      expect(SCREEN_HEIGHT.some((p) => p.test(text)), `${file} no longer needs its exemption`).toBe(true);
    }
  });

  it("the rules catch the audit's roots and spare the play box classes", () => {
    for (const bad of [
      'className="min-h-screen bg-black p-4"',
      'className="flex h-[calc(100vh-3rem)] w-full flex-col md:h-[calc(100vh-3.5rem)]"',
      'className="relative min-h-[calc(100vh-3rem)] md:min-h-[calc(100vh-3.5rem)]"',
      "body { min-height: 100vh; }",
      'className="fixed inset-x-0 bottom-0 top-12 md:top-14"',
    ]) {
      expect([...SCREEN_HEIGHT, OLD_HEADER].some((p) => p.test(bad)), bad).toBe(true);
    }
    for (const good of [
      'className="min-h-full bg-black p-4"',
      'className="flex h-full w-full flex-col"',
      'className="fixed inset-x-0 bottom-0 top-[var(--shell-header-h)]"',
      "transform: translateY(100vh) rotate(720deg);",
      'className="w-full max-w-2xl md:max-w-[min(42rem,calc(100vh_-_27rem))]"',
    ]) {
      expect([...SCREEN_HEIGHT, OLD_HEADER, ...LITERAL_HEADER].some((p) => p.test(good)), good).toBe(false);
    }
    for (const bad of [
      'className="fixed inset-x-0 bottom-0 top-12 short:top-10"',
      'className="relative w-full h-[calc(100dvh-3rem-var(--bottom-sheet-space,0px))]"',
      'className="pt-12 short:pt-10"',
    ]) {
      expect(LITERAL_HEADER.some((p) => p.test(bad)), bad).toBe(true);
    }
  });
});
