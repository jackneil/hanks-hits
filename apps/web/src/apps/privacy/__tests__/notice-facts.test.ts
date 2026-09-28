import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  GAME_STORAGE_KEYS,
  PROGRESS_OWNER_KEY,
  isClearedOnSignOut,
} from "@/lib/storage-keys";

import { SIGN_IN_COOKIE_DAYS } from "../lib/notice";

/**
 * The privacy notice states facts about the code. These tests fail when
 * the code changes under a fact, so the notice cannot silently become
 * false. When one fails, update the notice (and PRIVACY_NOTICE_UPDATED)
 * in the same change, then update the test.
 */

const SRC = path.resolve(__dirname, "../../..");

function source(relativePath: string): string {
  return readFileSync(path.join(SRC, relativePath), "utf8");
}

describe("privacy notice facts match the code", () => {
  it("sign-in cookie lasts as many days as the notice says", () => {
    const auth = source("lib/auth.ts");
    const match = auth.match(/maxAge:\s*(\d+)\s*\*\s*24\s*\*\s*60\s*\*\s*60/);
    expect(match, "session.maxAge in lib/auth.ts changed shape").not.toBeNull();
    expect(Number(match![1])).toBe(SIGN_IN_COOKIE_DAYS);
    // The notice describes a cookie session, not a database session.
    expect(auth).toMatch(/strategy:\s*"jwt"/);
  });

  it("stores passwords only as bcrypt hashes", () => {
    const signup = source("app/api/auth/signup/route.ts");
    expect(signup).toMatch(/bcrypt\.hash\(password,/);
    expect(signup).toMatch(/password:\s*hashedPassword/);
  });

  it("keeps real names and emails off the public leaderboard", () => {
    const leaderboard = source("app/api/leaderboards/[appId]/route.ts");
    // The public list reads the random handle, never the users table.
    expect(leaderboard).toMatch(/handle:\s*gamingProfiles\.handle/);
    expect(leaderboard).not.toMatch(/\busers\b/);
    expect(leaderboard).not.toMatch(/\bemail\b/);
  });

  it("keeps the account number on the device after sign-out, as the notice says", () => {
    expect(isClearedOnSignOut(PROGRESS_OWNER_KEY)).toBe(false);
  });

  it("clears every account-synced progress key on sign-out, as the notice says", () => {
    for (const key of GAME_STORAGE_KEYS) {
      expect(isClearedOnSignOut(key)).toBe(true);
    }
  });

  it("never sends email: no mail library is installed", () => {
    const pkg = JSON.parse(source("../package.json")) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const mailer of ["nodemailer", "resend", "@sendgrid/mail", "postmark", "mailgun.js"]) {
      expect(deps).not.toContain(mailer);
    }
  });
});
