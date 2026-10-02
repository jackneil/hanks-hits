import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, eq } from "@hank-neil/db";
import { users } from "@hank-neil/db/schema";
import { getOrCreateGamingProfile } from "@/lib/gaming-profile";

/**
 * GET /api/profile
 * The signed-in player's profile card: the made-up gamer name and the
 * date the account was made.
 *
 * An account keeps no name, email or photo (COPPA, issue #26i, see
 * lib/auth-privacy.ts), so there is none to show and no name to edit.
 * The gamer name is created on first sign-in. A session from before that
 * change gets its gamer name here.
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized - please log in" },
        { status: 401 }
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { createdAt: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const profile = await getOrCreateGamingProfile(db, session.user.id);

    return NextResponse.json({
      handle: profile?.handle ?? null,
      createdAt: user.createdAt?.toISOString() || null,
    });
  } catch (error) {
    console.error("GET /api/profile error:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}
