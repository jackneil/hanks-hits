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

const authState = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/auth", () => ({
  auth: async () => (authState.signedIn ? { user: { id: "kid-user-1" } } : null),
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
import { PROGRESS_SCHEMAS } from "@/lib/progress-schemas";
import { JsonValueCounter, PROGRESS_SAVE_BODY } from "@/lib/read-body";
import { largestSave } from "./largestSave";

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

/** A save request whose body arrives from a stream (no Content-Length unless given). */
function streamedSave(appId: string, body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://localhost/api/progress/${appId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
      duplex: "half",
    } as RequestInit),
    { params: Promise.resolve({ appId }) }
  );
}

/** A body that never ends, 1 MiB a chunk; it counts what the route pulled and if it cancelled. */
function endlessBody() {
  const seen = { pulled: 0, cancelled: false };
  const chunk = new Uint8Array(1024 * 1024).fill(0x20);
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        seen.cancelled = true;
      },
    },
    { highWaterMark: 0 }
  );
  return { body, seen };
}

describe("POST /api/progress/[appId]: the body limit (100 MiB, no time limit, no gates)", () => {
  beforeEach(() => {
    pg.reset();
    authState.signedIn = true;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refuses a declared Content-Length over 100 MiB at once (413), with no byte read", async () => {
    const { body, seen } = endlessBody();
    const res = await streamedSave("snake", body, { "Content-Length": String(PROGRESS_SAVE_BODY.maxBytes + 1) });
    expect(res.status).toBe(413);
    expect(seen.pulled).toBe(0);
    expect(progressRow("snake")).toBeUndefined();
  });

  it("stops a chunked body at 100 MiB plus one chunk, cancels it, and answers 413", async () => {
    const { body, seen } = endlessBody();
    const res = await streamedSave("snake", body);
    expect(res.status).toBe(413);
    expect(seen.pulled).toBe(PROGRESS_SAVE_BODY.maxBytes + 1024 * 1024);
    expect(seen.cancelled).toBe(true);
  });

  it("accepts a save body of exactly 100 MiB (a valid save and white space), and refuses one byte more", async () => {
    const { useSnakeStore } = await import("@/games/snake/lib/store");
    const head = JSON.stringify({ data: { ...useSnakeStore.getState().getProgress(), highScore: 7 }, merge: false });
    const exact = head + " ".repeat(PROGRESS_SAVE_BODY.maxBytes - head.length);
    const send = (text: string) =>
      POST(
        new Request("http://localhost/api/progress/snake", { method: "POST", headers: { "Content-Type": "application/json" }, body: text }),
        { params: Promise.resolve({ appId: "snake" }) }
      );
    const ok = await send(exact);
    expect(ok.status).toBe(200);
    expect((progressRow("snake")?.data as { highScore: number }).highScore).toBe(7);
    const over = await send(exact + " ");
    expect(over.status).toBe(413);
  });

  it("reads no body for a player who is not signed in (401, as before)", async () => {
    authState.signedIn = false;
    const { body, seen } = endlessBody();
    const res = await streamedSave("snake", body);
    expect(res.status).toBe(401);
    expect(seen.pulled).toBe(0);
  });

  it.each([["not json"], [""]])("answers the body %j with 400 and never quotes it", async (text) => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      new Request("http://localhost/api/progress/snake", { method: "POST", headers: { "Content-Type": "application/json" }, body: text }),
      { params: Promise.resolve({ appId: "snake" }) }
    );
    expect(res.status).toBe(400);
    expect(printed(errorLog)).not.toContain("not json");
  });

  it("answers a body of null with 400 (destructuring null threw: a 500 and an error log)", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      new Request("http://localhost/api/progress/snake", { method: "POST", headers: { "Content-Type": "application/json" }, body: "null" }),
      { params: Promise.resolve({ appId: "snake" }) }
    );
    expect(res.status).toBe(400);
    expect(errorLog).not.toHaveBeenCalled();
    expect(progressRow("snake")).toBeUndefined();
  });

  it("refuses a body of many small values ([{},{},...]) after about 4 MiB and before the parse (413)", async () => {
    // Review: 100 MiB of empty objects made JSON.parse use about 3.7 GB.
    const seen = { pulled: 0, cancelled: false };
    const chunk = new TextEncoder().encode(",{}".repeat(256 * 1024)); // 768 KiB, 524,288 marks
    let first = true;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const next = first ? new TextEncoder().encode('{"data":[{}') : chunk;
          first = false;
          seen.pulled += next.byteLength;
          controller.enqueue(next);
        },
        cancel() {
          seen.cancelled = true;
        },
      },
      { highWaterMark: 0 }
    );
    const res = await streamedSave("drawing-app", body);
    expect(res.status).toBe(413);
    expect(seen.pulled).toBeLessThan(4 * 1024 * 1024);
    expect(seen.cancelled).toBe(true);
    expect(progressRow("drawing-app")).toBeUndefined();
  });

  it("writes one log line for each refused body: the app, the reason and the counts, with no value of the body and no user id", async () => {
    const warn = vi.mocked(console.warn);
    warn.mockClear();
    const text = (body: string, headers: Record<string, string> = {}) =>
      POST(
        new Request("http://localhost/api/progress/snake", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body,
        }),
        { params: Promise.resolve({ appId: "snake" }) }
      );
    // Too big (declared), not JSON, empty, a body cut off part-way (the client went away), too many values.
    const declared = endlessBody();
    expect((await streamedSave("snake", declared.body, { "Content-Length": String(PROGRESS_SAVE_BODY.maxBytes + 1) })).status).toBe(413);
    expect((await text('{"data":{"password":hunter22}}')).status).toBe(400);
    expect((await text("")).status).toBe(400);
    let sent = false;
    const cut = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) controller.error(new Error("socket hang up"));
        else controller.enqueue(new TextEncoder().encode('{"data":{"highScore":'));
        sent = true;
      },
    });
    expect((await streamedSave("snake", cut)).status).toBe(400);
    expect((await text(`[${"0,".repeat(PROGRESS_SAVE_BODY.maxJsonValues!)}0]`)).status).toBe(413);

    const lines = warn.mock.calls.map((args) => args.join(" "));
    expect(lines).toEqual([
      `[read-body] POST /api/progress/snake: refused a request body (too_big; declared ${PROGRESS_SAVE_BODY.maxBytes + 1} bytes, received 0 bytes)`,
      "[read-body] POST /api/progress/snake: refused a request body (bad_json; declared no bytes, received 30 bytes)",
      "[read-body] POST /api/progress/snake: refused a request body (bad_json; declared no bytes, received 0 bytes)",
      "[read-body] POST /api/progress/snake: refused a request body (broken; declared no bytes, received 21 bytes)",
      `[read-body] POST /api/progress/snake: refused a request body (too_many_values; declared no bytes, received ${2 * PROGRESS_SAVE_BODY.maxJsonValues! + 3} bytes)`,
    ]);
    expect(lines.join("\n")).not.toContain("hunter22");
    expect(lines.join("\n")).not.toContain(USER_ID);
  });

  it("saves a body that pauses for 35 s in the middle (no time limit of our own: a phone in a tunnel)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { useSnakeStore } = await import("@/games/snake/lib/store");
    const text = JSON.stringify({ data: { ...useSnakeStore.getState().getProgress(), highScore: 35 }, merge: true });
    const bytes = new TextEncoder().encode(text);
    const half = Math.floor(bytes.length / 2);
    let step = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          step++;
          if (step === 1) controller.enqueue(bytes.slice(0, half));
          else if (step === 2) {
            await new Promise((resolve) => setTimeout(resolve, 35_000));
            controller.enqueue(bytes.slice(half));
          } else controller.close();
        },
      },
      { highWaterMark: 0 }
    );
    const pending = streamedSave("snake", body);
    await vi.advanceTimersByTimeAsync(35_000);
    const res = await pending;
    expect(res.status).toBe(200);
    expect((progressRow("snake")?.data as { highScore: number }).highScore).toBe(35);
  });

  it("saves three overlapping drawing saves of one account: no in-flight limit, no 429 or 503", async () => {
    const { useDrawingStore } = await import("@/apps/drawing-app/lib/store");
    const base = useDrawingStore.getState().getProgress() as Record<string, unknown>;
    const drawing = (n: number) => ({
      ...base,
      savedArtworks: Array.from({ length: n }, (_, i) => ({
        id: `art-${i}`,
        name: `Truck ${i}`,
        thumbnail: `data:image/png;base64,${"A".repeat(200_000)}`,
        dataUrl: `data:image/png;base64,${"A".repeat(1_400_000)}`,
        createdAt: "2026-10-02T12:00:00.000Z",
        editedAt: "2026-10-02T12:00:00.000Z",
      })),
      lastModified: Date.now(),
    });
    const results = await Promise.all([save("drawing-app", drawing(3), true), save("drawing-app", drawing(4), true), save("drawing-app", drawing(5), true)]);
    expect(results.map((res) => res.status)).toEqual([200, 200, 200]);
  });
});

describe("POST /api/progress/[appId]: the largest valid save of every game passes", () => {
  // The fields that hold machine text (a drawing's data URL is base64, so 1
  // byte a character). Every other string is filled with a 3-byte character.
  const ASCII_PATHS = ["savedArtworks.*.thumbnail", "savedArtworks.*.dataUrl"];
  // The fields that the schemas do not bound. A new one fails this test, so
  // that a review sees it. The body limit (100 MiB) still holds for them.
  const UNBOUNDED: Record<string, string[]> = {};
  const sizes: Record<string, number> = {};

  beforeEach(() => {
    pg.reset();
    authState.signedIn = true;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The JSON marks that the reader counts in a text (src/lib/read-body.ts). */
  const marksOf = (text: string) => {
    const counter = new JsonValueCounter();
    counter.add(new TextEncoder().encode(text));
    return counter.count;
  };
  const marks: Record<string, number> = {};

  it.each(Object.keys(PROGRESS_SCHEMAS).sort())("%s", async (appId) => {
    const schema = PROGRESS_SCHEMAS[appId as keyof typeof PROGRESS_SCHEMAS]!;
    const { value, unbounded } = largestSave(schema, ASCII_PATHS);
    expect(unbounded).toEqual(UNBOUNDED[appId] ?? []);
    expect(schema.safeParse(value).success, "the largest save is valid").toBe(true);

    const body = JSON.stringify({ data: value, merge: true });
    const bytes = Buffer.byteLength(body, "utf8");
    sizes[appId] = bytes;
    expect(bytes).toBeLessThanOrEqual(PROGRESS_SAVE_BODY.maxBytes);

    // The save with the most JSON values (each choice is the one with the
    // most marks) is under the value count, with room to spare.
    const most = largestSave(schema, ASCII_PATHS, (v) => marksOf(JSON.stringify(v) ?? ""));
    expect(schema.safeParse(most.value).success, "the save with the most values is valid").toBe(true);
    marks[appId] = Math.max(marksOf(body), marksOf(JSON.stringify({ data: most.value, merge: true })));
    expect(marks[appId]).toBeLessThanOrEqual(PROGRESS_SAVE_BODY.maxJsonValues!);
    const allocationsOf = (v: unknown) => {
      const counter = new JsonValueCounter();
      counter.add(new TextEncoder().encode(JSON.stringify(v) ?? ""));
      return counter.allocations;
    };
    const allocationHeavy = largestSave(schema, ASCII_PATHS, allocationsOf);
    expect(schema.safeParse(allocationHeavy.value).success).toBe(true);
    expect(allocationsOf({ data: allocationHeavy.value, merge: true })).toBeLessThanOrEqual(PROGRESS_SAVE_BODY.maxJsonAllocations!);

    const res = await POST(
      new Request(`http://localhost/api/progress/${appId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body }),
      { params: Promise.resolve({ appId }) }
    );
    expect(res.status).toBe(200);
    expect(progressRow(appId)).toBeDefined();
  });

  it("the largest of them is the expanded Drum Machine save, under the 100 MiB limit", () => {
    const largest = Object.entries(sizes).sort((a, b) => b[1] - a[1])[0];
    expect(largest[0]).toBe("drum-machine");
    expect(largest[1]).toBeGreaterThan(60_000_000);
    expect(largest[1]).toBeLessThan(PROGRESS_SAVE_BODY.maxBytes);
  });

  it("the Drum Machine's 10,261,528 marks fit the total budget", () => {
    const most = Object.entries(marks).sort((a, b) => b[1] - a[1])[0];
    expect(most).toEqual(["drum-machine", 10_261_528]);
    expect(most[1]).toBeLessThan(PROGRESS_SAVE_BODY.maxJsonValues!);
  });

  it("an Oregon Trail save with each event that the game writes passes", async () => {
    // Check the bounded event snapshot against every authored trail event,
    // and the river crossing result (src/games/oregon-trail/lib/store.ts).
    const { ALL_EVENTS } = await import("@/games/oregon-trail/lib/events");
    const river = { id: "river-crossing-result", title: "Kansas River Trouble!", message: "The wagon tipped. Lost: 2 oxen, 40 food.", category: "severe", probability: 0, effect: {} };
    const schema = PROGRESS_SCHEMAS["oregon-trail"]!;
    const base = largestSave(schema, ASCII_PATHS).value as Record<string, unknown>;
    for (const event of [...ALL_EVENTS, river]) {
      pg.reset();
      const data = { ...base, currentEvent: event };
      const body = JSON.stringify({ data, merge: true });
      expect(marksOf(body)).toBeLessThan(1_000);
      const res = await save("oregon-trail", data, true);
      expect(res.status, (event as { id: string }).id).toBe(200);
    }
  });
});
