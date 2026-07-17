// SECURITY: the only host the ROM CDN's signed-URL redirect may point at.
// Anything else (other hosts, other protocols, protocol-relative tricks,
// relative paths) is rejected. Used by the /api/roms proxy, which follows
// exactly one validated redirect hop instead of blind redirect-following.
export const ALLOWED_REDIRECT_HOST = "storage.railway.app";

/**
 * Validate a CDN redirect Location and return it only if it is a well-formed
 * https URL on the pinned storage host; otherwise null.
 */
export function safeRedirectTarget(location: string): string | null {
  let url: URL;
  try {
    url = new URL(location); // relative Locations throw — the CDN sends absolute
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== ALLOWED_REDIRECT_HOST) return null;
  if (url.port !== "") return null; // default https port only
  if (url.username || url.password) return null; // no credentialed URLs
  return url.toString();
}
