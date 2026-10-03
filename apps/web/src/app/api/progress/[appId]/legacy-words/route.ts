import { NextResponse } from "next/server";
import { db, eq, and } from "@hank-neil/db";
import { appProgress, legacyProgressWords, VALID_APP_IDS, type ValidAppId } from "@hank-neil/db/schema";
import { auth } from "@/lib/auth";
import { describeError } from "@/lib/describe-error";
import { progressRevision } from "@/lib/progress-revision";
import { extractProgressWords, WORD_EXTRACTION_VERSION } from "@/lib/progress-words";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

/** Transitional recovery of already-stored words. Never accepts new words or deletes candidates. */
export async function GET(request: Request, context: { params: Promise<{ appId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return json({ error: "Please sign in" }, 401);
    const userId = session.user.id;
    // Assertion only: the session still supplies the lookup owner.
    if (request.headers.get("x-hh-expected-owner") !== userId) {
      return json({ error: "The signed-in account changed", code: "owner_changed" }, 409);
    }
    const { appId } = await context.params;
    if (!VALID_APP_IDS.includes(appId as ValidAppId)) return json({ error: "Invalid app" }, 400);
    const candidates = await db.transaction(async (tx) => {
      const progress = await tx.query.appProgress.findFirst({
        where: and(eq(appProgress.userId, userId), eq(appProgress.appId, appId)),
      });
      if (!progress) return [];
      // The parent lookup owns the candidate set. Both reads share one snapshot,
      // including when a concurrent save archives and replaces the source.
      const archived = await tx.query.legacyProgressWords.findMany({
        where: eq(legacyProgressWords.progressId, progress.id),
        orderBy: (words, { asc }) => [asc(words.capturedAt), asc(words.sourceRevision)],
      });
      const result = archived.map(({ sourceRevision, extractionVersion, payload }) => ({
        sourceRevision, extractionVersion, payload,
      }));
      const payload = extractProgressWords(appId, progress.data);
      const sourceRevision = progressRevision(progress);
      if (payload.fields.length && !result.some((c) => c.sourceRevision === sourceRevision && c.extractionVersion === WORD_EXTRACTION_VERSION)) {
        result.push({ sourceRevision, extractionVersion: WORD_EXTRACTION_VERSION, payload });
      }
      return result;
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    return json({ appId, candidates });
  } catch (error) {
    console.error("Legacy word recovery failed:", describeError(error));
    return json({ error: "Could not recover saved words" }, 500);
  }
}
