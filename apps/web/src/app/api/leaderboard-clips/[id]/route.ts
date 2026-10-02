import { readBody, CLIP_DELETE_BODY } from "@/lib/read-body";
import { handleDelete } from "@/lib/leaderboard-clips/handlers";
import { defaultClipDeps } from "@/lib/leaderboard-clips/runtime";

/**
 * DELETE /api/leaderboard-clips/[id]: the owner (or an admin on
 * ADMIN_USER_IDS) takes the video off. An admin can send
 * { "keepForLegalReport": true } to move it to the legal hold instead.
 * See src/lib/leaderboard-clips/contract.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const meta = { url: request.url, method: request.method, headers: new Headers(request.headers) };
  return handleDelete(meta, () => readBody(request, CLIP_DELETE_BODY), id, defaultClipDeps());
}
