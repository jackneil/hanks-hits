/**
 * Typed library errors. The codes are the io worker's error codes (protocol IoEvent),
 * so the UI can pick kid-word copy for each one.
 */

export type LibraryErrorCode = "quota" | "opfs-unavailable" | "verify-failed" | "not-found";

export class LibraryError extends Error {
  readonly code: LibraryErrorCode;
  constructor(code: LibraryErrorCode, message: string) {
    super(message);
    this.name = "LibraryError";
    this.code = code;
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
