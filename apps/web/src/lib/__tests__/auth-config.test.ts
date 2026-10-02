// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real Auth.js config in lib/auth.ts, caught at the NextAuth() call.
 *
 * COPPA (16 CFR 312.5(c)(7), issue #26i): sign-in is Google only, an
 * account keeps only Google's subject id, and the session cookie and the
 * session response hold only the user id and the made-up gamer name.
 */

const captured = vi.hoisted(() => ({ config: null as null | Record<string, unknown> }));
const base = vi.hoisted(() => ({
  createUser: vi.fn(async (user: Record<string, unknown>) => user),
  updateUser: vi.fn(async (user: Record<string, unknown>) => user),
  linkAccount: vi.fn(async (account: Record<string, unknown>) => account),
  getUserByAccount: vi.fn(async () => null),
}));
const gamingProfile = vi.hoisted(() => ({
  sessionGamerName: vi.fn(async (): Promise<string | null> => "TurboFox42"),
}));

vi.mock("next-auth", () => ({
  default: (config: Record<string, unknown>) => {
    captured.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: () => base }));
vi.mock("@hank-neil/db", () => ({ db: {}, eq: vi.fn() }));
const signInAccounts = vi.hoisted(() => ({
  hasSignInAccount: vi.fn(async (): Promise<boolean> => false),
}));
vi.mock("@/lib/sign-in-accounts", () => signInAccounts);
vi.mock("@/lib/gaming-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gaming-profile")>()),
  sessionGamerName: gamingProfile.sessionGamerName,
}));

await import("../auth");

// Fields that are personal information or tokens, in any of their Auth.js names.
const PERSONAL = [
  "name",
  "email",
  "emailVerified",
  "email_verified",
  "image",
  "picture",
  "given_name",
  "family_name",
  "access_token",
  "refresh_token",
  "id_token",
  "expires_at",
  "token_type",
  "scope",
  "session_state",
];

const GOOGLE_CLAIMS = {
  sub: "109876543210987654321",
  email: "kid@example.com",
  email_verified: true,
  name: "Kid Example",
  given_name: "Kid",
  family_name: "Example",
  picture: "https://lh3.googleusercontent.com/a/photo",
  iss: "https://accounts.google.com",
  aud: "client",
  azp: "client",
  iat: 1,
  exp: 2,
};

const TOKEN_SET = {
  access_token: "synthetic-access-token-secret",
  refresh_token: "1//refresh",
  id_token: "eyJhbGciOi.header.payload-with-email",
  expires_at: 1790000000,
  token_type: "bearer",
  scope: "openid email profile",
  session_state: "state",
};

type Provider = { id: string; type: string; options?: Record<string, unknown> };
type Callbacks = {
  jwt: (params: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  session: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
type AnyAdapter = Record<string, (arg: Record<string, unknown>) => Promise<unknown>>;

function config() {
  if (!captured.config) throw new Error("lib/auth.ts did not call NextAuth()");
  return captured.config as {
    providers: Provider[];
    adapter: AnyAdapter;
    callbacks: Callbacks;
    session: { strategy: string };
  };
}

function google(): Provider {
  const provider = config().providers.find((p) => p.id === "google");
  if (!provider) throw new Error("no Google provider");
  return provider;
}

function personalKeysIn(value: unknown): string[] {
  const found: string[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    for (const [key, inner] of Object.entries(v)) {
      if (PERSONAL.includes(key)) found.push(key);
      walk(inner);
    }
  };
  walk(value);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  gamingProfile.sessionGamerName.mockImplementation(async () => "TurboFox42");
});

describe("sign-in providers", () => {
  it("is Google only: no email and password sign-in", () => {
    expect(config().providers.map((p) => p.id)).toEqual(["google"]);
  });

  it("keeps only Google's subject id from the profile", async () => {
    const profile = google().options?.profile as ((claims: unknown) => unknown) | undefined;
    expect(profile, "the Google provider must set profile()").toBeTypeOf("function");
    expect(await profile!(GOOGLE_CLAIMS)).toEqual({
      id: GOOGLE_CLAIMS.sub,
      name: null,
      email: null,
      image: null,
    });
  });

  it("stores no token of the token set", async () => {
    const account = google().options?.account as ((tokens: unknown) => unknown) | undefined;
    expect(account, "the Google provider must set account()").toBeTypeOf("function");
    expect(await account!(TOKEN_SET)).toEqual({});
  });

  it("asks Google for the openid scope only, so Google sends no email, name or photo", () => {
    const authorization = google().options?.authorization as { params?: { scope?: string } } | undefined;
    expect(authorization?.params?.scope).toBe("openid");
  });

  it("keeps JWT sessions (no session rows in the database)", () => {
    expect(config().session.strategy).toBe("jwt");
  });
});

describe("the database adapter", () => {
  it("creates a user with no name, email, email_verified or image", async () => {
    await config().adapter.createUser({
      id: "u1",
      name: "Kid Example",
      email: "kid@example.com",
      emailVerified: new Date(),
      image: "https://lh3.googleusercontent.com/a/photo",
    });
    expect(base.createUser).toHaveBeenCalledTimes(1);
    const written = base.createUser.mock.calls[0][0];
    expect(written).toMatchObject({ id: "u1", name: null, email: null, emailVerified: null, image: null });
  });

  it("drops personal fields from a user update", async () => {
    await config().adapter.updateUser({ id: "u1", name: "Kid", email: "kid@example.com", image: "x", emailVerified: new Date() });
    expect(base.updateUser.mock.calls[0][0]).toEqual({ id: "u1" });
  });

  it("links an account with no tokens", async () => {
    await config().adapter.linkAccount({
      userId: "u1",
      type: "oidc",
      provider: "google",
      providerAccountId: GOOGLE_CLAIMS.sub,
      ...TOKEN_SET,
    });
    expect(base.linkAccount.mock.calls[0][0]).toEqual({
      userId: "u1",
      type: "oidc",
      provider: "google",
      providerAccountId: GOOGLE_CLAIMS.sub,
    });
  });

  it("refuses to link a second sign-in account to a player (a new Google account while signed in)", async () => {
    signInAccounts.hasSignInAccount.mockImplementationOnce(async () => true);
    await expect(
      config().adapter.linkAccount({ userId: "u1", type: "oidc", provider: "google", providerAccountId: "other-sub" })
    ).rejects.toThrow(/already has a sign-in account/);
    expect(signInAccounts.hasSignInAccount).toHaveBeenCalledWith(expect.anything(), "u1");
    expect(base.linkAccount).not.toHaveBeenCalled();
  });

  it("keeps the adapter's read methods", () => {
    expect(config().adapter.getUserByAccount).toBeTypeOf("function");
  });
});

describe("the session cookie (jwt callback)", () => {
  it("holds only the user id and the gamer name after a sign-in", async () => {
    const token = await config().callbacks.jwt({
      // Auth.js's default token at sign-in.
      token: { name: "Kid Example", email: "kid@example.com", picture: "https://x/photo", sub: "u1" },
      user: { id: "u1", name: "Kid Example", email: "kid@example.com", image: "https://x/photo" },
      account: { provider: "google", type: "oidc", providerAccountId: GOOGLE_CLAIMS.sub, ...TOKEN_SET },
      profile: GOOGLE_CLAIMS,
      trigger: "signIn",
      isNewUser: true,
    });
    expect(token).toEqual({ sub: "u1", id: "u1", handle: "TurboFox42", authTime: expect.any(Number) });
    expect(gamingProfile.sessionGamerName).toHaveBeenCalledWith({}, "u1");
  });

  it("drops the name, email and picture of a cookie made before this change", async () => {
    const token = await config().callbacks.jwt({
      token: { name: "Kid Example", email: "kid@example.com", picture: "https://x/photo", sub: "u1", id: "u1", iat: 1, exp: 2, jti: "j" },
    });
    expect(token).toEqual({ sub: "u1", id: "u1", handle: "TurboFox42", authTime: expect.any(Number) });
    expect(personalKeysIn(token)).toEqual([]);
  });

  it("checks the account on every read, so a deleted account signs out on every device", async () => {
    const { ACCOUNT_GONE } = await import("@/lib/gaming-profile");
    gamingProfile.sessionGamerName.mockResolvedValueOnce(ACCOUNT_GONE as never);
    // A cookie that already holds a gamer name, as on a second device.
    const token = await config().callbacks.jwt({ token: { sub: "u1", id: "u1", handle: "TurboFox42" } });
    expect(token).toBeNull();
    expect(gamingProfile.sessionGamerName).toHaveBeenCalledWith({}, "u1");
  });

  it("keeps the session and the cookie's gamer name when the database cannot answer", async () => {
    gamingProfile.sessionGamerName.mockRejectedValueOnce(Object.assign(new Error("db down"), { code: "57P01" }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const token = await config().callbacks.jwt({ token: { sub: "u1", id: "u1", handle: "TurboFox42" } });
    expect(token).toEqual({ sub: "u1", id: "u1", handle: "TurboFox42", authTime: expect.any(Number) });
    expect(errors).toHaveBeenCalledWith("[auth] gamer name lookup failed", { code: "57P01" });
    errors.mockRestore();
  });

  it("picks up a new gamer name from the database", async () => {
    gamingProfile.sessionGamerName.mockResolvedValueOnce("RocketOwl7");
    const token = await config().callbacks.jwt({ token: { sub: "u1", id: "u1", handle: "TurboFox42" } });
    expect(token).toEqual({ sub: "u1", id: "u1", handle: "RocketOwl7", authTime: expect.any(Number) });
  });

  it("still signs in when the gamer name cannot be made, and logs no values", async () => {
    gamingProfile.sessionGamerName.mockRejectedValueOnce(
      Object.assign(new Error("Failed query: insert ... params: u1,kid@example.com"), { cause: { code: "57P01" } })
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const token = await config().callbacks.jwt({ token: { sub: "u1" }, user: { id: "u1" } });
    expect(token).toEqual({ sub: "u1", id: "u1", handle: null, authTime: expect.any(Number) });
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/kid@example\.com|u1/);
    errors.mockRestore();
  });

  it("clears a cookie that names no user", async () => {
    expect(await config().callbacks.jwt({ token: {} })).toBeNull();
  });

  it("keeps the session within a bound when the database does not answer at all", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      gamingProfile.sessionGamerName.mockImplementationOnce(() => new Promise<string | null>(() => {}));
      const { GAMER_NAME_TIMEOUT_MS } = await import("../auth");
      let settled: Record<string, unknown> | null | undefined;
      const read = config()
        .callbacks.jwt({ token: { sub: "u1", id: "u1", handle: "TurboFox42" } })
        .then((token) => {
          settled = token;
        });
      await vi.advanceTimersByTimeAsync(GAMER_NAME_TIMEOUT_MS - 1);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await read;
      expect(settled).toMatchObject({ sub: "u1", id: "u1", handle: "TurboFox42" });
      expect(errors).toHaveBeenCalledWith("[auth] gamer name lookup failed", { code: "timeout" });
    } finally {
      errors.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("the 30 days of a sign-in (jwt callback)", () => {
  const day = 24 * 60 * 60;
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  it("puts the sign-in time in the cookie at the sign-in", async () => {
    const before = nowSeconds();
    const token = await config().callbacks.jwt({ token: { sub: "u1" }, user: { id: "u1" } });
    expect(token?.authTime).toBeGreaterThanOrEqual(before);
    expect(token?.authTime).toBeLessThanOrEqual(nowSeconds());
  });

  it("keeps the sign-in time on each read, so a session used every day still ends", async () => {
    const authTime = nowSeconds() - 29 * day;
    const token = await config().callbacks.jwt({ token: { sub: "u1", id: "u1", handle: "TurboFox42", authTime } });
    expect(token?.authTime).toBe(authTime);
  });

  it("signs out 30 days after the sign-in, without a database read", async () => {
    gamingProfile.sessionGamerName.mockClear();
    const authTime = nowSeconds() - 30 * day - 1;
    expect(await config().callbacks.jwt({ token: { sub: "u1", id: "u1", handle: "TurboFox42", authTime } })).toBeNull();
    expect(gamingProfile.sessionGamerName).not.toHaveBeenCalled();
  });

  it("gives a cookie from before this change its 30 days from its next read", async () => {
    const before = nowSeconds();
    const token = await config().callbacks.jwt({ token: { sub: "u1", id: "u1", handle: "TurboFox42" } });
    expect(token?.authTime).toBeGreaterThanOrEqual(before);
  });

  it("shows the end of the 30 days as the session expiry when it is sooner", async () => {
    const authTime = 1_800_000_000;
    const session = await config().callbacks.session({
      session: { user: {}, expires: new Date((authTime + 40 * day) * 1000).toISOString() },
      token: { sub: "u1", id: "u1", handle: "TurboFox42", authTime },
    });
    expect(session.expires).toBe(new Date((authTime + 30 * day) * 1000).toISOString());
  });
});

describe("the session response (session callback)", () => {
  it("shows only the user id and the gamer name", async () => {
    const session = await config().callbacks.session({
      // Auth.js's default session, filled from a cookie made before this change.
      session: {
        user: { name: "Kid Example", email: "kid@example.com", image: "https://x/photo" },
        expires: "2026-11-01T00:00:00.000Z",
      },
      token: { sub: "u1", id: "u1", handle: "TurboFox42", name: "Kid Example", email: "kid@example.com", picture: "https://x/photo" },
    });
    expect(session).toEqual({
      expires: "2026-11-01T00:00:00.000Z",
      user: { id: "u1", handle: "TurboFox42" },
    });
    expect(personalKeysIn(session)).toEqual([]);
  });
});
