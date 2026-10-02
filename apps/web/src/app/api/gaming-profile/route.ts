import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, eq } from "@hank-neil/db";
import { gamingProfiles } from "@hank-neil/db/schema";
import { describeError } from "@/lib/describe-error";
import { readJson, refuseBody, SMALL_SAVE_BODY } from "@/lib/read-body";

/**
 * GET /api/gaming-profile
 * Get current user's gaming profile
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
      // User doesn't have a gaming profile yet (hasn't played any games)
      return NextResponse.json({
        handle: null,
        showOnLeaderboards: true,
        createdAt: null,
      });
    }

    return NextResponse.json({
      handle: profile.handle,
      showOnLeaderboards: profile.showOnLeaderboards,
      createdAt: profile.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("GET /api/gaming-profile error:", describeError(error));
    return NextResponse.json(
      { error: "Failed to fetch gaming profile" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/gaming-profile
 * Update user's gaming profile settings
 *
 * Body:
 * - showOnLeaderboards?: boolean - whether to appear on leaderboards
 *
 * Note: Handle customization is disabled for MVP (auto-generated only)
 */
export async function PATCH(request: Request) {
  try {
    const session = await auth();

    // Must be authenticated
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized - please log in" },
        { status: 401 }
      );
    }

    // A bounded read (64 KiB, no time limit: a save of a signed-in player):
    // request.json() held a body of any size in memory.
    const read = await readJson(request, SMALL_SAVE_BODY);
    if (!read.ok) return refuseBody("PATCH /api/gaming-profile", read, request);
    const body = read.value;
    const { showOnLeaderboards } =
      typeof body === "object" && body !== null
        ? (body as { showOnLeaderboards?: unknown })
        : {};

    // Validate input
    if (typeof showOnLeaderboards !== "boolean") {
      return NextResponse.json(
        { error: "Invalid showOnLeaderboards value" },
        { status: 400 }
      );
    }

    // Get user's gaming profile
    const profile = await db.query.gamingProfiles.findFirst({
      where: eq(gamingProfiles.userId, session.user.id),
    });

    if (!profile) {
      return NextResponse.json(
        { error: "No gaming profile found. Play a game first!" },
        { status: 404 }
      );
    }

    // Update profile
    await db
      .update(gamingProfiles)
      .set({
        showOnLeaderboards,
        updatedAt: new Date(),
      })
      .where(eq(gamingProfiles.id, profile.id));

    return NextResponse.json({
      success: true,
      showOnLeaderboards,
    });
  } catch (error) {
    console.error("PATCH /api/gaming-profile error:", describeError(error));
    return NextResponse.json(
      { error: "Failed to update gaming profile" },
      { status: 500 }
    );
  }
}
