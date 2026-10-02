// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const handles = vi.hoisted(() => ({ generateUniqueHandle: vi.fn() }));
vi.mock("@/lib/handle-generator", () => handles);

import type { Database } from "@hank-neil/db";
import {
  ACCOUNT_GONE,
  getOrCreateGamingProfile,
  isHandleCollision,
  postgresCode,
  sessionGamerName,
} from "../gaming-profile";

/**
 * Sign-in gives every player a made-up gamer name (an account keeps no
 * real name, COPPA #26i), and the progress route makes one when a score
 * reaches a leaderboard. Both use getOrCreateGamingProfile.
 */

/** A Postgres unique violation, wrapped the way drizzle-orm 0.45 wraps it. */
function drizzleUniqueViolation(constraint: string) {
  return Object.assign(new Error('Failed query: insert into "gaming_profiles" ("id", "user_id", "handle")'), {
    cause: Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505", constraint }),
  });
}

function fakeDb(options: { existing?: object | null; inserts: Array<object | Error | undefined>; afterConflict?: object }) {
  const findFirst = vi.fn(async () => (findFirst.mock.calls.length === 1 ? options.existing ?? undefined : options.afterConflict));
  const returning = vi.fn(async () => {
    const next = options.inserts.shift();
    if (next instanceof Error) throw next;
    return next ? [next] : [];
  });
  const values = vi.fn(() => ({ onConflictDoNothing: () => ({ returning }) }));
  const insert = vi.fn(() => ({ values }));
  const transaction = vi.fn(async (run: (sp: unknown) => unknown) => run({ insert }));
  const database = { query: { gamingProfiles: { findFirst } }, transaction } as unknown as Database;
  return { database, findFirst, values, transaction };
}

beforeEach(() => {
  handles.generateUniqueHandle.mockReset();
  handles.generateUniqueHandle.mockResolvedValueOnce("TurboFox42").mockResolvedValueOnce("RocketOwl7").mockResolvedValueOnce("ZoomBear3");
});

describe("isHandleCollision", () => {
  it("finds the unique violation on the handle under drizzle's wrapper", () => {
    expect(isHandleCollision(drizzleUniqueViolation("gaming_profiles_handle_unique"))).toBe(true);
  });

  it("is false for a unique violation on another constraint, and for other errors", () => {
    expect(isHandleCollision(drizzleUniqueViolation("gaming_profiles_user_id_unique"))).toBe(false);
    expect(isHandleCollision(new Error("connection reset"))).toBe(false);
    expect(isHandleCollision(null)).toBe(false);
  });
});

describe("getOrCreateGamingProfile", () => {
  it("returns the existing profile and creates nothing", async () => {
    const { database, transaction } = fakeDb({ existing: { handle: "OldName1" }, inserts: [] });
    expect(await getOrCreateGamingProfile(database, "u1")).toEqual({ handle: "OldName1" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("creates a profile with a random gamer name, in its own transaction", async () => {
    const { database, values, transaction } = fakeDb({ inserts: [{ handle: "TurboFox42" }] });
    expect(await getOrCreateGamingProfile(database, "u1")).toEqual({ handle: "TurboFox42" });
    expect(values).toHaveBeenCalledWith({ userId: "u1", handle: "TurboFox42" });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("returns the profile another tab made first", async () => {
    const { database } = fakeDb({ inserts: [undefined], afterConflict: { handle: "OtherTab9" } });
    expect(await getOrCreateGamingProfile(database, "u1")).toEqual({ handle: "OtherTab9" });
  });

  it("tries a new gamer name when another user took the first one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { database, values } = fakeDb({
      inserts: [drizzleUniqueViolation("gaming_profiles_handle_unique"), { handle: "RocketOwl7" }],
    });
    expect(await getOrCreateGamingProfile(database, "u1")).toEqual({ handle: "RocketOwl7" });
    expect(values).toHaveBeenLastCalledWith({ userId: "u1", handle: "RocketOwl7" });
    warn.mockRestore();
  });

  it("throws other database errors", async () => {
    const { database } = fakeDb({ inserts: [new Error("connection reset")] });
    await expect(getOrCreateGamingProfile(database, "u1")).rejects.toThrow("connection reset");
  });
});

describe("postgresCode", () => {
  it("finds the code under drizzle's wrapper, and on the error itself", () => {
    expect(postgresCode(drizzleUniqueViolation("x"))).toBe("23505");
    expect(postgresCode(Object.assign(new Error("fk"), { code: "23503" }))).toBe("23503");
  });

  it("is null for errors with no Postgres code", () => {
    expect(postgresCode(new Error("connection reset"))).toBeNull();
    expect(postgresCode(Object.assign(new Error("node"), { code: "ECONNRESET" }))).toBeNull();
    expect(postgresCode(undefined)).toBeNull();
  });
});

describe("sessionGamerName", () => {
  /** A database whose users + gaming_profiles read returns `rows`, and whose insert fails with `insertError`. */
  function sessionDb(rows: Array<{ handle: string | null }>, insertError?: Error) {
    const limit = vi.fn(async () => rows);
    const select = vi.fn(() => ({ from: () => ({ leftJoin: () => ({ where: () => ({ limit }) }) }) }));
    const findFirst = vi.fn(async () => undefined);
    const returning = vi.fn(async () => {
      if (insertError) throw insertError;
      return [{ handle: "TurboFox42" }];
    });
    const insert = vi.fn(() => ({ values: () => ({ onConflictDoNothing: () => ({ returning }) }) }));
    const transaction = vi.fn(async (run: (sp: unknown) => unknown) => run({ insert }));
    return { select, query: { gamingProfiles: { findFirst } }, transaction } as unknown as Database;
  }

  it("returns the gamer name of an account", async () => {
    expect(await sessionGamerName(sessionDb([{ handle: "RocketOwl7" }]), "u1")).toBe("RocketOwl7");
  });

  it("says ACCOUNT_GONE when the users row does not exist, and tries no insert", async () => {
    const database = sessionDb([]);
    expect(await sessionGamerName(database, "ghost")).toBe(ACCOUNT_GONE);
    expect((database as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction).not.toHaveBeenCalled();
  });

  it("makes a gamer name for an account that has none", async () => {
    expect(await sessionGamerName(sessionDb([{ handle: null }]), "u1")).toBe("TurboFox42");
  });

  it("says ACCOUNT_GONE when the account is deleted between the read and the insert", async () => {
    const fk = Object.assign(new Error("Failed query: insert"), { cause: { code: "23503" } });
    expect(await sessionGamerName(sessionDb([{ handle: null }], fk), "u1")).toBe(ACCOUNT_GONE);
  });

  it("throws other database errors, so the caller keeps the session", async () => {
    const down = Object.assign(new Error("Failed query"), { cause: { code: "57P01" } });
    await expect(sessionGamerName(sessionDb([{ handle: null }], down), "u1")).rejects.toThrow("Failed query");
  });
});
