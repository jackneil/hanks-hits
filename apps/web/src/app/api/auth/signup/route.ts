import { NextResponse } from "next/server";
import { db, eq } from "@hank-neil/db";
import { users } from "@hank-neil/db/schema";
import bcrypt from "bcryptjs";
import { checkSignupRateLimit, getClientIP } from "@/lib/rate-limit";
import { validateDisplayName, displayNameFromEmail } from "@/lib/validators";
import { describeError } from "@/lib/describe-error";
import { readJson, refuseBody, SMALL_JSON_BODY } from "@/lib/read-body";

/** A JSON object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    // Rate limiting - 5 requests per minute per IP
    const clientIP = getClientIP(request);
    const rateLimit = checkSignupRateLimit(clientIP);

    if (!rateLimit.success) {
      return NextResponse.json(
        {
          error: "Too many signup attempts. Please try again later.",
          retryAfter: rateLimit.resetIn,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.resetIn) },
        }
      );
    }

    // A bounded read (64 KiB in 30 s): request.json() held a body of any
    // size in memory, with no sign-in needed.
    const read = await readJson(request, SMALL_JSON_BODY);
    if (!read.ok) return refuseBody("POST /api/auth/signup", read, request);
    if (!isRecord(read.value)) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }
    const { name, email: rawEmail, password } = read.value;

    // Normalize email (lowercase + trim) to prevent duplicate accounts
    const email =
      typeof rawEmail === "string" ? rawEmail.toLowerCase().trim() : undefined;

    // Validation. The typeof checks matter: a JSON number for password
    // would slip past a bare truthiness test, dodge the length rule
    // (undefined < 8 is false), and blow up in bcrypt as a 500.
    if (!email || !password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // SECURITY: bound and charset-check the display name. `name` is optional at
    // signup — an absent/blank name falls back to a sanitized email prefix — but
    // when one IS provided it must pass the same strict rules as a profile edit
    // (previously it was stored raw into an unbounded text column).
    const hasName =
      name !== undefined &&
      name !== null &&
      !(typeof name === "string" && name.trim() === "");
    let displayName: string;
    if (hasName) {
      const nameResult = validateDisplayName(name);
      if (!nameResult.ok) {
        return NextResponse.json({ error: nameResult.error }, { status: 400 });
      }
      displayName = nameResult.name;
    } else {
      displayName = displayNameFromEmail(email);
    }

    // Check if user already exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const [newUser] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: displayName,
        email,
        password: hashedPassword,
      })
      .returning();

    return NextResponse.json({
      success: true,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
      },
    });
  } catch (error) {
    console.error("Signup error:", describeError(error));
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
