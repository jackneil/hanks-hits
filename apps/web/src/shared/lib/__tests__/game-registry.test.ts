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
});
