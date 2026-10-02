import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";

// POST /api/progress/[appId] writes the player's save (app_progress) and,
// in the same transaction, a leaderboard row whose score column is a
// Postgres bigint. Two defects lived here together:
// 1. Games keep fractions (Hill Climb distance from physics, Cookie Clicker
//    fractional cookies per second), and a fraction makes the bigint insert
//    throw "invalid input syntax for type bigint".
// 2. The board write shared the save's transaction with no savepoint, so
//    that throw rolled back the PROGRESS write too and the POST returned 500:
//    the player's cloud save was lost, not just the board row.
//
// The stand-in below models only what this route leans on, the way Postgres
// behaves (so these tests fail on the old route):
// - an integer column (bigint/integer/smallint) rejects a fraction: 22P02;
// - a single-column UNIQUE rejects a duplicate that is not the ON CONFLICT
//   target: 23505, with the constraint name on the driver error;
// - a failed statement aborts the transaction: later statements fail with
//   25P02 until ROLLBACK TO SAVEPOINT, and COMMIT of an aborted transaction
//   is a ROLLBACK;
// - a nested drizzle transaction is a SAVEPOINT: its failure undoes only its
//   own writes.
// Errors have drizzle's shape: a DrizzleQueryError whose message carries the
// SQL params, with the driver error (code, constraint) as its cause.

const pg = await vi.hoisted(async () =>
  (await import("./db-stand-in")).createDbStandIn()
);

const handles = vi.hoisted(() => ({ queue: [] as string[], next: 0 }));

vi.mock("@hank-neil/db", () => ({
  db: pg.db,
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sqlText: strings.join("?"),
    values,
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => ({ user: { id: "kid-user-1" } }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkProgressRateLimit: () => ({ success: true }),
  checkProgressDeleteRateLimit: () => ({ success: true }),
}));

// generateUniqueHandle checks the table first, so a real collision only
// happens in a race. The queue lets a test hand out a handle that another
// player already holds.
vi.mock("@/lib/handle-generator", () => ({
  generateUniqueHandle: async () =>
    handles.queue.shift() ?? `TestHandle${++handles.next}`,
}));

import { POST } from "../route";

const USER_ID = "kid-user-1";

function save(appId: string, data: Record<string, unknown>, merge = false) {
  return POST(
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
    totalCoinsEarned: 312,
    lastModified: Date.now(),
  } as Record<string, unknown>;
}

async function cookieClickerBlob(totalCookiesBaked: number) {
  const { useCookieClickerStore } = await import("@/games/cookie-clicker/lib/store");
  return {
    ...useCookieClickerStore.getState().getProgress(),
    cookies: 12.5,
    totalCookiesBaked,
    totalClicks: 41,
    lastModified: Date.now(),
  } as Record<string, unknown>;
}

async function memoryMatchBlob(easyMs: number) {
  const { useMemoryMatchStore } = await import("@/games/memory-match/lib/store");
  const base = useMemoryMatchStore.getState().getProgress();
  return {
    ...base,
    bestTimes: { easy: easyMs, medium: null, hard: null, expert: null },
    gamesWon: 1,
    updatedAt: Date.now(),
  } as Record<string, unknown>;
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

const progressRow = (appId: string) =>
  pg.rows("app_progress").find((r) => r.userId === USER_ID && r.appId === appId);
const boardRows = (appId: string) =>
  pg.rows("leaderboard_entries").filter((r) => r.appId === appId);

describe("POST /api/progress/[appId]: fractional scores and the board write", () => {
  beforeEach(() => {
    pg.reset();
    handles.queue = [];
    handles.next = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves a Hill Climb blob with a physics distance and boards it rounded down", async () => {
    const res = await save("hill-climb", await hillClimbBlob(4189.294008871742));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({ success: true, conflicts: [] })
    );
    // The save keeps the exact value: only the board copy is a whole number.
    expect((progressRow("hill-climb")?.data as Record<string, unknown>).bestDistance).toBe(
      4189.294008871742
    );
    expect(boardRows("hill-climb")).toEqual([
      expect.objectContaining({ score: 4189, scoreType: "high_score" }),
    ]);
  });

  it("saves a Cookie Clicker blob with fractional cookies and boards it rounded down", async () => {
    const res = await save("cookie-clicker", await cookieClickerBlob(436.8441000000125));

    expect(res.status).toBe(200);
    expect(
      (progressRow("cookie-clicker")?.data as Record<string, unknown>).totalCookiesBaked
    ).toBe(436.8441000000125);
    expect(boardRows("cookie-clicker")).toEqual([
      expect.objectContaining({ score: 436, scoreType: "high_score" }),
    ]);
  });

  it("rounds a fractional fastest_time UP, never faster than the real run", async () => {
    const res = await save("memory-match", await memoryMatchBlob(12500.2));

    expect(res.status).toBe(200);
    expect(progressRow("memory-match")).toBeDefined();
    expect(boardRows("memory-match")).toEqual([
      expect.objectContaining({ score: 12501, scoreType: "fastest_time" }),
    ]);
  });

  it("boards the merged value on a merge save (the path the game client uses)", async () => {
    expect((await save("hill-climb", await hillClimbBlob(1000))).status).toBe(200);
    const res = await save("hill-climb", await hillClimbBlob(2048.75), true);

    expect(res.status).toBe(200);
    expect((progressRow("hill-climb")?.data as Record<string, unknown>).bestDistance).toBe(
      2048.75
    );
    expect(boardRows("hill-climb")).toEqual([
      expect.objectContaining({ score: 2048, scoreType: "high_score" }),
    ]);
  });

  it("keeps the progress save when the board write fails, and logs it values-free", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    pg.state.failBoardWrites = true;

    const res = await save("hill-climb", await hillClimbBlob(4189.294008871742));

    // The client contract is unchanged: a 200 with success, so the game
    // does not treat its save as lost.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({ success: true, merged: false, conflicts: [] })
    );
    expect((progressRow("hill-climb")?.data as Record<string, unknown>).bestDistance).toBe(
      4189.294008871742
    );
    expect(boardRows("hill-climb")).toEqual([]);
    // The savepoint rolled back the profile the board work created as well.
    expect(pg.rows("gaming_profiles")).toEqual([]);

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("[LEADERBOARD] Board sync failed for hill-climb"),
      expect.objectContaining({ error: "DrizzleQueryError", cause: "Error", code: "57014" })
    );
    const logged = printed(errorLog);
    expect(logged).not.toContain(USER_ID);
    expect(logged).not.toContain("4189");
    expect(logged).not.toContain("Failed query");
    expect(logged).not.toContain("statement timeout");

    // The next save puts the board row in.
    pg.state.failBoardWrites = false;
    expect((await save("hill-climb", await hillClimbBlob(4189.294008871742), true)).status).toBe(200);
    expect(boardRows("hill-climb")).toEqual([
      expect.objectContaining({ score: 4189 }),
    ]);
  });

  it("retries a gaming-profile handle collision in its own savepoint", async () => {
    // Another player already holds the first handle this save draws (the
    // race generateUniqueHandle's pre-check cannot see).
    pg.state.committed.set("gaming_profiles", [
      { id: "other-profile", userId: "other-user", handle: "TakenHandle7" },
    ]);
    handles.queue = ["TakenHandle7", "FreeHandle8"];

    const res = await save("hill-climb", await hillClimbBlob(500));

    expect(res.status).toBe(200);
    const mine = pg.rows("gaming_profiles").find((p) => p.userId === USER_ID);
    expect(mine?.handle).toBe("FreeHandle8");
    expect(boardRows("hill-climb")).toEqual([
      expect.objectContaining({ gamingProfileId: mine?.id, score: 500 }),
    ]);
  });

  it("logs a failed progress save values-free: no SQL params, user id, or blob", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    pg.state.failProgressWrites = true;

    const res = await save("hill-climb", await hillClimbBlob(4189.294008871742));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to save progress" });
    expect(progressRow("hill-climb")).toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(
      "POST /api/progress error:",
      expect.objectContaining({ error: "DrizzleQueryError", cause: "Error", code: "53100" })
    );
    // A drizzle error's message is the SQL text plus every parameter: here
    // the user id and the whole progress blob.
    const logged = printed(errorLog);
    expect(logged).not.toContain(USER_ID);
    expect(logged).not.toContain("4189");
    expect(logged).not.toContain("Failed query");
    expect(logged).not.toContain("No space left");
  });
});

// ---------------------------------------------------------------------------
// A merge save whose merged blob breaks the schema
// ---------------------------------------------------------------------------
// The route re-validates the merged blob. It once stored the INCOMING save
// whenever that check failed, so an older save replaced a newer row whole.
// Now it starts again from the newer side and adds each merged field that
// keeps the blob valid; when the newer side is the stored row and the row
// itself fails the schema of today, it stores nothing and answers 409.

describe("POST merge: a merged blob that breaks the schema", () => {
  const HOUR = 60 * 60_000;
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  async function cookieBlob(fields: Record<string, unknown>) {
    const { useCookieClickerStore } = await import("@/games/cookie-clicker/lib/store");
    return { ...useCookieClickerStore.getState().getProgress(), ...fields } as Record<string, unknown>;
  }

  async function mathBlob(fields: Record<string, unknown>) {
    const { useMathAttackStore } = await import("@/games/math-attack/lib/store");
    return { ...useMathAttackStore.getState().getProgress(), ...fields } as Record<string, unknown>;
  }

  /** A stored row, written the way an older server version could have. */
  function putRow(appId: string, data: Record<string, unknown>, updatedAt: Date) {
    const rows = pg.state.committed.get("app_progress") ?? [];
    rows.push({ id: crypto.randomUUID(), userId: USER_ID, appId, data, lastSyncedAt: updatedAt, updatedAt });
    pg.state.committed.set("app_progress", rows);
  }

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    pg.reset();
    handles.queue = [];
    handles.next = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("newer row + an older save whose union is too long: the row stays the base, and the save's records still fold in", async () => {
    const now = Date.now();
    putRow(
      "cookie-clicker",
      await cookieBlob({ cookies: 7_000, totalCookiesBaked: 1_000, totalClicks: 50, unlockedAchievements: ids("row-", 300), lastModified: now - 60_000 }),
      new Date(now - 60_000)
    );
    const older = await cookieBlob({ cookies: 3, totalCookiesBaked: 5_000, totalClicks: 10, unlockedAchievements: ids("dev-", 300), lastModified: now - HOUR });

    const res = await save("cookie-clicker", older, true);

    expect(res.status).toBe(200);
    const stored = progressRow("cookie-clicker")!.data as Record<string, unknown>;
    expect(stored.cookies).toBe(7_000); // the newer row's wallet, not the older save's
    expect(stored.totalCookiesBaked).toBe(5_000); // the older save's record
    expect(stored.totalClicks).toBe(50);
    expect(stored.unlockedAchievements).toEqual(ids("row-", 300)); // 600 > 500: left out
    expect(stored.lastModified).toBe(now - 60_000);
    const logged = printed(warn);
    expect(logged).toContain("left out [unlockedAchievements]");
    expect(logged).toContain("stored row");
    expect(logged).not.toContain("dev-0");
  });

  it("newer row that the schema of today refuses + an older save: 409, and the row is not touched", async () => {
    const now = Date.now();
    const rowData = await mathBlob({ highScore: 900, gamesPlayed: 40, settings: { soundEnabled: true, difficulty: "13yo" }, lastModified: now - 60_000 });
    const rowTime = new Date(now - 60_000);
    putRow("math-attack", rowData, rowTime);
    const older = await mathBlob({ highScore: 100, gamesPlayed: 5, lastModified: now - HOUR });

    const res = await save("math-attack", older, true);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(expect.objectContaining({ kept: "existing" }));
    const row = progressRow("math-attack")!;
    expect(row.data).toEqual(rowData);
    expect(row.updatedAt).toBe(rowTime);
    expect(printed(warn)).toContain("kept the newer stored row");
  });

  it("older row + a newer save whose union is too long: the save is stored, with the row's records that fit", async () => {
    const now = Date.now();
    putRow(
      "cookie-clicker",
      await cookieBlob({ cookies: 7_000, totalCookiesBaked: 1_000, totalClicks: 9_000, unlockedAchievements: ids("row-", 300), lastModified: now - HOUR }),
      new Date(now - HOUR)
    );
    const newer = await cookieBlob({ cookies: 3, totalCookiesBaked: 200, totalClicks: 10, unlockedAchievements: ids("dev-", 300), lastModified: now - 1_000 });

    const res = await save("cookie-clicker", newer, true);

    expect(res.status).toBe(200);
    const stored = progressRow("cookie-clicker")!.data as Record<string, unknown>;
    expect(stored.cookies).toBe(3); // the newer save's wallet
    expect(stored.totalClicks).toBe(9_000); // the row's record
    expect(stored.totalCookiesBaked).toBe(1_000);
    expect(stored.unlockedAchievements).toEqual(ids("dev-", 300));
    expect(stored.lastModified).toBe(now - 1_000);
    expect(printed(warn)).toContain("incoming save");
  });

  it("older row that the schema of today refuses + a newer save: the save is stored with the row's best score", async () => {
    const now = Date.now();
    putRow(
      "math-attack",
      await mathBlob({ highScore: 900, gamesPlayed: 40, settings: { soundEnabled: true, difficulty: "13yo" }, lastModified: now - HOUR }),
      new Date(now - HOUR)
    );
    const newer = await mathBlob({ highScore: 100, gamesPlayed: 5, lastModified: now - 1_000 });

    const res = await save("math-attack", newer, true);

    expect(res.status).toBe(200);
    const stored = progressRow("math-attack")!.data as Record<string, unknown>;
    expect(stored.highScore).toBe(900);
    expect(stored.gamesPlayed).toBe(40);
    expect((stored.settings as Record<string, unknown>).difficulty).toBe(newer.settings && (newer.settings as Record<string, unknown>).difficulty);
  });
});
