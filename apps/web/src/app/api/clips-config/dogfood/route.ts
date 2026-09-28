import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import {
  DOGFOOD_COOKIE,
  DOGFOOD_COOKIE_MAX_AGE_SEC,
  parseDogfoodIds,
  signDogfoodCookie,
} from "@/shared/clips/config";

/**
 * POST /api/clips-config/dogfood  - turn clips on for this browser (dogfood mode).
 * DELETE /api/clips-config/dogfood - turn them off again.
 *
 * POST sets the signed dogfood cookie only for a signed-in user whose id is in
 * CLIPS_DOGFOOD_USER_IDS. Anyone else gets 401 or 403, and any old cookie is
 * removed. The cookie is HttpOnly, SameSite=Lax and (in production) Secure.
 * A request from another origin is refused, in addition to SameSite.
 *
 * The origin check never uses request.nextUrl: the standalone server builds
 * it from its own bind address (HOSTNAME=0.0.0.0 and PORT in the Dockerfile),
 * not from the host the browser used. So the check reads what the browser
 * sent: Sec-Fetch-Site (every supported browser sends it) must be
 * "same-origin"; without it, the Origin host must equal the host the browser
 * asked for (X-Forwarded-Host from the proxy, else Host).
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** The host the browser asked for: the first X-Forwarded-Host entry (the edge proxy), else Host. */
function requestedHost(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("host");
}

function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  // No Origin and no Sec-Fetch-Site: not a browser cross-site request. The
  // session and the SameSite=Lax cookie still guard it.
  if (!origin) return true;
  const host = requestedHost(request);
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function withCookie(response: NextResponse, value: string, maxAge: number): NextResponse {
  response.cookies.set(DOGFOOD_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return response;
}

function clearCookie(response: NextResponse): NextResponse {
  return withCookie(response, "", 0);
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Wrong origin" }, { status: 403, headers: NO_STORE });
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Dogfood is not set up" }, { status: 503, headers: NO_STORE });
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return clearCookie(NextResponse.json({ error: "Please sign in" }, { status: 401, headers: NO_STORE }));
  }
  if (!parseDogfoodIds(process.env.CLIPS_DOGFOOD_USER_IDS).has(userId)) {
    return clearCookie(NextResponse.json({ error: "Not on the dogfood list" }, { status: 403, headers: NO_STORE }));
  }
  const expiresAt = Math.floor(Date.now() / 1000) + DOGFOOD_COOKIE_MAX_AGE_SEC;
  const value = await signDogfoodCookie(userId, secret, expiresAt);
  return withCookie(NextResponse.json({ dogfood: true }, { headers: NO_STORE }), value, DOGFOOD_COOKIE_MAX_AGE_SEC);
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Wrong origin" }, { status: 403, headers: NO_STORE });
  }
  return clearCookie(NextResponse.json({ dogfood: false }, { headers: NO_STORE }));
}
