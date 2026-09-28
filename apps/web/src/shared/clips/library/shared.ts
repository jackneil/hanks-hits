/**
 * Library names and helpers that the main thread also uses (the My Clips UI, the
 * share sheet). This module has no dependencies except types and ownerKey.ts, so an
 * import from the UI never pulls mediabunny into the main bundle (plan 4). A guard
 * test walks the imports of this module to keep it that way.
 */

import type { ClipRecord } from "../protocol";
import { isClipId } from "./ownerKey";

/** The Web Lock that every row write and every file move holds (plan 8.1). */
export const LIBRARY_LOCK = "hh-clips-lib";
/** The BroadcastChannel that tells other tabs about library changes (plan 8.1). */
export const LIBRARY_CHANNEL = "hh-clips";

export type StoredMime = ClipRecord["mime"];

export interface ReconcileResult {
  /** Files with no row that got a new row. */
  reindexed: number;
  /** Rows with no bytes (for example after the browser removed site data). */
  missing: number;
  /** Files with no row that did not parse. They were removed. */
  unreadable: number;
  /** Files in the wrong owner folder, moved to their row's owner. */
  relocated: number;
  /** Chunk sets with no row. They were removed. */
  orphanChunks: number;
  /** Temp files left from stopped writes. They were removed. */
  staleTemp: number;
  /** Entries that could not be checked. They stay as they are. */
  errors: number;
}

/** Messages on the "hh-clips" BroadcastChannel. */
export type LibraryMessage =
  | { added: string }
  | { removed: string }
  | { updated: string }
  | { reconciled: ReconcileResult };

const EXTENSIONS: Record<StoredMime, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "image/png": "png",
};

/** The file extension for a stored mime type, without the dot. */
export function extensionFor(mime: StoredMime): string {
  return EXTENSIONS[mime] ?? "mp4";
}

/** True for the mime types that the library can store. */
export function isStoredMime(value: unknown): value is StoredMime {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EXTENSIONS, value);
}

/** The name of a stored clip file, for example "abc.mp4". */
export function clipFileName(id: string, mime: StoredMime): string {
  return `${id}.${extensionFor(mime)}`;
}

/** The clip id and mime type of a stored file name, or null for any other file. */
export function parseClipFileName(name: string): { id: string; mime: StoredMime } | null {
  const match = /^(.+)\.(mp4|webm|png)$/.exec(name);
  if (!match || !isClipId(match[1])) return null;
  const mime = (Object.keys(EXTENSIONS) as StoredMime[]).find((key) => EXTENSIONS[key] === match[2]);
  return mime ? { id: match[1], mime } : null;
}

/** The name a shared or downloaded file gets, for example "snake-clip-2026-09-28.mp4". */
export function downloadName(record: ClipRecord): string {
  const game = record.gameId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "game";
  const date = new Date(record.createdAt);
  const day = Number.isNaN(date.getTime())
    ? "clip"
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${game}-${record.kind}-${day}.${extensionFor(record.mime)}`;
}
