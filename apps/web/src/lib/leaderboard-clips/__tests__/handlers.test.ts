// @vitest-environment node
/**
 * The leaderboard clip routes (design/LEADERBOARD_CLIPS.html, sections 5 to
 * 7) on an in-memory store and bucket. The rules under test are the owner
 * decisions: public at once (D3), a report hides at once (D8), the owner or
 * an admin deletes (D8), off unless set up and a kill switch (D6), one clip
 * for each player and game (D2), and the server checks the device's MP4 but
 * never changes it (D1). leaderboard-clips.integration.test.ts runs the same
 * flow on a real Postgres and a real S3 server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jpegHasMetadata } from "@/shared/lib/jpeg";

import { legalHoldKey, posterKey, videoKey } from "../bucket";
import { resolveLeaderboardClipsConfig, type LeaderboardClipsEnv } from "../config";
import {
  LEADERBOARD_CLIP_LIMITS,
  LEADERBOARD_CLIP_SIZES,
  MAX_UPLOAD_REQUEST_BYTES,
  type DeleteLeaderboardClipResponse,
  type LeaderboardClipConfigResponse,
  type LeaderboardClipErrorResponse,
  type UploadLeaderboardClipResponse,
} from "../contract";
import { leaderboardClipGames } from "../games";
import {
  MAX_UPLOADS_AT_ONCE,
  SERVER_BUSY_RETRY_SEC,
  UploadGate,
  boundaryMarks,
  handleConfig,
  handleDelete as deleteClip,
  handleMedia,
  handleReport as reportClip,
  handleUpload as uploadClip,
  uploadBoundary,
  type ClipDeps,
} from "../handlers";
import { isClipId } from "../ids";
import { MemoryBucket, MemoryClipStore } from "./fakes";
import { testClipId } from "./storeContract";
import {
  GOOD_VIDEO,
  OTHER_SITE,
  POSTER_WITH_COMMENT,
  SAME_SITE,
  UDTA_VIDEO,
  deleteRequest,
  reportRequest,
  uploadRequest,
  uploadUrl,
} from "./requests";

import { readBody, CLIP_UPLOAD_BODY as UPLOAD_BODY_LIMITS, CLIP_DELETE_BODY, type BodyLimits } from "@/lib/read-body";

type TestDeps = ClipDeps & { uploadBodyLimits?: Omit<BodyLimits, "maxBytes"> };
const metadata = (request: Request) => ({ url: request.url, method: request.method, headers: new Headers(request.headers) });
function handleUpload(request: Request, deps: TestDeps) {
  return uploadClip(metadata(request), () => readBody(request, { ...UPLOAD_BODY_LIMITS, ...deps.uploadBodyLimits }), deps);
}
function handleDelete(request: Request, id: string, deps: ClipDeps) {
  return deleteClip(metadata(request), () => readBody(request, CLIP_DELETE_BODY), id, deps);
}
function handleReport(request: Request, id: string, deps: ClipDeps) {
  return reportClip(metadata(request), id, deps);
}

const KID = "user-kid-0001";
const OTHER_KID = "user-kid-0002";
const ADMIN = "user-admin-0003";

const ENV: LeaderboardClipsEnv = {
  LEADERBOARD_CLIPS_S3_ENDPOINT: "https://t3.storageapi.dev",
  LEADERBOARD_CLIPS_S3_BUCKET: "hanks-hits-clips-abc123",
  LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID: "key-id",
  LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY: "secret-value",
  ADMIN_USER_IDS: ADMIN,
};

interface Harness {
  deps: TestDeps;
  store: MemoryClipStore;
  bucket: MemoryBucket;
  env: LeaderboardClipsEnv;
  user: { id: string | null };
  clock: { now: Date };
  reports: { allowed: boolean; ips: string[] };
}

function harness(): Harness {
  const store = new MemoryClipStore();
  const bucket = new MemoryBucket();
  const env: LeaderboardClipsEnv = { ...ENV };
  const user = { id: KID as string | null };
  const clock = { now: new Date("2026-10-02T12:00:00.000Z") };
  const reports = { allowed: true, ips: [] as string[] };
  bucket.clock = () => clock.now;
  for (const id of [KID, OTHER_KID, ADMIN]) store.addUser(id);
  // The two players are on every clip game's board (the progress route wrote their rows).
  for (const id of [KID, OTHER_KID]) for (const appId of leaderboardClipGames()) store.addBoardEntry(id, appId);
  const deps: TestDeps = {
    config: () => resolveLeaderboardClipsConfig(env),
    store,
    bucket: () => bucket,
    userId: async () => user.id,
    now: () => clock.now,
    clientIp: (request) => request.headers.get("x-forwarded-for") ?? "unknown",
    reportLimit: (ip) => {
      reports.ips.push(ip);
      return { success: reports.allowed, resetIn: 1234 };
    },
    uploadGate: new UploadGate(),
  };
  return { deps, store, bucket, env, user, clock, reports };
}

async function errorOf(response: Response): Promise<LeaderboardClipErrorResponse> {
  return (await response.json()) as LeaderboardClipErrorResponse;
}

let logs: string[];

beforeEach(() => {
  logs = [];
  const capture = (...args: unknown[]) => {
    logs.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Upload a good clip as the current user and return the clip id. */
async function uploadGood(h: Harness, parts: Parameters<typeof uploadRequest>[0] = {}): Promise<UploadLeaderboardClipResponse> {
  const response = await handleUpload(await uploadRequest(parts), h.deps);
  expect(response.status).toBe(201);
  return (await response.json()) as UploadLeaderboardClipResponse;
}

describe("GET /api/leaderboard-clips (is the feature on?)", () => {
  it("says enabled, with the limits and the sizes the server takes", async () => {
    const h = harness();
    const response = handleConfig(h.deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as LeaderboardClipConfigResponse;
    expect(body).toEqual({
      enabled: true,
      limits: JSON.parse(JSON.stringify(LEADERBOARD_CLIP_LIMITS)),
      sizes: LEADERBOARD_CLIP_SIZES,
    });
  });

  it("says not enabled for a kid clone with no bucket, and for the kill switch", async () => {
    const h = harness();
    h.env.LEADERBOARD_CLIPS = "off";
    expect(((await handleConfig(h.deps).json()) as LeaderboardClipConfigResponse).enabled).toBe(false);
    for (const key of Object.keys(h.env)) delete h.env[key as keyof LeaderboardClipsEnv];
    expect(((await handleConfig(h.deps).json()) as LeaderboardClipConfigResponse).enabled).toBe(false);
  });
});

describe("POST /api/leaderboard-clips (upload)", () => {
  it("stores a good clip, makes it public at once, and measures it on the server", async () => {
    const h = harness();
    const body = await uploadGood(h, { runScore: "1790.6" });
    expect(isClipId(body.clip.id)).toBe(true);
    expect(body).toEqual({
      clip: {
        id: body.clip.id,
        runScore: 1790, // floor, like a board score
        durationMs: 2011,
        width: 1280,
        height: 720,
        status: "public",
        hasAudio: true,
        createdAt: "2026-10-02T12:00:00.000Z",
        hiddenAt: null,
      },
      replaced: false,
    });
    // The objects are in the bucket under lb/<id>, and the video is the device's own bytes.
    const video = h.bucket.objects.get(videoKey(body.clip.id))!;
    expect(video.contentType).toBe("video/mp4");
    expect(Buffer.from(video.body).equals(Buffer.from(GOOD_VIDEO))).toBe(true);
    const poster = h.bucket.objects.get(posterKey(body.clip.id))!;
    expect(poster.contentType).toBe("image/jpeg");
    expect(jpegHasMetadata(POSTER_WITH_COMMENT)).toBe(true);
    expect(jpegHasMetadata(poster.body)).toBe(false);
    expect(h.bucket.objects.size).toBe(2);
    // The row is public, on the profile of the player's board row.
    const profile = h.store.profileOf(KID)!;
    expect(h.store.clips.get(body.clip.id)).toMatchObject({
      gamingProfileId: profile.id,
      appId: "asteroids",
      status: "public",
      bytes: GOOD_VIDEO.length,
    });
    // The upload counts toward the daily limit, and it is finished.
    expect(h.store.uploads).toHaveLength(1);
    expect(h.store.uploads[0].finishedAt).not.toBeNull();
  });

  it("replaces the player's older clip of the same game and deletes its objects", async () => {
    const h = harness();
    const first = await uploadGood(h);
    const other = await uploadGood(h, { appId: "breakout" });
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    const second = await uploadGood(h, { runScore: "12" });
    expect(second.replaced).toBe(true);
    expect(second.clip.runScore).toBe(12);
    expect(h.store.clips.has(first.clip.id)).toBe(false);
    expect(h.bucket.objects.has(videoKey(first.clip.id))).toBe(false);
    expect(h.bucket.objects.has(posterKey(first.clip.id))).toBe(false);
    // The clip of another game stays.
    expect(h.bucket.objects.has(videoKey(other.clip.id))).toBe(true);
    expect([...h.store.clips.keys()].sort()).toEqual([other.clip.id, second.clip.id].sort());
  });

  it("still answers 201 when an old object cannot be deleted (the sweeper deletes the orphan)", async () => {
    const h = harness();
    await uploadGood(h);
    h.bucket.failOn.add("delete");
    const second = await uploadGood(h);
    expect(second.replaced).toBe(true);
    expect(h.bucket.objects.size).toBe(4);
    expect(logs.some((line) => line.includes("old clip objects not deleted"))).toBe(true);
  });

  it("refuses a request from another site before anything else", async () => {
    const h = harness();
    const response = await handleUpload(await uploadRequest({ headers: OTHER_SITE }), h.deps);
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe("wrong_origin");
    expect(h.store.uploads).toHaveLength(0);
  });

  it("is off (503) when the bucket is not set up, and with the kill switch", async () => {
    const h = harness();
    h.env.LEADERBOARD_CLIPS = "off";
    let response = await handleUpload(await uploadRequest(), h.deps);
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("clips_off");
    delete h.env.LEADERBOARD_CLIPS;
    delete h.env.LEADERBOARD_CLIPS_S3_BUCKET;
    response = await handleUpload(await uploadRequest(), h.deps);
    expect(response.status).toBe(503);
    expect(h.store.uploads).toHaveLength(0);
    expect(h.bucket.objects.size).toBe(0);
  });

  it("needs a signed-in player", async () => {
    const h = harness();
    h.user.id = null;
    const response = await handleUpload(await uploadRequest(), h.deps);
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("sign_in");
  });

  it("answers sign_in when the session's account is gone", async () => {
    const h = harness();
    h.user.id = "user-deleted";
    const response = await handleUpload(await uploadRequest(), h.deps);
    expect(response.status).toBe(401);
  });

  it("refuses a Content-Length over the limit, and a form that is not multipart, before it reads the body", async () => {
    const h = harness();
    let response = await handleUpload(await uploadRequest({ length: String(MAX_UPLOAD_REQUEST_BYTES + 1) }), h.deps);
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe("too_big");
    response = await handleUpload(await uploadRequest({ headers: { "content-type": "application/json" } }), h.deps);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("bad_form");
    expect(h.store.uploads).toHaveLength(0);
  });

  /** The same upload, sent chunked with no Content-Length (as a proxy can forward it). */
  async function chunked(parts: Parameters<typeof uploadRequest>[0] = {}, extraBytes = 0): Promise<Request> {
    const plain = await uploadRequest({ ...parts, noLength: true });
    const bytes = new Uint8Array(await plain.arrayBuffer());
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 64 * 1024) controller.enqueue(bytes.subarray(at, at + 64 * 1024));
        // Bytes past the end of the form (only to make the body too big).
        for (let left = extraBytes; left > 0; left -= 1024 * 1024) controller.enqueue(new Uint8Array(Math.min(left, 1024 * 1024)));
        controller.close();
      },
    });
    return new Request(plain.url, { method: "POST", headers: plain.headers, body, duplex: "half" } as RequestInit);
  }

  it("takes an upload with no Content-Length (a proxy can send it chunked)", async () => {
    const h = harness();
    const request = await chunked();
    expect(request.headers.get("content-length")).toBeNull();
    const response = await handleUpload(request, h.deps);
    expect(response.status).toBe(201);
  });

  it("counts the size while the body arrives: a chunked body over the limit is 413", async () => {
    const h = harness();
    const response = await handleUpload(await chunked({}, MAX_UPLOAD_REQUEST_BYTES), h.deps);
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe("too_big");
    expect(h.bucket.objects.size).toBe(0);
  });

  it("does not trust a Content-Length that is too small", async () => {
    const h = harness();
    const request = await chunked({}, MAX_UPLOAD_REQUEST_BYTES);
    const lying = new Request(request.url, {
      method: "POST",
      headers: { ...Object.fromEntries(request.headers), "content-length": "1000" },
      body: request.body,
      duplex: "half",
    } as RequestInit);
    expect((await handleUpload(lying, h.deps)).status).toBe(413);
  });

  it("allows 10 uploads a day for each account (429 daily_limit with Retry-After)", async () => {
    const h = harness();
    for (let i = 0; i < LEADERBOARD_CLIP_LIMITS.uploadsPerDay; i++) {
      await uploadGood(h);
      h.clock.now = new Date(h.clock.now.getTime() + 1000);
    }
    const response = await handleUpload(await uploadRequest(), h.deps);
    expect(response.status).toBe(429);
    expect((await errorOf(response)).code).toBe("daily_limit");
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(23 * 3600);
    // Another account still can.
    h.user.id = OTHER_KID;
    await uploadGood(h);
  });

  it("allows one upload at a time (429 busy)", async () => {
    const h = harness();
    const slot = await h.store.claimUploadSlot(KID, h.clock.now);
    expect(slot.ok).toBe(true);
    const response = await handleUpload(await uploadRequest(), h.deps);
    expect(response.status).toBe(429);
    expect((await errorOf(response)).code).toBe("busy");
    expect(response.headers.get("retry-after")).toBe("30");
  });

  it.each([
    ["no video", { video: null }],
    ["no poster", { poster: null }],
    ["no game", { appId: null }],
    ["no run score", { runScore: null }],
    ["a video that is text", { video: "not a file" }],
  ])("refuses a form with %s (bad_form)", async (_name, parts) => {
    const h = harness();
    const response = await handleUpload(await uploadRequest(parts), h.deps);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("bad_form");
    expect(h.bucket.objects.size).toBe(0);
  });

  it.each(["snake", "2048", "weather", "nope", "constructor"])("refuses the game %j (bad_game)", async (appId) => {
    const h = harness();
    const response = await handleUpload(await uploadRequest({ appId }), h.deps);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("bad_game");
  });

  it.each(["-1", "abc", "1e3", "1000000000001", "", "NaN"])("refuses the run score %j (bad_score)", async (runScore) => {
    const h = harness();
    const response = await handleUpload(await uploadRequest({ runScore }), h.deps);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("bad_score");
  });

  it("refuses a run score over the game's own limit (flappy-bird: 1,000,000)", async () => {
    const h = harness();
    const response = await handleUpload(await uploadRequest({ appId: "flappy-bird", runScore: "1000001" }), h.deps);
    expect((await errorOf(response)).code).toBe("bad_score");
  });

  it("refuses a video that fails the MP4 check, names the reason, and stores nothing", async () => {
    const h = harness();
    const response = await handleUpload(await uploadRequest({ video: UDTA_VIDEO }), h.deps);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({
      error: "The video did not pass the checks.",
      code: "bad_video",
      reason: "metadata",
    });
    expect(h.bucket.objects.size).toBe(0);
    expect(h.store.clips.size).toBe(0);
    // A rejected upload counts toward the daily limit.
    expect(h.store.uploads).toHaveLength(1);
  });

  it("refuses a player who is not on the game's board (409 no_board_entry), stores nothing, makes no profile", async () => {
    const h = harness();
    // KID has a profile and rows on other boards, but no asteroids row.
    h.store.removeBoardEntry(KID, "asteroids");
    let response = await handleUpload(await uploadRequest(), h.deps);
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("no_board_entry");
    // ADMIN has no profile at all.
    h.user.id = ADMIN;
    response = await handleUpload(await uploadRequest(), h.deps);
    expect(response.status).toBe(409);
    expect(h.store.profileOf(ADMIN)).toBeUndefined();
    expect(h.bucket.objects.size).toBe(0);
    expect(h.store.clips.size).toBe(0);
    // It counts toward the daily limit, though it read no body (the board is checked first).
    expect(h.store.uploads.filter((upload) => upload.finishedAt !== null)).toHaveLength(2);
    expect(h.deps.uploadGate.active).toBe(0);
  });

  /** An upload body that counts how often the server pulls it. */
  function countedUpload(appId = "asteroids", headers: Record<string, string> = {}) {
    const pulled = { chunks: 0 };
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled.chunks++;
          controller.enqueue(new Uint8Array(1024));
        },
      },
      { highWaterMark: 0 }
    );
    const request = new Request(uploadUrl(appId), {
      method: "POST",
      headers: { ...SAME_SITE, "content-type": "multipart/form-data; boundary=x", ...headers },
      body,
      duplex: "half",
    } as RequestInit);
    return { request, pulled };
  }

  it("checks the board row before the gate and the body: a player with no row takes no place and sends nothing", async () => {
    const h = harness();
    const gate = new UploadGate(1);
    h.deps.uploadGate = gate;
    h.store.removeBoardEntry(KID, "asteroids");
    const { request, pulled } = countedUpload();
    const response = await handleUpload(request, h.deps);
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("no_board_entry");
    expect(pulled.chunks).toBe(0);
    expect(gate.active).toBe(0);
  });

  it("refuses three fresh accounts with no board row before the gate, so a kid on the board still gets in", async () => {
    const h = harness();
    for (const id of ["fresh-1", "fresh-2", "fresh-3"]) {
      h.store.addUser(id);
      h.user.id = id;
      const { request, pulled } = countedUpload("asteroids", { "x-forwarded-for": `198.51.100.${id.slice(-1)}` });
      expect((await handleUpload(request, h.deps)).status).toBe(409);
      expect(pulled.chunks).toBe(0);
    }
    expect(h.deps.uploadGate.active).toBe(0);
    h.user.id = KID;
    await uploadGood(h);
  });

  it("needs the game in the URL (?appId=), and the same game in the form", async () => {
    const h = harness();
    // No game in the URL: refused before the slot and the body.
    const { request, pulled } = countedUpload();
    const noQuery = new Request(uploadUrl(null), { method: "POST", headers: request.headers, body: request.body, duplex: "half" } as RequestInit);
    let response = await handleUpload(noQuery, h.deps);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("bad_form");
    expect(pulled.chunks).toBe(0);
    expect(h.store.uploads).toHaveLength(0);
    // A game in the URL that is not a clip game.
    response = await handleUpload(await uploadRequest({ queryAppId: "snake" }), h.deps);
    expect((await errorOf(response)).code).toBe("bad_game");
    // The URL and the form name different games (the board row was checked for the URL's game).
    response = await handleUpload(await uploadRequest({ appId: "breakout", queryAppId: "asteroids" }), h.deps);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("bad_form");
    expect(h.bucket.objects.size).toBe(0);
  });

  it("checks the board row before the MP4 (the cheap database check first)", async () => {
    const h = harness();
    h.store.removeBoardEntry(KID, "asteroids");
    const response = await handleUpload(await uploadRequest({ video: UDTA_VIDEO }), h.deps);
    expect((await errorOf(response)).code).toBe("no_board_entry");
  });

  it("refuses a video over 16 MiB", async () => {
    const h = harness();
    const big = new Uint8Array(LEADERBOARD_CLIP_LIMITS.maxVideoBytes + 1);
    const response = await handleUpload(await uploadRequest({ video: big }), h.deps);
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe("too_big");
  });

  it("refuses a poster that is not a JPEG, or over 64 KB", async () => {
    const h = harness();
    let response = await handleUpload(await uploadRequest({ poster: GOOD_VIDEO.subarray(0, 1000) }), h.deps);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatchObject({ code: "bad_poster", reason: "not_jpeg" });
    response = await handleUpload(
      await uploadRequest({ poster: new Uint8Array(LEADERBOARD_CLIP_LIMITS.maxPosterBytes + 1) }),
      h.deps
    );
    expect(response.status).toBe(413);
    expect(h.bucket.objects.size).toBe(0);
  });

  it("answers 502 when the bucket fails, keeps nothing, and does not count the upload", async () => {
    const h = harness();
    const original = h.bucket.put.bind(h.bucket);
    h.bucket.put = async (key, body, type) => {
      if (key.endsWith(".jpg")) throw new Error("bucket down");
      return original(key, body, type);
    };
    const response = await handleUpload(await uploadRequest(), h.deps);
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe("storage_failed");
    expect(h.bucket.objects.size).toBe(0); // the stored video was deleted again
    expect(h.store.clips.size).toBe(0);
    expect(h.store.uploads).toHaveLength(0);
  });

  it("answers 500 when the row cannot be written, deletes the stored objects, and does not count it", async () => {
    const h = harness();
    h.store.failReplace = true;
    const response = await handleUpload(await uploadRequest(), h.deps);
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
    expect(h.bucket.objects.size).toBe(0);
    expect(h.store.uploads).toHaveLength(0);
    expect(logs.some((line) => line.includes("committed=no"))).toBe(true);
  });

  it("keeps the objects when the row was written but the answer was lost (201, the old clip is replaced)", async () => {
    const h = harness();
    const first = await uploadGood(h);
    h.store.failReplaceAfterCommit = true;
    const response = await handleUpload(await uploadRequest({ runScore: "77" }), h.deps);
    expect(response.status).toBe(201);
    const body = (await response.json()) as UploadLeaderboardClipResponse;
    expect(body.replaced).toBe(true);
    // The new row and its objects are there; the old clip and its objects are gone.
    expect([...h.store.clips.keys()]).toEqual([body.clip.id]);
    expect([...h.bucket.objects.keys()].sort()).toEqual([posterKey(body.clip.id), videoKey(body.clip.id)].sort());
    expect(h.store.clips.has(first.clip.id)).toBe(false);
    // It counts: the upload is on the board.
    expect(h.store.uploads.every((upload) => upload.finishedAt !== null)).toBe(true);
  });

  it("keeps the objects for the sweeper when it cannot tell whether the row was written (500)", async () => {
    const h = harness();
    h.store.failReplace = true;
    h.store.failExistingCheck = true;
    const response = await handleUpload(await uploadRequest(), h.deps);
    expect(response.status).toBe(500);
    // No row, so the objects are orphans: the sweeper deletes them after the grace time.
    expect(h.store.clips.size).toBe(0);
    expect(h.bucket.objects.size).toBe(2);
    expect(logs.some((line) => line.includes("committed=unknown"))).toBe(true);
  });

  it("answers 408 when the body does not arrive in time", async () => {
    const h = harness();
    h.deps.uploadBodyLimits = { timeoutMs: 20 };
    const stalled = new ReadableStream<Uint8Array>({ start() {} });
    const request = new Request(uploadUrl(), {
      method: "POST",
      headers: { ...SAME_SITE, "content-type": "multipart/form-data; boundary=x", "content-length": "1000" },
      body: stalled,
      duplex: "half",
    } as RequestInit);
    const response = await handleUpload(request, h.deps);
    expect(response.status).toBe(408);
    expect((await errorOf(response)).code).toBe("timeout");
  });

  it("answers 408 when the body drips in slower than the floor, and frees its place", async () => {
    const h = harness();
    h.deps.uploadBodyLimits = { timeoutMs: 60_000, minBytesPerSec: 1024, graceMs: 20 };
    let sent = false;
    const dripping = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          if (sent) return new Promise<void>(() => undefined); // nothing more
          sent = true;
          controller.enqueue(new Uint8Array(10));
        },
      },
      { highWaterMark: 0 }
    );
    const request = new Request(uploadUrl(), {
      method: "POST",
      headers: { ...SAME_SITE, "content-type": "multipart/form-data; boundary=x" },
      body: dripping,
      duplex: "half",
    } as RequestInit);
    const response = await handleUpload(request, h.deps);
    expect(response.status).toBe(408);
    expect((await errorOf(response)).code).toBe("timeout");
    expect(h.deps.uploadGate.active).toBe(0);
  });

  it("takes only MAX_UPLOADS_AT_ONCE uploads at the same time: the next one is 503 server_busy, unread and not counted", async () => {
    const h = harness();
    const gate = new UploadGate(1);
    h.deps.uploadGate = gate;
    expect(gate.tryEnter()).toBe(true); // another upload is running
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled++;
          controller.enqueue(new Uint8Array(1024));
        },
      },
      { highWaterMark: 0 }
    );
    const request = new Request(uploadUrl(), {
      method: "POST",
      headers: { ...SAME_SITE, "content-type": "multipart/form-data; boundary=x" },
      body,
      duplex: "half",
    } as RequestInit);
    const response = await handleUpload(request, h.deps);
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("server_busy");
    expect(response.headers.get("retry-after")).toBe(String(SERVER_BUSY_RETRY_SEC));
    expect(pulled).toBe(0);
    expect(h.store.uploads).toHaveLength(0); // the slot is released: it does not count
    expect(gate.active).toBe(1); // the refused upload took no place
    gate.leave();
    await uploadGood(h);
    expect(gate.active).toBe(0); // a finished upload gives its place back
  });

  it("lets one network address hold only one place: a second upload from it is 503 server_busy, another address gets in", async () => {
    const h = harness();
    expect(MAX_UPLOADS_AT_ONCE).toBeGreaterThan(1);
    // A body from 203.0.113.9 that is still arriving.
    const stalled = new Request(uploadUrl(), {
      method: "POST",
      headers: { ...SAME_SITE, "content-type": "multipart/form-data; boundary=x", "x-forwarded-for": "203.0.113.9" },
      body: new ReadableStream<Uint8Array>({ start() {} }),
      duplex: "half",
    } as RequestInit);
    h.deps.uploadBodyLimits = { timeoutMs: 200 };
    const first = handleUpload(stalled, h.deps);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.deps.uploadGate.active).toBe(1);
    // The same address, another account.
    h.user.id = OTHER_KID;
    const second = await handleUpload(await uploadRequest({ headers: { "x-forwarded-for": "203.0.113.9" } }), h.deps);
    expect(second.status).toBe(503);
    expect((await errorOf(second)).code).toBe("server_busy");
    expect(h.store.uploads.filter((upload) => upload.finishedAt !== null)).toHaveLength(0); // not counted
    // Another address.
    h.deps.uploadBodyLimits = undefined;
    const third = await handleUpload(await uploadRequest({ headers: { "x-forwarded-for": "198.51.100.4" } }), h.deps);
    expect(third.status).toBe(201);
    expect((await first).status).toBe(408);
    expect(h.deps.uploadGate.active).toBe(0);
    expect((h.deps.uploadGate as UploadGate).keysInFlight).toBe(0);
  });

  it("frees the place of a body that sends 4 MiB at once and then stops, one window later (production limits)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
    try {
      const h = harness();
      expect(h.deps.uploadBodyLimits).toBeUndefined(); // UPLOAD_BODY_LIMITS apply
      expect(UPLOAD_BODY_LIMITS.graceMs).toBe(15_000);
      const attackers = ["198.51.100.1", "198.51.100.2", "198.51.100.3"];
      const pending: Promise<Response>[] = [];
      for (const [i, ip] of attackers.entries()) {
        const id = `player-${i}`;
        h.store.addUser(id);
        h.store.addBoardEntry(id, "asteroids"); // even with a board row
        h.user.id = id;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(4 * 1024 * 1024).fill(120)); // then nothing, and no end
          },
        });
        pending.push(
          handleUpload(
            new Request(uploadUrl(), {
              method: "POST",
              headers: { ...SAME_SITE, "content-type": "multipart/form-data; boundary=x", "content-length": "16000000", "x-forwarded-for": ip },
              body,
              duplex: "half",
            } as RequestInit),
            h.deps
          )
        );
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(h.deps.uploadGate.active).toBe(3);
      await vi.advanceTimersByTimeAsync(17_000);
      expect((await Promise.all(pending)).map((response) => response.status)).toEqual([408, 408, 408]);
      expect(h.deps.uploadGate.active).toBe(0);
      h.user.id = KID;
      const kid = handleUpload(await uploadRequest(), h.deps);
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await kid).status).toBe(201);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the place back when an upload fails", async () => {
    const h = harness();
    h.bucket.failOn.add("put");
    expect((await handleUpload(await uploadRequest(), h.deps)).status).toBe(502);
    await handleUpload(await uploadRequest({ video: UDTA_VIDEO }), h.deps);
    expect(h.deps.uploadGate.active).toBe(0);
  });

  it("refuses a form with more parts than the four fields before it parses it (bad_form)", async () => {
    const h = harness();
    const plain = await uploadRequest();
    const boundary = /boundary=(.+)$/.exec(plain.headers.get("content-type")!)![1];
    const original = new Uint8Array(await plain.arrayBuffer());
    // Many empty parts after the real ones: a body that costs a lot of memory in formData().
    const extra = new TextEncoder().encode(`\r\n--${boundary}\r\ncontent-disposition: form-data; name="x"\r\n\r\n`.repeat(50));
    const closeAt = original.length - (`--${boundary}--\r\n`.length + 2);
    const body = new Uint8Array([...original.subarray(0, closeAt), ...extra, ...original.subarray(closeAt)]);
    const request = new Request(plain.url, {
      method: "POST",
      headers: { ...SAME_SITE, "content-type": plain.headers.get("content-type")! },
      body,
    });
    const response = await handleUpload(request, h.deps);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("bad_form");
    expect(h.bucket.objects.size).toBe(0);
  });

  // The part count must count the boundary that the parser splits on. Each
  // of these headers made the old regex read a different boundary than
  // undici, so ~300k tiny parts reached formData() (wave-2 review).
  it.each([
    ["a boundary= inside an earlier quoted parameter", 'multipart/form-data; x="; boundary=AAA"; boundary=B'],
    ["an escaped quote in a quoted boundary", 'multipart/form-data; boundary="B\\B"'],
    ["two boundary parameters", "multipart/form-data; boundary=B; boundary=AAA"],
    ["a quoted boundary", 'multipart/form-data; boundary="B"'],
    ["a second parameter", "multipart/form-data; boundary=B; charset=utf-8"],
  ])("refuses %s before it reads the body (bad_form)", async (_name, contentType) => {
    const h = harness();
    const { request, pulled } = countedUpload("asteroids", { "content-type": contentType });
    const parse = vi.spyOn(Response.prototype, "formData");
    const response = await handleUpload(request, h.deps);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("bad_form");
    expect(pulled.chunks).toBe(0);
    expect(parse).not.toHaveBeenCalled();
    expect(h.store.uploads).toHaveLength(0);
  });

  it("refuses a body of many tiny parts on a browser-shaped header before the parse", async () => {
    const h = harness();
    const part = `--B\r\nContent-Disposition: form-data; name="a"\r\n\r\n\r\n`;
    const bytes = new TextEncoder().encode(part.repeat(20_000) + "--B--\r\n");
    const parse = vi.spyOn(Response.prototype, "formData");
    const response = await handleUpload(
      new Request(uploadUrl(), {
        method: "POST",
        headers: { ...SAME_SITE, "content-type": "multipart/form-data; boundary=B", "content-length": String(bytes.length) },
        body: bytes,
      }),
      h.deps
    );
    expect((await errorOf(response)).code).toBe("bad_form");
    expect(parse).not.toHaveBeenCalled();
  });

  it("refuses a multipart type with no boundary (bad_form)", async () => {
    const h = harness();
    const plain = await uploadRequest();
    const request = new Request(plain.url, {
      method: "POST",
      headers: { ...SAME_SITE, "content-type": "multipart/form-data" },
      body: await plain.arrayBuffer(),
    });
    expect((await errorOf(await handleUpload(request, h.deps))).code).toBe("bad_form");
  });

  it("logs no user id, handle, clip id or file name", async () => {
    const h = harness();
    const body = await uploadGood(h);
    await handleUpload(await uploadRequest({ video: UDTA_VIDEO }), h.deps);
    const text = logs.join("\n");
    expect(text).toContain("upload stored: game=asteroids");
    for (const secret of [KID, body.clip.id, "clip.mp4", "poster.jpg", h.store.profileOf(KID)!.id]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("GET /api/leaderboard-clips/[id]/video and /poster", () => {
  async function publicClip(h: Harness): Promise<string> {
    return (await uploadGood(h)).clip.id;
  }

  it("sends anybody to a 10-minute signed link of a public clip", async () => {
    const h = harness();
    const id = await publicClip(h);
    h.user.id = null;
    const video = await handleMedia(id, "video", h.deps);
    expect(video.status).toBe(302);
    expect(video.headers.get("location")).toBe(`https://bucket.test/${videoKey(id)}?X-Amz-Expires=600&X-Amz-Signature=fake`);
    expect(video.headers.get("cache-control")).toBe("private, max-age=60");
    expect(video.headers.get("vary")).toBe("Cookie");
    const poster = await handleMedia(id, "poster", h.deps);
    expect(poster.headers.get("location")).toContain(posterKey(id));
  });

  it("shows a hidden clip to its owner only (an admin and other players get 404)", async () => {
    const h = harness();
    const id = await publicClip(h);
    await h.store.hideClip(id, h.clock.now);
    for (const viewer of [null, OTHER_KID, ADMIN]) {
      h.user.id = viewer;
      const response = await handleMedia(id, "video", h.deps);
      expect(response.status, String(viewer)).toBe(404);
      expect((await errorOf(response)).code).toBe("not_found");
    }
    h.user.id = KID;
    expect((await handleMedia(id, "video", h.deps)).status).toBe(302);
  });

  it("shows a clip whose owner has no row on the game's board (any more) to that player only", async () => {
    const h = harness();
    const id = await publicClip(h);
    h.store.removeBoardEntry(KID, "asteroids");
    for (const viewer of [null, OTHER_KID]) {
      h.user.id = viewer;
      expect((await handleMedia(id, "video", h.deps)).status, String(viewer)).toBe(404);
    }
    h.user.id = KID;
    expect((await handleMedia(id, "video", h.deps)).status).toBe(302);
    // Another player cannot learn that it exists through DELETE either.
    h.user.id = OTHER_KID;
    expect((await handleDelete(deleteRequest(id), id, h.deps)).status).toBe(404);
  });

  it("shows the clip of a player who hides from the leaderboards to that player only", async () => {
    const h = harness();
    const id = await publicClip(h);
    h.store.profileOf(KID)!.showOnLeaderboards = false;
    h.user.id = OTHER_KID;
    expect((await handleMedia(id, "video", h.deps)).status).toBe(404);
    h.user.id = KID;
    expect((await handleMedia(id, "poster", h.deps)).status).toBe(302);
  });

  it("answers 404 for an id that is not a clip id or not a clip", async () => {
    const h = harness();
    for (const id of ["short", "../../etc/passwd", `${testClipId()}x`, testClipId()]) {
      expect((await handleMedia(id, "video", h.deps)).status, id).toBe(404);
    }
  });

  it("answers 503 when the feature is off, and 502 when the link cannot be signed", async () => {
    const h = harness();
    const id = await publicClip(h);
    h.bucket.failOn.add("sign");
    expect((await handleMedia(id, "video", h.deps)).status).toBe(502);
    h.env.LEADERBOARD_CLIPS = "off";
    expect((await handleMedia(id, "video", h.deps)).status).toBe(503);
  });
});

describe("POST /api/leaderboard-clips/[id]/report", () => {
  it("lets anybody hide a public clip at once, with no review", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    h.user.id = null;
    const response = await handleReport(reportRequest(id, { ...SAME_SITE, "x-forwarded-for": "203.0.113.9" }), id, h.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hidden: true });
    expect(h.store.clips.get(id)).toMatchObject({ status: "hidden", hiddenAt: h.clock.now });
    // The limit keys on the network address.
    expect(h.reports.ips).toEqual(["203.0.113.9"]);
    // Nobody but the owner can watch it now.
    expect((await handleMedia(id, "video", h.deps)).status).toBe(404);
    // A second report is also 200.
    expect((await handleReport(reportRequest(id), id, h.deps)).status).toBe(200);
    expect(h.store.clips.get(id)!.hiddenAt).toEqual(h.clock.now);
  });

  it("is rate limited by network address (429 with Retry-After)", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    h.reports.allowed = false;
    const response = await handleReport(reportRequest(id), id, h.deps);
    expect(response.status).toBe(429);
    expect((await errorOf(response)).code).toBe("too_many_reports");
    expect(response.headers.get("retry-after")).toBe("1234");
    expect(h.store.clips.get(id)!.status).toBe("public");
  });

  it("refuses another site, answers 404 for no clip, and 503 when off", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    expect((await handleReport(reportRequest(id, OTHER_SITE), id, h.deps)).status).toBe(403);
    expect(h.store.clips.get(id)!.status).toBe("public");
    expect((await handleReport(reportRequest("bad"), "bad", h.deps)).status).toBe(404);
    const missing = testClipId();
    expect((await handleReport(reportRequest(missing), missing, h.deps)).status).toBe(404);
    h.env.LEADERBOARD_CLIPS = "off";
    expect((await handleReport(reportRequest(id), id, h.deps)).status).toBe(503);
  });
});

describe("DELETE /api/leaderboard-clips/[id]", () => {
  it("lets the owner take the video off: the row and both objects go", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    const response = await handleDelete(deleteRequest(id), id, h.deps);
    expect(response.status).toBe(200);
    expect((await response.json()) as DeleteLeaderboardClipResponse).toEqual({ deleted: true, keptForLegalReport: false });
    expect(h.store.clips.size).toBe(0);
    expect(h.bucket.objects.size).toBe(0);
    expect((await handleDelete(deleteRequest(id), id, h.deps)).status).toBe(404);
  });

  it("lets the owner delete a clip that a report hid", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    await h.store.hideClip(id, h.clock.now);
    expect((await handleDelete(deleteRequest(id), id, h.deps)).status).toBe(200);
    expect(h.bucket.objects.size).toBe(0);
  });

  it("refuses another player: 403 for a clip they can see, 404 for one they cannot", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    h.user.id = OTHER_KID;
    const visible = await handleDelete(deleteRequest(id), id, h.deps);
    expect(visible.status).toBe(403);
    expect((await errorOf(visible)).code).toBe("not_allowed");
    await h.store.hideClip(id, h.clock.now);
    expect((await handleDelete(deleteRequest(id), id, h.deps)).status).toBe(404);
    expect(h.store.clips.size).toBe(1);
    expect(h.bucket.objects.size).toBe(2);
  });

  it("lets an admin (ADMIN_USER_IDS) delete any clip, also a hidden one", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    await h.store.hideClip(id, h.clock.now);
    h.user.id = ADMIN;
    expect((await handleDelete(deleteRequest(id), id, h.deps)).status).toBe(200);
    expect(h.store.clips.size).toBe(0);
    expect(h.bucket.objects.size).toBe(0);
  });

  it("gives no admin power when ADMIN_USER_IDS is not set", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    delete h.env.ADMIN_USER_IDS;
    h.user.id = ADMIN;
    expect((await handleDelete(deleteRequest(id), id, h.deps)).status).toBe(403);
  });

  it("lets only an admin keep a clip for a legal report: copies to legal-hold/, then deletes", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    const video = h.bucket.objects.get(videoKey(id))!.body;
    // The owner cannot ask for the legal hold.
    expect((await handleDelete(deleteRequest(id, { keepForLegalReport: true }), id, h.deps)).status).toBe(403);
    h.user.id = ADMIN;
    const response = await handleDelete(deleteRequest(id, { keepForLegalReport: true }), id, h.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, keptForLegalReport: true });
    expect(h.store.clips.size).toBe(0);
    expect([...h.bucket.objects.keys()].sort()).toEqual(
      [legalHoldKey(id, "jpg"), legalHoldKey(id, "json"), legalHoldKey(id, "mp4")].sort()
    );
    expect(Buffer.from(h.bucket.objects.get(legalHoldKey(id, "mp4"))!.body).equals(Buffer.from(video))).toBe(true);
    const record = JSON.parse(new TextDecoder().decode(h.bucket.objects.get(legalHoldKey(id, "json"))!.body));
    expect(record).toMatchObject({ clipId: id, appId: "asteroids", userId: KID, keptAt: h.clock.now.toISOString() });
  });

  it("deletes nothing when the legal-hold copy fails", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    h.bucket.failOn.add("copy");
    h.user.id = ADMIN;
    const response = await handleDelete(deleteRequest(id, { keepForLegalReport: true }), id, h.deps);
    expect(response.status).toBe(502);
    expect(h.store.clips.size).toBe(1);
    expect(h.bucket.objects.has(videoKey(id))).toBe(true);
  });

  it("works while the kill switch is on (a player can always take a video off)", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    h.env.LEADERBOARD_CLIPS = "off";
    expect((await handleDelete(deleteRequest(id), id, h.deps)).status).toBe(200);
    expect(h.bucket.objects.size).toBe(0);
  });

  it("while the kill switch is on, the owner finds the clip id on the leaderboard and takes the video off", async () => {
    const { myClipFields } = await import("../leaderboard");
    const h = harness();
    const { clip } = await uploadGood(h);
    h.env.LEADERBOARD_CLIPS = "off";
    const mine = await myClipFields(h.deps, "asteroids", h.store.profileOf(KID)!.id);
    expect(mine.clip?.id).toBe(clip.id);
    const response = await handleDelete(deleteRequest(mine.clip!.id), mine.clip!.id, h.deps);
    expect(response.status).toBe(200);
    expect(h.store.clips.size).toBe(0);
    expect(h.bucket.objects.size).toBe(0);
  });

  it.each<[string, unknown]>([
    ["not JSON", "{oops"],
    ["an array", [true]],
    ["an unknown field", { keepForLegalReport: false, extra: 1 }],
    ["a string flag", { keepForLegalReport: "yes" }],
  ])("refuses a body that is %s (400 bad_request)", async (_name, body) => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    const response = await handleDelete(deleteRequest(id, body), id, h.deps);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("bad_request");
    expect(h.store.clips.size).toBe(1);
  });

  it("reads a chunked DELETE body only up to 1 KiB (plus one chunk), then 400 bad_request", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    let pulledBytes = 0;
    const chunk = new Uint8Array(1024).fill(0x20);
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulledBytes += chunk.byteLength;
          controller.enqueue(chunk); // never ends
        },
      },
      { highWaterMark: 0 }
    );
    const request = new Request(`https://hankshits.com/api/leaderboard-clips/${id}`, {
      method: "DELETE",
      headers: { ...SAME_SITE, "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    const response = await handleDelete(request, id, h.deps);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("bad_request");
    expect(pulledBytes).toBeLessThanOrEqual(3 * 1024);
    expect(h.store.clips.size).toBe(1);
  });

  it("refuses another site, a guest, and answers 503 with no bucket", async () => {
    const h = harness();
    const id = (await uploadGood(h)).clip.id;
    expect((await handleDelete(deleteRequest(id, undefined, OTHER_SITE), id, h.deps)).status).toBe(403);
    h.user.id = null;
    expect((await handleDelete(deleteRequest(id), id, h.deps)).status).toBe(401);
    h.user.id = KID;
    delete h.env.LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY;
    expect((await handleDelete(deleteRequest(id), id, h.deps)).status).toBe(503);
    expect(h.store.clips.size).toBe(1);
  });
});

describe("uploadBoundary and boundaryMarks", () => {
  it("takes the Content-Type that browsers and fetch() send for a FormData body", () => {
    expect(uploadBoundary("multipart/form-data; boundary=----WebKitFormBoundaryAbC123xyz09")).toBe("----WebKitFormBoundaryAbC123xyz09");
    expect(uploadBoundary("multipart/form-data; boundary=----geckoformboundary1f2e3d4c5b6a")).toBe("----geckoformboundary1f2e3d4c5b6a");
    expect(uploadBoundary("multipart/form-data; boundary=---------------------------41184676334")).toBe(
      "---------------------------41184676334"
    );
    expect(uploadBoundary("multipart/form-data; boundary=----formdata-undici-012345678901")).toBe("----formdata-undici-012345678901");
    expect(uploadBoundary("Multipart/Form-Data; Boundary=abc")).toBe("abc");
  });

  it("gives the same boundary as the WHATWG MIME parser, or none", async () => {
    const { MIMEType } = await import("node:util");
    for (const type of [
      'multipart/form-data; x="; boundary=AAA"; boundary=B',
      'multipart/form-data; boundary="B\\B"',
      "multipart/form-data; boundary=B; boundary=AAA",
      "multipart/form-data;boundary=B",
      "multipart/form-data; boundary=a=b",
      "multipart/form-data; boundary=" + "x".repeat(71),
      "multipart/mixed; boundary=B",
      "text/plain; boundary=B",
      "multipart/form-data",
      "",
    ]) {
      const ours = uploadBoundary(type);
      if (ours !== null) expect(ours).toBe(new MIMEType(type).params.get("boundary"));
    }
    expect(uploadBoundary('multipart/form-data; x="; boundary=AAA"; boundary=B')).toBeNull();
    expect(uploadBoundary("multipart/form-data; boundary=" + "x".repeat(71))).toBeNull();
    expect(uploadBoundary("multipart/mixed; boundary=B")).toBeNull();
  });

  it("counts every --boundary, also one with no CRLF before it, and stops past the limit", () => {
    const text = (value: string) => new TextEncoder().encode(value);
    expect(boundaryMarks(text("--B\r\na\r\n--B\na\n--B--"), "B", 10)).toBe(3);
    expect(boundaryMarks(text("x--Bx--Bx--B"), "B", 10)).toBe(3);
    expect(boundaryMarks(text("--B".repeat(1000)), "B", 5)).toBe(6);
  });
});
