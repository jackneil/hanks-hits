// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

// The progress route on a REAL Postgres, through the real @hank-neil/db
// module (drizzle + pg). route.test.ts runs the same contract on an
// in-memory stand-in on every run. This file proves that the stand-in still
// matches Postgres, so a drizzle or pg upgrade cannot change the behavior
// unseen. The facts that the fix depends on:
// - a bigint column rejects a fraction (22P02);
// - a failed statement inside a nested drizzle transaction (a SAVEPOINT)
//   rolls back only to the savepoint, and the outer transaction commits;
// - without the savepoint, the COMMIT of the aborted transaction is a
//   silent ROLLBACK, and the progress save is lost with a 200 response.
//
// OPT-IN. Set TEST_DATABASE_URL to a LOCAL Postgres server, for example
//   TEST_DATABASE_URL=postgres://localhost:5432/postgres pnpm --filter web test
// The test makes a new database with a unique name, applies the migrations
// in packages/db/drizzle, and drops the database at the end. It refuses a
// server that is not on this computer. Without the variable it is skipped.

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const ids = vi.hoisted(() => ({ user: "pg-route-test-user" }));
const handles = vi.hoisted(() => ({ queue: [] as string[], next: 0 }));

vi.mock("@/lib/auth", () => ({
  auth: async () => ({ user: { id: ids.user } }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkProgressRateLimit: () => ({ success: true }),
  checkProgressDeleteRateLimit: () => ({ success: true }),
}));

// generateUniqueHandle checks the table first, so a real collision only
// happens in a race. The queue hands out a handle another player holds.
vi.mock("@/lib/handle-generator", () => ({
  generateUniqueHandle: async () =>
    handles.queue.shift() ?? `PgHandle${++handles.next}`,
}));

type DbModule = typeof import("@hank-neil/db");
type RouteModule = typeof import("../route");

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../.."
);
const migrationsDir = path.join(repoRoot, "packages/db/drizzle");

/** Every migration statement, in journal order. */
function migrationStatements(): string[] {
  const journal = JSON.parse(
    readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8")
  ) as { entries: { idx: number; tag: string }[] };
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .flatMap((entry) =>
      readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8")
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean)
    );
}

/** What console.error printed, formatted the way Node prints it to a log. */
function printed(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls
    .map((args) =>
      args
        .map((a) => (typeof a === "string" ? a : inspect(a, { depth: 8 })))
        .join(" ")
    )
    .join("\n");
}

describe.skipIf(!ADMIN_URL)("POST /api/progress/[appId] on a real Postgres", () => {
  const dbName = `hh_progress_route_${process.pid}_${Date.now().toString(36)}`;
  let admin: DbModule | undefined;
  let scratch: DbModule | undefined;
  let route: RouteModule;
  let created = false;

  beforeAll(async () => {
    const adminUrl = new URL(ADMIN_URL!);
    if (!LOCAL_HOSTS.has(adminUrl.hostname)) {
      throw new Error(
        `TEST_DATABASE_URL must name a Postgres server on this computer; refusing host "${adminUrl.hostname}"`
      );
    }

    // @hank-neil/db makes its pool from DATABASE_URL when it loads, so load
    // it once for the admin database and once for the new database.
    process.env.DATABASE_URL = adminUrl.toString();
    vi.resetModules();
    admin = await import("@hank-neil/db");
    await admin.db.execute(admin.sql.raw(`CREATE DATABASE "${dbName}"`));
    created = true;

    const scratchUrl = new URL(adminUrl);
    scratchUrl.pathname = `/${dbName}`;
    process.env.DATABASE_URL = scratchUrl.toString();
    vi.resetModules();
    scratch = await import("@hank-neil/db");
    for (const statement of migrationStatements()) {
      await scratch.db.execute(scratch.sql.raw(statement));
    }
    // The route gets the same module instance as `scratch`.
    route = await import("../route");
  });

  afterAll(async () => {
    await scratch?.db.$client.end();
    if (admin && created) {
      await admin.db.execute(
        admin.sql.raw(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
      );
    }
    await admin?.db.$client.end();
  });

  beforeEach(async () => {
    const { db, sql, users } = scratch!;
    await db.execute(
      sql.raw(
        "TRUNCATE leaderboard_entries, gaming_profiles, app_progress, users CASCADE"
      )
    );
    await db.insert(users).values({ id: ids.user, name: "Test Kid" });
    handles.queue = [];
    handles.next = 0;
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  function save(appId: string, data: Record<string, unknown>, merge = true) {
    return route.POST(
      new Request(`http://localhost/api/progress/${appId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, merge }),
      }),
      { params: Promise.resolve({ appId }) }
    );
  }

  async function hillClimbBlob(bestDistance: number) {
    const { useHillClimbStore } = await import("@/games/hill-climb/lib/store");
    return {
      ...useHillClimbStore.getState().getProgress(),
      bestDistance,
      lastModified: Date.now(),
    } as Record<string, unknown>;
  }

  async function cookieClickerBlob(totalCookiesBaked: number) {
    const { useCookieClickerStore } = await import("@/games/cookie-clicker/lib/store");
    return {
      ...useCookieClickerStore.getState().getProgress(),
      totalCookiesBaked,
      lastModified: Date.now(),
    } as Record<string, unknown>;
  }

  async function memoryMatchBlob(easyMs: number) {
    const { useMemoryMatchStore } = await import("@/games/memory-match/lib/store");
    return {
      ...useMemoryMatchStore.getState().getProgress(),
      bestTimes: { easy: easyMs, medium: null, hard: null, expert: null },
      gamesWon: 1,
      updatedAt: Date.now(),
    } as Record<string, unknown>;
  }

  async function progressOf(appId: string) {
    const { db, appProgress, and, eq } = scratch!;
    const rows = await db
      .select()
      .from(appProgress)
      .where(and(eq(appProgress.userId, ids.user), eq(appProgress.appId, appId)));
    return rows[0]?.data as Record<string, unknown> | undefined;
  }

  async function boardOf(appId: string) {
    const { db, leaderboardEntries, eq } = scratch!;
    return db
      .select({ score: leaderboardEntries.score, scoreType: leaderboardEntries.scoreType })
      .from(leaderboardEntries)
      .where(eq(leaderboardEntries.appId, appId));
  }

  async function withFailingInsert<T>(table: string, run: () => Promise<T>): Promise<T> {
    const { db, sql } = scratch!;
    await db.execute(
      sql.raw(`CREATE OR REPLACE FUNCTION hh_test_fail() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'forced failure' USING ERRCODE = 'XX000'; END $$ LANGUAGE plpgsql`)
    );
    await db.execute(
      sql.raw(`CREATE TRIGGER hh_test_fail BEFORE INSERT OR UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION hh_test_fail()`)
    );
    try {
      return await run();
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS hh_test_fail ON ${table}`));
    }
  }

  it("saves a fractional Hill Climb distance and boards it rounded down", async () => {
    const res = await save("hill-climb", await hillClimbBlob(4189.294008871742));

    expect(res.status).toBe(200);
    expect((await progressOf("hill-climb"))?.bestDistance).toBe(4189.294008871742);
    expect(await boardOf("hill-climb")).toEqual([{ score: 4189, scoreType: "high_score" }]);
  });

  it("saves fractional Cookie Clicker cookies and boards them rounded down", async () => {
    const res = await save("cookie-clicker", await cookieClickerBlob(436.8441000000125));

    expect(res.status).toBe(200);
    expect((await progressOf("cookie-clicker"))?.totalCookiesBaked).toBe(436.8441000000125);
    expect(await boardOf("cookie-clicker")).toEqual([{ score: 436, scoreType: "high_score" }]);
  });

  it("boards a fractional fastest_time rounded up", async () => {
    const res = await save("memory-match", await memoryMatchBlob(12500.2));

    expect(res.status).toBe(200);
    expect(await progressOf("memory-match")).toBeDefined();
    expect(await boardOf("memory-match")).toEqual([{ score: 12501, scoreType: "fastest_time" }]);
  });

  it("commits the progress save when the board write fails, and logs it values-free", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await withFailingInsert("leaderboard_entries", async () =>
      save("hill-climb", await hillClimbBlob(4189.294008871742))
    );

    expect(res.status).toBe(200);
    expect((await progressOf("hill-climb"))?.bestDistance).toBe(4189.294008871742);
    expect(await boardOf("hill-climb")).toEqual([]);
    // The savepoint also rolled back the profile that the board work made.
    const { db, gamingProfiles } = scratch!;
    expect(await db.select().from(gamingProfiles)).toEqual([]);

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("[LEADERBOARD] Board sync failed for hill-climb"),
      expect.objectContaining({ code: "XX000" })
    );
    const log = printed(errorLog);
    expect(log).not.toContain(ids.user);
    expect(log).not.toContain("4189");
    expect(log).not.toContain("params");
    expect(log).not.toContain("forced failure");

    // The next save puts the board row in.
    expect((await save("hill-climb", await hillClimbBlob(4189.294008871742))).status).toBe(200);
    expect(await boardOf("hill-climb")).toEqual([{ score: 4189, scoreType: "high_score" }]);
  });

  it("retries a handle collision in its own savepoint", async () => {
    const { db, users, gamingProfiles, eq } = scratch!;
    await db.insert(users).values({ id: "pg-route-other-user", name: "Other Kid" });
    await db
      .insert(gamingProfiles)
      .values({ userId: "pg-route-other-user", handle: "TakenHandle7" });
    handles.queue = ["TakenHandle7", "FreeHandle8"];

    const res = await save("hill-climb", await hillClimbBlob(500));

    expect(res.status).toBe(200);
    const [mine] = await db
      .select()
      .from(gamingProfiles)
      .where(eq(gamingProfiles.userId, ids.user));
    expect(mine?.handle).toBe("FreeHandle8");
    expect(await boardOf("hill-climb")).toEqual([{ score: 500, scoreType: "high_score" }]);
  });

  it("logs a failed progress write values-free (no SQL params, no user id)", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await withFailingInsert("app_progress", async () =>
      save("hill-climb", await hillClimbBlob(4189.294008871742), false)
    );

    expect(res.status).toBe(500);
    expect(await progressOf("hill-climb")).toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(
      "POST /api/progress error:",
      expect.objectContaining({ code: "XX000" })
    );
    const log = printed(errorLog);
    expect(log).not.toContain(ids.user);
    expect(log).not.toContain("4189");
    expect(log).not.toContain("params");
    expect(log).not.toContain("Failed query");
  });

  // A merge save whose merged blob breaks the schema: the route once stored
  // the incoming save whole, so an older save replaced a newer row.
  async function putRow(appId: string, data: Record<string, unknown>, at: Date) {
    const { db, appProgress } = scratch!;
    await db.insert(appProgress).values({
      id: crypto.randomUUID(),
      userId: ids.user,
      appId,
      data,
      lastSyncedAt: at,
      updatedAt: at,
    });
  }

  async function rowOf(appId: string) {
    const { db, appProgress, and, eq } = scratch!;
    const rows = await db
      .select()
      .from(appProgress)
      .where(and(eq(appProgress.userId, ids.user), eq(appProgress.appId, appId)));
    return rows[0];
  }

  it("keeps a newer row as the base when the merge is too long, and folds in the older save's record", async () => {
    const list = (prefix: string) => Array.from({ length: 300 }, (_, i) => `${prefix}${i}`);
    const now = Date.now();
    await putRow(
      "cookie-clicker",
      { ...(await cookieClickerBlob(1_000)), cookies: 7_000, unlockedAchievements: list("row-"), lastModified: now - 60_000 },
      new Date(now - 60_000)
    );
    const older = { ...(await cookieClickerBlob(5_000)), cookies: 3, unlockedAchievements: list("dev-"), lastModified: now - 3_600_000 };

    const res = await save("cookie-clicker", older);

    expect(res.status).toBe(200);
    const stored = await progressOf("cookie-clicker");
    expect(stored?.cookies).toBe(7_000);
    expect(stored?.totalCookiesBaked).toBe(5_000);
    expect(stored?.unlockedAchievements).toEqual(list("row-"));
  });

  it("answers 409 and leaves a newer row that the schema refuses untouched", async () => {
    const { useMathAttackStore } = await import("@/games/math-attack/lib/store");
    const now = Date.now();
    const rowData = {
      ...useMathAttackStore.getState().getProgress(),
      highScore: 900,
      settings: { soundEnabled: true, difficulty: "13yo" },
      lastModified: now - 60_000,
    };
    await putRow("math-attack", rowData, new Date(now - 60_000));
    const before = await rowOf("math-attack");
    const older = { ...useMathAttackStore.getState().getProgress(), highScore: 100, lastModified: now - 3_600_000 };

    const res = await save("math-attack", older);

    expect(res.status).toBe(409);
    const after = await rowOf("math-attack");
    expect(after?.data).toEqual(rowData);
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });

  async function cloud(appId = "cookie-clicker") {
    const response = await route.GET(new Request(`http://localhost/api/progress/${appId}`), {
      params: Promise.resolve({ appId }),
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<{ data: Record<string, unknown> | null; revision: string | null; protocol: number; updatedAt?: string }>;
  }

  function compareSave(data: Record<string, unknown>, baseRevision: string | null, expectedOwnerId = ids.user) {
    return route.POST(new Request("http://localhost/api/progress/cookie-clicker", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, merge: true, baseRevision, expectedOwnerId }),
    }), { params: Promise.resolve({ appId: "cookie-clicker" }) });
  }

  it("conditionally creates an absent row and continues its idle wallet without changing the player timestamp", async () => {
    expect(await cloud()).toMatchObject({ data: null, revision: null, protocol: 1 });
    const initial: Record<string, unknown> = { ...await cookieClickerBlob(1000), cookies: 1000 };
    const created = await compareSave(initial, null);
    expect(created.status).toBe(200);
    const first = await created.json();
    expect(first.revision).toMatch(/^[a-f0-9]{64}$/);
    expect((await cloud()).revision).toBe(first.revision);
    const updated = await compareSave({ ...first.data, cookies: 1200, totalCookiesBaked: 1200 }, first.revision);
    expect(updated.status).toBe(200);
    const second = await updated.json();
    expect(second.data).toMatchObject({ cookies: 1200, lastModified: initial.lastModified });
    expect(second.revision).not.toBe(first.revision);
    expect(await cloud()).toMatchObject({ data: second.data, revision: second.revision });
  });

  it("a stale revision changes neither the save nor its leaderboard, even with a newer player timestamp", async () => {
    const initial: Record<string, unknown> = { ...await cookieClickerBlob(9000), cookies: 9000 };
    const first = await (await compareSave(initial, null)).json();
    const second = await (await compareSave({ ...first.data, cookies: 8000, totalCookiesBaked: 9500 }, first.revision)).json();
    const beforeBoard = await scratch!.db.query.leaderboardEntries.findMany();
    const stale = await compareSave({ ...first.data, cookies: 2000, totalCookiesBaked: 99999, lastModified: Date.now() + 1000 }, first.revision);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "revision_conflict", data: second.data, revision: second.revision });
    expect(await cloud()).toMatchObject({ data: second.data, revision: second.revision });
    expect(await scratch!.db.query.leaderboardEntries.findMany()).toEqual(beforeBoard);
  });

  it("a matched continuation can spend its wallet while retaining earned records", async () => {
    const first = await (await compareSave({ ...await cookieClickerBlob(9000), cookies: 9000 }, null)).json();
    const response = await compareSave({ ...first.data, cookies: 2000, totalCookiesBaked: 2000 }, first.revision);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      cookies: 2000, totalCookiesBaked: 9000, lastModified: first.data.lastModified,
    });
  });

  it("uses the same revision for a legacy database timestamp with sub-millisecond precision", async () => {
    const first = await (await compareSave(await cookieClickerBlob(1000), null)).json();
    await scratch!.db.execute(scratch!.sql.raw("UPDATE app_progress SET updated_at = date_trunc('milliseconds', updated_at) + interval '456 microseconds'"));
    const before = await cloud();
    vi.spyOn(Date, "now").mockReturnValue(new Date(before.updatedAt!).getTime());
    const response = await compareSave({ ...first.data, cookies: 1100 }, before.revision);
    expect(response.status).toBe(200);
    const after = await response.json();
    expect(after.revision).not.toBe(before.revision);
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt!).getTime());
    expect(await cloud()).toMatchObject({ data: after.data, revision: after.revision });
  });

  it("legacy equal-time writes retain the stored wallet but advance revision even within one millisecond", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    const first = await (await compareSave({ ...await cookieClickerBlob(9000), cookies: 9000 }, null)).json();
    expect((await save("cookie-clicker", { ...first.data, cookies: 2000 })).status).toBe(200);
    const second = await cloud();
    expect(second.data!.cookies).toBe(9000);
    expect(second.revision).not.toBe(first.revision);
    expect(new Date(second.updatedAt!).getTime()).toBeGreaterThan(new Date(first.updatedAt).getTime());
    expect((await compareSave({ ...first.data, cookies: 9100 }, first.revision)).status).toBe(409);
  });

  it("only one of two concurrent continuations commits and the other gets the actual winner", async () => {
    const first = await (await compareSave({ ...await cookieClickerBlob(1000), cookies: 1000 }, null)).json();
    // Hold the first write long enough that an unlocked read-before-write implementation races.
    await scratch!.db.execute(scratch!.sql.raw(`CREATE FUNCTION hh_pause_progress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.05); RETURN NEW; END $$`));
    await scratch!.db.execute(scratch!.sql.raw(`CREATE TRIGGER hh_pause_progress BEFORE UPDATE ON app_progress FOR EACH ROW EXECUTE FUNCTION hh_pause_progress()`));
    try {
      const responses = await Promise.all([
        compareSave({ ...first.data, cookies: 1100, totalCookiesBaked: 1100 }, first.revision),
        compareSave({ ...first.data, cookies: 1200, totalCookiesBaked: 1200 }, first.revision),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      const winner = await responses.find((r) => r.status === 200)!.json();
      const loser = await responses.find((r) => r.status === 409)!.json();
      expect(loser).toMatchObject({ data: winner.data, revision: winner.revision });
      expect(await cloud()).toMatchObject({ data: winner.data, revision: winner.revision });
    } finally {
      await scratch!.db.execute(scratch!.sql.raw("DROP TRIGGER hh_pause_progress ON app_progress"));
      await scratch!.db.execute(scratch!.sql.raw("DROP FUNCTION hh_pause_progress()"));
    }
  });

  it("only one concurrent expected-absence request creates the row", async () => {
    const data = await cookieClickerBlob(1000);
    const responses = await Promise.all([compareSave({ ...data, cookies: 1100 }, null), compareSave({ ...data, cookies: 1200 }, null)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("deletion and recreation invalidate the old row incarnation", async () => {
    const first = await (await compareSave(await cookieClickerBlob(1000), null)).json();
    expect((await route.DELETE(new Request("http://localhost/api/progress/cookie-clicker", { method: "DELETE" }), {
      params: Promise.resolve({ appId: "cookie-clicker" }),
    })).status).toBe(200);
    const missing = await compareSave(first.data, first.revision);
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ data: null, revision: null });
    const recreated = await (await compareSave(first.data, null)).json();
    expect(recreated.revision).not.toBe(first.revision);
    expect((await compareSave(first.data, first.revision)).status).toBe(409);
  });

  it("rejects an account switch even when both accounts have no row, without revealing progress", async () => {
    const response = await compareSave(await cookieClickerBlob(1000), null, "previous-owner");
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("owner_changed");
    expect(body).not.toHaveProperty("data");
    expect((await cloud()).data).toBeNull();
  });

  it("rejects malformed revisions rather than silently using legacy semantics", async () => {
    expect((await compareSave(await cookieClickerBlob(1000), "not-a-revision")).status).toBe(400);
    expect((await cloud()).data).toBeNull();
  });

});
