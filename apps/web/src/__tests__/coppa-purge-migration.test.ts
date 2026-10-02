// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The COPPA purge (packages/db/drizzle/0001_coppa_google_id_only.sql,
 * issue #26i) on a scratch copy of the schema, with SYNTHETIC rows shaped
 * like production on 2026-10-01: 4 Google users, each with an email and a
 * name, 3 with a photo, no password, and Google accounts that hold an
 * access_token, an id_token, a scope, a token_type and an expires_at.
 * No real row is ever copied.
 *
 * The purge must not touch the game progress rows: the words that players
 * typed into games are moved to the device and cleared by the local word
 * store change (design/LOCAL_WORDS.html), which moves them first. So the
 * seed holds SYNTHETIC typed words in app_progress, and the purge must
 * leave every progress row exactly as it was. The runbook's read-only
 * typed-words count (packages/db/scripts/typed-words-count.sql) runs here
 * too: before and after the purge, and field by field on its own database.
 *
 * The file is applied the same way as in production: psql, one
 * transaction, stop on the first error. Then the real Drizzle adapter,
 * wrapped by withoutPersonalInfo, signs players in against the purged
 * database, an account is deleted, and the vacuum step
 * (packages/db/scripts/coppa-purge-vacuum.sql) runs. The last check reads
 * the table and index files and finds none of the old values in them.
 *
 * It needs a LOCAL Postgres (HH_TEST_PGHOST, default the /tmp socket;
 * HH_TEST_PGPORT, default 5432) and psql. It creates and drops its own
 * database. It never reads DATABASE_URL or PGHOST, so it cannot touch a
 * remote database. Without a local Postgres it is skipped, and says so.
 */

// Gamer names under test control: the collision case needs a known duplicate.
const handles = vi.hoisted(() => ({ next: [] as string[] }));
vi.mock("@/lib/handle-generator", () => ({
  generateUniqueHandle: async () => handles.next.shift() ?? `Fresh${Math.floor(Math.random() * 1e9)}`,
}));

const HOST = process.env.HH_TEST_PGHOST ?? "/tmp";
const PORT = process.env.HH_TEST_PGPORT ?? "5432";
const LOCAL_HOST = HOST.startsWith("/") || HOST === "localhost" || HOST === "127.0.0.1";
const DB_NAME = `hh_coppa_purge_${process.pid}_${Date.now()}`;
const REPO = path.resolve(__dirname, "../../../..");
const MIGRATIONS = path.join(REPO, "packages/db/drizzle");
const PURGE_TAG = "0001_coppa_google_id_only";
const VACUUM_FILE = path.join(REPO, "packages/db/scripts/coppa-purge-vacuum.sql");
/** Read only: the app_progress rows that still hold a typed word (runbook steps 6, 10 and 12). */
const TYPED_COUNT_FILE = path.join(REPO, "packages/db/scripts/typed-words-count.sql");

function pgReady(): boolean {
  if (!LOCAL_HOST) return false;
  const ready = spawnSync("pg_isready", ["-h", HOST, "-p", PORT], { encoding: "utf8" });
  return ready.status === 0 && spawnSync("psql", ["--version"]).status === 0;
}

const READY = pgReady();
if (!READY) {
  console.warn(
    `[coppa-purge-migration] SKIPPED: no local Postgres at ${HOST}:${PORT} (or no psql). ` +
      "The purge SQL was NOT checked. Start a local Postgres to run it."
  );
}

// Only what psql needs. NODE_ENV is there because Next.js types make ProcessEnv require it.
const PG_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  PGHOST: HOST,
  PGPORT: PORT,
  PGCONNECT_TIMEOUT: "5",
};

/** Runs SQL with psql, stops on the first error, and returns the rows as "a|b" lines. */
function psql(database: string, sql: string): string[] {
  const out = execFileSync("psql", ["-X", "-q", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", sql], {
    env: PG_ENV,
    encoding: "utf8",
    // Keep psql's errors out of the test log: a thrown error carries them.
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split("\n").filter(Boolean);
}

/** Runs a read-only SQL file the way the runbook does, and returns its rows as "a|b" lines. */
function runReadOnlyFile(database: string, file: string): string[] {
  const out = execFileSync("psql", ["-X", "-q", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-d", database, "-f", file], {
    env: PG_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split("\n").filter(Boolean);
}

/** Applies a migration file the way production does: one transaction, stop on error. */
function applyFile(database: string, file: string, oneTransaction = true) {
  const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1", ...(oneTransaction ? ["-1"] : []), "-d", database, "-f", file];
  return spawnSync("psql", args, { env: PG_ENV, encoding: "utf8" });
}

function journalTags(): string[] {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta/_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  return journal.entries.sort((a, b) => a.idx - b.idx).map((e) => e.tag);
}

const one = (sql: string) => psql(DB_NAME, sql)[0];

const SEED = `
INSERT INTO users (id, name, email, email_verified, image, password, created_at, updated_at) VALUES
  ('user-a', 'Synthetic Parent A', 'parent.a@example.test', NULL, 'https://example.test/a.png', NULL, now(), now()),
  ('user-b', 'Synthetic Kid B',    'kid.b@example.test',    NULL, 'https://example.test/b.png', NULL, now(), now()),
  ('user-c', 'Synthetic Kid C',    'kid.c@example.test',    NULL, 'https://example.test/c.png', NULL, now(), now()),
  ('user-d', 'Synthetic Kid D',    'kid.d@example.test',    NULL, NULL,                         NULL, now(), now());
INSERT INTO accounts (user_id, type, provider, provider_account_id, refresh_token, access_token, expires_at, token_type, scope, id_token, session_state)
SELECT id, 'oidc', 'google', 'google-sub-' || id, NULL, 'synthetic-access-token-' || id, 1790000000, 'bearer',
       'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
       'eyJhbGciOiJSUzI1NiJ9.synthetic-claims-with-email.' || id, NULL
FROM users;
INSERT INTO gaming_profiles (id, user_id, handle) SELECT 'gp-' || id, id, 'Handle' || upper(substr(id, 6)) FROM users;
INSERT INTO app_progress (id, user_id, app_id, data) VALUES
  ('p1', 'user-a', 'chess', '{"gamesWon": 3}'),
  ('p2', 'user-b', 'snake', '{"highScore": 120}');
INSERT INTO leaderboard_entries (id, gaming_profile_id, app_id, score) VALUES ('l1', 'gp-user-b', 'snake', 120);
`;

/**
 * user-c's saves, with SYNTHETIC words that a player typed. The purge must
 * leave them alone (the local word store change moves them to the device
 * first). Dollar quotes: the JSON has apostrophes.
 */
const TYPED: Record<string, Record<string, unknown>> = {
  "oregon-trail": {
    gameStarted: true,
    leaderName: "Synthetic Kid",
    party: [{ name: "Synthetic Mom", health: "very_poor", isSick: true, sickDays: 11, leftBehind: false }],
    milesTraveled: 140,
  },
  "virtual-pet": { pet: { name: "Synthetic Kid's pup", speciesId: "pupper" }, coins: 50 },
  weather: { savedLocations: [{ name: "Synthetic Town", latitude: 35.1, longitude: -80.8 }], units: "fahrenheit" },
};
const TYPED_SEED = Object.entries(TYPED)
  .map(([appId, data]) => `INSERT INTO app_progress (id, user_id, app_id, data) VALUES ('typed-${appId}', 'user-c', '${appId}', $j$${JSON.stringify(data)}$j$);`)
  .join("\n");

/** The values that the purge must clear, to look for in the database files. */
const OLD_VALUES = [
  "parent.a@example.test",
  "kid.b@example.test",
  "Synthetic Parent A",
  "Synthetic Kid B",
  "https://example.test/a.png",
  "synthetic-access-token-user-a",
  "synthetic-claims-with-email.user-a",
];

describe.skipIf(!READY)("COPPA purge migration on a scratch database", () => {
  let before: {
    users: string;
    accounts: string;
    profiles: string;
    progress: string;
    progressRows: string[];
    leaderboard: string;
    subs: string[];
    typedWords: string[];
  };
  let purge: ReturnType<typeof applyFile>;

  beforeAll(() => {
    psql("postgres", `CREATE DATABASE "${DB_NAME}"`);
    const tags = journalTags();
    expect(tags).toContain(PURGE_TAG);
    // Build the schema from every migration before the purge, in journal order.
    for (const tag of tags.slice(0, tags.indexOf(PURGE_TAG))) {
      const result = applyFile(DB_NAME, path.join(MIGRATIONS, `${tag}.sql`));
      expect(result.status, result.stderr).toBe(0);
    }
    psql(DB_NAME, SEED);
    psql(DB_NAME, TYPED_SEED);
    before = {
      users: one("SELECT count(*) FROM users"),
      accounts: one("SELECT count(*) FROM accounts"),
      profiles: one("SELECT count(*) FROM gaming_profiles"),
      progress: one("SELECT count(*) FROM app_progress"),
      progressRows: psql(DB_NAME, "SELECT id || '=' || data::text || '=' || updated_at::text FROM app_progress ORDER BY id"),
      leaderboard: one("SELECT count(*) FROM leaderboard_entries"),
      subs: psql(DB_NAME, "SELECT user_id || '=' || provider_account_id FROM accounts ORDER BY 1"),
      typedWords: runReadOnlyFile(DB_NAME, TYPED_COUNT_FILE),
    };
    // The seed really is shaped like production before the purge.
    expect(one("SELECT count(email) || ',' || count(name) || ',' || count(image) || ',' || count(password) FROM users")).toBe("4,4,3,0");
    expect(one("SELECT count(access_token) || ',' || count(id_token) FROM accounts")).toBe("4,4");

    purge = applyFile(DB_NAME, path.join(MIGRATIONS, `${PURGE_TAG}.sql`));
  });

  afterAll(async () => {
    try {
      const { db } = await import("@hank-neil/db");
      await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    } catch {
      // The adapter checks did not run, so there is no pool.
    }
    psql("postgres", `DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  });

  it("applies in one transaction with no error", () => {
    expect(purge.status, purge.stderr).toBe(0);
  });

  it("clears the email, name, image and email_verified of every user", () => {
    expect(one("SELECT count(*) FROM users WHERE email IS NOT NULL OR name IS NOT NULL OR image IS NOT NULL OR email_verified IS NOT NULL")).toBe("0");
  });

  it("clears every token and token claim of every account", () => {
    expect(
      one(
        "SELECT count(*) FROM accounts WHERE refresh_token IS NOT NULL OR access_token IS NOT NULL OR id_token IS NOT NULL " +
          "OR expires_at IS NOT NULL OR token_type IS NOT NULL OR scope IS NOT NULL OR session_state IS NOT NULL"
      )
    ).toBe("0");
  });

  it("drops the password column", () => {
    expect(one("SELECT count(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password'")).toBe("0");
  });

  it("leaves every saved game exactly as it was, typed words too (the local word store change moves them first)", () => {
    expect(psql(DB_NAME, "SELECT id || '=' || data::text || '=' || updated_at::text FROM app_progress ORDER BY id")).toEqual(
      before.progressRows
    );
    expect(one("SELECT data->>'leaderName' FROM app_progress WHERE id = 'typed-oregon-trail'")).toBe("Synthetic Kid");
  });

  it("leaves the typed-words count of the runbook the same, so the backup step still waits for the local word store clear", () => {
    // user-c's three typed rows, before and after: this purge clears none of them.
    expect(before.typedWords).toEqual(["oregon-trail|1", "virtual-pet|1", "weather|1", "total|3"]);
    expect(runReadOnlyFile(DB_NAME, TYPED_COUNT_FILE)).toEqual(before.typedWords);
  });

  it("keeps every user, account link, gamer name, save and score", () => {
    expect(one("SELECT count(*) FROM users")).toBe(before.users);
    expect(one("SELECT count(*) FROM accounts")).toBe(before.accounts);
    expect(one("SELECT count(*) FROM gaming_profiles")).toBe(before.profiles);
    expect(one("SELECT count(*) FROM app_progress")).toBe(before.progress);
    expect(one("SELECT count(*) FROM leaderboard_entries")).toBe(before.leaderboard);
    expect(psql(DB_NAME, "SELECT user_id || '=' || provider_account_id FROM accounts ORDER BY 1")).toEqual(before.subs);
  });

  it("adds the one-account-per-player index", () => {
    expect(one("SELECT indexdef FROM pg_indexes WHERE indexname = 'accounts_user_id_unique'")).toMatch(/UNIQUE INDEX .* \(user_id\)/);
  });

  it("makes the database reject an email, a name, a photo or a token from now on", () => {
    const tries = [
      "INSERT INTO users (id, email) VALUES ('x1', 'new@example.test')",
      "INSERT INTO users (id, name) VALUES ('x2', 'Some Name')",
      "UPDATE users SET image = 'https://example.test/x.png' WHERE id = 'user-a'",
      "UPDATE accounts SET id_token = 'eyJ.x.y' WHERE user_id = 'user-a'",
      "UPDATE accounts SET access_token = 'synthetic-access-token-x' WHERE user_id = 'user-a'",
    ];
    for (const sql of tries) {
      expect(() => psql(DB_NAME, sql), sql).toThrow(/violates check constraint/);
    }
  });

  it("changes nothing when it is run a second time (the transaction stops and rolls back)", () => {
    const again = applyFile(DB_NAME, path.join(MIGRATIONS, `${PURGE_TAG}.sql`));
    expect(again.status).not.toBe(0);
    expect(one("SELECT count(*) FROM users")).toBe(before.users);
  });

  describe("sign-in with the real Drizzle adapter after the purge", () => {
    let adapter: import("next-auth/adapters").Adapter;
    let rawAdapter: import("next-auth/adapters").Adapter;

    beforeAll(async () => {
      process.env.DATABASE_URL = `postgresql://${encodeURIComponent(userInfo().username)}@localhost:${PORT}/${DB_NAME}?host=${encodeURIComponent(HOST)}`;
      const { db } = await import("@hank-neil/db");
      const schema = await import("@hank-neil/db/schema");
      const { DrizzleAdapter } = await import("@auth/drizzle-adapter");
      const { withoutPersonalInfo } = await import("@/lib/auth-privacy");
      rawAdapter = DrizzleAdapter(db, {
        usersTable: schema.users,
        accountsTable: schema.accounts,
        sessionsTable: schema.sessions,
        verificationTokensTable: schema.verificationTokens,
        authenticatorsTable: schema.authenticators,
      });
      adapter = withoutPersonalInfo(rawAdapter);
    });

    it("finds a purged player by the Google subject id alone", async () => {
      const user = await adapter.getUserByAccount!({ provider: "google", providerAccountId: "google-sub-user-b" });
      expect(user?.id).toBe("user-b");
      expect(user?.email ?? null).toBeNull();
    });

    it("stores a new Google player with no email, name or photo, and an account with no tokens", async () => {
      const user = await adapter.createUser!({
        id: "ignored",
        name: "Synthetic New Kid",
        email: "new.kid@example.test",
        emailVerified: null,
        image: "https://example.test/new.png",
      });
      await adapter.linkAccount!({
        userId: user.id,
        type: "oidc",
        provider: "google",
        providerAccountId: "google-sub-new",
        access_token: "synthetic-access-token-new",
        id_token: "eyJ.synthetic.new",
        expires_at: 1790000000,
        token_type: "bearer",
        scope: "openid",
      });
      expect(psql(DB_NAME, `SELECT coalesce(name,'-') || coalesce(email,'-') || coalesce(image,'-') FROM users WHERE id = '${user.id}'`)).toEqual(["---"]);
      expect(
        psql(DB_NAME, "SELECT coalesce(access_token,'-') || coalesce(id_token,'-') || coalesce(scope,'-') FROM accounts WHERE provider_account_id = 'google-sub-new'")
      ).toEqual(["---"]);
      const again = await adapter.getUserByAccount!({ provider: "google", providerAccountId: "google-sub-new" });
      expect(again?.id).toBe(user.id);
    });

    it("rejects the same sign-in without the wrapper, at the database", async () => {
      await expect(
        rawAdapter.createUser!({ id: "x", name: null, email: "raw@example.test", emailVerified: null, image: null })
      ).rejects.toThrow();
      expect(one("SELECT count(*) FROM users WHERE email IS NOT NULL")).toBe("0");
    });

    it("gives a new player a gamer name, and the same one on the next sign-in", async () => {
      const { db } = await import("@hank-neil/db");
      const { getOrCreateGamingProfile } = await import("@/lib/gaming-profile");
      const fresh = one("SELECT id FROM users WHERE id NOT LIKE 'user-%' LIMIT 1");
      handles.next = ["ScratchName1"];
      const first = await getOrCreateGamingProfile(db, fresh);
      const second = await getOrCreateGamingProfile(db, fresh);
      expect(first?.handle).toBe("ScratchName1");
      expect(second?.id).toBe(first?.id);
    });

    it("retries a taken gamer name inside the caller's transaction without aborting it", async () => {
      const { db } = await import("@hank-neil/db");
      const { getOrCreateGamingProfile } = await import("@/lib/gaming-profile");
      psql(DB_NAME, "INSERT INTO users (id) VALUES ('user-tx')");
      // The first name is taken by user-a (HandleA): a unique violation.
      handles.next = ["HandleA", "ScratchName2"];
      const profile = await db.transaction(async (tx) => {
        const created = await getOrCreateGamingProfile(tx as unknown as typeof db, "user-tx");
        // The transaction still works after the failed insert.
        await tx.query.users.findFirst();
        return created;
      });
      expect(profile?.handle).toBe("ScratchName2");
      expect(one("SELECT handle FROM gaming_profiles WHERE user_id = 'user-tx'")).toBe("ScratchName2");
    });

    it("refuses to link a second Google account to a player who is signed in", async () => {
      // Auth.js calls linkAccount with the signed-in user's id when a Google
      // account that is new to the site signs in on that browser.
      await expect(
        adapter.linkAccount!({ userId: "user-b", type: "oidc", provider: "google", providerAccountId: "google-sub-second" })
      ).rejects.toThrow();
      expect(one("SELECT count(*) FROM accounts WHERE user_id = 'user-b'")).toBe("1");
      expect(one("SELECT count(*) FROM accounts WHERE provider_account_id = 'google-sub-second'")).toBe("0");
    });

    it("refuses that link in the code too, before the database, with the adapter that lib/auth.ts builds", async () => {
      // The same guard covers the time between the deploy and the purge,
      // before accounts_user_id_unique exists.
      const { db } = await import("@hank-neil/db");
      const { oneAccountPerPlayer, SecondSignInAccountError } = await import("@/lib/auth-privacy");
      const { hasSignInAccount } = await import("@/lib/sign-in-accounts");
      const guarded = oneAccountPerPlayer(adapter, (userId) => hasSignInAccount(db, userId));
      await expect(
        guarded.linkAccount!({ userId: "user-b", type: "oidc", provider: "google", providerAccountId: "google-sub-third" })
      ).rejects.toBeInstanceOf(SecondSignInAccountError);
      expect(one("SELECT count(*) FROM accounts WHERE user_id = 'user-b'")).toBe("1");
      // A player with no sign-in account yet still gets the link.
      psql(DB_NAME, "INSERT INTO users (id) VALUES ('user-unlinked')");
      expect(await hasSignInAccount(db, "user-unlinked")).toBe(false);
      await guarded.linkAccount!({ userId: "user-unlinked", type: "oidc", provider: "google", providerAccountId: "google-sub-unlinked" });
      expect(await hasSignInAccount(db, "user-unlinked")).toBe(true);
    });

    it("reads the gamer name of a session, and says when the account is gone", async () => {
      const { db } = await import("@hank-neil/db");
      const { ACCOUNT_GONE, sessionGamerName } = await import("@/lib/gaming-profile");
      expect(await sessionGamerName(db, "user-b")).toBe("HandleB");
      // A cookie for a user id that has no row: no insert, no foreign-key error.
      expect(await sessionGamerName(db, "ghost")).toBe(ACCOUNT_GONE);
      expect(one("SELECT count(*) FROM gaming_profiles WHERE user_id = 'ghost'")).toBe("0");
      // A player with no gamer name yet gets one.
      psql(DB_NAME, "INSERT INTO users (id) VALUES ('user-noname')");
      handles.next = ["ScratchName3"];
      expect(await sessionGamerName(db, "user-noname")).toBe("ScratchName3");
    });

    it("deletes an account and everything in it, and nothing of another account", async () => {
      const { db } = await import("@hank-neil/db");
      const { deleteAccount } = await import("@/lib/account-deletion");
      const { ACCOUNT_GONE, sessionGamerName } = await import("@/lib/gaming-profile");
      psql(
        DB_NAME,
        `INSERT INTO app_transactions (id, progress_id, type, amount) SELECT 't-' || id, id, 'earn', 5 FROM app_progress WHERE user_id = 'user-c';
         INSERT INTO leaderboard_entries (id, gaming_profile_id, app_id, score) VALUES ('l-c', 'gp-user-c', 'chess', 3);`
      );
      const others = () =>
        one(
          "SELECT (SELECT count(*) FROM users WHERE id <> 'user-c') || ',' || (SELECT count(*) FROM accounts WHERE user_id <> 'user-c') || ',' || " +
            "(SELECT count(*) FROM app_progress WHERE user_id <> 'user-c') || ',' || (SELECT count(*) FROM gaming_profiles WHERE user_id <> 'user-c') || ',' || " +
            "(SELECT count(*) FROM leaderboard_entries WHERE gaming_profile_id <> 'gp-user-c')"
        );
      const othersBefore = others();

      expect(await deleteAccount(db, "user-c")).toBe(true);

      expect(
        one(
          "SELECT (SELECT count(*) FROM users WHERE id = 'user-c') + (SELECT count(*) FROM accounts WHERE user_id = 'user-c') + " +
            "(SELECT count(*) FROM app_progress WHERE user_id = 'user-c') + (SELECT count(*) FROM app_transactions WHERE id LIKE 't-typed-%') + " +
            "(SELECT count(*) FROM gaming_profiles WHERE user_id = 'user-c') + (SELECT count(*) FROM leaderboard_entries WHERE gaming_profile_id = 'gp-user-c')"
        )
      ).toBe("0");
      expect(others()).toBe(othersBefore);
      // Its session cookies sign out at the next read.
      expect(await sessionGamerName(db, "user-c")).toBe(ACCOUNT_GONE);
      expect(await deleteAccount(db, "user-c")).toBe(false);
    });
  });

  describe("the vacuum step after the purge", () => {
    /** The files of users and accounts: tables, indexes and TOAST. */
    function relationFiles(): string[] {
      return psql(
        DB_NAME,
        `WITH t AS (SELECT oid, reltoastrelid FROM pg_class WHERE oid IN ('users'::regclass, 'accounts'::regclass))
         SELECT pg_relation_filepath(oid) FROM t
         UNION ALL SELECT pg_relation_filepath(reltoastrelid) FROM t WHERE reltoastrelid <> 0
         UNION ALL SELECT pg_relation_filepath(indexrelid) FROM pg_index WHERE indrelid IN (SELECT oid FROM t UNION SELECT reltoastrelid FROM t)`
      );
    }

    function valuesOnDisk(dataDir: string): string[] {
      const found = new Set<string>();
      for (const rel of relationFiles()) {
        const bytes = readFileSync(path.join(dataDir, rel));
        for (const value of OLD_VALUES) if (bytes.includes(value)) found.add(value);
      }
      return [...found].sort();
    }

    let dataDir = "";
    let readable = false;
    beforeAll(() => {
      dataDir = one("SHOW data_directory");
      try {
        accessSync(dataDir, fsConstants.R_OK);
        readable = true;
      } catch {
        console.warn(`[coppa-purge-migration] the data files in ${dataDir} are not readable: the on-disk check is SKIPPED.`);
      }
    });

    it("rewrites the tables, so the old values are gone from the files, and not only from the rows", (context) => {
      if (!readable) context.skip();
      psql(DB_NAME, "CHECKPOINT");
      // The check can see the bytes: after the UPDATEs, the old row versions are still in the files.
      expect(valuesOnDisk(dataDir)).toContain("parent.a@example.test");

      const fileNumbers = () =>
        psql(DB_NAME, "SELECT pg_relation_filenode(t) FROM unnest(ARRAY['users', 'accounts']::regclass[]) AS t");
      const filesBefore = fileNumbers();

      const vacuum = applyFile(DB_NAME, VACUUM_FILE, false);
      expect(vacuum.status, vacuum.stderr).toBe(0);

      expect(valuesOnDisk(dataDir)).toEqual([]);
      // Each table got new files (VACUUM FULL), so no old page is kept. A
      // plain VACUUM can clear these few small pages too, but it keeps the
      // old files, and on bigger pages old bytes can stay in the free space.
      const filesAfter = fileNumbers();
      filesAfter.forEach((file, i) => expect(file, `table ${i}`).not.toBe(filesBefore[i]));
      expect(one("SELECT count(*) FROM users")).not.toBe("0");
    });
  });
});

/**
 * packages/db/scripts/typed-words-count.sql, field by field. Each typed row
 * holds ONE typed field, so the check fails when the script misses a field
 * of design/LOCAL_WORDS.html, section 3. The blank rows hold the same fields
 * with no word in them. All values are SYNTHETIC.
 */
describe.skipIf(!READY)("the typed-words count of the runbook (typed-words-count.sql)", () => {
  const WORDS_DB = `${DB_NAME}_words`;

  const TYPED_FIELDS: [string, Record<string, unknown>][] = [
    ["oregon-trail", { leaderName: "Synthetic Leader", party: [] }],
    ["oregon-trail", { leaderName: "", party: [{ name: "" }, { name: "Synthetic Aunt" }] }],
    ["weather", { savedLocations: [{ name: "Synthetic Town", latitude: 1, longitude: 2 }], lastLocation: null }],
    ["weather", { savedLocations: [], lastLocation: { name: "Synthetic Town", latitude: 1, longitude: 2 } }],
    ["toy-finder", { wishlistItems: [{ toyId: "t1", notes: "" }, { toyId: "t2", notes: "Synthetic note" }] }],
    ["drawing-app", { savedArtworks: [{ id: "a1", name: "Synthetic picture" }] }],
    ["drum-machine", { savedBeats: [{ id: "b1", name: "" }, { id: "b2", name: "Synthetic beat" }] }],
    ["virtual-pet", { pet: { name: "Synthetic pup" }, settings: { petName: "" } }],
    ["virtual-pet", { pet: { name: "" }, settings: { petName: "Synthetic pup" } }],
    ["four-wheeler-3d", { adventure: { outfit: { text: "SYNTH" }, feeders: [] } }],
    ["four-wheeler-3d", { adventure: { outfit: { text: "" }, feeders: [{ id: "feeder-1", label: "Synthetic spot" }] } }],
  ];

  /** The same fields with no word in them: none of these rows may count. */
  const BLANK_FIELDS: [string, Record<string, unknown>][] = [
    ["oregon-trail", { leaderName: "", party: [{ name: "" }] }],
    ["weather", { savedLocations: [], lastLocation: null }],
    ["toy-finder", { wishlistItems: [{ toyId: "t1", priority: "high", addedAt: 1 }] }],
    ["drawing-app", { savedArtworks: [] }],
    ["drum-machine", { savedBeats: [] }],
    ["virtual-pet", { pet: { name: "" }, settings: { petName: "" } }],
    ["four-wheeler-3d", { adventure: { outfit: { text: "" }, feeders: [{ id: "feeder-1", label: "" }] } }],
    // Another app with a field of the same name is not a typed-word field.
    ["snake", { leaderName: "Not a typed-word app", highScore: 3 }],
  ];

  /** A list field that is not a list: the clear does not know the shape, so it counts (fail closed). */
  const ODD_FIELDS: [string, Record<string, unknown>][] = [
    ["oregon-trail", { leaderName: "", party: "not a list" }],
    ["drum-machine", { savedBeats: { name: "not a list" } }],
    ["four-wheeler-3d", { adventure: { outfit: { text: "" }, feeders: ["not an object"] } }],
  ];

  function insert(rows: [string, Record<string, unknown>][], prefix: string): string {
    return rows
      .map(([appId, data], i) => {
        const id = `${prefix}-${i}`;
        return (
          `INSERT INTO users (id) VALUES ('${id}');` +
          `INSERT INTO app_progress (id, user_id, app_id, data) VALUES ('${id}', '${id}', '${appId}', $j$${JSON.stringify(data)}$j$);`
        );
      })
      .join("\n");
  }

  const count = () => runReadOnlyFile(WORDS_DB, TYPED_COUNT_FILE);

  beforeAll(() => {
    psql("postgres", `CREATE DATABASE "${WORDS_DB}"`);
    const tags = journalTags();
    for (const tag of tags.slice(0, tags.indexOf(PURGE_TAG))) {
      const result = applyFile(WORDS_DB, path.join(MIGRATIONS, `${tag}.sql`));
      expect(result.status, result.stderr).toBe(0);
    }
  });

  afterAll(() => {
    psql("postgres", `DROP DATABASE IF EXISTS "${WORDS_DB}" WITH (FORCE)`);
  });

  it("prints total|0 when no row holds a typed word, also with blank fields", () => {
    expect(count()).toEqual(["total|0"]);
    psql(WORDS_DB, insert(BLANK_FIELDS, "blank"));
    expect(count()).toEqual(["total|0"]);
  });

  it("counts a row for each typed-word field of design/LOCAL_WORDS.html, section 3", () => {
    psql(WORDS_DB, insert(TYPED_FIELDS, "typed"));
    expect(count()).toEqual([
      "drawing-app|1",
      "drum-machine|1",
      "four-wheeler-3d|2",
      "oregon-trail|2",
      "toy-finder|1",
      "virtual-pet|2",
      "weather|2",
      `total|${TYPED_FIELDS.length}`,
    ]);
  });

  it("counts a list field of an unexpected shape, and does not stop on it", () => {
    psql(WORDS_DB, insert(ODD_FIELDS, "odd"));
    expect(count()).toContain(`total|${TYPED_FIELDS.length + ODD_FIELDS.length}`);
  });

  it("only reads: the session is read only, so a write in the same session fails", () => {
    const sql = readFileSync(TYPED_COUNT_FILE, "utf8");
    expect(sql).toMatch(/^SET default_transaction_read_only = on;$/m);
    const probe = spawnSync(
      "psql",
      ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", WORDS_DB, "-c", "SET default_transaction_read_only = on", "-c", "DELETE FROM app_progress"],
      { env: PG_ENV, encoding: "utf8" }
    );
    expect(probe.status).not.toBe(0);
    expect(probe.stderr).toMatch(/read-only transaction/);
  });
});
