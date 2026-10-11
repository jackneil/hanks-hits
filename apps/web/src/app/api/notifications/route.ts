import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, eq, and, desc, sql } from "@hank-neil/db";
import { notifications } from "@hank-neil/db/schema";
import { isSameOriginRequest } from "@/lib/same-origin";
import { readJson, refuseBody, SMALL_SAVE_BODY } from "@/lib/read-body";
import { checkRateLimit } from "@/lib/rate-limit";
import { describeError } from "@/lib/describe-error";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Sign in to see your updates" }, { status: 401, headers });
    if (request.headers.get("x-hh-expected-owner") !== session.user.id) return NextResponse.json({ error: "The signed-in account changed", code: "owner_changed" }, { status: 409, headers });
    if (!checkRateLimit(`inbox:${session.user.id}`, 120, 60_000).success) return NextResponse.json({ error: "Please try again shortly" }, { status: 429, headers });
    const items = await db.select({ id: notifications.id, kind: notifications.kind, appId: notifications.appId,
      actorHandle: notifications.actorHandle, createdAt: notifications.createdAt, readAt: notifications.readAt })
      .from(notifications).where(eq(notifications.userId, session.user.id))
      .orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(100);
    return NextResponse.json({ items }, { headers });
  } catch (error) {
    console.error("[live] history unavailable", describeError(error));
    return NextResponse.json({ error: "Your updates could not load. Please try again." }, { status: 503, headers });
  }
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest({ headers: request.headers })) return NextResponse.json({ error: "Request refused" }, { status: 403, headers });
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Sign in to see your updates" }, { status: 401, headers });
    if (request.headers.get("x-hh-expected-owner") !== session.user.id) return NextResponse.json({ error: "The signed-in account changed", code: "owner_changed" }, { status: 409, headers });
    if (!checkRateLimit(`inbox-write:${session.user.id}`, 60, 60_000).success) return NextResponse.json({ error: "Please try again shortly" }, { status: 429, headers });
    const read = await readJson(request, SMALL_SAVE_BODY);
    if (!read.ok) return refuseBody("PATCH /api/notifications", read, request);
    const id = typeof read.value === "object" && read.value !== null ? (read.value as { id?: unknown }).id : undefined;
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({ error: "Choose an update to mark read" }, { status: 400, headers });
    await db.update(notifications).set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(and(eq(notifications.userId, session.user.id), eq(notifications.id, id)));
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    console.error("[live] mark-read unavailable", describeError(error));
    return NextResponse.json({ error: "That update could not be marked read. Please try again." }, { status: 503, headers });
  }
}
