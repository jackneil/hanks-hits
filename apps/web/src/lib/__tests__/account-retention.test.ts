import { afterEach, describe, expect, it, vi } from "vitest";

import { db, type Database } from "@hank-neil/db";

import {
  RETENTION_FIRST_RUN_DELAY_MS,
  RETENTION_INTERVAL_MS,
  inactiveAccountDeleteQuery,
  runAccountRetention,
  startAccountRetentionSchedule,
} from "../account-retention";
import { INACTIVE_ACCOUNT_MONTHS, inactiveAccountCutoff } from "../retention-policy";

/**
 * The delete of accounts that nobody used (the 312.10 timeframe in the
 * privacy notice). The query tests read the SQL without a database. The
 * last test runs the real delete against Postgres, inside a transaction
 * that it rolls back, when RETENTION_TEST_DATABASE_URL is set. Use a copy
 * of the database for that test, never production:
 *
 *     createdb -T <source> retention_check
 *     RETENTION_TEST_DATABASE_URL=postgres:///retention_check \
 *       pnpm --filter web exec vitest run src/lib/__tests__/account-retention.test.ts
 */

const NOW = new Date("2028-01-16T12:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("inactiveAccountCutoff", () => {
  it("is the same moment, INACTIVE_ACCOUNT_MONTHS earlier, in UTC", () => {
    expect(INACTIVE_ACCOUNT_MONTHS).toBe(24);
    expect(inactiveAccountCutoff(NOW).toISOString()).toBe("2026-01-16T12:00:00.000Z");
  });

  it("moves a day that does not exist to the next day", () => {
    expect(inactiveAccountCutoff(new Date("2028-02-29T00:00:00.000Z")).toISOString()).toBe(
      "2026-03-01T00:00:00.000Z"
    );
  });
});

describe("inactiveAccountDeleteQuery", () => {
  const query = inactiveAccountDeleteQuery(db, NOW).toSQL();
  const cutoff = inactiveAccountCutoff(NOW).toISOString();

  it("deletes from users only, and returns only the ids", () => {
    expect(query.sql).toMatch(/^delete from "users" where /);
    expect(query.sql).toMatch(/returning "id"$/);
  });

  it("checks every kind of use against the cutoff", () => {
    expect(query.sql).toContain('"users"."created_at" < $');
    expect(query.sql).toContain('"users"."updated_at" < $');
    expect(query.sql).toContain('not exists (select 1 from "app_progress" where');
    expect(query.sql).toContain('"app_progress"."updated_at" >= $');
    expect(query.sql).toContain('not exists (select 1 from "gaming_profiles" where');
    expect(query.sql).toContain('"gaming_profiles"."updated_at" >= $');
    expect(query.sql).toContain(
      'not exists (select 1 from "leaderboard_entries" inner join "gaming_profiles" on'
    );
    expect(query.sql).toContain('"leaderboard_entries"."synced_at" >= $');
    // Each check looks at the account in the outer delete.
    expect(query.sql.match(/= "users"\."id"/g)).toHaveLength(3);
  });

  it("sends the cutoff as a UTC ISO string, and no other value", () => {
    expect(query.params).toEqual([cutoff, cutoff, cutoff, cutoff, cutoff]);
  });
});

describe("runAccountRetention", () => {
  function fakeDatabase(result: Promise<unknown>): Database {
    const chain = {
      where: () => chain,
      returning: () => result,
    };
    return { delete: () => chain } as unknown as Database;
  }

  it("logs only the count and the cutoff date", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runAccountRetention(fakeDatabase(Promise.resolve([{ id: "a" }, { id: "b" }])), NOW);
    expect(log).toHaveBeenCalledWith(
      "[retention] Deleted 2 account(s) with no use since 2026-01-16."
    );
  });

  it("logs a failure without the error text, and does not throw", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = Object.assign(new Error("Failed query: params: kid@example.com"), {
      code: "57P01",
    });
    await expect(
      runAccountRetention(fakeDatabase(Promise.reject(failure)), NOW)
    ).resolves.toBeUndefined();
    const [line] = error.mock.calls[0];
    expect(line).toContain("[retention] Inactive account delete failed");
    expect(line).toContain("57P01");
    expect(line).not.toContain("kid@example.com");
  });
});

describe("startAccountRetentionSchedule", () => {
  it("runs one minute after start, then once each day", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {});
    const stop = startAccountRetentionSchedule(run);

    await vi.advanceTimersByTimeAsync(RETENTION_FIRST_RUN_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS * 3);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not start a second schedule while one runs", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {});
    const stop = startAccountRetentionSchedule(run);
    const second = vi.fn(async () => {});
    expect(startAccountRetentionSchedule(second)).toBe(stop);

    await vi.advanceTimersByTimeAsync(RETENTION_FIRST_RUN_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    stop();
  });
});

const liveUrl = process.env.RETENTION_TEST_DATABASE_URL;

describe.skipIf(!liveUrl)("deleteInactiveAccounts against Postgres (rolled back)", () => {
  it("deletes only the accounts with no use since the cutoff, with all their data", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = liveUrl;
    const live = await import("@hank-neil/db");
    const { deleteInactiveAccounts } = await import("../account-retention");
    const { users, appProgress, gamingProfiles, leaderboardEntries } = live;

    const now = new Date();
    const cutoff = inactiveAccountCutoff(now);
    const old = new Date(cutoff.getTime() - 24 * 60 * 60 * 1000);
    const recent = new Date(cutoff.getTime() + 24 * 60 * 60 * 1000);
    const tag = `retention-test-${now.getTime()}`;
    const id = (name: string) => `${tag}-${name}`;

    const Rollback = new Error("rollback");
    let remaining: string[] = [];
    let leftoverRows = -1;

    await expect(
      live.db.transaction(async (tx) => {
        await tx.insert(users).values([
          { id: id("unused"), createdAt: old, updatedAt: old },
          { id: id("saved-recently"), createdAt: old, updatedAt: old },
          { id: id("scored-recently"), createdAt: old, updatedAt: old },
          { id: id("renamed-recently"), createdAt: old, updatedAt: recent },
          { id: id("new"), createdAt: recent, updatedAt: recent },
        ]);
        await tx.insert(appProgress).values([
          { id: id("p-unused"), userId: id("unused"), appId: "snake", data: {}, updatedAt: old },
          { id: id("p-saved"), userId: id("saved-recently"), appId: "snake", data: {}, updatedAt: recent },
        ]);
        await tx.insert(gamingProfiles).values([
          { id: id("g-unused"), userId: id("unused"), handle: id("h1"), createdAt: old, updatedAt: old },
          { id: id("g-scored"), userId: id("scored-recently"), handle: id("h2"), createdAt: old, updatedAt: old },
        ]);
        await tx.insert(leaderboardEntries).values([
          { id: id("l-unused"), gamingProfileId: id("g-unused"), appId: "snake", score: 5, achievedAt: old, syncedAt: old },
          { id: id("l-scored"), gamingProfileId: id("g-scored"), appId: "snake", score: 5, achievedAt: old, syncedAt: recent },
        ]);

        await deleteInactiveAccounts(tx as unknown as Database, now);

        const rows = await tx
          .select({ id: users.id })
          .from(users)
          .where(live.like(users.id, `${tag}-%`));
        remaining = rows.map((row) => row.id).sort();

        const leftovers = await tx.execute(
          live.sql`select
            (select count(*) from ${appProgress} where ${appProgress.id} = ${id("p-unused")}) +
            (select count(*) from ${gamingProfiles} where ${gamingProfiles.id} = ${id("g-unused")}) +
            (select count(*) from ${leaderboardEntries} where ${leaderboardEntries.id} = ${id("l-unused")}) as n`
        );
        leftoverRows = Number((leftovers.rows[0] as { n: string | number }).n);

        throw Rollback;
      })
    ).rejects.toBe(Rollback);

    await (live.db.$client as { end: () => Promise<void> }).end();

    expect(remaining).toEqual(
      [id("new"), id("renamed-recently"), id("saved-recently"), id("scored-recently")].sort()
    );
    // The progress, profile and score of the deleted account went with it.
    expect(leftoverRows).toBe(0);
  });
});
