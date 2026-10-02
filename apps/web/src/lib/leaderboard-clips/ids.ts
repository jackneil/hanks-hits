/**
 * Clip ids: 24 random URL-safe characters (18 random bytes in base64url).
 * An id has no meaning and cannot be guessed, so a clip that is not on the
 * leaderboard (hidden, or of a player who does not show) cannot be found.
 */
import { CLIP_ID_PATTERN } from "./contract";

/** A new clip id from the system's secure random source. */
export function newClipId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** True for a string that has the form of a clip id. */
export function isClipId(value: unknown): value is string {
  return typeof value === "string" && CLIP_ID_PATTERN.test(value);
}
