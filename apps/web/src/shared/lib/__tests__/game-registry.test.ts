import { describe, expect, it } from "vitest";
import { parseMetadata } from "../game-registry";

// The home page discovers games by regex-scanning each metadata.ts at runtime,
// so this parser IS the discovery contract: a field it can't parse does not
// exist as far as the home page is concerned. These tests pin that contract,
// especially madeByKid — the marker the make-a-game / remix-a-game skills
// write and the My Games shelf reads.

const fullMetadata = `
import type { GameMetadata } from "@/shared/lib/game-registry";

export const metadata: GameMetadata = {
  id: "donut-catch",
  name: "Donut Catch",
  emoji: "🍩",
  category: "arcade",
  description: "Catch the donuts",
  hidden: false,
  madeByKid: true,
};
`;

describe("parseMetadata", () => {
  it("parses every field of a complete metadata file", () => {
    const parsed = parseMetadata(fullMetadata, "donut-catch");
    expect(parsed).toEqual({
      id: "donut-catch",
      name: "Donut Catch",
      emoji: "🍩",
      category: "arcade",
      description: "Catch the donuts",
      hidden: false,
      madeByKid: true,
      clips: false,
    });
  });

  it("treats a game as NOT kid-made when madeByKid is absent", () => {
    const content = `
export const metadata = {
  id: "snake",
  name: "Snake",
  emoji: "🐍",
  category: "arcade",
};
`;
    const parsed = parseMetadata(content, "snake");
    expect(parsed?.madeByKid).toBe(false);
  });

  it("parses an explicit madeByKid: false", () => {
    const content = `
export const metadata = {
  id: "chess",
  name: "Chess",
  emoji: "♟️",
  category: "board",
  madeByKid: false,
};
`;
    const parsed = parseMetadata(content, "chess");
    expect(parsed?.madeByKid).toBe(false);
  });

  it("falls back to the directory name when id is missing", () => {
    const content = `
export const metadata = {
  name: "Mystery",
  emoji: "❓",
  category: "puzzle",
};
`;
    const parsed = parseMetadata(content, "mystery-dir");
    expect(parsed?.id).toBe("mystery-dir");
  });

  it("returns null when required fields are missing", () => {
    const parsed = parseMetadata(`export const metadata = { id: "x" };`, "x");
    expect(parsed).toBeNull();
  });

  it("only accepts a plain madeByKid literal, matching the scan contract", () => {
    // A computed value must not register as kid-made — the same rule the
    // home page already applies to every other metadata field.
    const content = `
export const metadata = {
  id: "computed",
  name: "Computed",
  emoji: "🤖",
  category: "arcade",
  madeByKid: someFlag,
};
`;
    const parsed = parseMetadata(content, "computed");
    expect(parsed?.madeByKid).toBe(false);
  });

  it("reads a plain clips literal and defaults it to false", () => {
    const on = `
export const metadata = {
  id: "breakout",
  name: "Breakout",
  emoji: "🧱",
  category: "arcade",
  clips: true,
};
`;
    expect(parseMetadata(on, "breakout")?.clips).toBe(true);
    expect(parseMetadata(on.replace("clips: true", "clips: false"), "breakout")?.clips).toBe(false);
    expect(parseMetadata(on.replace("  clips: true,\n", ""), "breakout")?.clips).toBe(false);
  });

  it("never reads a computed clips value or a longer field name as clips", () => {
    const content = `
export const metadata = {
  id: "draw",
  name: "Draw",
  emoji: "🎨",
  category: "apps",
  clipsScrubbed: "abc",
  noclips: true,
  clips: enabled,
};
`;
    expect(parseMetadata(content, "draw")?.clips).toBe(false);
  });

  it("reads id only at a word boundary, never from a field that ends in id", () => {
    const content = `
export const metadata = {
  gameId: "wrong",
  name: "Right",
  emoji: "✅",
  category: "arcade",
};
`;
    expect(parseMetadata(content, "right-dir")?.id).toBe("right-dir");
  });
});
