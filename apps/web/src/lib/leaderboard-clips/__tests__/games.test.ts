// @vitest-environment node
/**
 * Which games take leaderboard clips, and the run score rules: a plain
 * decimal from 0 to the bound of the game's board field in its progress
 * schema, made whole like a board score.
 */
import { describe, expect, it } from "vitest";

import { VALID_APP_IDS, type ValidAppId } from "@hank-neil/db/schema";
import { MAX_BOARD_SCORE } from "@/lib/leaderboard-schemas";
import { GAME_METADATA } from "@/shared/lib/gameMetadata.generated";

import { boardScoreField, isLeaderboardClipGame, leaderboardClipGames, normalizeRunScore, runScoreLimit } from "../games";

/** The 13 clip games of the spec (section 1). */
const CLIP_GAMES = [
  "arkanoid",
  "asteroids",
  "blitz-bomber",
  "bomberman",
  "breakout",
  "dino-runner",
  "endless-runner",
  "flappy-bird",
  "hextris",
  "hill-climb",
  "math-attack",
  "platformer",
  "space-invaders",
];

describe("isLeaderboardClipGame", () => {
  it("is exactly the games with clips: true and a leaderboard", () => {
    expect([...leaderboardClipGames()].sort()).toEqual(CLIP_GAMES);
    const fromMetadata = VALID_APP_IDS.filter((id) => GAME_METADATA[id]?.clips === true);
    expect([...fromMetadata].sort()).toEqual(CLIP_GAMES);
  });

  it.each(["snake", "2048", "chess", "weather", "achievements", "nope", "constructor", "__proto__", "", 7, null])(
    "refuses %j",
    (appId) => {
      expect(isLeaderboardClipGame(appId)).toBe(false);
    }
  );
});

describe("runScoreLimit", () => {
  it("finds the board field of every clip game in its progress schema", () => {
    for (const appId of CLIP_GAMES as ValidAppId[]) {
      const found = boardScoreField(appId);
      expect(found, appId).not.toBeNull();
      expect(Number.isFinite(found!.max), appId).toBe(true);
    }
  });

  it.each<[ValidAppId, string, number]>([
    ["asteroids", "highScore", 1_000_000_000_000],
    ["flappy-bird", "highScore", 1_000_000],
    ["hill-climb", "bestDistance", 1_000_000_000_000],
    ["platformer", "totalStars", 1_000_000],
  ])("%s: %s up to %d", (appId, field, max) => {
    expect(boardScoreField(appId)).toEqual({ field, max });
    expect(runScoreLimit(appId)).toBe(max);
  });

  it("never goes over the board column limit", () => {
    for (const appId of CLIP_GAMES as ValidAppId[]) expect(runScoreLimit(appId)).toBeLessThanOrEqual(MAX_BOARD_SCORE);
  });
});

describe("normalizeRunScore", () => {
  it.each<[ValidAppId, string, number | null]>([
    ["asteroids", "1790", 1790],
    ["asteroids", "0", 0],
    ["hill-climb", "523.97", 523], // a distance rounds down, like the board
    ["flappy-bird", "1000000", 1_000_000],
    ["flappy-bird", "1000001", null], // over the game's schema bound
    ["asteroids", "1000000000001", null],
    ["asteroids", "-1", null],
    ["asteroids", "1e3", null],
    ["asteroids", " 12", null],
    ["asteroids", "0x10", null],
    ["asteroids", "", null],
    ["asteroids", "NaN", null],
    ["asteroids", "Infinity", null],
    ["asteroids", "12.", null],
  ])("%s %j -> %j", (appId, raw, expected) => {
    expect(normalizeRunScore(appId, raw)).toBe(expected);
  });

  it("refuses a value that is not a string", () => {
    expect(normalizeRunScore("asteroids", 12 as unknown as string)).toBeNull();
  });
});
