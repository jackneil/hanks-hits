import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression (live run, 2026-09-29): globals.css had an unconditional
// `.btn:hover { transform: scale(1.05) }`. On a touch screen a tap puts the
// button in :hover, and it stays there until the next tap on something
// else, so a button stayed big after the kid lifted the finger. Every
// :hover rule in the app's own CSS must sit in
// `@media (hover: hover) and (pointer: fine)`, so it applies to a mouse only.
// (Tailwind's hover: variant already has its own (hover: hover) guard.)

const SRC = path.resolve(__dirname, "..");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : cssFiles(full);
    return entry.name.endsWith(".css") ? [full] : [];
  });
}

interface HoverRule {
  selector: string;
  line: number;
  /** The prelude of every at-rule around the rule, outermost first. */
  atRules: string[];
}

/**
 * Every style rule whose selector has :hover, with the at-rules around it.
 * A small brace walker: comments and quoted strings are skipped, so a brace
 * inside them does not count.
 */
function hoverRules(css: string): HoverRule[] {
  const rules: HoverRule[] = [];
  const stack: string[] = [];
  let prelude = "";
  let preludeLine = 1;
  let line = 1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "\n") line++;
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      line += (css.slice(i, stop).match(/\n/g) ?? []).length;
      i = stop - 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === "\\" ? 2 : 1;
      prelude += css.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "{") {
      const head = prelude.trim().replace(/\s+/g, " ");
      if (!head.startsWith("@") && /:hover\b/.test(head)) {
        rules.push({ selector: head, line: preludeLine, atRules: stack.filter((p) => p.startsWith("@")) });
      }
      stack.push(head);
      prelude = "";
      continue;
    }
    if (ch === "}") {
      stack.pop();
      prelude = "";
      continue;
    }
    if (ch === ";") {
      // The end of a declaration or of a block-less at-rule (@import).
      prelude = "";
      continue;
    }
    if (!prelude.trim()) preludeLine = line;
    prelude += ch;
  }
  return rules;
}

const MOUSE_ONLY = (atRule: string) =>
  /^@media\b/.test(atRule) && /\(\s*hover\s*:\s*hover\s*\)/.test(atRule) && /\(\s*pointer\s*:\s*fine\s*\)/.test(atRule);

describe("hover styles apply to a mouse only", () => {
  const files = cssFiles(SRC);

  it("finds the app's CSS files, globals.css included", () => {
    expect(files.map((file) => path.relative(SRC, file))).toContain(path.join("app", "globals.css"));
  });

  it("puts every :hover rule in @media (hover: hover) and (pointer: fine)", () => {
    const found = files.flatMap((file) =>
      hoverRules(readFileSync(file, "utf8")).map((rule) => ({ ...rule, file: path.relative(SRC, file) }))
    );
    // The sweep must see the rules it guards, or it proves nothing.
    expect(found.map((rule) => rule.selector)).toEqual(expect.arrayContaining([".btn:hover", ".card:hover"]));

    const touchSticky = found
      .filter((rule) => !rule.atRules.some(MOUSE_ONLY))
      .map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(touchSticky).toEqual([]);
  });

  it("the walker sees a :hover rule outside the media query, and one inside it", () => {
    const css = `
      /* a { } comment with braces */
      .a:hover { transform: scale(1.05); }
      @media (hover: hover) and (pointer: fine) {
        .b:hover { content: "}"; }
      }
      @layer components { .c:hover:not(:disabled) { color: red; } }
    `;
    expect(hoverRules(css)).toEqual([
      { selector: ".a:hover", line: 3, atRules: [] },
      { selector: ".b:hover", line: 5, atRules: ["@media (hover: hover) and (pointer: fine)"] },
      { selector: ".c:hover:not(:disabled)", line: 7, atRules: ["@layer components"] },
    ]);
    expect(hoverRules(css).filter((rule) => !rule.atRules.some(MOUSE_ONLY)).map((rule) => rule.selector)).toEqual([
      ".a:hover",
      ".c:hover:not(:disabled)",
    ]);
  });
});
