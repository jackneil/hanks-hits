/**
 * The site's same-origin check for routes that change state.
 *
 * A request from another site is refused, in addition to the SameSite=Lax
 * session cookie. Routes that anybody can call with no session (the report
 * button of a leaderboard clip) depend on this check alone.
 *
 * The check never uses request.nextUrl: the standalone server builds it from
 * its own bind address (HOSTNAME=0.0.0.0 and PORT in the Dockerfile), not
 * from the host the browser used. So the check reads what the browser sent:
 * Sec-Fetch-Site (every supported browser sends it) must be "same-origin";
 * without it, the Origin host must equal the host the browser asked for
 * (X-Forwarded-Host from the proxy, else Host). A request with neither
 * header is not a browser cross-site request; the session still guards it.
 */

/** The host the browser asked for: the first X-Forwarded-Host entry (the edge proxy), else Host. */
export function requestedHost(request: Request | { headers: Headers }): string | null {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("host");
}

/** True when the request came from a page of this site (or from no browser at all). */
export function isSameOriginRequest(request: Request | { headers: Headers }): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = requestedHost(request);
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
