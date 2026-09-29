import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression (verify finding ui24): the custom daisyUI themes set no
// --depth, so they kept --depth: 1 from daisyUI's default light theme, and
// every .btn got a drop shadow in its own color (a blue shadow under each
// blue button). Both themes must be flat.

const globalsCss = readFileSync(path.resolve(__dirname, "../globals.css"), "utf8");

/** The body of every `@plugin "daisyui/theme" { ... }` block, by theme name. */
function themeBlocks(css: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const opener = /@plugin\s+"daisyui\/theme"\s*\{/g;
  for (let match = opener.exec(css); match; match = opener.exec(css)) {
    let depth = 1;
    let i = opener.lastIndex;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    const body = css.slice(opener.lastIndex, i - 1).replace(/\/\*[\s\S]*?\*\//g, "");
    const name = /name:\s*"([^"]+)"/.exec(body)?.[1] ?? "(unnamed)";
    blocks.set(name, body);
  }
  return blocks;
}

describe("daisyUI themes in globals.css", () => {
  const blocks = themeBlocks(globalsCss);

  it("finds both custom themes", () => {
    expect([...blocks.keys()].sort()).toEqual(["adventure", "adventure-dark"]);
  });

  it.each(["adventure", "adventure-dark"])("%s sets --depth: 0 and --noise: 0", (name) => {
    const body = blocks.get(name) ?? "";
    expect(body).toMatch(/--depth:\s*0\s*;/);
    expect(body).toMatch(/--noise:\s*0\s*;/);
  });

  it("still matches how daisyUI colors the button shadow (scaled by --depth)", () => {
    // If a daisyUI upgrade stops scaling the colored shadow by --depth,
    // --depth: 0 no longer removes it, and this test says so.
    const buttonCss = readFileSync(
      path.resolve(__dirname, "../../../node_modules/daisyui/components/button.css"),
      "utf8"
    );
    expect(buttonCss).toMatch(
      /--btn-shadow:0 3px 2px -2px color-mix\(in oklab, var\(--btn-bg\) calc\(var\(--depth\) \* 30%\), #0000\)/
    );
  });
});
