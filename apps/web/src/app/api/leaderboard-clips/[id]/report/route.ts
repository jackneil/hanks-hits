import { handleReport } from "@/lib/leaderboard-clips/handlers";
import { defaultClipDeps } from "@/lib/leaderboard-clips/runtime";

/**
 * POST /api/leaderboard-clips/[id]/report: anybody can report a video, and
 * it is hidden at once (no review queue). Rate limited by network address.
 * See src/lib/leaderboard-clips/contract.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const meta = { url: request.url, method: request.method, headers: new Headers(request.headers) };
  return handleReport(meta, id, defaultClipDeps());
}
