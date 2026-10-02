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

const pg = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Tables = Map<string, Row[]>;
  type Col = {
    name: string;
    table: object;
    isUnique: boolean;
    uniqueName?: string;
    getSQLType(): string;
  };
  type Pred =
    | { op: "eq"; col: Col; val: unknown }
    | { op: "and"; preds: Pred[] };
  type Scope = { tables: Tables; root: { aborted: boolean } | null };

  const NAME = Symbol.for("drizzle:Name");
  const tableName = (t: object) => (t as Record<symbol, string>)[NAME];
  const columnsOf = (t: object) =>
    Object.entries(t).filter(
      ([, c]) =>
        c && typeof c === "object" && typeof (c as Col).getSQLType === "function"
    ) as [string, Col][];
  const keyOf = (col: Col) => {
    const entry = columnsOf(col.table).find(([, c]) => c === col);
    if (!entry) throw new Error(`stand-in: unknown column ${col.name}`);
    return entry[0];
  };
  const matches = (row: Row, p: Pred): boolean =>
    p.op === "and"
      ? p.preds.every((q) => matches(row, q))
      : row[keyOf(p.col)] === p.val;
  const firstTable = (p: Pred): object =>
    p.op === "and" ? firstTable(p.preds[0]) : p.col.table;
  const clone = (t: Tables): Tables =>
    new Map([...t].map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));

  class DrizzleQueryError extends Error {}
  const queryError = (
    sqlText: string,
    params: unknown[],
    code: string,
    message: string,
    constraint?: string
  ) =>
    new DrizzleQueryError(`Failed query: ${sqlText}\nparams: ${params.join(",")}`, {
      cause: Object.assign(new Error(message), {
        code,
        ...(constraint ? { constraint } : {}),
      }),
    });

  const state = {
    committed: new Map() as Tables,
    /** Make every leaderboard_entries write fail (a stand-in for any DB fault). */
    failBoardWrites: false,
    /** Make every app_progress write fail (the save itself cannot be stored). */
    failProgressWrites: false,
  };

  function applyUpdate(name: string, existing: Row, incoming: Row, set: Row) {
    if (name === "leaderboard_entries") {
      // The route's CASE WHEN: keep the better score (lower for fastest_time).
      const better =
        incoming.scoreType === "fastest_time"
          ? (incoming.score as number) < (existing.score as number)
          : (incoming.score as number) > (existing.score as number);
      if (better) {
        existing.score = incoming.score;
        existing.additionalStats = incoming.additionalStats;
        existing.achievedAt = incoming.achievedAt;
      }
      existing.syncedAt = set.syncedAt;
      return;
    }
    Object.assign(existing, set);
  }

  function executor(scope: Scope): Record<string, unknown> {
    // Every statement fails fast on an aborted transaction, and a failure
    // aborts it.
    const stmt = async <T>(fn: () => T): Promise<T> => {
      if (scope.root?.aborted) {
        throw queryError(
          "<next statement>",
          [],
          "25P02",
          "current transaction is aborted, commands ignored until end of transaction block"
        );
      }
      try {
        return fn();
      } catch (error) {
        if (scope.root) scope.root.aborted = true;
        throw error;
      }
    };
    const rowsOf = (t: object) => {
      const name = tableName(t);
      if (!scope.tables.has(name)) scope.tables.set(name, []);
      return scope.tables.get(name)!;
    };

    const insert = (table: object) => ({
      values: (input: Row) => {
        const run = (conflict: { target: Col | Col[]; set?: Row; nothing?: boolean }) =>
          stmt(() => {
            const name = tableName(table);
            const params = Object.values(input);
            const sqlText = `insert into "${name}" (${Object.keys(input).join(", ")})`;
            if (name === "leaderboard_entries" && state.failBoardWrites) {
              throw queryError(sqlText, params, "57014", "canceling statement due to statement timeout");
            }
            if (name === "app_progress" && state.failProgressWrites) {
              throw queryError(sqlText, params, "53100", "could not extend file: No space left on device");
            }
            for (const [key, col] of columnsOf(table)) {
              const v = input[key];
              const type = col.getSQLType();
              if (
                ["bigint", "integer", "smallint"].includes(type) &&
                typeof v === "number" &&
                !Number.isInteger(v)
              ) {
                throw queryError(sqlText, params, "22P02", `invalid input syntax for type ${type}: "${v}"`);
              }
            }
            const row: Row = { ...input };
            if (row.id === undefined) row.id = crypto.randomUUID();
            const all = rowsOf(table);
            const targets = [conflict.target].flat();
            const existing = all.find((r) =>
              targets.every((c) => r[keyOf(c)] === row[keyOf(c)])
            );
            if (existing) {
              if (conflict.nothing) return [];
              applyUpdate(name, existing, row, conflict.set ?? {});
              return [{ ...existing }];
            }
            for (const [key, col] of columnsOf(table)) {
              if (col.isUnique && all.some((r) => r[key] === row[key])) {
                throw queryError(
                  sqlText,
                  params,
                  "23505",
                  `duplicate key value violates unique constraint "${col.uniqueName}"`,
                  col.uniqueName
                );
              }
            }
            all.push(row);
            return [{ ...row }];
          });
        return {
          onConflictDoUpdate: (c: { target: Col | Col[]; set: Row }) =>
            run({ target: c.target, set: c.set }),
          onConflictDoNothing: (c: { target: Col | Col[] }) => ({
            returning: () => run({ target: c.target, nothing: true }),
          }),
        };
      },
    });

    const query = new Proxy(
      {},
      {
        get: () => ({
          findFirst: ({ where }: { where: Pred }) =>
            stmt(() => {
              const row = rowsOf(firstTable(where)).find((r) => matches(r, where));
              return row ? { ...row } : undefined;
            }),
        }),
      }
    );

    const del = (table: object) => ({
      where: (p: Pred) =>
        stmt(() => {
          const all = rowsOf(table);
          for (let i = all.length - 1; i >= 0; i--) if (matches(all[i], p)) all.splice(i, 1);
        }),
    });

    const transaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      if (!scope.root) {
        // BEGIN on a private copy. A throw is a ROLLBACK (nothing published);
        // COMMIT of an aborted transaction is a ROLLBACK too.
        const txScope: Scope = { tables: clone(state.committed), root: { aborted: false } };
        const result = await fn(executor(txScope));
        if (!txScope.root!.aborted) state.committed = txScope.tables;
        return result;
      }
      // SAVEPOINT (fails on an aborted transaction like any statement)
      await stmt(() => undefined);
      const snapshot = clone(scope.tables);
      try {
        const result = await fn(executor(scope));
        await stmt(() => undefined); // RELEASE SAVEPOINT
        return result;
      } catch (error) {
        // ROLLBACK TO SAVEPOINT: undo this level's writes, clear the abort.
        scope.tables.clear();
        for (const [k, v] of snapshot) scope.tables.set(k, v);
        scope.root.aborted = false;
        throw error;
      }
    };

    return { insert, query, delete: del, transaction };
  }

  const db = executor({
    get tables() {
      return state.committed;
    },
    root: null,
  } as Scope);

  return {
    db,
    state,
    rows: (name: string) => state.committed.get(name) ?? [],
    reset() {
      state.committed = new Map();
      state.failBoardWrites = false;
      state.failProgressWrites = false;
    },
  };
});

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
