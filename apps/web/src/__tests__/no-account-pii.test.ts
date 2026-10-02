// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Session } from "next-auth";

/**
 * An account keeps only Google's subject id (COPPA 16 CFR 312.5(c)(7),
 * issue #26i, design/ACCOUNTS_COPPA.md). So no app code may read or write
 * a user's name, email, email_verified or photo, read them from the
 * session or its token, or bring back email and password sign-in. The
 * screens show the made-up gamer name (gaming_profiles.handle) instead.
 *
 * lib/auth-privacy.ts is the one file that names these fields: it is the
 * code that removes them.
 */

const SRC = path.resolve(__dirname, "..");
const ALLOWED = new Set(["lib/auth-privacy.ts"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const RULES: Array<{ why: string; pattern: RegExp }> = [
  { why: "reads a personal field of the session user", pattern: /\.user\??\.(name|email|image)\b/ },
  { why: "reads or writes a personal column of users", pattern: /\busers\.(name|email|image|emailVerified)\b/ },
  { why: "reads a personal claim of the session token", pattern: /\btoken\??\.(name|email|picture)\b/ },
  { why: "brings back email and password sign-in", pattern: /providers\/credentials|signInWithCredentials|\/api\/auth\/signup|bcrypt/ },
  { why: "names email_verified", pattern: /\bemailVerified\b|\bemail_verified\b/ },
];

describe("account personal information", () => {
  it("is read or written nowhere in the app", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = path.relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const rule of RULES) {
            if (rule.pattern.test(line)) hits.push(`${rel}:${i + 1} ${rule.why}: ${line.trim()}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });
});

/**
 * The Session type has no name, email or image (src/types/next-auth.d.ts),
 * so the compiler rejects every read of them, also the destructuring reads
 * that the source check above cannot see. `pnpm typecheck` checks these
 * lines: if the type gets the fields back, each @ts-expect-error is unused
 * and typecheck fails.
 */
export function sessionHasNoPersonalFields(session: Session) {
  // @ts-expect-error The session user has no email.
  void session.user.email;
  // @ts-expect-error The session user has no name.
  void session.user.name;
  // @ts-expect-error The session user has no image.
  void session.user.image;
  // @ts-expect-error A destructuring read is rejected too.
  const { email } = session.user;
  return [session.user.id, session.user.handle, email];
}
