import { readBody, CLIP_UPLOAD_BODY } from "@/lib/read-body";
import { handleConfig, handleRuns, handleUpload } from "@/lib/leaderboard-clips/handlers";
import { defaultClipDeps } from "@/lib/leaderboard-clips/runtime";

/**
 * GET  /api/leaderboard-clips: is the feature on? (LeaderboardClipConfigResponse)
 * POST /api/leaderboard-clips: put a run video on the leaderboard (multipart).
 *
 * The contract (fields, limits, responses, error codes) is in
 * src/lib/leaderboard-clips/contract.ts; the spec is design/LEADERBOARD_CLIPS.html.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const appId = new URL(request.url).searchParams.get("appId");
  return appId === null ? handleConfig(defaultClipDeps()) : handleRuns(appId, defaultClipDeps());
}

export function POST(request: Request) {
  const meta = { url: request.url, method: request.method, headers: new Headers(request.headers) };
  return handleUpload(meta, () => readBody(request, CLIP_UPLOAD_BODY), defaultClipDeps());
}
