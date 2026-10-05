import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { validateProgress } from "@/lib/progress-schemas";
import { sameProgress } from "./progressStamp";

export type ProgressSnapshot<T> = { data: T | null; revision: string | null };
export type ProgressRequest<T> = { id: string; base: ProgressSnapshot<T>; data: T };
export type ProgressConflict<T> = {
  remote: ProgressSnapshot<T>;
  reason: "concurrent-edit" | "ambiguous-delivery" | "unknown-lineage" | "canonical-change";
  paths: string[];
};
export type ProgressJournal<T> = {
  version: 1;
  appId: ValidAppId;
  ownerId: string;
  writerId: string;
  serial: number;
  acknowledged: ProgressSnapshot<T>;
  sent: ProgressRequest<T> | null;
  live: T;
  conflict: ProgressConflict<T> | null;
  /** An explicit choice must advance the revision, even for an unchanged copy. */
  forceWrite: boolean;
  /** Opaque source bytes survive conversion, archive and later session writes. */
  imported?: { kind: "bakery-v1"; sourceKey: string; raw: string };
};

export const PROGRESS_JOURNAL_PREFIX = "progress-sync-v1-";
export const progressJournalKey = (appId: ValidAppId, writerId: string) =>
  `${PROGRESS_JOURNAL_PREFIX}${appId}-${writerId}-storage`;
export const cloneProgress = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(value);

/** Refuse lossy schema parsing: never silently remove an original local field. */
export function isJournalProgress(appId: ValidAppId, value: unknown): value is AppProgressData {
  const checked = validateProgress(appId, value);
  return checked.success && sameProgress(checked.data, value);
}
export function isProgressSnapshot<T extends AppProgressData>(appId: ValidAppId, value: unknown): value is ProgressSnapshot<T> {
  if (!object(value)) return false;
  if (value.revision === null) return value.data === null;
  return typeof value.revision === "string" && /^[a-f0-9]{64}$/.test(value.revision)
    && (value.data === null || isJournalProgress(appId, value.data));
}

/** The caller supplies the mounted owner and app; a stored record cannot select them. */
export function parseProgressJournal<T extends AppProgressData>(raw: string, appId: ValidAppId, ownerId: string): ProgressJournal<T> | null {
  try {
    const row: unknown = JSON.parse(raw);
    if (!object(row) || row.version !== 1 || row.appId !== appId || row.ownerId !== ownerId || !ownerId
      || !identifier(row.writerId) || !Number.isSafeInteger(row.serial) || (row.serial as number) < 0
      || !isProgressSnapshot(appId, row.acknowledged) || !isJournalProgress(appId, row.live)
      || typeof row.forceWrite !== "boolean") return null;
    if (row.imported !== undefined) {
      if (appId !== "cookie-clicker" || !object(row.imported) || row.imported.kind !== "bakery-v1"
        || typeof row.imported.sourceKey !== "string" || !row.imported.sourceKey
        || typeof row.imported.raw !== "string") return null;
      const imported: unknown = JSON.parse(row.imported.raw);
      if (!object(imported) || imported.version !== 1 || imported.ownerId !== ownerId) return null;
    }
    if (row.sent !== null && (!object(row.sent) || !identifier(row.sent.id)
      || !isProgressSnapshot(appId, row.sent.base) || !isJournalProgress(appId, row.sent.data)
      || !sameProgress(row.sent.base, row.acknowledged))) return null;
    if (row.conflict !== null && (!object(row.conflict) || !isProgressSnapshot(appId, row.conflict.remote)
      || !["concurrent-edit", "ambiguous-delivery", "unknown-lineage", "canonical-change"].includes(row.conflict.reason as string)
      || !Array.isArray(row.conflict.paths) || !row.conflict.paths.every(path => typeof path === "string"))) return null;
    return row as ProgressJournal<T>;
  } catch { return null; }
}

export function newProgressJournal<T extends AppProgressData>(
  appId: ValidAppId, ownerId: string, writerId: string, canonical: ProgressSnapshot<T>, live: T, related: boolean,
): ProgressJournal<T> {
  const row: ProgressJournal<T> = {
    version: 1, appId, ownerId, writerId, serial: 0, acknowledged: canonical, sent: null, live,
    conflict: related || sameProgress(canonical.data, live) ? null
      : { remote: canonical, reason: "unknown-lineage", paths: ["$root"] },
    forceWrite: false,
  };
  const checked = parseProgressJournal<T>(JSON.stringify(row), appId, ownerId);
  if (!checked) throw new Error("Invalid progress journal");
  return checked;
}
