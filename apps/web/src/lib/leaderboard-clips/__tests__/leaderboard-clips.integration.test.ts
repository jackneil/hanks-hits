// @vitest-environment node
/**
 * Leaderboard clips on a REAL Postgres and a REAL S3 server (MinIO), through
 * the real route files and their production wiring (runtime.ts: the drizzle
 * store, the aws4fetch bucket client, the settings from the environment).
 * Only the session is a stand-in.
 *
 * The flow: upload (only with a board row) -> public -> the leaderboard API
 * shows the clip -> the 302 works and the object downloads -> a report
 * hides it -> a new upload replaces it and deletes the old objects -> the
 * owner deletes it -> an admin keeps one for a legal report -> the sweeper
 * removes orphans, page by page. The ClipStore contract (storeContract.ts) also runs on Postgres
 * here, so the in-memory store of the unit tests cannot drift unseen.
 *
 * OPT-IN, like src/app/api/progress/[appId]/__tests__/route.pg.test.ts:
 * - TEST_DATABASE_URL: a Postgres server on this computer, for example
 *   postgres://localhost:5432/postgres. The test makes its own database,
 *   applies the migrations in packages/db/drizzle, and drops it.
 * - TEST_S3_ENDPOINT, TEST_S3_ACCESS_KEY_ID, TEST_S3_SECRET_ACCESS_KEY: an
 *   S3 server on this computer, for example a MinIO started with
 *     docker run -d --name hh-test-minio -p 127.0.0.1:9100:9000 minio/minio server /data
 *   (keys minioadmin / minioadmin). The test makes its own bucket and
 *   deletes it.
 * The store contract needs only TEST_DATABASE_URL. The pre-push hook sets
 * the variables when the local servers answer. A server that is not on this
 * computer is refused.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";

import { jpegHasMetadata, stripJpegMetadata } from "@/shared/lib/jpeg";

import type {
  LeaderboardApiResponse,
  LeaderboardClipConfigResponse,
  UploadLeaderboardClipResponse,
} from "../contract";
import type { BucketSettings, LeaderboardClipsEnv } from "../config";
import { runStoreContract } from "./storeContract";
import { GOOD_VIDEO, POSTER_WITH_COMMENT, SAME_SITE, deleteRequest, reportRequest, uploadRequest } from "./requests";

const DB_URL = process.env.TEST_DATABASE_URL;
const S3_ENDPOINT = process.env.TEST_S3_ENDPOINT;
const S3_KEY = process.env.TEST_S3_ACCESS_KEY_ID;
const S3_SECRET = process.env.TEST_S3_SECRET_ACCESS_KEY;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null),
}));

type DbModule = typeof import("@hank-neil/db");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const migrationsDir = path.join(repoRoot, "packages/db/drizzle");

/** Every migration statement, in journal order (the same as route.pg.test.ts). */
function migrationStatements(): string[] {
  const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .flatMap((entry) =>
      readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8")
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean)
    );
}

function assertLocal(url: string, name: string): void {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`${name} must name a server on this computer; refusing host "${host}"`);
}

const KID_A = "it-kid-a";
const KID_B = "it-kid-b";
const ADMIN = "it-admin";

describe.skipIf(!DB_URL)("leaderboard clips on a real Postgres", () => {
  const dbName = `hh_lbclips_${process.pid}_${Date.now().toString(36)}`;
  let admin: DbModule | undefined;
  let scratch: DbModule;
  let created = false;

  beforeAll(async () => {
    assertLocal(DB_URL!, "TEST_DATABASE_URL");
    process.env.DATABASE_URL = DB_URL!;
    vi.resetModules();
    admin = await import("@hank-neil/db");
    await admin.db.execute(admin.sql.raw(`CREATE DATABASE "${dbName}"`));
    created = true;
    const scratchUrl = new URL(DB_URL!);
    scratchUrl.pathname = `/${dbName}`;
    process.env.DATABASE_URL = scratchUrl.toString();
    vi.resetModules();
    scratch = await import("@hank-neil/db");
    for (const statement of migrationStatements()) await scratch.db.execute(scratch.sql.raw(statement));
  });

  afterAll(async () => {
    await scratch?.db.$client.end();
    if (admin && created) await admin.db.execute(admin.sql.raw(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`));
    await admin?.db.$client.end();
  });

  async function resetTables(): Promise<void> {
    await scratch.db.execute(
      scratch.sql.raw(
        "TRUNCATE leaderboard_clip_uploads, leaderboard_clips, leaderboard_entries, gaming_profiles, app_progress, users CASCADE"
      )
    );
  }

  async function addUser(userId: string): Promise<void> {
    await scratch.db.insert(scratch.users).values({ id: userId, name: "Test Kid" });
  }

  async function profileFor(userId: string) {
    const [profile] = await scratch.db.insert(scratch.gamingProfiles)
      .values({ userId, handle: `Test${userId.replace(/[^a-zA-Z0-9]/g, "")}` })
      .onConflictDoUpdate({ target: scratch.gamingProfiles.userId, set: { userId } })
      .returning();
    return profile;
  }

  /** A board row, as the progress route writes it: the profile on first use, then the entry. Returns the profile id. */
  async function addBoardEntry(userId: string, appId: string, scoreType?: string, score = 1): Promise<string> {
    const { getGameScoreType } = await import("@/lib/leaderboard-extractors");
    const profile = await profileFor(userId);
    await scratch.db
      .insert(scratch.leaderboardEntries)
      .values({ gamingProfileId: profile!.id, appId, score, scoreType: scoreType ?? getGameScoreType(appId) })
      .onConflictDoNothing();
    return profile!.id;
  }

  async function removeBoardEntry(userId: string, appId: string): Promise<void> {
    await scratch.db.execute(
      scratch.sql`DELETE FROM leaderboard_entries WHERE app_id = ${appId} AND gaming_profile_id IN (SELECT id FROM gaming_profiles WHERE user_id = ${userId})`
    );
  }

  runStoreContract("postgres", async () => {
    await resetTables();
    const { createDbClipStore } = await import("../store");
    const { db, sql } = scratch;
    return {
      store: createDbClipStore(db),
      addUser,
      addBoardEntry: (userId, appId, scoreType) => addBoardEntry(userId, appId, scoreType),
      removeBoardEntry,
      setShowOnLeaderboards: async (userId, show) => {
        await db.execute(sql`UPDATE gaming_profiles SET show_on_leaderboards = ${show} WHERE user_id = ${userId}`);
      },
      deleteUser: async (userId) => {
        await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
      },
      uploadCount: async (userId) => {
        const result = await db.execute(sql`SELECT count(*)::int AS n FROM leaderboard_clip_uploads WHERE user_id = ${userId}`);
        return (result.rows[0] as { n: number }).n;
      },
    };
  });

  it("lets only one of six uploads that start at the same moment take the slot (advisory lock)", async () => {
    await resetTables();
    await addUser(KID_A);
    const { createDbClipStore } = await import("../store");
    const store = createDbClipStore(scratch.db);
    // Open six connections first, so the six claims really run at the same time.
    await Promise.all(Array.from({ length: 6 }, () => scratch.db.execute(scratch.sql`select pg_sleep(0.05)`)));
    const now = new Date();
    const results = await Promise.all(Array.from({ length: 6 }, () => store.claimUploadSlot(KID_A, now)));
    expect(results.filter((slot) => slot.ok)).toHaveLength(1);
    expect(results.filter((slot) => !slot.ok && slot.code === "busy")).toHaveLength(5);
  });

  it("refuses a clip row that breaks the table rules (one clip per player and game, hidden_at with hidden)", async () => {
    await resetTables();
    await addUser(KID_A);
    const profile = await addBoardEntry(KID_A, "asteroids");
    const base = { gamingProfileId: profile, appId: "asteroids", runScore: 1, durationMs: 1000, width: 1280, height: 720, bytes: 10, hasAudio: true };
    await scratch.db.insert(scratch.leaderboardClips).values({ id: "A".repeat(24), ...base });
    await expect(scratch.db.insert(scratch.leaderboardClips).values({ id: "B".repeat(24), ...base })).rejects.toThrow();
    await expect(
      scratch.db.insert(scratch.leaderboardClips).values({ id: "C".repeat(24), ...base, appId: "breakout", status: "hidden" })
    ).rejects.toThrow();
    await expect(
      scratch.db.insert(scratch.leaderboardClips).values({ id: "D".repeat(24), ...base, appId: "breakout", runScore: -1 })
    ).rejects.toThrow();
  });

  it("answers the old board shape plus the clip fields (null / none) when the feature is not set up", async () => {
    await resetTables();
    await addUser(KID_A);
    const profile = await profileFor(KID_A);
    await scratch.db
      .insert(scratch.leaderboardEntries)
      .values({ gamingProfileId: profile!.id, appId: "asteroids", score: 77, scoreType: "high_score" });
    const saved = { ...process.env };
    for (const name of Object.keys(process.env)) {
      if (name.startsWith("LEADERBOARD_CLIPS")) delete process.env[name];
    }
    try {
      session.userId = KID_A;
      const route = await import("@/app/api/leaderboards/[appId]/route");
      const response = await route.GET(new Request("https://hankshits.com/api/leaderboards/asteroids?includeMe=true"), {
        params: Promise.resolve({ appId: "asteroids" }),
      });
      const body = (await response.json()) as LeaderboardApiResponse;
      expect(Object.keys(body).sort()).toEqual(["leaderboard", "myClip", "myEntry", "period", "scoreType", "totalPlayers"]);
      expect(Object.keys(body.leaderboard[0]).sort()).toEqual(["achievedAt", "additionalStats", "clip", "handle", "rank", "score"]);
      expect(body.leaderboard[0]).toMatchObject({ rank: 1, score: 77, clip: null });
      expect(body.myEntry).toEqual({ rank: 1, handle: profile!.handle, score: 77, clipStatus: "none", clip: null });
      expect(body.myClip).toEqual({ clipStatus: "none", clip: null });
    } finally {
      Object.assign(process.env, saved);
    }
  });

  describe.skipIf(!S3_ENDPOINT || !S3_KEY || !S3_SECRET)("with a real S3 server", () => {
    const bucketName = `hh-lbclips-${process.pid}-${Date.now().toString(36)}`;
    let s3: AwsClient;
    let settings: BucketSettings;
    let routes: {
      clips: typeof import("@/app/api/leaderboard-clips/route");
      clip: typeof import("@/app/api/leaderboard-clips/[id]/route");
      video: typeof import("@/app/api/leaderboard-clips/[id]/video/route");
      poster: typeof import("@/app/api/leaderboard-clips/[id]/poster/route");
      report: typeof import("@/app/api/leaderboard-clips/[id]/report/route");
      board: typeof import("@/app/api/leaderboards/[appId]/route");
    };
    let bucketCreated = false;

    const bucketUrl = (key = "") => `${S3_ENDPOINT!.replace(/\/$/, "")}/${bucketName}${key ? `/${key}` : ""}`;

    async function listKeys(prefix: string): Promise<string[]> {
      const response = await s3.fetch(`${bucketUrl()}?list-type=2&prefix=${encodeURIComponent(prefix)}`);
      const xml = await response.text();
      return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]).sort();
    }

    beforeAll(async () => {
      assertLocal(S3_ENDPOINT!, "TEST_S3_ENDPOINT");
      s3 = new AwsClient({ accessKeyId: S3_KEY!, secretAccessKey: S3_SECRET!, service: "s3", region: "us-east-1" });
      const made = await s3.fetch(bucketUrl(), { method: "PUT" });
      expect(made.status, "create the test bucket").toBe(200);
      bucketCreated = true;
      // The app reads these at each request (config.ts). Path style, region
      // us-east-1 (MinIO's default), the endpoint on this computer.
      Object.assign(process.env, {
        LEADERBOARD_CLIPS_S3_ENDPOINT: S3_ENDPOINT,
        LEADERBOARD_CLIPS_S3_BUCKET: bucketName,
        LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID: S3_KEY,
        LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY: S3_SECRET,
        LEADERBOARD_CLIPS_S3_REGION: "us-east-1",
        LEADERBOARD_CLIPS_S3_URL_STYLE: "path",
        ADMIN_USER_IDS: ADMIN,
      });
      delete process.env.LEADERBOARD_CLIPS;
      settings = {
        endpoint: new URL(S3_ENDPOINT!).origin,
        bucket: bucketName,
        accessKeyId: S3_KEY!,
        secretAccessKey: S3_SECRET!,
        region: "us-east-1",
        urlStyle: "path",
      };
      // The routes get the same @hank-neil/db module as `scratch`.
      routes = {
        clips: await import("@/app/api/leaderboard-clips/route"),
        clip: await import("@/app/api/leaderboard-clips/[id]/route"),
        video: await import("@/app/api/leaderboard-clips/[id]/video/route"),
        poster: await import("@/app/api/leaderboard-clips/[id]/poster/route"),
        report: await import("@/app/api/leaderboard-clips/[id]/report/route"),
        board: await import("@/app/api/leaderboards/[appId]/route"),
      };
    });

    afterAll(async () => {
      for (const name of [
        "LEADERBOARD_CLIPS_S3_ENDPOINT",
        "LEADERBOARD_CLIPS_S3_BUCKET",
        "LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID",
        "LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY",
        "LEADERBOARD_CLIPS_S3_REGION",
        "LEADERBOARD_CLIPS_S3_URL_STYLE",
        "ADMIN_USER_IDS",
      ]) {
        delete process.env[name];
      }
      if (!bucketCreated) return;
      for (const key of [...(await listKeys("")), ...(await listKeys("legal-hold/"))]) {
        await s3.fetch(bucketUrl(key), { method: "DELETE" });
      }
      await s3.fetch(bucketUrl(), { method: "DELETE" });
    });

    beforeEach(async () => {
      await resetTables();
      for (const id of [KID_A, KID_B, ADMIN]) await addUser(id);
      session.userId = null;
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

    async function upload(userId: string, parts: Parameters<typeof uploadRequest>[0] = {}) {
      session.userId = userId;
      const response = await routes.clips.POST(await uploadRequest(parts));
      expect(response.status).toBe(201);
      return (await response.json()) as UploadLeaderboardClipResponse;
    }

    async function board(userId: string | null, appId = "asteroids", period = "all"): Promise<LeaderboardApiResponse> {
      session.userId = userId;
      const response = await routes.board.GET(
        new Request(`https://hankshits.com/api/leaderboards/${appId}?includeMe=true&period=${period}`),
        params({ appId })
      );
      expect(response.status).toBe(200);
      return (await response.json()) as LeaderboardApiResponse;
    }

    async function putBoardEntry(userId: string, score: number): Promise<void> {
      await addBoardEntry(userId, "asteroids", "high_score", score);
    }

    async function media(id: string, kind: "video" | "poster", userId: string | null) {
      session.userId = userId;
      const route = kind === "video" ? routes.video : routes.poster;
      return route.GET(new Request(`https://hankshits.com/api/leaderboard-clips/${id}/${kind}`), params({ id }));
    }

    it("says the feature is on", async () => {
      const response = routes.clips.GET();
      expect(((await response.json()) as LeaderboardClipConfigResponse).enabled).toBe(true);
    });

    it("runs the whole flow: upload, board, play, report, replace, delete", async () => {
      await putBoardEntry(KID_A, 2000);
      await putBoardEntry(KID_B, 1500);

      // 1. Upload: public at once.
      const first = await upload(KID_A, { runScore: "1790" });
      expect(first.clip).toMatchObject({ runScore: 1790, durationMs: 2011, width: 1280, height: 720, status: "public" });
      expect(await listKeys("lb/")).toEqual([`lb/${first.clip.id}.jpg`, `lb/${first.clip.id}.mp4`]);

      // 2. The leaderboard API shows it, to anybody; the player sees "public".
      const seen = await board(null);
      expect(seen.leaderboard.map((entry) => [entry.score, entry.clip])).toEqual([
        [2000, { id: first.clip.id, runScore: 1790, durationMs: 2011, width: 1280, height: 720 }],
        [1500, null],
      ]);
      expect(seen.myEntry).toBeNull();
      const mine = await board(KID_A);
      expect(mine.myEntry).toMatchObject({ rank: 1, score: 2000, clipStatus: "public", clip: { id: first.clip.id } });

      // 3. The 302 goes to a signed link, and the bytes download.
      const video = await media(first.clip.id, "video", null);
      expect(video.status).toBe(302);
      expect(video.headers.get("cache-control")).toBe("private, max-age=60");
      const location = new URL(video.headers.get("location")!);
      expect(location.origin).toBe(settings.endpoint);
      expect(location.searchParams.get("X-Amz-Expires")).toBe("600");
      const downloaded = await fetch(location);
      expect(downloaded.status).toBe(200);
      expect(Buffer.from(await downloaded.arrayBuffer()).equals(Buffer.from(GOOD_VIDEO))).toBe(true);
      const posterLink = (await media(first.clip.id, "poster", null)).headers.get("location")!;
      const poster = new Uint8Array(await (await fetch(posterLink)).arrayBuffer());
      expect(jpegHasMetadata(poster)).toBe(false);
      expect(Buffer.from(poster).equals(Buffer.from(stripJpegMetadata(POSTER_WITH_COMMENT)!))).toBe(true);
      // An unsigned request to the bucket is refused (the bucket is private).
      expect((await fetch(`${location.origin}${location.pathname}`)).status).toBe(403);

      // 4. A report (no sign-in) hides it at once.
      session.userId = null;
      const reported = await routes.report.POST(
        reportRequest(first.clip.id, { ...SAME_SITE, "x-real-ip": "203.0.113.50" }),
        params({ id: first.clip.id })
      );
      expect(reported.status).toBe(200);
      expect((await board(null)).leaderboard[0].clip).toBeNull();
      expect((await board(KID_A)).myEntry).toMatchObject({ clipStatus: "hidden", clip: { status: "hidden" } });
      expect((await media(first.clip.id, "video", null)).status).toBe(404);
      expect((await media(first.clip.id, "video", KID_B)).status).toBe(404);
      expect((await media(first.clip.id, "video", ADMIN)).status).toBe(404);
      expect((await media(first.clip.id, "video", KID_A)).status).toBe(302);

      // 5. A new upload replaces the hidden clip and deletes its objects.
      const second = await upload(KID_A, { runScore: "523.9" });
      expect(second.replaced).toBe(true);
      expect(second.clip.runScore).toBe(523);
      expect(await listKeys("lb/")).toEqual([`lb/${second.clip.id}.jpg`, `lb/${second.clip.id}.mp4`]);
      expect((await board(null)).leaderboard[0].clip?.id).toBe(second.clip.id);

      // 6. Another player cannot delete it; the owner can.
      session.userId = KID_B;
      expect((await routes.clip.DELETE(deleteRequest(second.clip.id), params({ id: second.clip.id }))).status).toBe(403);
      session.userId = KID_A;
      const deleted = await routes.clip.DELETE(deleteRequest(second.clip.id), params({ id: second.clip.id }));
      expect(deleted.status).toBe(200);
      expect(await listKeys("lb/")).toEqual([]);
      expect((await board(KID_A)).myEntry).toMatchObject({ clipStatus: "none", clip: null });
    });

    it("refuses a player with no row on the game's board (409), and stores nothing", async () => {
      await addBoardEntry(KID_A, "breakout");
      session.userId = KID_A;
      const response = await routes.clips.POST(await uploadRequest({ appId: "asteroids" }));
      expect(response.status).toBe(409);
      expect(((await response.json()) as { code: string }).code).toBe("no_board_entry");
      expect(await listKeys("lb/")).toEqual([]);
    });

    it("plays a clip to anybody only while its owner has a row on the board; the owner always finds it in myClip", async () => {
      await putBoardEntry(KID_A, 500);
      const clip = await upload(KID_A);
      expect((await media(clip.clip.id, "video", null)).status).toBe(302);
      // The row moves out of the week: myEntry is null for the week, myClip still has the clip.
      await scratch.db.execute(scratch.sql`UPDATE leaderboard_entries SET achieved_at = now() - interval '30 days'`);
      const week = await board(KID_A, "asteroids", "week");
      expect(week.myEntry).toBeNull();
      expect(week.myClip).toMatchObject({ clipStatus: "public", clip: { id: clip.clip.id } });
      // The board row is gone: nobody else can play it, the owner still can (and can delete it).
      await removeBoardEntry(KID_A, "asteroids");
      expect((await media(clip.clip.id, "video", null)).status).toBe(404);
      expect((await media(clip.clip.id, "video", KID_B)).status).toBe(404);
      expect((await media(clip.clip.id, "video", KID_A)).status).toBe(302);
      expect((await board(KID_A)).myClip).toMatchObject({ clipStatus: "public", clip: { id: clip.clip.id } });
      session.userId = KID_A;
      expect((await routes.clip.DELETE(deleteRequest(clip.clip.id), params({ id: clip.clip.id }))).status).toBe(200);
      expect(await listKeys("lb/")).toEqual([]);
    });

    it("lets an admin keep a clip for a legal report: the objects move to legal-hold/", async () => {
      await putBoardEntry(KID_B, 10);
      const clip = await upload(KID_B);
      session.userId = ADMIN;
      const response = await routes.clip.DELETE(
        deleteRequest(clip.clip.id, { keepForLegalReport: true }),
        params({ id: clip.clip.id })
      );
      expect(response.status).toBe(200);
      expect(await listKeys("lb/")).toEqual([]);
      expect(await listKeys("legal-hold/")).toEqual(
        ["jpg", "json", "mp4"].map((ext) => `legal-hold/${clip.clip.id}.${ext}`)
      );
      const held = await s3.fetch(bucketUrl(`legal-hold/${clip.clip.id}.mp4`));
      expect(Buffer.from(await held.arrayBuffer()).equals(Buffer.from(GOOD_VIDEO))).toBe(true);
    });

    it("sweeps the objects with no row, page by page, and leaves the rest", async () => {
      await putBoardEntry(KID_A, 10);
      await putBoardEntry(KID_B, 20);
      const kept = await upload(KID_A);
      const gone = await upload(KID_B);
      // KID_B's account is deleted: the cascade removes the row, the objects stay.
      await scratch.db.execute(scratch.sql`DELETE FROM users WHERE id = ${KID_B}`);
      // A stray object under lb/ (an upload that crashed before its row).
      await s3.fetch(bucketUrl("lb/zzzzzzzzzzzzzzzzzzzzzzzz.mp4"), { method: "PUT", body: "x" });
      const { createClipBucket } = await import("../bucket");
      const { createDbClipStore } = await import("../store");
      const { resolveLeaderboardClipsConfig } = await import("../config");
      const { sweepLeaderboardClips } = await import("../sweeper");
      // Page size 2: the real server's continuation tokens are followed.
      const result = await sweepLeaderboardClips({
        config: () => resolveLeaderboardClipsConfig({ ...process.env } as LeaderboardClipsEnv),
        store: createDbClipStore(scratch.db),
        bucket: (s) => createClipBucket(s, { listPageSize: 2 }),
        now: () => new Date(Date.now() + 2 * 60 * 60 * 1000), // past the 1-hour grace
      });
      expect(result).toMatchObject({ skipped: false, expiredRows: 0, orphanObjects: 3, deletedObjects: 3, failedDeletes: 0 });
      expect(await listKeys("lb/")).toEqual([`lb/${kept.clip.id}.jpg`, `lb/${kept.clip.id}.mp4`]);
      expect(gone.clip.id).not.toBe(kept.clip.id);
    });

    it("keeps the board answer when clips are switched off (no public clip), and the owner can still take theirs off", async () => {
      await putBoardEntry(KID_A, 10);
      const stored = await upload(KID_A);
      process.env.LEADERBOARD_CLIPS = "off";
      try {
        const seen = await board(KID_A);
        expect(seen.leaderboard[0].clip).toBeNull();
        // The owner still gets their own clip (section 7: take it off at any time).
        expect(seen.myEntry).toMatchObject({ clipStatus: "public", clip: { id: stored.clip.id } });
        expect(seen.myClip).toMatchObject({ clipStatus: "public", clip: { id: stored.clip.id } });
        // Another viewer sees no clip.
        expect((await board(KID_B)).leaderboard[0].clip).toBeNull();
        session.userId = KID_A;
        expect((await routes.clips.POST(await uploadRequest())).status).toBe(503);
        const id = seen.myClip!.clip!.id;
        expect((await routes.clip.DELETE(deleteRequest(id), params({ id }))).status).toBe(200);
        expect((await board(KID_A)).myClip).toEqual({ clipStatus: "none", clip: null });
      } finally {
        delete process.env.LEADERBOARD_CLIPS;
      }
    });
  });
});
