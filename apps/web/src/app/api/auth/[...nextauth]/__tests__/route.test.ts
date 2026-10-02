// @vitest-environment node
/**
 * POST /api/auth/* is wrapped (route.ts): Auth.js reads the body itself
 * (@auth/core getBody: req.json() or req.text()) with no limit and before
 * any check, so the wrapper reads it first with the small JSON limits
 * (64 KiB in 30 s) and gives Auth.js a new request with the same bytes and
 * headers. These tests run the REAL Auth.js (next-auth with the app's
 * config in src/lib/auth.ts); only the database is a stand-in.
 */
import { inspect } from "node:util";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => {
  process.env.AUTH_SECRET = "test-secret-for-the-auth-route-wrapper-0123456789";
  return {
    row: null as null | { id: string; email: string; name: string; image: null; password: string },
    lookups: 0,
  };
});

vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: () => undefined }));
vi.mock("@hank-neil/db", () => ({
  db: {
    query: {
      users: {
        findFirst: async () => {
          user.lookups++;
          return user.row;
        },
      },
    },
  },
  eq: () => ({}),
}));

import { SMALL_JSON_BODY } from "@/lib/read-body";
import { GET, POST } from "../route";

const ORIGIN = "http://localhost:3000";
const BASE = `${ORIGIN}/api/auth`;
const EMAIL = "kid@example.com";
const PASSWORD = "test-password-truck-jumps-42";
const SESSION_COOKIE = "authjs.session-token";

beforeAll(async () => {
  user.row = { id: "user-kid-1", email: EMAIL, name: "Kid", image: null, password: await bcrypt.hash(PASSWORD, 4) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The name=value pairs of the Set-Cookie lines, for the next request's Cookie header. */
function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
}

/** The CSRF token and its cookie, from GET /api/auth/csrf. */
async function csrf(): Promise<{ token: string; cookie: string }> {
  const response = await GET(new NextRequest(`${BASE}/csrf`));
  expect(response.status).toBe(200);
  const { csrfToken } = (await response.json()) as { csrfToken: string };
  return { token: csrfToken, cookie: cookiesOf(response) };
}

function post(pathname: string, body: BodyInit | null, headers: Record<string, string>): NextRequest {
  return new NextRequest(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1]);
}

/** Sign in with the credentials form: the cookie header of the signed-in browser, and its CSRF token. */
async function signIn(): Promise<{ cookie: string; token: string }> {
  const { token, cookie } = await csrf();
  const form = new URLSearchParams({ csrfToken: token, email: EMAIL, password: PASSWORD, callbackUrl: `${ORIGIN}/` });
  const response = await POST(post("/callback/credentials", form.toString(), { cookie }));
  expect(response.status).toBe(302);
  const session = response.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`));
  expect(session).toBeDefined();
  return { cookie: `${cookie}; ${session!.split(";")[0]}`, token };
}

/** What console.error and console.warn printed, formatted the way Node prints it to a log. */
function printed(...spies: Array<{ mock: { calls: unknown[][] } }>): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 8 }))).join(" "))
    .join("\n");
}

describe("Auth.js behind the bounded wrapper: the flows still work", () => {
  it("gives a CSRF token and its cookie (GET is not wrapped)", async () => {
    const { token, cookie } = await csrf();
    expect(token).toMatch(/^[0-9a-f]{20,}$/);
    expect(cookie).toContain("authjs.csrf-token=");
  });

  it("signs a player in with the credentials form: a redirect and a session cookie", async () => {
    const { cookie } = await signIn();
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
  });

  it("signs a player in the way next-auth/react does (X-Auth-Return-Redirect: the URL in JSON)", async () => {
    const { token, cookie } = await csrf();
    const form = new URLSearchParams({ csrfToken: token, email: EMAIL, password: PASSWORD, callbackUrl: `${ORIGIN}/games`, redirect: "false" });
    const response = await POST(post("/callback/credentials", form.toString(), { cookie, "x-auth-return-redirect": "1" }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { url: string }).url).toBe(`${ORIGIN}/games`);
    expect(response.headers.getSetCookie().some((line) => line.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
  });

  it("runs the jwt and session callbacks: the session has the player's id", async () => {
    const { cookie } = await signIn();
    const response = await GET(new NextRequest(`${BASE}/session`, { headers: { cookie } }));
    expect(response.status).toBe(200);
    const session = (await response.json()) as { user: { id: string; email: string; name: string } };
    expect(session.user).toEqual(expect.objectContaining({ id: "user-kid-1", email: EMAIL, name: "Kid" }));
  });

  it("runs the jwt callback on a session update (a JSON POST): the name is read again from the database", async () => {
    const { cookie, token } = await signIn();
    user.row = { ...user.row!, name: "Hank" };
    try {
      const response = await POST(
        post("/session", JSON.stringify({ csrfToken: token, data: { name: "ignored" } }), {
          cookie,
          "content-type": "application/json",
        })
      );
      expect(response.status).toBe(200);
      expect(((await response.json()) as { user: { name: string } }).user.name).toBe("Hank");
    } finally {
      user.row = { ...user.row!, name: "Kid" };
    }
  });

  it("refuses a wrong password (no session cookie)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { token, cookie } = await csrf();
    const form = new URLSearchParams({ csrfToken: token, email: EMAIL, password: "wrong-password" });
    const response = await POST(post("/callback/credentials", form.toString(), { cookie }));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=CredentialsSignin");
    expect(response.headers.getSetCookie().some((line) => line.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    expect(printed(errors)).not.toContain("wrong-password");
  });

  it("refuses a sign-in with no CSRF token (the CSRF check still runs)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const form = new URLSearchParams({ email: EMAIL, password: PASSWORD });
    const response = await POST(post("/callback/credentials", form.toString(), {}));
    expect(response.headers.get("location")).toContain("error=MissingCSRF");
    expect(response.headers.getSetCookie().some((line) => line.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
  });

  it("signs a player out: the session cookie is cleared", async () => {
    const { cookie, token } = await signIn();
    const response = await POST(post("/signout", new URLSearchParams({ csrfToken: token }).toString(), { cookie }));
    expect(response.status).toBe(302);
    const cleared = response.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(new RegExp(`^${SESSION_COOKIE}=;|Max-Age=0|Expires=Thu, 01 Jan 1970`, "i"));
  });
});

describe("Auth.js behind the bounded wrapper: the body limit", () => {
  it("refuses a declared Content-Length over 64 KiB with 413 before it reads the body or asks the database", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled++;
          controller.enqueue(new Uint8Array(1024).fill(0x61));
        },
      },
      { highWaterMark: 0 }
    );
    const lookups = user.lookups;
    const response = await POST(post("/callback/credentials", body, { "content-length": String(SMALL_JSON_BODY.maxBytes + 1) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "The request is too big." });
    expect(pulled).toBe(0);
    expect(user.lookups).toBe(lookups);
  });

  it("stops a chunked body (no Content-Length, no session) at 64 KiB plus one chunk, and answers 413", async () => {
    let sent = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          sent += 16 * 1024;
          controller.enqueue(new Uint8Array(16 * 1024).fill(0x61));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 }
    );
    const response = await POST(post("/callback/credentials", body, {}));
    expect(response.status).toBe(413);
    expect(sent).toBe(SMALL_JSON_BODY.maxBytes + 16 * 1024);
    expect(cancelled).toBe(true);
  });

  it("gives Auth.js an empty body as an empty body: an empty JSON sign-in gets Auth.js's own 400, as before the wrapper", async () => {
    // Next.js gives an empty POST an empty body stream, not null. A null body
    // here made Auth.js answer a MissingCSRF redirect in place of its 400.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(
      new NextRequest(`${BASE}/callback/credentials`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "0" },
        body: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
        duplex: "half",
      } as ConstructorParameters<typeof NextRequest>[1])
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("writes one log line for a refused body (a sign of an attack), with no value of the body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = `password=hunter22&pad=${"a".repeat(SMALL_JSON_BODY.maxBytes)}`;
    const response = await POST(post("/callback/credentials", body, {}));
    expect(response.status).toBe(413);
    const lines = warn.mock.calls.map((args) => args.join(" "));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\[read-body\] POST \/api\/auth\/\[\.\.\.nextauth\]: refused a request body \(too_big; declared no bytes, received \d+ bytes\)$/
    );
    expect(lines[0]).not.toContain("hunter22");
  });

  it("passes a sign-in form of exactly 64 KiB to Auth.js", async () => {
    const { token, cookie } = await csrf();
    const head = new URLSearchParams({ csrfToken: token, email: EMAIL, password: PASSWORD, callbackUrl: `${ORIGIN}/` }).toString();
    const form = `${head}&pad=${"a".repeat(SMALL_JSON_BODY.maxBytes - head.length - "&pad=".length)}`;
    expect(new TextEncoder().encode(form).byteLength).toBe(SMALL_JSON_BODY.maxBytes);
    const response = await POST(post("/callback/credentials", form, { cookie }));
    expect(response.status).toBe(302);
    expect(response.headers.getSetCookie().some((line) => line.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
  });
});

describe("Auth.js logs errors with no value in them", () => {
  it("logs a JSON body that does not parse without the text near the bad token (part of a password)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await POST(
      post("/callback/credentials", `{"email":"${EMAIL}","password":hunter22secret}`, { "content-type": "application/json" })
    );
    // Auth.js answers as before (its own 400); only the log line changed.
    expect(response.status).toBe(400);
    const logged = printed(errors, warnings);
    expect(logged).toContain("[auth][error]");
    expect(logged).toContain("SyntaxError");
    expect(logged).not.toContain("hunter22");
    expect(logged).not.toContain(EMAIL);
  });
});
