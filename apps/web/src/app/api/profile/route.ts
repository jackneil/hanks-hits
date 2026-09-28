import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, eq } from "@hank-neil/db";
import { users } from "@hank-neil/db/schema";
import { validateDisplayName } from "@/lib/validators";
import { logServerError } from "@/lib/server-log";
// Name changes use the shared in-memory limiter, so their counters are
// cleared on the same schedule as every other counter.
import { checkNameChangeRateLimit } from "@/lib/rate-limit";

/**
 * GET /api/profile
 * Fetch current user's profile info (including createdAt from DB)
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

    // Fetch user from DB to get createdAt
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      createdAt: user.createdAt?.toISOString() || null,
      emailVerified: user.emailVerified ? true : false,
      // Don't expose: password, updatedAt
    });
  } catch (error) {
    logServerError("GET /api/profile error", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/profile
 * Update user's display name
 *
 * Body: { name: string }
 */
export async function PATCH(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized - please log in" },
        { status: 401 }
      );
    }

    // Rate limit name changes (5 per hour per user)
    if (!checkNameChangeRateLimit(session.user.id).success) {
      return NextResponse.json(
        { error: "Too many name changes. Try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { name } = body as { name?: unknown };

    // Validate name (shared with the signup route so the rules can't drift)
    const nameResult = validateDisplayName(name);
    if (!nameResult.ok) {
      return NextResponse.json({ error: nameResult.error }, { status: 400 });
    }
    const trimmedName = nameResult.name;

    // Update user
    await db
      .update(users)
      .set({
        name: trimmedName,
        updatedAt: new Date(),
      })
      .where(eq(users.id, session.user.id));

    return NextResponse.json({
      success: true,
      name: trimmedName,
    });
  } catch (error) {
    logServerError("PATCH /api/profile error", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}
