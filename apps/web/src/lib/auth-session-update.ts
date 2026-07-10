/**
 * Sanitizes the name a client passes to useSession().update({ name }) before
 * it is written into the session JWT. Only a bounded, non-empty string is
 * accepted; anything else returns null and the token is left untouched.
 */
export function sanitizeSessionNameUpdate(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().slice(0, 100);
  return trimmed.length > 0 ? trimmed : null;
}
