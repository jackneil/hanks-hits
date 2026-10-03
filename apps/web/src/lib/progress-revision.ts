import { createHash } from "node:crypto";

/** Opaque identity of one committed row version, scoped to its owner and app. */
export function progressRevision(row: { id: string; userId: string; appId: string; updatedAt: Date }): string {
  return createHash("sha256")
    .update(JSON.stringify([row.userId, row.appId, row.id, row.updatedAt.toISOString()]))
    .digest("hex");
}

/** Every cooperating write advances the driver-visible millisecond under the row lock. */
export function nextProgressTime(previous: Date | undefined, now = Date.now()): Date {
  return new Date(Math.max(now, previous ? previous.getTime() + 1 : now));
}
