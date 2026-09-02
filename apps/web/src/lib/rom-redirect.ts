// SECURITY: the only hosts the ROM CDN's signed-URL redirect may point at.
// Anything else (other hosts, other protocols, protocol-relative tricks,
// relative paths) is rejected. Used by the /api/roms proxy, which follows
// exactly one validated redirect hop instead of blind redirect-following.
//
// Railway object storage signs URLs on its S3 API host (t3.storageapi.dev).
// storage.railway.app is the older host and is kept so a rotation back to it
// does not take the whole ROM library down. Verified 2026-09-02 against the
// live CDN: a 302 from cdn-hankshits.up.railway.app points at t3.storageapi.dev.
export const ALLOWED_REDIRECT_HOSTS = [
  "t3.storageapi.dev",
  "storage.railway.app",
] as const;

/**
 * Validate a CDN redirect Location and return it only if it is a well-formed
 * https URL on one of the pinned storage hosts; otherwise null.
 */
export function safeRedirectTarget(location: string): string | null {
  let url: URL;
  try {
    url = new URL(location); // relative Locations throw — the CDN sends absolute
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!ALLOWED_REDIRECT_HOSTS.includes(url.hostname as (typeof ALLOWED_REDIRECT_HOSTS)[number])) return null;
  if (url.port !== "") return null; // default https port only
  if (url.username || url.password) return null; // no credentialed URLs
  return url.toString();
}
