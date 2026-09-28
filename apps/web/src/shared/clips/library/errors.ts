/**
 * Typed library errors. The codes are the io worker's error codes (protocol IoEvent),
 * so the UI can pick kid-word copy for each one.
 */

import type { EvictionOutcome } from "./eviction";

export type LibraryErrorCode = "quota" | "opfs-unavailable" | "verify-failed" | "not-found";

export class LibraryError extends Error {
  readonly code: LibraryErrorCode;
  /**
   * Clips that the failed operation removed before it failed (a save that made room
   * and then could not store the new clip). The UI must still hear about them
   * (plan 8.1: never a silent eviction). Null when nothing was removed.
   */
  eviction: EvictionOutcome | null = null;
  constructor(code: LibraryErrorCode, message: string) {
    super(message);
    this.name = "LibraryError";
    this.code = code;
  }
}

/**
 * The caller sent a value that is not valid (an unsafe id, a field the UI may not
 * change, an owner change the plan does not have). The io worker answers it with the
 * "bad-command" code. A plain TypeError from a bug stays a failure, not a bad command.
 */
export class InvalidInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}

/** True for a browser QuotaExceededError (a DOMException, or its newer subclass) or a quota LibraryError. */
export function isQuotaError(error: unknown): boolean {
  if (error instanceof LibraryError) return error.code === "quota";
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "QuotaExceededError";
}

/** True for a NotFoundError DOMException from the file system API. */
export function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "NotFoundError";
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
