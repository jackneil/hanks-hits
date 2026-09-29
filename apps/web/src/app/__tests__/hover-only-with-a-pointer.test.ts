import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression (live run, 2026-09-29): an unlayered `.btn:hover { transform:
// scale(1.05) }` stayed on after a tap on a phone, because a touch screen
// keeps :hover until the next tap somewhere else. A full-width result chip
// button drew at 300 px in a 286 px cell and ran into the chip's padding.
// A hover rule that moves or grows an element must only apply where a real
// hover exists: inside @media (hover: hover).

const globalsCss = readFileSync(path.resolve(__dirname, "../globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

interface CssRule {
  selector: string;
  body: string;
  /** The @media conditions around the rule, outermost first. */
  media: string[];
}

/** Every style rule of a stylesheet (no nesting inside rules), with the @media blocks around it. */
function styleRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const walk = (text: string, media: string[]) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const prelude = text.slice(i, open).trim().split(";").pop()!.trim();
      let depth = 1;
      let j = open + 1;
      for (; j < text.length && depth > 0; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith("@media")) walk(body, [...media, prelude.slice("@media".length).trim()]);
      else if (prelude.startsWith("@layer") || prelude.startsWith("@supports")) walk(body, media);
      else if (!prelude.startsWith("@")) rules.push({ selector: prelude, body, media });
      i = j;
    }
  };
  walk(css, []);
  return rules;
}

describe("hover effects in globals.css", () => {
  const rules = styleRules(globalsCss);

  it("reads the stylesheet's rules (a control)", () => {
    expect(rules.some((rule) => rule.selector === ".btn")).toBe(true);
    expect(rules.some((rule) => rule.selector.includes(":hover"))).toBe(true);
  });

  it("moves or grows an element on hover only where a real hover exists", () => {
    const moving = rules.filter((rule) => rule.selector.includes(":hover") && /\b(transform|translate|scale)\s*:/.test(rule.body));
    expect(moving.map((rule) => rule.selector).sort()).toEqual([".btn:hover", ".card:hover"]);
    for (const rule of moving) {
      expect({ selector: rule.selector, hoverOnly: rule.media.some((condition) => /\(\s*hover\s*:\s*hover\s*\)/.test(condition)) }).toEqual({
        selector: rule.selector,
        hoverOnly: true,
      });
    }
  });
});
