import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Two AI-design tells, kept out of the shared UI (2026-09-29 sweep):
//
// 1. A colored stripe on one edge of a card, a note or a row (border-l-4
//    plus a color). It is the most reliable tell of AI-built UI. A note
//    uses a plain fill instead; a selected row uses the selected-row
//    background and weight on its words. (The Leaderboard stripe also hid
//    a bug: the zebra background beat the selected-row background, so the
//    stripe was the only mark on the kid's own row.)
// 2. A gradient used as decoration (bg-gradient-to-*, gradient text with
//    bg-clip-text) on the shared components and the profile pages. They
//    use one solid color each.
//
// Scope: a stripe is checked everywhere except the games (a game draws its
// own art, for example the Quoridor goal rows). The gradient check covers
// shared/components and apps/profile; the other pages are listed for their
// own redesign.

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

function hits(files: string[], pattern: RegExp): Hit[] {
  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((text, i) =>
        pattern.test(text) ? [{ file: path.relative(SRC, file), line: i + 1, text: text.trim() }] : []
      )
  );
}

const COLORS =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black|primary|secondary|accent|info|success|warning|error";

/**
 * A thick or colored border on one edge only (left, top, or the start
 * side): a Tailwind class, a React style key, or a CSS rule of 2px or more.
 */
const EDGE_STRIPE = new RegExp(
  [
    String.raw`\bborder-(?:l|t|s)-(?:\d|\[|(?:${COLORS})\b)`,
    String.raw`\bborder(?:Left|Top|InlineStart)(?:Width|Color)?\s*:`,
    String.raw`\bborder-(?:left|top|inline-start)(?:-width)?\s*:\s*(?:[2-9]|\d{2,})(?:\.\d+)?px`,
  ].join("|")
);

/** A gradient as decoration: a gradient background or gradient text. */
const DECORATIVE_GRADIENT = /\bbg-(?:gradient|linear|radial|conic)-|\bbg-clip-text\b|\b(?:linear|radial|conic)-gradient\(/;

describe("no AI-design tells in the shared UI", () => {
  it("no colored edge stripe on a card, a note or a row, outside the games' own art", () => {
    const files = sourceFiles(SRC).filter(
      (file) => !file.includes(`${path.sep}games${path.sep}`) && !file.endsWith(".generated.ts")
    );
    expect(files.length).toBeGreaterThan(50);
    expect(hits(files, EDGE_STRIPE)).toEqual([]);
  });

  it("the stripe pattern finds the stripes it is for", () => {
    // The guard must not pass because the pattern can never match.
    for (const stripe of [
      'className="border-l-4 border-green-500"',
      'className="border-l-primary"',
      'className="border-t-[3px]"',
      "style={{ borderLeft: '4px solid red' }}",
      "  border-left: 4px solid #22c55e;",
    ]) {
      expect(stripe).toMatch(EDGE_STRIPE);
    }
    // A plain one-pixel divider line is not a stripe.
    expect('className="border-t border-white/10"').not.toMatch(EDGE_STRIPE);
    expect("  border-top: 1px solid #ffffff22;").not.toMatch(EDGE_STRIPE);
    expect('className="border-solid border-slate-700"').not.toMatch(EDGE_STRIPE);
  });

  it("no decorative gradient on the shared components or the profile pages", () => {
    const files = [
      ...sourceFiles(path.join(SRC, "shared", "components")),
      ...sourceFiles(path.join(SRC, "apps", "profile")),
    ];
    expect(files.length).toBeGreaterThan(10);
    expect(hits(files, DECORATIVE_GRADIENT)).toEqual([]);
  });

  it("the gradient pattern finds the gradients it is for", () => {
    for (const gradient of [
      'className="bg-gradient-to-b from-blue-600 to-purple-700"',
      'className="bg-linear-to-r from-cyan-500"',
      'className="bg-clip-text text-transparent"',
      "background: linear-gradient(to top, red, blue);",
    ]) {
      expect(gradient).toMatch(DECORATIVE_GRADIENT);
    }
    expect('className="bg-blue-800"').not.toMatch(DECORATIVE_GRADIENT);
  });

  it("the profile cards take one solid color per game, with no gradient stops", () => {
    const generated = readFileSync(path.join(SRC, "shared", "lib", "gameMetadata.generated.ts"), "utf8");
    expect(generated).not.toMatch(/\b(?:from|via|to)-[a-z]+-\d{2,3}\b/);
    expect(generated).toMatch(/export function getGameSurface\(/);
    expect(generated).not.toMatch(/getGameGradient/);
  });
});
