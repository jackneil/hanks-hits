import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SECONDARY_ACTION, SECONDARY_EDGE_HEX } from "../buttonStyles";

/** WCAG 2 relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two #rrggbb colors. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The base-100 color (the sheet and button fill) of every theme in globals.css. */
function themeSurfaces(): Record<string, string> {
  const css = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");
  const out: Record<string, string> = {};
  for (const block of css.matchAll(/@plugin "daisyui\/theme" \{([\s\S]*?)\n\}/g)) {
    const name = /name:\s*"([^"]+)"/.exec(block[1])?.[1];
    const base = /--color-base-100:\s*(#[0-9a-fA-F]{6})/.exec(block[1])?.[1];
    if (name && base) out[name] = base;
  }
  return out;
}

describe("the secondary button edge (WCAG 1.4.11 non-text contrast)", () => {
  it("measures the known pairs right (a control)", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    // The old edge: base-300 on base-100, the finding's 1.1:1.
    expect(contrast("#e0f2fe", "#ffffff")).toBeLessThan(1.2);
  });

  it("stands out at 3:1 or more against the surface of every theme", () => {
    const surfaces = themeSurfaces();
    expect(Object.keys(surfaces).sort()).toEqual(["adventure", "adventure-dark"]);
    for (const [theme, surface] of Object.entries(surfaces)) {
      expect({ theme, ratio: contrast(SECONDARY_EDGE_HEX, surface) >= 3 }).toEqual({ theme, ratio: true });
    }
  });

  it("is a full 2 px border in that color, never a stripe on one side", () => {
    const tokens = SECONDARY_ACTION.split(/\s+/);
    expect(tokens).toContain("border-2");
    expect(tokens).toContain(`border-[${SECONDARY_EDGE_HEX}]`);
    expect(tokens.filter((token) => /^border-[lrtbxyse]-|^border-(l|r|t|b|x|y|s|e)$/.test(token))).toEqual([]);
  });
});
