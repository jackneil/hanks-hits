import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The touch and height defaults of the page (phone UX audit 2026-09-29,
// S1 and S11). These read the source, because jsdom applies no CSS:
// - the body and the root layout are sized in dvh, not vh: on an iPhone
//   100vh is the height with the Safari toolbars hidden, so a 100vh page
//   was taller than the screen and every route scrolled;
// - every button has touch-action: manipulation, so a fast double tap on
//   a game button never zooms the page (only .btn had it);
// - a text field inside the play box keeps its selection, so the play
//   box's select-none does not break typing.

const SRC = path.resolve(__dirname, "..");
const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");
const layout = readFileSync(path.join(SRC, "app/layout.tsx"), "utf8");

/** The body of a CSS rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : null;
}

describe("touch and height defaults", () => {
  it("the body is at least one dvh tall, with the vh value first for a browser without dvh", () => {
    const body = ruleBody("body");
    expect(body).not.toBeNull();
    const heights = [...body!.matchAll(/min-height:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(heights).toEqual(["100vh", "100dvh"]);
  });

  it("the root layout body uses min-h-dvh, not min-h-screen", () => {
    expect(layout).toMatch(/<body className=\{`[^`]*\bmin-h-dvh\b/);
    expect(layout).not.toMatch(/min-h-screen/);
  });

  it("every button has touch-action manipulation, in the components layer", () => {
    const body = ruleBody(`button,\n  [role="button"]`);
    expect(body, 'no rule for button, [role="button"]').not.toBeNull();
    expect(body).toMatch(/touch-action:\s*manipulation;/);
    // Inside @layer components, so a utility such as touch-none on a hold
    // control still wins.
    const start = css.indexOf('[role="button"]');
    const before = css.slice(0, start);
    const lastLayer = before.lastIndexOf("@layer components");
    expect(lastLayer).toBeGreaterThan(-1);
    const opened = (before.slice(lastLayer).match(/\{/g) ?? []).length;
    const closed = (before.slice(lastLayer).match(/\}/g) ?? []).length;
    expect(opened).toBeGreaterThan(closed);
  });

  it("a text field in the play box keeps its selection", () => {
    const body = ruleBody(`[data-play-box] input,\n  [data-play-box] textarea,\n  [data-play-box] [contenteditable]`);
    expect(body).not.toBeNull();
    expect(body).toMatch(/user-select:\s*text;/);
    expect(body).toMatch(/-webkit-user-select:\s*text;/);
  });
});
