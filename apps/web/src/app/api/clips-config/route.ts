import { NextResponse, type NextRequest } from "next/server";

import { DOGFOOD_COOKIE, clipsVerdictFor, isUnknownClipsMode } from "@/shared/clips/config";

/**
 * GET /api/clips-config
 *
 * The clips flag verdict for this browser (plan 4.1): { mode, capture }.
 * CLIPS_MODE is read at request time, so the kill switch works without a
 * build. The answer depends on the dogfood cookie, so it is never cached.
 */
export const dynamic = "force-dynamic";

let warnedUnknownMode = false;

export async function GET(request: NextRequest) {
  const clipsMode = process.env.CLIPS_MODE;
  if (isUnknownClipsMode(clipsMode) && !warnedUnknownMode) {
    warnedUnknownMode = true;
    // Values-free: the variable name only, never its value.
    console.warn("[clips] CLIPS_MODE is not off, dogfood or on; clips are off.");
  }
  const verdict = await clipsVerdictFor({
    clipsMode,
    nodeEnv: process.env.NODE_ENV,
    cookie: request.cookies.get(DOGFOOD_COOKIE)?.value,
    secret: process.env.AUTH_SECRET,
    dogfoodIds: process.env.CLIPS_DOGFOOD_USER_IDS,
    nowSec: Math.floor(Date.now() / 1000),
  });
  return NextResponse.json(verdict, {
    headers: { "Cache-Control": "no-store, max-age=0", Vary: "Cookie" },
  });
}
