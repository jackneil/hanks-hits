// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isSameOriginRequest, requestedHost } from "../same-origin";

/**
 * The site's same-origin check for routes that change state (the dogfood
 * cookie, and the leaderboard clip upload, report and delete). The report
 * route takes requests with no session, so this check is its only guard
 * against a request from another site.
 */
function request(headers: Record<string, string>): Request {
  // The URL is the server's own bind address, as in the standalone server:
  // the check must never read it.
  return new Request("http://0.0.0.0:3000/api/leaderboard-clips/x/report", { method: "POST", headers });
}

describe("isSameOriginRequest", () => {
  it("takes Sec-Fetch-Site: same-origin, and refuses every other value", () => {
    expect(isSameOriginRequest(request({ "sec-fetch-site": "same-origin" }))).toBe(true);
    for (const site of ["same-site", "cross-site", "none"]) {
      expect(isSameOriginRequest(request({ "sec-fetch-site": site, origin: "https://hankshits.com", host: "hankshits.com" })), site).toBe(false);
    }
  });

  it("without Sec-Fetch-Site, compares the Origin host with the host the browser asked for", () => {
    expect(isSameOriginRequest(request({ origin: "https://hankshits.com", host: "hankshits.com" }))).toBe(true);
    expect(isSameOriginRequest(request({ origin: "https://evil.example", host: "hankshits.com" }))).toBe(false);
    // Behind the edge proxy, X-Forwarded-Host is the host the browser used.
    expect(
      isSameOriginRequest(request({ origin: "https://hankshits.com", host: "10.0.0.5:3000", "x-forwarded-host": "hankshits.com, proxy" }))
    ).toBe(true);
    expect(isSameOriginRequest(request({ origin: "https://hankshits.com:8443", host: "hankshits.com" }))).toBe(false);
    expect(isSameOriginRequest(request({ origin: "null", host: "hankshits.com" }))).toBe(false);
  });

  it("lets a request with neither header through (not a browser cross-site request)", () => {
    expect(isSameOriginRequest(request({}))).toBe(true);
  });

  it("reads the requested host from X-Forwarded-Host first, then Host", () => {
    expect(requestedHost(request({ host: "a.example", "x-forwarded-host": " b.example , c" }))).toBe("b.example");
    expect(requestedHost(request({ host: "a.example" }))).toBe("a.example");
  });
});
