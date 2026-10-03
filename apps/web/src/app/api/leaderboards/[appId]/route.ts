import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, eq, and, sql, gte, asc, desc } from "@hank-neil/db";
import {
  gamingProfiles,
  leaderboardEntries,
  VALID_APP_IDS,
  type ValidAppId,
} from "@hank-neil/db/schema";
import { leaderboardQuerySchema, TIME_PERIODS } from "@/lib/leaderboard-schemas";
import { hasLeaderboardSupport, getGameScoreType } from "@/lib/leaderboard-extractors";
import { describeError } from "@/lib/describe-error";
import type {
  LeaderboardApiMyClip,
  LeaderboardApiMyEntry,
  LeaderboardApiResponse,
} from "@/lib/leaderboard-clips/contract";
import { NO_CLIP, clipsForEntries, myClipFields } from "@/lib/leaderboard-clips/leaderboard";
import { defaultClipDeps } from "@/lib/leaderboard-clips/runtime";

type RouteContext = {
  params: Promise<{ appId: string }>;
};

/**
 * GET /api/leaderboards/[appId]
 * Fetch leaderboard for a specific game
 *
 * Query params:
 * - period: 'all' | 'week' | 'month' (default: 'all')
 * - limit: 1-100 (default: 100)
 * - offset: pagination offset (default: 0)
 * - includeMe: include current user's rank even if not in top N
 *
 * Leaderboard clips (design/LEADERBOARD_CLIPS.html): each entry has
 * clip (a public clip, or null), myEntry has clipStatus and clip, and myClip
 * (includeMe=true and signed in) has the player's own clip for every period,
 * also when myEntry is null. The clip lookup never fails the board
 * (src/lib/leaderboard-clips/leaderboard.ts).
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { appId } = await context.params;

    // Validate appId
    if (!VALID_APP_IDS.includes(appId as ValidAppId)) {
      return NextResponse.json(
        { error: `Invalid app ID: ${appId}` },
        { status: 400 }
      );
    }

    // Check if game supports leaderboards
    if (!hasLeaderboardSupport(appId)) {
      return NextResponse.json(
        { error: `Leaderboard not available for: ${appId}` },
        { status: 400 }
      );
    }

    // Parse and validate query params
    const url = new URL(request.url);
    const queryResult = leaderboardQuerySchema.safeParse({
      period: url.searchParams.get("period") || "all",
      limit: url.searchParams.get("limit") || "100",
      offset: url.searchParams.get("offset") || "0",
      includeMe: url.searchParams.get("includeMe") || "false",
    });

    if (!queryResult.success) {
      return NextResponse.json(
        { error: "Invalid query parameters" },
        { status: 400 }
      );
    }

    const { period, limit, offset, includeMe } = queryResult.data;

    // Get current user (optional - for myEntry)
    const session = await auth();
    const userId = session?.user?.id;

    // Determine score type for this game (affects sort direction)
    const scoreType = getGameScoreType(appId);
    const isTimeBased = scoreType === "fastest_time";

    // Build time filter using parameterized query (avoid sql.raw)
    const days = TIME_PERIODS[period];
    const cutoffDate = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;
    const timeFilter = cutoffDate
      ? gte(leaderboardEntries.achievedAt, cutoffDate)
      : undefined;

    // Get leaderboard entries with profile handles
    // Sort: by score (ASC for time-based, DESC for others), then by achievedAt (earlier wins ties)
    const entries = await db
      .select({
        handle: gamingProfiles.handle,
        score: leaderboardEntries.score,
        scoreType: leaderboardEntries.scoreType,
        additionalStats: leaderboardEntries.additionalStats,
        achievedAt: leaderboardEntries.achievedAt,
        gamingProfileId: leaderboardEntries.gamingProfileId,
        showOnLeaderboards: gamingProfiles.showOnLeaderboards,
      })
      .from(leaderboardEntries)
      .innerJoin(
        gamingProfiles,
        eq(leaderboardEntries.gamingProfileId, gamingProfiles.id)
      )
      .where(
        and(
          eq(leaderboardEntries.appId, appId),
          eq(leaderboardEntries.scoreType, scoreType), // Filter by game's score type
          timeFilter,
          eq(gamingProfiles.showOnLeaderboards, true)
        )
      )
      .orderBy(
        // Primary sort: score (ASC for fastest_time, DESC for others)
        isTimeBased
          ? asc(leaderboardEntries.score)
          : desc(leaderboardEntries.score),
        // Secondary sort: achievedAt (earlier wins ties)
        asc(leaderboardEntries.achievedAt)
      )
      .limit(limit)
      .offset(offset);

    // Get total player count for this game/period
    const countResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(leaderboardEntries)
      .innerJoin(
        gamingProfiles,
        eq(leaderboardEntries.gamingProfileId, gamingProfiles.id)
      )
      .where(
        and(
          eq(leaderboardEntries.appId, appId),
          eq(leaderboardEntries.scoreType, scoreType), // Filter by game's score type
          timeFilter,
          eq(gamingProfiles.showOnLeaderboards, true)
        )
      );

    const totalPlayers = Number(countResult[0]?.count || 0);

    // The public clips of the listed players (all of them show on the
    // leaderboards: the query above filters on showOnLeaderboards).
    const clipDeps = defaultClipDeps();
    const clips = await clipsForEntries(
      clipDeps,
      appId,
      entries.map((entry) => entry.gamingProfileId)
    );

    // Build leaderboard with ranks
    // Note: For tie-breaking, we use achievedAt (earlier wins)
    const leaderboard = entries.map((entry, index) => ({
      rank: offset + index + 1,
      handle: entry.handle,
      score: Number(entry.score),
      additionalStats: entry.additionalStats,
      achievedAt: entry.achievedAt?.toISOString() || null,
      clip: clips.byProfile.get(entry.gamingProfileId) ?? null,
    }));

    // Get current user's entry if authenticated and includeMe is true
    let myEntry: LeaderboardApiMyEntry | null = null;
    let myClip: LeaderboardApiMyClip | null = null;
    if (userId && includeMe) {
      const profile = await db.query.gamingProfiles.findFirst({
        where: eq(gamingProfiles.userId, userId),
      });
      // The player's own clip, whatever the period and whether or not
      // the player has a row in it.
      myClip = profile ? await myClipFields(clipDeps, appId, profile.id) : NO_CLIP;

      if (profile) {
        // Get user's rank
        const userEntry = await db
          .select({
            score: leaderboardEntries.score,
            additionalStats: leaderboardEntries.additionalStats,
          })
          .from(leaderboardEntries)
          .where(
            and(
              eq(leaderboardEntries.gamingProfileId, profile.id),
              eq(leaderboardEntries.appId, appId),
              eq(leaderboardEntries.scoreType, scoreType), // Filter by game's score type
              timeFilter
            )
          )
          .limit(1);

        if (userEntry.length > 0) {
          // Count how many players have a better score
          // For fastest_time: count players with LOWER scores (faster times)
          // For others: count players with HIGHER scores
          const rankResult = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(leaderboardEntries)
            .innerJoin(
              gamingProfiles,
              eq(leaderboardEntries.gamingProfileId, gamingProfiles.id)
            )
            .where(
              and(
                eq(leaderboardEntries.appId, appId),
                eq(leaderboardEntries.scoreType, scoreType), // Filter by game's score type
                timeFilter,
                eq(gamingProfiles.showOnLeaderboards, true),
                isTimeBased
                  ? sql`${leaderboardEntries.score} < ${userEntry[0].score}`
                  : sql`${leaderboardEntries.score} > ${userEntry[0].score}`
              )
            );

          const rank = Number(rankResult[0]?.count || 0) + 1;

          myEntry = {
            rank,
            handle: profile.handle,
            score: Number(userEntry[0].score),
            ...myClip,
          };
        }
      }
    }

    const body: LeaderboardApiResponse = {
      leaderboard,
      myEntry,
      myClip,
      totalPlayers,
      period,
      scoreType, // Added for client-side score formatting
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("GET /api/leaderboards error:", describeError(error));
    return NextResponse.json(
      { error: "Failed to fetch leaderboard" },
      { status: 500 }
    );
  }
}
