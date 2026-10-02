import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, eq, and, sql } from "@hank-neil/db";
import { gamingProfiles, leaderboardEntries } from "@hank-neil/db/schema";
import { getGameMetadata } from "@/shared/lib/gameMetadata.generated";
import { describeError } from "@/lib/describe-error";

/**
 * GET /api/leaderboards/my-ranks
 * Get current user's ranks across all games
 *
 * Requires authentication
 */
export async function GET() {
  try {
    const session = await auth();

    // Must be authenticated
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized - please log in" },
        { status: 401 }
      );
    }

    // Get user's gaming profile
    const profile = await db.query.gamingProfiles.findFirst({
      where: eq(gamingProfiles.userId, session.user.id),
    });

    if (!profile) {
      // User hasn't played any games yet
      return NextResponse.json({
        handle: null,
        ranks: [],
      });
    }

    // Get all user's leaderboard entries
    const userEntries = await db
      .select({
        appId: leaderboardEntries.appId,
        score: leaderboardEntries.score,
        scoreType: leaderboardEntries.scoreType,
      })
      .from(leaderboardEntries)
      .where(eq(leaderboardEntries.gamingProfileId, profile.id));

    // Calculate rank for each game
    const ranks = await Promise.all(
      userEntries.map(async (entry) => {
        // Count how many players have a higher score (all-time)
        const rankResult = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(leaderboardEntries)
          .innerJoin(
            gamingProfiles,
            eq(leaderboardEntries.gamingProfileId, gamingProfiles.id)
          )
          .where(
            and(
              eq(leaderboardEntries.appId, entry.appId),
              eq(leaderboardEntries.scoreType, entry.scoreType),
              eq(gamingProfiles.showOnLeaderboards, true),
              entry.scoreType === "fastest_time"
                ? sql`${leaderboardEntries.score} < ${entry.score}`
                : sql`${leaderboardEntries.score} > ${entry.score}`
            )
          );

        // Get total players for this game
        const totalResult = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(leaderboardEntries)
          .innerJoin(
            gamingProfiles,
            eq(leaderboardEntries.gamingProfileId, gamingProfiles.id)
          )
          .where(
            and(
              eq(leaderboardEntries.appId, entry.appId),
              eq(leaderboardEntries.scoreType, entry.scoreType),
              eq(gamingProfiles.showOnLeaderboards, true)
            )
          );

        const rank = Number(rankResult[0]?.count || 0) + 1;
        const totalPlayers = Number(totalResult[0]?.count || 0);

        // Get game metadata dynamically
        const metadata = getGameMetadata(entry.appId);

        return {
          appId: entry.appId,
          gameName: metadata.name,
          icon: metadata.icon,
          rank,
          score: Number(entry.score),
          scoreType: entry.scoreType,
          totalPlayers,
        };
      })
    );

    // Sort by rank (best first)
    ranks.sort((a, b) => a.rank - b.rank);

    return NextResponse.json({
      handle: profile.handle,
      ranks,
    });
  } catch (error) {
    console.error("GET /api/leaderboards/my-ranks error:", describeError(error));
    return NextResponse.json(
      { error: "Failed to fetch ranks" },
      { status: 500 }
    );
  }
}
