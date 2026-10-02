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
import { mergeForSave } from "@/lib/progress-merge";
import { validateProgress } from "@/lib/progress-schemas";
import { checkProgressDeleteRateLimit, checkProgressRateLimit } from "@/lib/rate-limit";
import { generateUniqueHandle } from "@/lib/handle-generator";
import {
  extractLeaderboardScore,
  hasLeaderboardSupport,
  toBoardEntry,
} from "@/lib/leaderboard-extractors";
import { leaderboardEntrySchema } from "@/lib/leaderboard-schemas";
import { describeError } from "@/lib/describe-error";

type RouteContext = {
  params: Promise<{ appId: string }>;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The UNIQUE constraint on gaming_profiles.handle (migration 0000). */
const HANDLE_UNIQUE_CONSTRAINT = "gaming_profiles_handle_unique";

/**
 * True when the error (or a cause under it) is a unique violation (SQLSTATE
 * 23505) on the gaming-profile handle. drizzle wraps the driver error in a
 * DrizzleQueryError whose own message is the SQL text, so the check reads
 * the driver fields on the cause chain, not the top-level message. Any other
 * 23505 (for example gaming_profiles_user_id_unique) is not a collision.
 */
function isHandleCollision(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e && typeof e === "object"; depth++) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (code === "23505" && constraint === HANDLE_UNIQUE_CONSTRAINT) {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Write the player's board entry for one save. Runs inside the savepoint
 * that POST opens, so a throw here undoes only the board work.
 */
async function syncLeaderboardEntry(
  tx: Tx,
  appId: ValidAppId,
  userId: string,
  finalData: AppProgressData,
  now: Date
): Promise<void> {
  const extracted = extractLeaderboardScore(appId, finalData);
  // The one place an extraction becomes a board entry: a whole number
  // (bigint column), rounded so it never flatters the player.
  const scoreData = toBoardEntry(extracted);

  // DIAGNOSTIC: Log extraction results to debug empty leaderboards
  if (!extracted) {
    console.warn(
      `[LEADERBOARD] No score extracted for ${appId}. Progress data keys:`,
      Object.keys(finalData)
    );
    return;
  }
  if (!scoreData) {
    console.warn(
      `[LEADERBOARD] No rankable ${extracted.scoreType} score for ${appId} (not finite, below 1, or over the limit), skipping leaderboard update`
    );
    return;
  }
  console.log(
    `[LEADERBOARD] Extracted score ${scoreData.score} (${scoreData.scoreType}) for ${appId}`
  );

  // Validate the board entry (bounds, integer, stats shape)
  const validated = leaderboardEntrySchema.safeParse(scoreData);
  if (!validated.success) {
    console.warn(
      `[LEADERBOARD] Invalid score for ${appId}:`,
      validated.error.message
    );
    return; // Skip the board update; the progress save is unaffected
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
        // Each attempt gets its own savepoint: a failed INSERT aborts the
        // enclosing transaction in Postgres, so without one the retry below
        // would run on an aborted transaction and fail again.
        const [inserted] = await tx.transaction((attemptTx) =>
          attemptTx
            .insert(gamingProfiles)
            .values({
              userId,
              handle,
            })
            .onConflictDoNothing({ target: gamingProfiles.userId })
            .returning()
        );

        // If insert was a no-op (userId race - another tab won), fetch their profile
        profile = inserted || await tx.query.gamingProfiles.findFirst({
          where: eq(gamingProfiles.userId, userId),
        });
        break; // Success - exit retry loop
      } catch (err) {
        // Handle collision (different user got same random handle): the
        // unique constraint on the 'handle' column triggers this.
        if (isHandleCollision(err) && attempt < 2) {
          console.warn(`[LEADERBOARD] Handle collision on attempt ${attempt + 1}, retrying...`);
          continue; // Try again with a new handle
        }
        throw err; // Other errors or max retries exceeded
      }
    }

    // Should never happen, but handle gracefully
    if (!profile) {
      console.error(`[LEADERBOARD] Failed to get/create a gaming profile for ${appId}`);
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
    console.error("GET /api/progress error:", describeError(error));
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
    const { data, merge = false } = body as {
      data: AppProgressData;
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

    // If merging, fetch existing first and merge. Ordering comes from the
    // progress blobs' own lastModified (validated + bounded by the zod schema);
    // the row's updatedAt only breaks ties when a blob carries no timestamp.
    // Field-aware reconcile means a stale/default blob can never erase earned
    // monotonic progress (see mergeForSave + the wipe regression tests).
    if (merge) {
      const existing = await db.query.appProgress.findFirst({
        where: and(
          eq(appProgress.userId, userId),
          eq(appProgress.appId, appId)
        ),
      });

      if (existing) {
        const mergeResult = mergeForSave(validation.data as AppProgressData, {
          data: existing.data as AppProgressData,
          updatedAt: existing.updatedAt,
        });
        // SECURITY: re-validate the MERGED blob before persisting — max() and
        // array-union combine two individually-valid blobs, and the result
        // must still satisfy the schema's bounds. If it doesn't, fall back to
        // the incoming validated payload rather than storing an unvalidated
        // shape (both inputs passed validation at their own write time).
        const mergedValidation = validateProgress(
          appId as ValidAppId,
          mergeResult.data
        );
        if (mergedValidation.success) {
          finalData = mergedValidation.data as AppProgressData;
          conflicts = mergeResult.conflicts;

          // TRIPWIRE: a merge must never SHRINK an unlockable set — the
          // reconciler unions them (arrays and id->timestamp records). If
          // this ever logs, trophies/unlocks are being dropped and the 3am
          // "my kid's trophies vanished" report has its trail.
          if (appId === "achievements") {
            const count = (blob: AppProgressData | undefined | null) => {
              const u = blob?.unlocked;
              return u && typeof u === "object" && !Array.isArray(u)
                ? Object.keys(u).length
                : 0;
            };
            const merged = count(finalData);
            const inputs = Math.max(
              count(validation.data as AppProgressData),
              count(existing.data as AppProgressData)
            );
            if (merged < inputs) {
              console.warn(
                `[achievements] merge SHRANK unlocked set for user ${userId}: ` +
                  `incoming=${count(validation.data as AppProgressData)} ` +
                  `existing=${count(existing.data as AppProgressData)} merged=${merged}`
              );
            }
          }
        } else {
          console.warn(
            `Merged progress for ${appId} failed re-validation; persisting incoming payload instead:`,
            mergedValidation.error
          );
        }
      }
    }

    const now = new Date();
    const progressId = crypto.randomUUID();

    // TRANSACTION: Save progress, then sync the leaderboard in a savepoint.
    // The progress blob is the player's save. The board row is a copy of a
    // number already inside that blob, so a board failure must never take
    // the save down with it.
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

      // 2. LEADERBOARD SYNC in a SAVEPOINT (a nested drizzle transaction).
      // If it throws, Postgres rolls back to the savepoint only: the progress
      // upsert above still commits, and the next save retries the board.
      if (hasLeaderboardSupport(appId)) {
        try {
          await tx.transaction((sp) =>
            syncLeaderboardEntry(sp, appId, userId, finalData, now)
          );
        } catch (error) {
          // Values-free on purpose: a driver error's text carries the query
          // params (user id, score, stats), so log only the game and the
          // error kind + SQLSTATE.
          console.error(
            `[LEADERBOARD] Board sync failed for ${appId}; progress saved without it:`,
            describeError(error)
          );
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
    console.error("POST /api/progress error:", describeError(error));
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
    const rateLimit = checkProgressDeleteRateLimit(session.user.id);
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
    console.error("DELETE /api/progress error:", describeError(error));
    return NextResponse.json(
      { error: "Failed to delete progress" },
      { status: 500 }
    );
  }
}
