import { NextResponse } from "next/server";
import { db, eq } from "@hank-neil/db";
import { users } from "@hank-neil/db/schema";
import bcrypt from "bcryptjs";
import { checkSignupRateLimit, getClientIP } from "@/lib/rate-limit";

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

    const { name, email: rawEmail, password } = await request.json();

    // Normalize email (lowercase + trim) to prevent duplicate accounts
    const email = rawEmail?.toLowerCase().trim();

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
        name: name || email.split("@")[0],
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
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
