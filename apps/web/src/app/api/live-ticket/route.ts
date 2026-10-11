import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { issueLiveTicket } from "@/lib/live/ticket";
import { isSameOriginRequest } from "@/lib/same-origin";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";
import { describeError } from "@/lib/describe-error";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOriginRequest({ headers: request.headers })) return NextResponse.json({ error: "Request refused" }, { status: 403, headers });
  if (!checkRateLimit(`live-ticket:${getClientIP({ headers: request.headers })}`, 60, 60_000).success) {
    return NextResponse.json({ error: "Please try again shortly" }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "Live updates unavailable" }, { status: 503, headers });
  try {
    const session = await auth();
    if (request.headers.get("x-hh-expected-owner") !== (session?.user?.id ?? "")) return NextResponse.json({ error: "The signed-in account changed", code: "owner_changed" }, { status: 409, headers });
    return NextResponse.json({ ticket: issueLiveTicket(session?.user?.id ?? null, secret) }, { headers });
  } catch (error) {
    console.error("[live] ticket unavailable", describeError(error));
    return NextResponse.json({ error: "Live updates unavailable" }, { status: 503, headers });
  }
}
