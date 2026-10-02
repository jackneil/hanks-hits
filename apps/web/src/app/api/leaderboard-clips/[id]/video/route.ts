import { handleMedia } from "@/lib/leaderboard-clips/handlers";
import { defaultClipDeps } from "@/lib/leaderboard-clips/runtime";

/**
 * GET /api/leaderboard-clips/[id]/video: a 302 to a signed bucket link that
 * works for 10 minutes. Anybody for a public clip; the owner also for a
 * clip that a report hid; 404 otherwise.
 * See src/lib/leaderboard-clips/contract.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  return handleMedia(id, "video", defaultClipDeps());
}
