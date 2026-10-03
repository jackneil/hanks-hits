import { db, eq, sql } from "@hank-neil/db";
import { legacyProgressWords, progressWordPolicy } from "@hank-neil/db/schema";
import { extractProgressWords, WORD_EXTRACTION_VERSION } from "./progress-words";
import { progressRevision } from "./progress-revision";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const WORD_POLICY_ID = "local-only";

/** Shared by every compatible writer; cutover takes the exclusive form. */
export async function lockWordPolicy(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended('hh:progress-word-policy:v1', 0))`);
}

/** A separate statement AFTER the locks, so Read Committed sees the new policy. */
export async function readWordPolicy(connection: Pick<Tx, "query">): Promise<boolean> {
  const policy = await connection.query.progressWordPolicy.findFirst({
    where: eq(progressWordPolicy.id, WORD_POLICY_ID),
  });
  if (!policy) throw new Error("Progress word policy is not installed");
  return policy.enabled;
}

/** Only the stored row is a source. Call inside the same transaction as replacement. */
export async function preserveProgressWords(tx: Tx, row: {
  id: string; userId: string; appId: string; data: unknown; updatedAt: Date;
}): Promise<void> {
  const payload = extractProgressWords(row.appId, row.data);
  if (!payload.fields.length) return;
  const sourceRevision = progressRevision(row);
  const prior = await tx.query.legacyProgressWords.findFirst({
    where: eq(legacyProgressWords.progressId, row.id),
  });
  await tx.insert(legacyProgressWords).values({
    progressId: row.id, sourceRevision, extractionVersion: WORD_EXTRACTION_VERSION, payload,
  }).onConflictDoNothing({ target: [
    legacyProgressWords.progressId, legacyProgressWords.sourceRevision, legacyProgressWords.extractionVersion,
  ] }).returning({ progressId: legacyProgressWords.progressId });
  if (prior && prior.sourceRevision !== sourceRevision) {
    console.warn(`[progress-words] ${row.appId}: preserved another stored legacy version`);
  }
}
