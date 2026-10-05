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
    await scratch.db.transaction(async (tx) => {
      for (const statement of migrationStatements()) await tx.execute(scratch!.sql.raw(statement));
    });
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
    await db.execute(sql`UPDATE progress_word_policy SET enabled = false`);
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

  function chooseSave(data: Record<string, unknown>, baseRevision: string | null, extra: Record<string, unknown> = {}) {
    return route.POST(new Request("http://localhost/api/progress/cookie-clicker", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, merge: true, baseRevision, expectedOwnerId: ids.user, resolution: true, ...extra }),
    }), { params: Promise.resolve({ appId: "cookie-clicker" }) });
  }

  it("stores exactly the explicit selected copy while an ordinary continuation retains records", async () => {
    const first = await (await compareSave({ ...await cookieClickerBlob(9000), cookies: 9000 }, null)).json();
    const selected = { ...first.data, cookies: 2000, totalCookiesBaked: 2000 };
    const response = await chooseSave(selected, first.revision);
    expect(response.status).toBe(200);
    const chosen = await response.json();
    expect(chosen.data).toEqual(selected);
    expect(chosen.revision).not.toBe(first.revision);
    expect(await cloud()).toMatchObject({ data: selected, revision: chosen.revision });
    const before = await rowOf("cookie-clicker");
    expect((await chooseSave(first.data, first.revision)).status).toBe(409);
    expect(await rowOf("cookie-clicker")).toEqual(before);
    const repeated = await chooseSave(selected, chosen.revision);
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).revision).not.toBe(chosen.revision);
  });

  it.each([false, "true", null, 1])("rejects malformed explicit-choice mode %s without writing", async resolution => {
    const first = await (await compareSave(await cookieClickerBlob(9000), null)).json();
    const before = await rowOf("cookie-clicker");
    expect((await chooseSave(first.data, first.revision, { resolution })).status).toBe(400);
    expect(await rowOf("cookie-clicker")).toEqual(before);
  });

  it("requires revision and owner assertions for explicit choices", async () => {
    const data = await cookieClickerBlob(2000);
    expect((await chooseSave(data, null, { baseRevision: undefined })).status).toBe(400);
    expect((await chooseSave(data, null, { expectedOwnerId: "other-owner" })).status).toBe(409);
    expect((await chooseSave(data, null, { expectedOwnerId: undefined })).status).toBe(409);
    expect((await cloud()).data).toBeNull();
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
    const fence = await missing.json();
    expect(fence).toMatchObject({ data: null, revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(fence.revision).not.toBe(first.revision);
    expect((await compareSave(first.data, null)).status).toBe(409);
    const recreated = await (await compareSave(first.data, fence.revision)).json();
    expect(recreated.revision).not.toBe(first.revision);
    expect((await compareSave(first.data, first.revision)).status).toBe(409);
  });

  function erase(appId = "cookie-clicker", expectedOwner = ids.user) {
    return route.DELETE(new Request(`http://localhost/api/progress/${appId}`, {
      method: "DELETE", headers: { "x-hh-expected-owner": expectedOwner },
    }), { params: Promise.resolve({ appId }) });
  }

  it("fences a first save already dispatched when an absent game is deleted", async () => {
    const data = await cookieClickerBlob(1000);
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const request = new Request("http://localhost/api/progress/cookie-clicker", {
      method: "POST", duplex: "half", headers: { "Content-Type": "application/json" },
      body: new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }),
    } as RequestInit);
    const pending = route.POST(request, { params: Promise.resolve({ appId: "cookie-clicker" }) });
    let deleted: Response;
    try {
      deleted = await erase();
    } finally {
      body.enqueue(new TextEncoder().encode(JSON.stringify({ data, baseRevision: null, expectedOwnerId: ids.user })));
      body.close();
    }
    const response = await pending;
    expect(deleted!.status).toBe(200);
    expect(response.status).toBe(409);
    const fence = await cloud();
    expect(fence.data).toBeNull();
    expect(fence.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(await response.json()).toMatchObject({ data: null, revision: fence.revision });
    // JSONB null survives the real driver's NOT NULL constraint.
    const stored = await scratch!.db.execute(scratch!.sql`SELECT data = 'null'::jsonb AS json_null, data IS NULL AS sql_null FROM app_progress`);
    expect(stored.rows).toEqual([{ json_null: true, sql_null: false }]);
  });

  it("advances every deletion fence, rejects legacy resurrection, and allows exact-revision restart", async () => {
    const data = await cookieClickerBlob(1000);
    expect((await erase()).status).toBe(200);
    const first = await cloud();
    expect((await erase()).status).toBe(200);
    const second = await cloud();
    expect(second.revision).not.toBe(first.revision);
    expect((await compareSave(data, first.revision)).status).toBe(409);
    expect((await save("cookie-clicker", data)).status).toBe(409);
    expect(await cloud()).toEqual(second);
    const restarted = await compareSave(data, second.revision);
    expect(restarted.status).toBe(200);
    expect((await restarted.json()).data).toEqual(data);
    expect((await compareSave(data, second.revision)).status).toBe(409);
  });

  it("rejects an old unconditional save delayed past deletion and a legitimate restart", async () => {
    const data = await cookieClickerBlob(1000);
    await compareSave(data, null);
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const request = new Request("http://localhost/api/progress/cookie-clicker", {
      method: "POST", duplex: "half", headers: { "Content-Type": "application/json" },
      body: new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }),
    } as RequestInit);
    const pending = route.POST(request, { params: Promise.resolve({ appId: "cookie-clicker" }) });
    let restarted: Response;
    try {
      expect((await erase()).status).toBe(200);
      const fence = await cloud();
      restarted = await compareSave({ ...data, cookies: 42, totalCookiesBaked: 42 }, fence.revision);
    } finally {
      body.enqueue(new TextEncoder().encode(JSON.stringify({ data, merge: false })));
      body.close();
    }
    const stale = await pending;
    expect(restarted!.status).toBe(200);
    const fresh = await restarted!.json();
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ data: fresh.data, revision: fresh.revision });
    expect(await cloud()).toMatchObject({ data: fresh.data, revision: fresh.revision });
  });

  it("serializes deletion with an already based save so deleted gameplay stays absent", async () => {
    const data = await cookieClickerBlob(1000);
    const first = await (await compareSave(data, null)).json();
    const [deleted, saved] = await Promise.all([erase(), compareSave({ ...data, cookies: 2000 }, first.revision)]);
    expect(deleted.status).toBe(200);
    expect([200, 409]).toContain(saved.status);
    expect((await cloud()).data).toBeNull();
    expect(await scratch!.db.query.leaderboardEntries.findMany()).toEqual([]);
  });

  it("omits deletion metadata from profiles and rejects a stale owner's delete assertion", async () => {
    const data = await cookieClickerBlob(1000);
    await compareSave(data, null);
    const before = await cloud();
    const foreign = await erase("cookie-clicker", "previous-owner");
    expect(foreign.status).toBe(409);
    expect(await foreign.json()).toEqual({ error: "The signed-in account changed", code: "owner_changed" });
    expect(await cloud()).toEqual(before);
    await erase();
    await save("weather", weatherWords("Other game"), false);
    const all = await import("../../route");
    const response = await all.GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ count: 1, progress: [{ appId: "weather" }] });
    const { db, users, appProgress } = scratch!;
    await db.insert(users).values({ id: "other-owner", name: "Other" });
    await db.insert(appProgress).values({ id: "other-save", userId: "other-owner", appId: "cookie-clicker", data });
    await erase();
    expect(await db.query.appProgress.findFirst({ where: scratch!.eq(appProgress.id, "other-save") })).toMatchObject({ data });
    await db.delete(users).where(scratch!.eq(users.id, ids.user));
    expect(await db.query.appProgress.findMany()).toHaveLength(1);
  });

  it("rolls back deletion when dependent cleanup fails and otherwise erases transactions and board", async () => {
    const first = await (await compareSave(await cookieClickerBlob(1000), null)).json();
    const { db, sql, appTransactions } = scratch!;
    const row = (await rowOf("cookie-clicker"))!;
    await db.insert(appTransactions).values({ id: "purchase", progressId: row.id, type: "spend", amount: 20 });
    const board = await db.query.leaderboardEntries.findMany();
    expect(board.length).toBeGreaterThan(0);
    await db.execute(sql.raw("CREATE FUNCTION hh_reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cleanup unavailable'; END $$"));
    await db.execute(sql.raw("CREATE TRIGGER hh_reject_cleanup BEFORE DELETE ON app_transactions FOR EACH ROW EXECUTE FUNCTION hh_reject_cleanup()"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await erase()).status).toBe(500);
      expect(await cloud()).toMatchObject({ data: first.data, revision: first.revision });
      expect(await db.query.leaderboardEntries.findMany()).toEqual(board);
      expect(await db.select().from(appTransactions)).toHaveLength(1);
    } finally {
      await db.execute(sql.raw("DROP TRIGGER hh_reject_cleanup ON app_transactions"));
      await db.execute(sql.raw("DROP FUNCTION hh_reject_cleanup()"));
    }
    expect((await erase()).status).toBe(200);
    expect(await db.select().from(appTransactions)).toEqual([]);
    expect(await db.query.leaderboardEntries.findMany()).toEqual([]);
    expect((await cloud()).data).toBeNull();
  });

  it("adds the enforcement flag transactionally without changing existing saves", async () => {
    await compareSave(await cookieClickerBlob(1000), null);
    const before = await cloud();
    const { db, sql } = scratch!;
    await db.execute(sql.raw("ALTER TABLE app_progress DROP COLUMN revision_required"));
    const statements = readFileSync(path.join(migrationsDir, "0004_progress_deletion_fence.sql"), "utf8")
      .split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
    const interrupted = new Error("simulated migration interruption");
    await expect(db.transaction(async tx => {
      for (const statement of statements) await tx.execute(sql.raw(statement));
      throw interrupted;
    })).rejects.toBe(interrupted);
    const columns = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'app_progress' AND column_name = 'revision_required'`);
    expect(columns.rows).toEqual([]);
    await db.transaction(async tx => {
      for (const statement of statements) await tx.execute(sql.raw(statement));
    });
    expect(await cloud()).toEqual(before);
    expect((await rowOf("cookie-clicker"))!.revisionRequired).toBe(false);
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

  function weatherWords(name: string, lastModified = Date.now()) {
    const town = { name, latitude: 12, longitude: 23 };
    return { savedLocations: [town], lastLocation: town, units: "celsius", lastModified };
  }

  async function enableLocalWords() {
    await scratch!.db.execute(scratch!.sql`UPDATE progress_word_policy SET enabled = true`);
  }

  async function recoverWords(owner = ids.user) {
    const recovery = await import("../legacy-words/route");
    return recovery.GET(new Request("http://localhost/api/progress/weather/legacy-words", {
      headers: { "x-hh-expected-owner": owner },
    }), { params: Promise.resolve({ appId: "weather" }) });
  }

  it("keeps word projection and original-source preservation inside an explicit choice", async () => {
    await save("weather", weatherWords("Original town"), false);
    const before = await cloud("weather");
    await enableLocalWords();
    const response = await route.POST(new Request("http://localhost/api/progress/weather", {
      method: "POST", body: JSON.stringify({ data: weatherWords("New typed town"), resolution: true,
        baseRevision: before.revision, expectedOwnerId: ids.user }),
    }), { params: Promise.resolve({ appId: "weather" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ savedLocations: [], lastLocation: null });
    const preserved = JSON.stringify(await (await recoverWords()).json());
    expect(preserved).toContain("Original town");
    expect(preserved).not.toContain("New typed town");
    expect(JSON.stringify(await scratch!.db.select().from(scratch!.appProgress))).not.toContain("town");
  });

  it("preserves the permanent deletion fence after an explicit chosen restart", async () => {
    await erase();
    const fence = await cloud(), selected = await cookieClickerBlob(2000);
    expect((await chooseSave(selected, null)).status).toBe(409);
    expect((await chooseSave(selected, fence.revision)).status).toBe(200);
    expect((await rowOf("cookie-clicker"))!.revisionRequired).toBe(true);
    expect((await save("cookie-clicker", await cookieClickerBlob(9000))).status).toBe(409);
    expect((await cloud()).data).toEqual(selected);
  });

  it("keeps compatibility behavior until cutover, then preserves the old source before an old-client save", async () => {
    expect((await save("weather", weatherWords("Original town"), false)).status).toBe(200);
    expect((await cloud("weather")).data).toMatchObject({ lastLocation: { name: "Original town" } });
    await enableLocalWords();
    expect((await save("weather", weatherWords("New typed town"), false)).status).toBe(200);
    const ordinary = await cloud("weather");
    expect(ordinary.data).toMatchObject({ savedLocations: [], lastLocation: null, units: "celsius" });
    const response = await recoverWords();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const recovered = await response.json();
    expect(recovered.candidates).toHaveLength(1);
    expect(JSON.stringify(recovered)).toContain("Original town");
    expect(JSON.stringify(recovered)).not.toContain("New typed town");
    const { db, appProgress, legacyProgressWords } = scratch!;
    expect(JSON.stringify(await db.select().from(appProgress))).not.toContain("New typed town");
    expect(JSON.stringify(await db.select().from(legacyProgressWords))).not.toContain("New typed town");
    await save("weather", weatherWords("Retry town"), true);
    expect((await (await recoverWords()).json()).candidates).toHaveLength(1);
    const aggregate = await (await import("../../route")).GET();
    expect(JSON.stringify(await aggregate.json())).not.toContain("town");
  });

  it("sanitizes strict conflicts without archiving or altering the canonical revision", async () => {
    await save("weather", weatherWords("Secret town"), false);
    const before = await cloud("weather");
    await enableLocalWords();
    const response = await route.POST(new Request("http://localhost/api/progress/weather", {
      method: "POST", body: JSON.stringify({ data: weatherWords("New town"), baseRevision: null, expectedOwnerId: ids.user }),
    }), { params: Promise.resolve({ appId: "weather" }) });
    expect(response.status).toBe(409);
    const conflict = await response.json();
    expect(conflict.revision).toBe(before.revision);
    expect(conflict.data.lastLocation).toBeNull();
    expect(await scratch!.db.select().from(scratch!.legacyProgressWords)).toHaveLength(0);
    expect(JSON.stringify(await (await recoverWords()).json())).toContain("Secret town");
    const ack = await route.POST(new Request("http://localhost/api/progress/weather", {
      method: "POST", body: JSON.stringify({ data: weatherWords("New town"), baseRevision: before.revision, expectedOwnerId: ids.user }),
    }), { params: Promise.resolve({ appId: "weather" }) });
    expect(ack.status).toBe(200);
    expect((await ack.json()).data.lastLocation).toBeNull();
  });

  it("rolls back archive insertion when the progress replacement fails", async () => {
    await save("weather", weatherWords("Still recoverable"), false);
    await enableLocalWords();
    const { db, sql, legacyProgressWords } = scratch!;
    await db.execute(sql.raw(`CREATE FUNCTION fail_word_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`));
    await db.execute(sql.raw(`CREATE TRIGGER fail_word_save BEFORE UPDATE ON app_progress FOR EACH ROW EXECUTE FUNCTION fail_word_save()`));
    try {
      expect((await save("weather", weatherWords("Replacement"), false)).status).toBe(500);
      expect(await db.select().from(legacyProgressWords)).toHaveLength(0);
      expect(JSON.stringify(await (await recoverWords()).json())).toContain("Still recoverable");
    } finally {
      await db.execute(sql.raw("DROP TRIGGER fail_word_save ON app_progress"));
      await db.execute(sql.raw("DROP FUNCTION fail_word_save()"));
    }
  });

  it("retains distinct legacy versions and deduplicates exact-source retries", async () => {
    await save("weather", weatherWords("First version"), false);
    await enableLocalWords();
    await save("weather", weatherWords("Never archived"), false);
    const { db, appProgress, eq } = scratch!;
    // Simulates an unexpected stored legacy source, not an accepted new-client word.
    await db.update(appProgress).set({ data: weatherWords("Second legacy version"), updatedAt: new Date(Date.now() + 10) }).where(eq(appProgress.appId, "weather"));
    await save("weather", weatherWords("Also not archived"), false);
    const recovered = await (await recoverWords()).json();
    expect(recovered.candidates).toHaveLength(2);
    expect(JSON.stringify(recovered)).toContain("First version");
    expect(JSON.stringify(recovered)).toContain("Second legacy version");
    expect(JSON.stringify(recovered)).not.toContain("not archived");
  });

  it("refuses stale owner assertions and cascades only the deleted owner's recovery rows", async () => {
    await save("weather", weatherWords("Owner A town"), false);
    await enableLocalWords();
    await save("weather", weatherWords("Ignored"), false);
    const stale = await recoverWords("different-account");
    expect(stale.status).toBe(409);
    expect(JSON.stringify(await stale.json())).not.toContain("town");
    const { db, sql, users, appProgress, legacyProgressWords } = scratch!;
    await db.insert(users).values({ id: "other-word-owner" });
    await db.insert(appProgress).values({ id: "other-word-progress", userId: "other-word-owner", appId: "weather", data: weatherWords("Other town") });
    await db.insert(legacyProgressWords).values({ progressId: "other-word-progress", sourceRevision: "other-revision", extractionVersion: 1, payload: { fields: [] } });
    await db.execute(sql`DELETE FROM users WHERE id = ${ids.user}`);
    const rows = await db.select().from(legacyProgressWords);
    expect(rows).toHaveLength(1);
    expect(rows[0].progressId).toBe("other-word-progress");
  });

  it("recovers the original words while two old clients race to replace them", async () => {
    await save("weather", weatherWords("Before the race"), false);
    await enableLocalWords();
    const [first, recovery, second] = await Promise.all([
      save("weather", weatherWords("Race A"), true),
      recoverWords(),
      save("weather", weatherWords("Race B"), false),
    ]);
    expect([first.status, second.status, recovery.status]).toEqual([200, 200, 200]);
    for (const response of [recovery, await recoverWords()]) {
      const candidates = (await response.json()).candidates;
      expect(candidates).toHaveLength(1);
      expect(JSON.stringify(candidates)).toContain("Before the race");
      expect(JSON.stringify(candidates)).not.toContain("Race A");
      expect(JSON.stringify(candidates)).not.toContain("Race B");
    }
  });

  it("cutover waits for compatible writers and later writes use the enabled policy", async () => {
    const { db, sql } = scratch!;
    const { readWordPolicy } = await import("@/lib/progress-word-storage");
    await save("weather", weatherWords("Before barrier"), false);
    let signalLocked!: () => void;
    let releaseWriter!: () => void;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([ids.user, "weather"])}, 0))`);
      signalLocked();
      await release;
    });
    await locked;
    const writer = save("weather", weatherWords("Last compatible write"), false);
    const waitingCount = async () => {
      const waiting = await db.execute(sql`SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
      return (waiting.rows[0] as { count: number }).count;
    };
    try { await vi.waitFor(async () => expect(await waitingCount()).toBe(1), { timeout: 10000 }); }
    catch (error) { releaseWriter(); await blocker; await writer; throw error; }
    let cutoverDone = false;
    const cutover = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('hh:progress-word-policy:v1', 0))`);
      await tx.execute(sql`UPDATE progress_word_policy SET enabled = true WHERE id = 'local-only'`);
    }).then(() => { cutoverDone = true; });
    try {
      await vi.waitFor(async () => expect(await waitingCount()).toBe(2), { timeout: 10000 });
      expect(cutoverDone).toBe(false);
    } finally {
      releaseWriter();
      await blocker;
      expect((await writer).status).toBe(200);
      await cutover;
    }
    expect(await readWordPolicy(db)).toBe(true);
    await save("weather", weatherWords("After barrier"), false);
    const recovered = await (await recoverWords()).json();
    expect(JSON.stringify(recovered)).toContain("Last compatible write");
    expect(JSON.stringify(recovered)).not.toContain("After barrier");
  });

  it("explicit progress deletion cascades archives without waiting for a device receipt", async () => {
    await save("weather", weatherWords("Delete me"), false);
    await enableLocalWords();
    await save("weather", weatherWords("Ignored"), false);
    expect(await scratch!.db.select().from(scratch!.legacyProgressWords)).toHaveLength(1);
    const deleted = await route.DELETE(new Request("http://localhost/api/progress/weather", { method: "DELETE" }), {
      params: Promise.resolve({ appId: "weather" }),
    });
    expect(deleted.status).toBe(200);
    expect(await scratch!.db.select().from(scratch!.legacyProgressWords)).toHaveLength(0);
    expect((await (await recoverWords()).json()).candidates).toEqual([]);
  });

  it("deduplicates two archive attempts for the identical stored revision", async () => {
    await save("weather", weatherWords("Same source"), false);
    const { preserveProgressWords } = await import("@/lib/progress-word-storage");
    const row = await rowOf("weather");
    await scratch!.db.transaction(async (tx) => {
      await preserveProgressWords(tx, row!);
      await preserveProgressWords(tx, row!);
    });
    expect(await scratch!.db.select().from(scratch!.legacyProgressWords)).toHaveLength(1);
  });

  it("holds a coherent recovery snapshot when progress is deleted between its two reads", async () => {
    await save("weather", weatherWords("Snapshot words"), false);
    await enableLocalWords();
    await save("weather", weatherWords("Ignored"), false);
    const { db } = scratch!;
    let parentRead!: () => void;
    let resumeRecovery!: () => void;
    const read = new Promise<void>((resolve) => { parentRead = resolve; });
    const resume = new Promise<void>((resolve) => { resumeRecovery = resolve; });
    const realTransaction = db.transaction.bind(db);
    const interception = vi.spyOn(db, "transaction").mockImplementation((fn, config) => realTransaction(async (tx) => {
      if (config?.isolationLevel !== "repeatable read") return fn(tx);
      const query = { ...tx.query, appProgress: {
        ...tx.query.appProgress,
        findFirst: async (options: Parameters<typeof tx.query.appProgress.findFirst>[0]) => {
          const row = await tx.query.appProgress.findFirst(options);
          parentRead();
          await resume;
          return row;
        },
      } };
      return fn(new Proxy(tx, { get: (target, key) => key === "query" ? query : Reflect.get(target, key) }));
    }, config));
    const recovery = recoverWords();
    try {
      await read;
      const deleted = await route.DELETE(new Request("http://localhost/api/progress/weather", { method: "DELETE" }), {
        params: Promise.resolve({ appId: "weather" }),
      });
      expect(deleted.status).toBe(200);
    } finally {
      resumeRecovery();
      interception.mockRestore();
    }
    const response = await recovery;
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("Snapshot words");
    expect((await (await recoverWords()).json()).candidates).toEqual([]);
  });

  it("rolls back the bounded additive migration under old-writer contention, then retries cleanly", async () => {
    const { db, sql } = scratch!;
    // This is the isolated scratch database, never an external database.
    await db.execute(sql.raw("DROP TABLE legacy_progress_words, progress_word_policy"));
    const statements = readFileSync(path.join(migrationsDir, "0002_legacy_progress_words.sql"), "utf8")
      .split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
    const migrate = () => db.transaction(async (tx) => {
      for (const statement of statements) await tx.execute(sql.raw(statement));
    });
    let ready!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => { ready = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const writer = db.transaction(async (tx) => {
      await tx.execute(sql.raw("LOCK TABLE app_progress IN ROW EXCLUSIVE MODE"));
      ready();
      await resume;
    });
    await locked;
    try {
      await expect(migrate()).rejects.toMatchObject({ cause: { code: "55P03" } });
      const absent = await db.execute(sql.raw("SELECT to_regclass('legacy_progress_words') AS archive, to_regclass('progress_word_policy') AS policy"));
      expect(absent.rows[0]).toEqual({ archive: null, policy: null });
    } finally {
      release();
      await writer;
      await migrate();
    }
    expect((await db.execute(sql.raw("SHOW lock_timeout"))).rows[0]).toEqual({ lock_timeout: "0" });
    expect((await db.execute(sql.raw("SHOW statement_timeout"))).rows[0]).toEqual({ statement_timeout: "0" });
    expect((await save("weather", weatherWords("Normal save after migration"), false)).status).toBe(200);
  });

});
