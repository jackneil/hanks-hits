// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";

import {
  GOOGLE_SCOPE,
  googleProfile,
  keepNoTokens,
  oneAccountPerPlayer,
  privateSession,
  privateToken,
  SESSION_MAX_AGE_SECONDS,
  sessionTooOld,
  signInTime,
  SecondSignInAccountError,
  withoutPersonalInfo,
} from "../auth-privacy";

/**
 * The building blocks of "an account keeps only Google's subject id"
 * (COPPA, issue #26i). auth-config.test.ts checks that lib/auth.ts uses
 * them; this file checks each one on its own, with a fake adapter.
 */

function fakeBase() {
  return {
    createUser: vi.fn(async (user: AdapterUser) => user),
    updateUser: vi.fn(async (user: Partial<AdapterUser> & Pick<AdapterUser, "id">) => user as AdapterUser),
    linkAccount: vi.fn(async (account: AdapterAccount) => account),
    getUser: vi.fn(async () => null),
  } satisfies Adapter;
}

const KID: AdapterUser = {
  id: "u1",
  name: "Kid Example",
  email: "kid@example.com",
  emailVerified: new Date("2026-01-01"),
  image: "https://lh3.googleusercontent.com/a/photo",
};

describe("googleProfile", () => {
  it("returns the subject id and null for every personal field", () => {
    expect(
      googleProfile({
        sub: "1098",
        // Claims Google sends with the email and profile scopes:
        ...({ email: "kid@example.com", name: "Kid", picture: "https://x" } as object),
      })
    ).toEqual({ id: "1098", name: null, email: null, image: null });
  });

  it("asks for the openid scope only", () => {
    expect(GOOGLE_SCOPE.split(/\s+/)).toEqual(["openid"]);
  });
});

describe("keepNoTokens", () => {
  it("keeps nothing of the token set", () => {
    expect(keepNoTokens()).toEqual({});
  });
});

describe("withoutPersonalInfo", () => {
  it("writes null for the name, email, email_verified and image of a new user", async () => {
    const base = fakeBase();
    await withoutPersonalInfo(base).createUser!(KID);
    expect(base.createUser).toHaveBeenCalledWith({
      id: "u1",
      name: null,
      email: null,
      emailVerified: null,
      image: null,
    });
  });

  it("keeps other user fields, so a later column still reaches the database", async () => {
    const base = fakeBase();
    await withoutPersonalInfo(base).createUser!({ ...KID, role: "player" } as AdapterUser);
    expect(base.createUser.mock.calls[0][0]).toMatchObject({ id: "u1", role: "player" });
  });

  it("drops the personal fields from an update and keeps the rest", async () => {
    const base = fakeBase();
    await withoutPersonalInfo(base).updateUser!({ ...KID, role: "player" } as AdapterUser);
    expect(base.updateUser).toHaveBeenCalledWith({ id: "u1", role: "player" });
  });

  it("links an account with only the fields that link it", async () => {
    const base = fakeBase();
    await withoutPersonalInfo(base).linkAccount!({
      userId: "u1",
      type: "oidc",
      provider: "google",
      providerAccountId: "1098",
      access_token: "a",
      refresh_token: "r",
      id_token: "i",
      expires_at: 1,
      token_type: "bearer",
      scope: "openid email",
      session_state: "s",
    });
    expect(base.linkAccount).toHaveBeenCalledWith({
      userId: "u1",
      type: "oidc",
      provider: "google",
      providerAccountId: "1098",
    });
  });

  it("passes the other methods through and adds none that the base lacks", () => {
    const base = fakeBase();
    const wrapped = withoutPersonalInfo(base);
    expect(wrapped.getUser).toBe(base.getUser);
    expect(withoutPersonalInfo({}).createUser).toBeUndefined();
    expect(withoutPersonalInfo({}).linkAccount).toBeUndefined();
  });
});

describe("oneAccountPerPlayer", () => {
  const LINK: AdapterAccount = { userId: "u1", type: "oidc", provider: "google", providerAccountId: "1098" };

  it("links the first sign-in account of a player", async () => {
    const base = fakeBase();
    const hasSignInAccount = vi.fn(async () => false);
    await oneAccountPerPlayer(base, hasSignInAccount).linkAccount!(LINK);
    expect(hasSignInAccount).toHaveBeenCalledWith("u1");
    expect(base.linkAccount).toHaveBeenCalledWith(LINK);
  });

  it("refuses a second sign-in account, so a new Google account is not linked to the player who is signed in", async () => {
    const base = fakeBase();
    const wrapped = oneAccountPerPlayer(base, async () => true);
    await expect(wrapped.linkAccount!({ ...LINK, providerAccountId: "2222" })).rejects.toBeInstanceOf(
      SecondSignInAccountError
    );
    expect(base.linkAccount).not.toHaveBeenCalled();
  });

  it("puts no id in the error", () => {
    expect(new SecondSignInAccountError().message).not.toMatch(/u1|1098|2222/);
  });

  it("passes the other methods through and adds no linkAccount that the base lacks", () => {
    const base = fakeBase();
    expect(oneAccountPerPlayer(base, async () => false).createUser).toBe(base.createUser);
    expect(oneAccountPerPlayer({}, async () => false).linkAccount).toBeUndefined();
  });
});

describe("the 30 days of a sign-in (signInTime, sessionTooOld)", () => {
  const now = 1_800_000_000;
  const day = 24 * 60 * 60;

  it("starts at the sign-in", () => {
    expect(signInTime({ authTime: now - 10 * day }, true, now)).toBe(now);
  });

  it("keeps the sign-in time on each later read, so the 30 days do not slide", () => {
    expect(signInTime({ authTime: now - 29 * day }, false, now)).toBe(now - 29 * day);
  });

  it("starts the 30 days at the next read for a cookie from before the sign-in time", () => {
    expect(signInTime({}, false, now)).toBe(now);
    expect(signInTime({ authTime: "x" }, false, now)).toBe(now);
  });

  it("never lets a time in the future add days", () => {
    expect(signInTime({ authTime: now + 5 * day }, false, now)).toBe(now);
  });

  it("ends the session 30 days after the sign-in, also when it was used every day", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(30 * day);
    expect(sessionTooOld(now - 29 * day, now)).toBe(false);
    expect(sessionTooOld(now - 30 * day, now)).toBe(true);
    expect(sessionTooOld(now - 31 * day, now)).toBe(true);
  });
});

describe("privateToken and privateSession", () => {
  it("builds a token with the id, the gamer name and the sign-in time only", () => {
    expect(privateToken("u1", "TurboFox42", 1_700_000_000)).toEqual({
      sub: "u1",
      id: "u1",
      handle: "TurboFox42",
      authTime: 1_700_000_000,
    });
  });

  it("builds a session with the id, the gamer name and the expiry only", () => {
    expect(privateSession("2026-11-01T00:00:00.000Z", { id: "u1", handle: "TurboFox42" })).toEqual({
      expires: "2026-11-01T00:00:00.000Z",
      user: { id: "u1", handle: "TurboFox42" },
    });
  });

  it("falls back to sub for the id and to null for a missing gamer name", () => {
    expect(privateSession("x", { sub: "u2" })).toEqual({ expires: "x", user: { id: "u2", handle: null } });
  });
});
