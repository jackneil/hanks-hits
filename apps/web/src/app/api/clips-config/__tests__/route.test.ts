// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

import { DOGFOOD_COOKIE, DOGFOOD_COOKIE_MAX_AGE_SEC, signDogfoodCookie } from "@/shared/clips/config";
import { GET } from "../route";
import { DELETE, POST } from "../dogfood/route";

// A test-only signing value, built at run time (not a credential).
const SECRET = ["route", "test", "only", "signing", "value"].join(":");

function verdictRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/clips-config", {
    headers: cookie ? { cookie: `${DOGFOOD_COOKIE}=${cookie}` } : {},
  });
}

/** A request as a browser sends it: every HTTP request carries Host. */
function dogfoodRequest(method: "POST" | "DELETE", origin?: string): NextRequest {
  return new NextRequest("http://localhost/api/clips-config/dogfood", {
    method,
    headers: origin ? { host: "localhost", origin } : { host: "localhost" },
  });
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/clips-config", () => {
  it("is on by default in development and off by default in production", async () => {
    vi.stubEnv("CLIPS_MODE", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(await (await GET(verdictRequest())).json()).toEqual({ mode: "on", capture: true });
    vi.stubEnv("NODE_ENV", "production");
    expect(await (await GET(verdictRequest())).json()).toEqual({ mode: "off", capture: false });
  });

  it("follows CLIPS_MODE at request time and is never cached", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLIPS_MODE", "on");
    const on = await GET(verdictRequest());
    expect(await on.json()).toEqual({ mode: "on", capture: true });
    expect(on.headers.get("cache-control")).toContain("no-store");
    vi.stubEnv("CLIPS_MODE", "off");
    expect(await (await GET(verdictRequest())).json()).toEqual({ mode: "off", capture: false });
  });

  it("fails closed on an unknown CLIPS_MODE and logs without the value", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CLIPS_MODE", "maybe-secret-value");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await (await GET(verdictRequest())).json()).toEqual({ mode: "off", capture: false });
    for (const call of warn.mock.calls) expect(String(call[0])).not.toContain("maybe-secret-value");
    warn.mockRestore();
  });

  describe("dogfood mode", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CLIPS_MODE", "dogfood");
      vi.stubEnv("AUTH_SECRET", SECRET);
      vi.stubEnv("CLIPS_DOGFOOD_USER_IDS", "user-a, user-b");
    });
    const future = () => Math.floor(Date.now() / 1000) + 3600;

    it("is off without a cookie", async () => {
      expect(await (await GET(verdictRequest())).json()).toEqual({ mode: "dogfood", capture: false });
    });

    it("is on with a valid signed cookie for a listed user", async () => {
      const cookie = await signDogfoodCookie("user-a", SECRET, future());
      expect(await (await GET(verdictRequest(cookie))).json()).toEqual({ mode: "dogfood", capture: true });
    });

    it("is off with a cookie signed with another secret, an expired cookie, or a user who left the list", async () => {
      const forged = await signDogfoodCookie("user-a", "another-secret", future());
      const expired = await signDogfoodCookie("user-a", SECRET, Math.floor(Date.now() / 1000) - 1);
      const removed = await signDogfoodCookie("user-c", SECRET, future());
      for (const cookie of [forged, expired, removed, "v1.garbage", "nonsense"]) {
        expect(await (await GET(verdictRequest(cookie))).json()).toEqual({ mode: "dogfood", capture: false });
      }
    });

    it("is off when AUTH_SECRET is missing, even with a cookie", async () => {
      const cookie = await signDogfoodCookie("user-a", SECRET, future());
      vi.stubEnv("AUTH_SECRET", "");
      expect(await (await GET(verdictRequest(cookie))).json()).toEqual({ mode: "dogfood", capture: false });
    });
  });
});

describe("POST /api/clips-config/dogfood", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLIPS_MODE", "dogfood");
    vi.stubEnv("AUTH_SECRET", SECRET);
    vi.stubEnv("CLIPS_DOGFOOD_USER_IDS", "user-a");
  });

  it("sets a signed, HttpOnly, Secure, Lax cookie for a listed signed-in user that the verdict route accepts", async () => {
    authMock.mockResolvedValue({ user: { id: "user-a" } });
    const response = await POST(dogfoodRequest("POST", "http://localhost"));
    expect(response.status).toBe(200);
    const cookie = response.cookies.get(DOGFOOD_COOKIE);
    expect(cookie?.value).toMatch(/^v1\./);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: DOGFOOD_COOKIE_MAX_AGE_SEC });
    expect(await (await GET(verdictRequest(cookie!.value))).json()).toEqual({ mode: "dogfood", capture: true });
  });

  it("refuses a guest (401) and a user who is not listed (403), and clears any old cookie", async () => {
    const guest = await POST(dogfoodRequest("POST"));
    expect(guest.status).toBe(401);
    expect(guest.cookies.get(DOGFOOD_COOKIE)?.value).toBe("");
    authMock.mockResolvedValue({ user: { id: "user-z" } });
    const stranger = await POST(dogfoodRequest("POST"));
    expect(stranger.status).toBe(403);
    expect(stranger.cookies.get(DOGFOOD_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });

  it("refuses another origin before it reads the session", async () => {
    authMock.mockResolvedValue({ user: { id: "user-a" } });
    const response = await POST(dogfoodRequest("POST", "https://evil.example"));
    expect(response.status).toBe(403);
    expect(authMock).not.toHaveBeenCalled();
    expect(response.cookies.get(DOGFOOD_COOKIE)).toBeUndefined();
  });

  /**
   * The deployed shape: the standalone server builds request.nextUrl from its
   * bind address (HOSTNAME=0.0.0.0, PORT=3000), while the browser sends the
   * public host. The check must use what the browser sent.
   */
  function deployedRequest(method: "POST" | "DELETE", headers: Record<string, string>): NextRequest {
    return new NextRequest("http://0.0.0.0:3000/api/clips-config/dogfood", { method, headers });
  }

  it("accepts a same-origin browser POST on the deployed server, whose own URL is its bind address", async () => {
    authMock.mockResolvedValue({ user: { id: "user-a" } });
    const viaSecFetch = await POST(deployedRequest("POST", { host: "hankshits.com", origin: "https://hankshits.com", "sec-fetch-site": "same-origin" }));
    expect(viaSecFetch.status).toBe(200);
    expect(viaSecFetch.cookies.get(DOGFOOD_COOKIE)?.value).toMatch(/^v1\./);
    // An older browser with no Sec-Fetch-Site: Origin against Host, or against the proxy's X-Forwarded-Host.
    expect((await POST(deployedRequest("POST", { host: "hankshits.com", origin: "https://hankshits.com" }))).status).toBe(200);
    expect(
      (await POST(deployedRequest("POST", { host: "internal:3000", "x-forwarded-host": "hankshits.com", origin: "https://hankshits.com" }))).status,
    ).toBe(200);
    expect((await DELETE(deployedRequest("DELETE", { host: "hankshits.com", origin: "https://hankshits.com", "sec-fetch-site": "same-origin" }))).status).toBe(200);
  });

  it("refuses a cross-site POST on the deployed server by Sec-Fetch-Site, and by Origin when that header is missing", async () => {
    authMock.mockResolvedValue({ user: { id: "user-a" } });
    for (const site of ["cross-site", "same-site", "none"]) {
      const response = await POST(deployedRequest("POST", { host: "hankshits.com", origin: "https://hankshits.com", "sec-fetch-site": site }));
      expect(response.status, site).toBe(403);
    }
    expect((await POST(deployedRequest("POST", { host: "hankshits.com", origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(deployedRequest("POST", { host: "hankshits.com", origin: "not a url" }))).status).toBe(403);
    expect((await DELETE(deployedRequest("DELETE", { host: "hankshits.com", "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(authMock).not.toHaveBeenCalled();
  });

  it("answers 503 when AUTH_SECRET is not set", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    authMock.mockResolvedValue({ user: { id: "user-a" } });
    expect((await POST(dogfoodRequest("POST"))).status).toBe(503);
  });

  it("DELETE clears the cookie", async () => {
    const response = await DELETE(dogfoodRequest("DELETE"));
    expect(response.status).toBe(200);
    expect(response.cookies.get(DOGFOOD_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });
});
