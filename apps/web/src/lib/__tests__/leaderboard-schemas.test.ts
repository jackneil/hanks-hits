import { describe, expect, it } from "vitest";
import { leaderboardEntrySchema, leaderboardQuerySchema } from "../leaderboard-schemas";

describe("leaderboardQuerySchema", () => {
  it("defaults includeMe to false when omitted", () => {
    expect(leaderboardQuerySchema.parse({}).includeMe).toBe(false);
  });

  it("parses includeMe=false as false", () => {
    expect(leaderboardQuerySchema.parse({ includeMe: "false" }).includeMe).toBe(false);
  });

  it("parses includeMe=true as true", () => {
    expect(leaderboardQuerySchema.parse({ includeMe: "true" }).includeMe).toBe(true);
  });

  it("rejects ambiguous includeMe strings", () => {
    expect(() => leaderboardQuerySchema.parse({ includeMe: "definitely" })).toThrow();
  });
});

describe("leaderboardEntrySchema", () => {
  it("validates extracted score stats", () => {
    expect(
      leaderboardEntrySchema.safeParse({
        score: 2048,
        scoreType: "high_score",
        stats: {
          highestTile: 2048,
          accuracy: "95%",
        },
      }).success
    ).toBe(true);
  });

  it("rejects legacy additionalStats payloads instead of silently skipping stats validation", () => {
    expect(
      leaderboardEntrySchema.safeParse({
        score: 2048,
        scoreType: "high_score",
        additionalStats: {
          highestTile: 2048,
        },
      }).success
    ).toBe(false);
  });

  it("bounds stats payload size", () => {
    const tooManyStats = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [`stat${index}`, index])
    );

    expect(
      leaderboardEntrySchema.safeParse({
        score: 2048,
        scoreType: "high_score",
        stats: tooManyStats,
      }).success
    ).toBe(false);
  });
});
