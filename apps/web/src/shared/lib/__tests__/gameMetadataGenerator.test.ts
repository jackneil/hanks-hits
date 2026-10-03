// @vitest-environment node
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { GAME_VIDEO_IDS } from "@/lib/game-video-games";

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
        preferredOrientation: runtime.preferredOrientation,
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

  it("turns clips on for all 26 games while apps and unknown IDs stay off", () => {
    const gameIds = scanMetadata(SRC_DIR, "games").map((game) => game.id).sort();
    expect(gameIds).toHaveLength(26);
    expect(gameIds).toEqual([...GAME_VIDEO_IDS]);
    const enabled = Object.entries(GAME_METADATA).filter(([, metadata]) => metadata.clips).map(([id]) => id).sort();
    expect(enabled).toEqual(gameIds);
    for (const app of scanMetadata(SRC_DIR, "apps")) expect(getGameMetadata(app.id).clips, app.id).toBe(false);
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
      preferredOrientation: undefined,
    });
  });

  it("writes preferredOrientation into the lookup only for the modules that declare one", () => {
    const sideways = parseMetadataContent(
      `export const metadata = { id: "p", name: "P", emoji: "🏃", category: "action", preferredOrientation: "landscape" };`,
      "p"
    );
    const upright = parseMetadataContent(
      `export const metadata = { id: "f", name: "F", emoji: "🐦", category: "arcade", preferredOrientation: "portrait" };`,
      "f"
    );
    const either = parseMetadataContent(
      `export const metadata = { id: "h", name: "H", emoji: "🏔️", category: "racing" };`,
      "h"
    );
    const output = generateOutput([sideways!, upright!, either!]);
    expect(output).toMatch(/"p": \{[^}]*preferredOrientation: "landscape",/);
    expect(output).toMatch(/"f": \{[^}]*preferredOrientation: "portrait",/);
    expect(output).not.toMatch(/"h": \{[^}]*preferredOrientation/);
  });

  it("declares a preferred orientation only for the games the phone audit found one-way", () => {
    // Endless Runner and Platformer asked for landscape before (they
    // mounted OrientationWarning in their own tree). Flappy Bird is a
    // portrait-shaped game, and so is Breakout's 3:4 field (it plays
    // sideways too, at half the size, so the tip says so once). Hill
    // Climb, Monster Truck and Four-Wheeler 3D play both ways (main-loop
    // decision 2) and declare nothing. A genre PR that makes a game play
    // both ways removes its line here.
    const declared = Object.entries(GAME_METADATA)
      .filter(([, m]) => m.preferredOrientation)
      .map(([id, m]) => `${id}:${m.preferredOrientation}`)
      .sort();
    expect(declared).toEqual([
      "breakout:portrait",
      "endless-runner:landscape",
      "flappy-bird:portrait",
      "platformer:landscape",
    ]);
    for (const id of ["hill-climb", "monster-truck", "four-wheeler-3d"]) {
      expect(GAME_METADATA[id].preferredOrientation, id).toBeUndefined();
    }
  });
});
