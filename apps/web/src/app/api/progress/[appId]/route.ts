import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, eq, and, sql } from "@hank-neil/db";
import {
  appProgress,
  gamingProfiles,
  leaderboardEntries,
  VALID_APP_IDS,
  type ValidAppId,
  type AppProgressData,
} from "@hank-neil/db/schema";
import { mergeProgress } from "@/lib/progress-merge";
import { validateProgress } from "@/lib/progress-schemas";
import { checkProgressRateLimit } from "@/lib/rate-limit";
import { generateUniqueHandle } from "@/lib/handle-generator";
import {
  extractLeaderboardScore,
  hasLeaderboardSupport,
} from "@/lib/leaderboard-extractors";
import { leaderboardEntrySchema } from "@/lib/leaderboard-schemas";

type RouteContext = {
  params: Promise<{ appId: string }>;
};

/**
 * GET /api/progress/[appId]
 * Fetch user's progress for a specific game/app
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    const { appId } = await context.params;

    // Must be authenticated
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized - please log in" },
        { status: 401 }
      );
    }

    // Rate limit: 60 requests per minute per user
    const rateLimit = checkProgressRateLimit(session.user.id);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${rateLimit.resetIn}s` },
        { status: 429 }
      );
    }

    // Validate appId
    if (!VALID_APP_IDS.includes(appId as ValidAppId)) {
      return NextResponse.json(
        { error: `Invalid app ID: ${appId}` },
        { status: 400 }
      );
    }

    // Fetch progress
    const progress = await db.query.appProgress.findFirst({
      where: and(
        eq(appProgress.userId, session.user.id),
        eq(appProgress.appId, appId)
      ),
    });

    if (!progress) {
      return NextResponse.json({
        data: null,
        lastSyncedAt: null,
        message: "No saved progress found",
      });
    }

    return NextResponse.json({
      data: progress.data,
      lastSyncedAt: progress.lastSyncedAt?.toISOString() || null,
      updatedAt: progress.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("GET /api/progress error:", error);
    return NextResponse.json(
      { error: "Failed to fetch progress" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/progress/[appId]
 * Save user's progress for a specific game/app
 *
 * Body:
 * - data: AppProgressData - the entire game state
 * - localTimestamp?: number - client's last modified timestamp
 * - merge?: boolean - if true, merge with server data instead of overwrite
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    const { appId } = await context.params;

    // Must be authenticated
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized - please log in" },
        { status: 401 }
      );
    }

    // Rate limit: 60 saves per minute per user
    const rateLimit = checkProgressRateLimit(session.user.id);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${rateLimit.resetIn}s` },
        { status: 429 }
      );
    }

    // Validate appId
    if (!VALID_APP_IDS.includes(appId as ValidAppId)) {
      return NextResponse.json(
        { error: `Invalid app ID: ${appId}` },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { data, localTimestamp, merge = false } = body as {
      data: AppProgressData;
      localTimestamp?: number;
      merge?: boolean;
    };

    // Basic type check
    if (!data || typeof data !== "object") {
      return NextResponse.json(
        { error: "Invalid progress data" },
        { status: 400 }
      );
    }

    // SECURITY: Validate progress data against game-specific schema
    // This prevents users from POSTing arbitrary data like {"coins": 999999999}
    const validation = validateProgress(appId as ValidAppId, data);
    if (!validation.success) {
      console.warn(
        `Invalid progress data for ${appId} from user ${session.user.id}:`,
        validation.error
      );
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const userId = session.user.id;
    // SECURITY: persist the VALIDATED/parsed payload, not the raw request body —
    // otherwise unknown keys that Zod strips from validation.data are still stored
    // verbatim. validation.data is bounded by the schema; `data` is attacker-shaped.
    let finalData: AppProgressData = validation.data as AppProgressData;
    let conflicts: string[] = [];

    // If merging, fetch existing first and merge
    // SECURITY: Server timestamp ALWAYS wins - we don't trust any client timestamps
    if (merge) {
      const existing = await db.query.appProgress.findFirst({
        where: and(
          eq(appProgress.userId, userId),
          eq(appProgress.appId, appId)
        ),
      });

      if (existing) {
        const serverTimestamp = existing.updatedAt.getTime();
        const nowTimestamp = Date.now();
        const mergeResult = mergeProgress(
          validation.data as AppProgressData,
          existing.data as AppProgressData,
          nowTimestamp,
          serverTimestamp
        );
        finalData = mergeResult.data;
        conflicts = mergeResult.conflicts;
      }
    }

    const now = new Date();
    const progressId = crypto.randomUUID();

    // TRANSACTION: Save progress and sync leaderboard atomically
    // This ensures data consistency between appProgress and leaderboard_entries
    await db.transaction(async (tx) => {
      // 1. UPSERT progress: Insert or update atomically
      await tx
        .insert(appProgress)
        .values({
          id: progressId,
          userId,
          appId,
          data: finalData,
          lastSyncedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [appProgress.userId, appProgress.appId],
          set: {
            data: finalData,
            lastSyncedAt: now,
            updatedAt: now,
          },
        });

      // 2. LEADERBOARD SYNC: Extract and upsert leaderboard entry
      if (hasLeaderboardSupport(appId)) {
        const scoreData = extractLeaderboardScore(
          appId as ValidAppId,
          finalData
        );

        // DIAGNOSTIC: Log extraction results to debug empty leaderboards
        if (!scoreData) {
          console.warn(
            `[LEADERBOARD] No score extracted for ${appId}. Progress data keys:`,
            Object.keys(finalData)
          );
        } else if (scoreData.score <= 0) {
          console.warn(
            `[LEADERBOARD] Score is ${scoreData.score} for ${appId}, skipping leaderboard update`
          );
        } else {
          console.log(
            `[LEADERBOARD] Extracted score ${scoreData.score} (${scoreData.scoreType}) for ${appId}`
          );
        }

        if (scoreData && scoreData.score > 0) {
          // Validate extracted score
          const validated = leaderboardEntrySchema.safeParse(scoreData);
          if (!validated.success) {
            console.warn(
              `[LEADERBOARD] Invalid score for ${appId}:`,
              validated.error.message
            );
            return; // Don't fail transaction, just skip leaderboard update
          }

          // Get or create gaming profile (server-side lookup by session)
          // RACE-SAFE: Handles both userId race (same user, two tabs) and
          // handle collision race (different users get same random handle)
          let profile = await tx.query.gamingProfiles.findFirst({
            where: eq(gamingProfiles.userId, userId),
          });

          if (!profile) {
            // Try up to 3 times in case of handle collision
            for (let attempt = 0; attempt < 3; attempt++) {
              const handle = await generateUniqueHandle(tx as unknown as typeof db);
              try {
                const [inserted] = await tx
                  .insert(gamingProfiles)
                  .values({
                    userId,
                    handle,
                  })
                  .onConflictDoNothing({ target: gamingProfiles.userId })
                  .returning();

                // If insert was a no-op (userId race - another tab won), fetch their profile
                profile = inserted || await tx.query.gamingProfiles.findFirst({
                  where: eq(gamingProfiles.userId, userId),
                });
                break; // Success - exit retry loop
              } catch (err) {
                // Handle collision (different user got same random handle)
                // The unique constraint on 'handle' column triggers this
                const isHandleCollision = err instanceof Error &&
                  err.message.includes("unique") &&
                  err.message.toLowerCase().includes("handle");

                if (isHandleCollision && attempt < 2) {
                  console.warn(`[LEADERBOARD] Handle collision on attempt ${attempt + 1}, retrying...`);
                  continue; // Try again with a new handle
                }
                throw err; // Other errors or max retries exceeded
              }
            }

            // Should never happen, but handle gracefully
            if (!profile) {
              console.error(`[LEADERBOARD] Failed to get/create profile for user ${userId}`);
              return;
            }
          }

          // Upsert leaderboard entry (only if new score is better)
          const isTimeBased = scoreData.scoreType === "fastest_time";

          await tx
            .insert(leaderboardEntries)
            .values({
              gamingProfileId: profile.id,
              appId,
              score: scoreData.score,
              scoreType: scoreData.scoreType,
              additionalStats: scoreData.stats || null,
              achievedAt: now, // SERVER TIMESTAMP - never from client
              syncedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                leaderboardEntries.gamingProfileId,
                leaderboardEntries.appId,
                leaderboardEntries.scoreType,
              ],
              set: {
                // Only update if new score is better
                score: isTimeBased
                  ? sql`CASE WHEN ${scoreData.score} < ${leaderboardEntries.score} THEN ${scoreData.score} ELSE ${leaderboardEntries.score} END`
                  : sql`CASE WHEN ${scoreData.score} > ${leaderboardEntries.score} THEN ${scoreData.score} ELSE ${leaderboardEntries.score} END`,
                additionalStats: isTimeBased
                  ? sql`CASE WHEN ${scoreData.score} < ${leaderboardEntries.score} THEN ${JSON.stringify(scoreData.stats || {})}::jsonb ELSE ${leaderboardEntries.additionalStats} END`
                  : sql`CASE WHEN ${scoreData.score} > ${leaderboardEntries.score} THEN ${JSON.stringify(scoreData.stats || {})}::jsonb ELSE ${leaderboardEntries.additionalStats} END`,
                achievedAt: isTimeBased
                  ? sql`CASE WHEN ${scoreData.score} < ${leaderboardEntries.score} THEN ${now} ELSE ${leaderboardEntries.achievedAt} END`
                  : sql`CASE WHEN ${scoreData.score} > ${leaderboardEntries.score} THEN ${now} ELSE ${leaderboardEntries.achievedAt} END`,
                syncedAt: now,
              },
            });
        }
      }
    });

    return NextResponse.json({
      success: true,
      updatedAt: now.toISOString(),
      merged: merge && conflicts.length === 0,
      conflicts,
    });
  } catch (error) {
    console.error("POST /api/progress error:", error);
    return NextResponse.json(
      { error: "Failed to save progress" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/progress/[appId]
 * Delete user's progress for a specific game/app
 * (For account deletion or "start over" feature)
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    const { appId } = await context.params;

    // Must be authenticated
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized - please log in" },
        { status: 401 }
      );
    }

    // Rate limit: 10 deletes per minute per user (stricter than saves)
    const rateLimit = checkProgressRateLimit(session.user.id);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${rateLimit.resetIn}s` },
        { status: 429 }
      );
    }

    // Validate appId
    if (!VALID_APP_IDS.includes(appId as ValidAppId)) {
      return NextResponse.json(
        { error: `Invalid app ID: ${appId}` },
        { status: 400 }
      );
    }

    // Find and delete progress (cascade will delete transactions)
    const existing = await db.query.appProgress.findFirst({
      where: and(
        eq(appProgress.userId, session.user.id),
        eq(appProgress.appId, appId)
      ),
    });

    if (!existing) {
      return NextResponse.json(
        { error: "No progress found to delete" },
        { status: 404 }
      );
    }

    // Capture userId before transaction (guaranteed to exist after auth check)
    const userId = session.user.id;

    // TRANSACTION: Delete progress and leaderboard entry atomically
    await db.transaction(async (tx) => {
      // Delete progress
      await tx.delete(appProgress).where(eq(appProgress.id, existing.id));

      // Delete leaderboard entry (if exists)
      const profile = await tx.query.gamingProfiles.findFirst({
        where: eq(gamingProfiles.userId, userId),
      });

      if (profile) {
        await tx.delete(leaderboardEntries).where(
          and(
            eq(leaderboardEntries.gamingProfileId, profile.id),
            eq(leaderboardEntries.appId, appId)
          )
        );
      }
    });

    return NextResponse.json({
      success: true,
      deleted: true,
    });
  } catch (error) {
    console.error("DELETE /api/progress error:", error);
    return NextResponse.json(
      { error: "Failed to delete progress" },
      { status: 500 }
    );
  }
}
