/**
 * The Content-Security-Policy sources that let a page play a leaderboard clip.
 *
 * The video and poster routes answer with a 302 to a signed bucket link.
 * After a redirect, the browser checks the new URL against media-src (and
 * img-src for the poster), so the bucket host must be in both lists
 * (CSP Level 3, section 7.6: paths are ignored after a redirect, the host is
 * not).
 *
 * next.config.ts builds the header once, at build time. It allows every
 * Railway bucket host (path style https://t3.storageapi.dev and virtual-hosted
 * style https://<bucket>.t3.storageapi.dev), plus the origin of
 * LEADERBOARD_CLIPS_S3_ENDPOINT when the build can see it (another S3
 * provider, or a local MinIO). At run time, config.ts turns the feature off
 * when the bucket origin is not in the list that the build used, so a page
 * can never show a player that the CSP blocks.
 *
 * Pure functions, no imports: next.config.ts and the server both use them.
 */

/** Railway object storage (Tigris), in path style and virtual-hosted style. */
export const RAILWAY_BUCKET_SOURCES = ["https://t3.storageapi.dev", "https://*.t3.storageapi.dev"] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The origin of an S3 endpoint setting, or null when the setting is not a
 * usable URL. Only https is accepted, except http on this computer (a local
 * MinIO for development and tests).
 */
export function endpointOrigin(endpoint: string | undefined): string | null {
  const raw = (endpoint ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
  return null;
}

/** The media sources for leaderboard clips: the Railway hosts, plus the endpoint origin when it is another host. */
export function clipMediaSources(endpoint: string | undefined): string[] {
  const sources: string[] = [...RAILWAY_BUCKET_SOURCES];
  const origin = endpointOrigin(endpoint);
  if (origin && !sources.some((source) => sourceAllows(source, origin))) sources.push(origin);
  return sources;
}

function defaultPort(protocol: string): string {
  return protocol === "https:" ? "443" : protocol === "http:" ? "80" : "";
}

/**
 * True when a CSP host-source (scheme://host[:port], with an optional "*."
 * host wildcard) matches an origin. This is the subset of the CSP matching
 * rules that clipMediaSources() produces.
 */
export function sourceAllows(source: string, origin: string): boolean {
  const match = /^(https?):\/\/(\*\.)?([^/:]+)(?::(\d+))?$/.exec(source);
  if (!match) return false;
  let target: URL;
  try {
    target = new URL(origin);
  } catch {
    return false;
  }
  const [, scheme, wildcard, host, port] = match;
  if (target.protocol !== `${scheme}:`) return false;
  const targetHost = target.hostname.toLowerCase();
  const sourceHost = host.toLowerCase();
  if (wildcard) {
    if (!targetHost.endsWith(`.${sourceHost}`)) return false;
  } else if (targetHost !== sourceHost) {
    return false;
  }
  const targetPort = target.port || defaultPort(target.protocol);
  const sourcePort = port || defaultPort(target.protocol);
  return targetPort === sourcePort;
}

/** True when one of the sources matches the origin. */
export function sourcesAllow(sources: readonly string[], origin: string): boolean {
  return sources.some((source) => sourceAllows(source, origin));
}
