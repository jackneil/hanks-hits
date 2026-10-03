/**
 * An in-memory stand-in for the Postgres tables that POST
 * /api/progress/[appId] writes, shared by the route tests (route.test.ts and
 * sync-roundtrip.test.tsx). route.pg.test.ts proves that it still matches a
 * real Postgres.
 *
 * Use it from a mock factory, so the route and the test share one instance:
 *   const pg = await vi.hoisted(async () => (await import("./db-stand-in")).createDbStandIn());
 */

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

export function createDbStandIn() {
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

    // Atomicity/concurrent lock behavior is proved on real Postgres, not modeled here.
    const execute = (statement: { sqlText?: string }) => stmt(() => {
      if (!statement.sqlText?.includes("pg_advisory_xact_lock")) throw new Error("stand-in: unsupported execute");
      return [];
    });
    return { insert, query, delete: del, transaction, execute };
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
    /** The @hank-neil/db exports that the route uses, for vi.mock. */
    module: {
      db,
      eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
      and: (...preds: unknown[]) => ({ op: "and", preds }),
      sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
        sqlText: strings.join("?"),
        values,
      }),
    },
    rows: (name: string) => state.committed.get(name) ?? [],
    reset() {
      state.committed = new Map([["progress_word_policy", [{ id: "local-only", enabled: false }]]]);
      state.failBoardWrites = false;
      state.failProgressWrites = false;
    },
  };
}
