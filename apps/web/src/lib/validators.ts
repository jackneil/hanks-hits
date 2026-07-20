/**
 * Shared input validators for user-supplied identity fields.
 *
 * SECURITY: the display name is the one free-text field a user controls that is
 * persisted and rendered back (header avatar, profile page). It must be bounded
 * and charset-restricted at EVERY write path. Both the signup route and the
 * profile PATCH route use these helpers so the rules can never drift apart —
 * previously signup stored the raw body `name` with no checks while profile
 * validated strictly, an inconsistency this module removes.
 */

export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 50;

// Allowed: letters, digits, spaces, and the small set of name punctuation kids
// actually use (underscore, hyphen, apostrophe, period). No angle brackets,
// quotes, or ampersands — belt-and-suspenders against markup even though React
// auto-escapes on render.
const DISPLAY_NAME_PATTERN = /^[a-zA-Z0-9 _\-'.]+$/;

export type DisplayNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

/**
 * Strictly validate a user-provided display name. Used wherever a name is
 * explicitly supplied (profile edits, and signup when the body includes one).
 * Returns the trimmed name on success, or a user-safe error string.
 */
export function validateDisplayName(input: unknown): DisplayNameResult {
  if (typeof input !== "string") {
    return { ok: false, error: "Name must be a string" };
  }

  const trimmed = input.trim();

  if (trimmed.length < DISPLAY_NAME_MIN || trimmed.length > DISPLAY_NAME_MAX) {
    return {
      ok: false,
      error: `Name must be ${DISPLAY_NAME_MIN}-${DISPLAY_NAME_MAX} characters`,
    };
  }

  if (!DISPLAY_NAME_PATTERN.test(trimmed)) {
    return { ok: false, error: "Name contains invalid characters" };
  }

  return { ok: true, name: trimmed };
}

/**
 * Derive a safe default display name from an email local-part, for signup when
 * no name is supplied. The result is sanitized to the allowed charset and
 * clamped so it always satisfies validateDisplayName's rules (email local-parts
 * can legally contain characters like `+` that the name charset forbids).
 */
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const cleaned = local
    .replace(/[^a-zA-Z0-9 _\-'.]/g, "")
    .trim()
    .slice(0, DISPLAY_NAME_MAX);
  return cleaned.length >= DISPLAY_NAME_MIN ? cleaned : "player";
}
