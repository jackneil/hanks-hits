// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { WebSocket } from "ws";
import { startGateway } from "../../../../scripts/live/gateway";
import { issueLiveTicket } from "../ticket";

const adminUrl = process.env.TEST_DATABASE_URL;
const dbName = `hh_live_test_${randomUUID().replaceAll("-", "")}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const identity = vi.hoisted(() => ({ id: "a" }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: identity.id } }) }));

describe.skipIf(!adminUrl)("live notifications on real PostgreSQL", () => {
  let admin: Pool, pool: Pool, dbModule: typeof import("@hank-neil/db"), route: typeof import("@/app/api/notifications/route");
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let created = false;
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Local PostgreSQL required");
    admin = new Pool({ connectionString: url.toString(), max: 1 });
    await admin.query(`CREATE DATABASE "${dbName}"`); created = true;
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString(), max: 4 });
    const dir = path.join(root, "packages/db/drizzle");
    const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8"));
    for (const entry of journal.entries) await pool.query(readFileSync(path.join(dir, `${entry.tag}.sql`), "utf8"));
    process.env.DATABASE_URL = url.toString();
    vi.resetModules(); dbModule = await import("@hank-neil/db"); route = await import("@/app/api/notifications/route");
  });
  afterAll(async () => {
    await dbModule?.db.$client.end(); await pool?.end();
    if (created) await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    await admin?.end();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
  });
  beforeEach(async () => {
    identity.id = "a";
    await pool.query("TRUNCATE users CASCADE");
    await pool.query("INSERT INTO users(id) VALUES ('a'),('b'),('c')");
    await pool.query("INSERT INTO gaming_profiles(id,user_id,handle) VALUES ('pa','a','PlayerA'),('pb','b','PlayerB'),('pc','c','PlayerC')");
  });
  const score = (profile: string, value: number, scoreType = "high_score") => pool.query(
    "INSERT INTO leaderboard_entries(id,gaming_profile_id,app_id,score,score_type) VALUES ($1,$2,'snake',$3,$4) ON CONFLICT(gaming_profile_id,app_id,score_type) DO UPDATE SET score=EXCLUDED.score", [randomUUID(), profile, value, scoreType]);
  const history = () => route.GET(new Request("http://localhost/api/notifications", { headers: { "x-hh-expected-owner": identity.id } }));
  it("notifies actual crossings and milestones, never ties, repeats or hidden profiles", async () => {
    await score("pa", 100); await score("pb", 90);
    await pool.query("DELETE FROM notifications");
    await score("pb", 100); expect((await pool.query("SELECT * FROM notifications WHERE kind='score_passed'")).rowCount).toBe(0);
    await score("pb", 101);
    expect((await pool.query("SELECT user_id,kind,actor_handle FROM notifications WHERE user_id='a'")).rows).toEqual([{ user_id: "a", kind: "score_passed", actor_handle: "PlayerB" }]);
    const count = (await pool.query("SELECT * FROM notifications")).rowCount;
    await score("pb", 101); expect((await pool.query("SELECT * FROM notifications")).rowCount).toBe(count);
    await pool.query("UPDATE gaming_profiles SET show_on_leaderboards=false WHERE id='pb'");
    expect((await pool.query("SELECT actor_handle FROM notifications WHERE user_id='a'")).rows[0].actor_handle).toBeNull();
    await score("pb", 200); expect((await pool.query("SELECT * FROM notifications")).rowCount).toBe(count);
  });
  it("uses lower scores for fastest-time crossings", async () => {
    await score("pa", 100, "fastest_time"); await score("pb", 110, "fastest_time");
    await pool.query("DELETE FROM notifications"); await score("pb", 99, "fastest_time");
    expect((await pool.query("SELECT user_id FROM notifications WHERE kind='score_passed'")).rows).toEqual([{ user_id: "a" }]);
  });
  it("scrubs handles even when opt-out races a blocked notification insert", async () => {
    await score("pa", 100); await score("pb", 90); await pool.query("DELETE FROM notifications");
    const blocker = await pool.connect(), writer = await pool.connect(), hide = await pool.connect();
    let scoring: Promise<unknown> | undefined, hiding: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('hh-inbox:a', 0))");
      const pid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      scoring = writer.query("UPDATE leaderboard_entries SET score=101 WHERE gaming_profile_id='pb'");
      const deadline = Date.now() + 10_000;
      while (!(await pool.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event='advisory'", [pid])).rowCount) {
        if (Date.now() > deadline) throw new Error("Score did not reach inbox lock");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      let hidden = false;
      hiding = hide.query("UPDATE gaming_profiles SET show_on_leaderboards=false WHERE id='pb'").then(() => { hidden = true; });
      await new Promise(resolve => setTimeout(resolve, 50)); expect(hidden).toBe(false);
      await blocker.query("COMMIT"); await scoring; await hiding;
      expect((await pool.query("SELECT actor_handle FROM notifications WHERE kind='score_passed'")).rows).toEqual([{ actor_handle: null }]);
    } finally {
      await blocker.query("ROLLBACK"); await Promise.allSettled([scoring, hiding]);
      blocker.release(); writer.release(); hide.release();
    }
  });
  it("serializes racing improvements before computing milestones", async () => {
    await score("pa", 100); await score("pb", 120); await pool.query("DELETE FROM notifications");
    const first = await pool.connect(), second = await pool.connect();
    try {
      await first.query("BEGIN"); await second.query("BEGIN");
      await first.query("UPDATE leaderboard_entries SET score=150 WHERE gaming_profile_id='pa'");
      const waiting = second.query("UPDATE leaderboard_entries SET score=130 WHERE gaming_profile_id='pb'");
      await first.query("COMMIT"); await waiting; await second.query("COMMIT");
      expect((await pool.query("SELECT user_id FROM notifications WHERE kind='first_place'")).rows).toEqual([{ user_id: "a" }]);
    } finally { await first.query("ROLLBACK"); await second.query("ROLLBACK"); first.release(); second.release(); }
  });
  it("keeps private HTTP history and mark-read scoped to the session owner", async () => {
    await score("pa", 100); await score("pb", 101);
    const a = await (await history()).json(); expect(a.items.length).toBeGreaterThan(0);
    identity.id = "c"; expect((await (await history()).json()).items).toEqual([]);
    const request = new Request("http://localhost/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json", "sec-fetch-site": "same-origin", "x-hh-expected-owner": "c" }, body: JSON.stringify({ id: a.items[0].id }) });
    const secondRequest = new Request(request.clone(), { headers: { ...Object.fromEntries(request.headers), "x-hh-expected-owner": "a" } });
    expect((await route.PATCH(request)).status).toBe(200);
    expect((await pool.query("SELECT read_at FROM notifications WHERE id=$1", [a.items[0].id])).rows[0].read_at).toBeNull();
    identity.id = "a"; expect((await route.PATCH(secondRequest)).status).toBe(200);
    expect((await pool.query("SELECT read_at FROM notifications WHERE id=$1", [a.items[0].id])).rows[0].read_at).not.toBeNull();
  });
  it("caps durable history at 100 notifications per owner", async () => {
    await score("pa", 100); await score("pb", 101);
    for (let i = 0; i < 105; i++) { await score("pa", 102 + i * 2); await score("pb", 103 + i * 2); }
    expect(Number((await pool.query("SELECT count(*) FROM notifications WHERE user_id='a'")).rows[0].count)).toBe(100);
  });
  it("refuses stale owner assertions for history, writes and socket tickets", async () => {
    identity.id = "b";
    const headers = { "x-hh-expected-owner": "a", "sec-fetch-site": "same-origin", "content-type": "application/json" };
    expect((await route.GET(new Request("http://localhost/api/notifications", { headers }))).status).toBe(409);
    expect((await route.PATCH(new Request("http://localhost/api/notifications", { headers, method: "PATCH", body: JSON.stringify({ id: randomUUID() }) }))).status).toBe(409);
    const before = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "owner-test";
    try {
      const ticket = await import("@/app/api/live-ticket/route");
      expect((await ticket.POST(new Request("http://localhost/api/live-ticket", { headers, method: "POST" }))).status).toBe(409);
    } finally { if (before === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = before; }
  });
  it("recovers missed database events while browser sockets stay connected", async () => {
    const beforeAuthUrl = process.env.AUTH_URL;
    process.env.AUTH_URL = "http://127.0.0.1";
    const gateway = startGateway({ port: 0, host: "127.0.0.1", upstreamPort: 1,
      databaseUrl: process.env.DATABASE_URL, secret: "pg-test", release: { id: "a", builtAt: 1 } });
    let socket: WebSocket | undefined;
    async function until(check: () => Promise<boolean>) {
      const deadline = Date.now() + 10_000;
      while (!await check()) {
        if (Date.now() > deadline) throw new Error("Recovery deadline exceeded");
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }
    try {
      await once(gateway.server, "listening"); const address = gateway.server.address();
      if (!address || typeof address === "string") throw new Error("port");
      const events: Array<{ type: string }> = [];
      socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/live`, ["hh-live", `ticket.${issueLiveTicket("a", "pg-test")}`], { origin: "http://127.0.0.1" });
      socket.on("message", data => events.push(JSON.parse(String(data))));
      await once(socket, "open");
      await until(async () => events.some(event => event.type === "inbox"));
      await until(async () => Number((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname=$1 AND application_name='hh-live-listener'", [dbName])).rows[0].count) === 1);
      const before = events.filter(event => event.type === "inbox").length;
      // Exact scratch DB + application identity; never terminate unrelated
      // database sessions or restart the shared local PostgreSQL service.
      await pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND application_name='hh-live-listener'", [dbName]);
      await pool.query("INSERT INTO notifications(user_id,kind,app_id) VALUES ('a','top_ten','snake')");
      await until(async () => events.filter(event => event.type === "inbox").length > before);
      expect(socket.readyState).toBe(WebSocket.OPEN);
      expect((await (await history()).json()).items).toHaveLength(1);
    } finally {
      socket?.terminate(); await gateway.close();
      if (beforeAuthUrl === undefined) delete process.env.AUTH_URL; else process.env.AUTH_URL = beforeAuthUrl;
    }
  });
});
