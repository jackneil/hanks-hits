// @vitest-environment node
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

import { generateOutput, parseMetadataContent, scanMetadata } from "../../../../scripts/gameMetadataGen";
import { parseMetadata } from "../game-registry";
import { GAME_METADATA, getGameMetadata } from "../gameMetadata.generated";
import { readMetadataLiterals } from "../metadataLiterals";

const SRC_DIR = path.resolve(__dirname, "../../..");

/** Every metadata.ts in the repo, with its folder name. */
function realMetadataFiles(): Array<{ dir: string; content: string }> {
  const out: Array<{ dir: string; content: string }> = [];
  for (const type of ["games", "apps"]) {
    const root = path.join(SRC_DIR, type);
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name, "metadata.ts");
      if (entry.isDirectory() && fs.existsSync(file)) out.push({ dir: entry.name, content: fs.readFileSync(file, "utf-8") });
    }
  }
  return out;
}

describe("game metadata generator", () => {
  it("reads every real metadata file the same way as the runtime scan", () => {
    const files = realMetadataFiles();
    expect(files.length).toBeGreaterThan(20);
    for (const { dir, content } of files) {
      const runtime = parseMetadata(content, dir);
      const generated = parseMetadataContent(content, dir);
      expect(generated === null, dir).toBe(runtime === null);
      if (!runtime || !generated) continue;
      expect(generated, dir).toEqual({
        id: runtime.id,
        name: runtime.name,
        emoji: runtime.emoji,
        category: runtime.category,
        description: runtime.description,
        madeByKid: runtime.madeByKid,
        clips: runtime.clips,
      });
    }
  });

  it("matches the committed lookup, so a stale gameMetadata.generated.ts fails here", () => {
    const items = [...scanMetadata(SRC_DIR, "games"), ...scanMetadata(SRC_DIR, "apps")];
    const committed = fs.readFileSync(path.join(SRC_DIR, "shared/lib/gameMetadata.generated.ts"), "utf-8");
    expect(generateOutput(items)).toBe(committed);
  });

  it("writes the clips literal of each module into the lookup", () => {
    const on = parseMetadataContent(`export const metadata = { id: "x", name: "X", emoji: "🎬", category: "arcade", clips: true };`, "x");
    const off = parseMetadataContent(`export const metadata = { id: "y", name: "Y", emoji: "🎮", category: "arcade" };`, "y");
    const output = generateOutput([on!, off!]);
    expect(output).toMatch(/"x": \{[^}]*clips: true,/);
    expect(output).toMatch(/"y": \{[^}]*clips: false,/);
  });

  it("turns clips on only for the modules that chose it, one at a time", () => {
    // Asteroids is the first live proof (Wave C integration). Game PRs (2.6 and
    // later) add modules one at a time: add each one here with its PR.
    expect(Object.entries(GAME_METADATA).filter(([, m]) => m.clips).map(([id]) => id)).toEqual(["asteroids"]);
    expect(getGameMetadata("no-such-game").clips).toBe(false);
  });

  it("returns undefined for fields that are absent or computed", () => {
    expect(readMetadataLiterals(`export const metadata = { name: someName, clips: flag };`)).toEqual({
      id: undefined,
      name: undefined,
      emoji: undefined,
      category: undefined,
      description: undefined,
      hidden: undefined,
      madeByKid: undefined,
      clips: undefined,
    });
  });
});
