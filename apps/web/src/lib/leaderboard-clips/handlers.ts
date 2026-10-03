/**
 * The request handlers of the leaderboard clip routes
 * (design/LEADERBOARD_CLIPS.html, sections 5 to 7). The route files under
 * src/app/api/leaderboard-clips/ are thin: each one calls a handler here
 * with defaultClipDeps() (runtime.ts). Tests call the handlers with an
 * in-memory store and bucket.
 *
 * Owner decisions that these handlers keep (do not change them here):
 * - No approval queue, no review step, no notifications. A clip is public
 *   as soon as the upload checks pass (D3).
 * - A report hides a clip at once; nobody reviews it (D8).
 * - An owner can delete their own clip. ADMIN_USER_IDS is optional and only
 *   lets an admin delete any clip, and nothing more (D8).
 * - The feature is off unless the bucket settings are set;
 *   LEADERBOARD_CLIPS=off is the kill switch (D6).
 * - One clip for each player and game; the newest replaces the old (D2).
 *   Only a player with a row on the game's board can upload (spec section
 *   1), and anybody can watch a clip only while its owner is on that board,
 *   so every clip that anybody can watch is where a viewer can report it.
 * - The video comes from the player's device; the server only checks it,
 *   never transcodes it (D1).
 *
 * Logs are values-free: the game id, a status, sizes and counts. Never a
 * user id, a handle, a clip id or a byte of the upload.
 */
import { MIMEType } from "node:util";

import type { ValidAppId } from "@hank-neil/db/schema";

import { describeError } from "@/lib/describe-error";
import { InFlightGate } from "@/lib/in-flight";
import type { BodyRead } from "@/lib/read-body";
import { isSameOriginRequest } from "@/lib/same-origin";

import {
  LEADERBOARD_CLIP_LIMITS,
  LEADERBOARD_CLIP_SIZES,
  MAX_UPLOAD_REQUEST_BYTES,
  UPLOAD_FIELDS,
  UPLOAD_QUERY,
  type DeleteLeaderboardClipResponse,
  type LeaderboardClipConfigResponse,
  type LeaderboardClipErrorCode,
  type LeaderboardClipErrorResponse,
  type MyLeaderboardClip,
  type ReportLeaderboardClipResponse,
  type UploadLeaderboardClipResponse,
} from "./contract";
import { legalHoldKey, posterKey, videoKey, type ClipBucket } from "./bucket";
import { isClipAdmin, type BucketSettings, type LeaderboardClipsConfig } from "./config";
import { isLeaderboardClipGame, normalizeRunScore } from "./games";
import { isClipId, newClipId } from "./ids";
import { inspectClipMp4 } from "./mp4";
import { cleanPoster } from "./poster";
import type { BoardSlot, ClipRow, ClipStore, ClipWithOwner } from "./store";

/**
 * The uploads that this server process reads at the same time. Each upload
 * holds its body in memory (up to 16 MiB, and about 55 MiB while the form
 * is parsed and checked), and accounts cost nothing to make, so a limit for
 * each account alone does not bound the memory of the server.
 */
export const MAX_UPLOADS_AT_ONCE = 3;
/**
 * The uploads that one network address (getClientIP) can run at the same
 * time. Without it, one client with a few free accounts holds every place
 * of the gate, and every other player gets server_busy.
 */
export const MAX_UPLOADS_PER_CLIENT = 1;
/** How long a player waits after "server_busy" before trying again. */
export const SERVER_BUSY_RETRY_SEC = 15;

/**
 * The places of the uploads that run in this process: MAX_UPLOADS_AT_ONCE
 * in all, MAX_UPLOADS_PER_CLIENT for each network address (the key of
 * tryEnter). runtime.ts keeps one gate for the process (processSingleton).
 */
export class UploadGate extends InFlightGate {
  constructor(limit: number = MAX_UPLOADS_AT_ONCE, perClient: number = MAX_UPLOADS_PER_CLIENT) {
    super(limit, perClient);
  }
}

export type ClipRequestMeta = { url: string; method: string; headers: Headers };
export type ClipBodyReader = () => Promise<BodyRead>;

export interface ClipDeps {
  /** The settings, read on each request (the kill switch works at the next request). */
  config: () => LeaderboardClipsConfig;
  store: ClipStore;
  bucket: (settings: BucketSettings) => ClipBucket;
  /** The signed-in user id, or null. */
  userId: () => Promise<string | null>;
  now: () => Date;
  clientIp: (meta: ClipRequestMeta) => string;
  /** The report limit for one network address. */
  reportLimit: (ip: string) => { success: boolean; resetIn: number };
  /** The uploads that run at the same time in this process (one gate for the process). */
  uploadGate: InFlightGate;
}

const NO_STORE = { "Cache-Control": "no-store" } as const;
const LOG = "[leaderboard-clips]";

const MESSAGES: Record<LeaderboardClipErrorCode, string> = {
  clips_off: "Leaderboard videos are off.",
  wrong_origin: "Wrong origin.",
  sign_in: "Please sign in.",
  too_big: "The upload is too big.",
  timeout: "The upload took too long.",
  daily_limit: "That is all the videos for today. Try again tomorrow.",
  busy: "Another video is still uploading.",
  server_busy: "The server is busy. Try again soon.",
  too_many_reports: "Too many reports. Try again later.",
  bad_form: "The upload form is not complete.",
  bad_game: "This game cannot put a video on the leaderboard.",
  no_board_entry: "You are not on this game's leaderboard yet.",
  bad_score: "The run score is not valid.",
  bad_video: "The video did not pass the checks.",
  bad_poster: "The picture did not pass the checks.",
  bad_request: "The request is not valid.",
  not_allowed: "That is not allowed.",
  not_found: "No such video.",
  storage_failed: "The video store did not answer. Try again.",
  server_error: "Something went wrong. Try again.",
};

function json<T>(body: T, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

function fail(
  status: number,
  code: LeaderboardClipErrorCode,
  options: { reason?: string; headers?: Record<string, string> } = {}
): Response {
  const body: LeaderboardClipErrorResponse = { error: MESSAGES[code], code };
  if (options.reason) body.reason = options.reason;
  return json(body, status, options.headers);
}

/** The clip as its owner sees it. */
export function myClipOf(row: ClipRow): MyLeaderboardClip {
  return {
    id: row.id,
    runScore: row.runScore,
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    status: row.status,
    hasAudio: row.hasAudio,
    createdAt: row.createdAt.toISOString(),
    hiddenAt: row.hiddenAt ? row.hiddenAt.toISOString() : null,
  };
}

/** Delete keys and never throw. Returns how many deletes failed. */
async function deleteQuietly(bucket: ClipBucket, keys: string[]): Promise<number> {
  const results = await Promise.allSettled(keys.map((key) => bucket.delete(key)));
  return results.filter((result) => result.status === "rejected").length;
}

/** True when the error is a foreign key violation (SQLSTATE 23503) anywhere on its cause chain. */
function isForeignKeyViolation(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; depth < 5 && e && typeof e === "object"; depth++) {
    if ((e as { code?: unknown }).code === "23503") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The multipart Content-Type that a browser sends for a FormData body:
 * "multipart/form-data; boundary=<token>", with no other parameter. The
 * boundary has the characters of RFC 2046 (no space, no quote).
 */
const BROWSER_MULTIPART_TYPE = /^multipart\/form-data;[ \t]*boundary=([0-9A-Za-z'()+_,\-./:=?]{1,70})$/i;

/**
 * The boundary of the upload, or null when the Content-Type is not the
 * shape that a browser sends. The form parser (undici, in formData()) reads
 * the Content-Type with the WHATWG MIME rules; Node's MIMEType uses the same
 * rules. The boundary must be the same with both readings, so the part
 * count below always counts the boundary that the parser splits on. Any
 * other shape (a quoted boundary, a second parameter, an escape) is refused.
 */
export function uploadBoundary(contentType: string): string | null {
  const simple = BROWSER_MULTIPART_TYPE.exec(contentType);
  if (!simple) return null;
  let parsed: MIMEType;
  try {
    parsed = new MIMEType(contentType);
  } catch {
    return null;
  }
  if (parsed.essence !== "multipart/form-data") return null;
  const boundary = parsed.params.get("boundary");
  return boundary === simple[1] ? boundary : null;
}

/**
 * How many times "--<boundary>" is in the body, counted up to `max + 1`. A
 * valid form has one for each part and the closing one. A body with many
 * tiny parts costs a lot of memory and time in formData(), so it is refused
 * before the parse. The count includes every match, also one with no CRLF
 * before it, so it is never lower than the number of parts that the parser
 * finds (each delimiter that the parser finds is one match).
 */
export function boundaryMarks(bytes: Uint8Array, boundary: string, max: number): number {
  const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mark = Buffer.from(`--${boundary}`, "latin1");
  let count = 0;
  for (let at = body.indexOf(mark); at !== -1 && count <= max; at = body.indexOf(mark, at + mark.length)) {
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// GET /api/leaderboard-clips
// ---------------------------------------------------------------------------

export function handleConfig(deps: Pick<ClipDeps, "config">): Response {
  const body: LeaderboardClipConfigResponse = {
    enabled: deps.config().enabled,
    limits: LEADERBOARD_CLIP_LIMITS,
    sizes: LEADERBOARD_CLIP_SIZES,
  };
  return json(body);
}

// ---------------------------------------------------------------------------
// POST /api/leaderboard-clips
// ---------------------------------------------------------------------------

interface UploadOutcome {
  response: Response;
  /** True: the upload counts toward the daily limit. False: it failed on our side. */
  counts: boolean;
}

export async function handleUpload(meta: ClipRequestMeta, readUpload: ClipBodyReader, deps: ClipDeps): Promise<Response> {
  // Order: the checks that need no body (the headers, the game in the URL),
  // then the account's slot (the daily limit and one at a time), then the
  // player's board row, then a place in this server's gate, then the body.
  // A refusal before the gate reads no body at all.
  if (!isSameOriginRequest(meta)) return fail(403, "wrong_origin");
  const config = deps.config();
  if (!config.enabled) return fail(503, "clips_off");
  const userId = await deps.userId();
  if (!userId) return fail(401, "sign_in");

  // A Content-Length over the limit, and the form type, are refused before
  // the body is read. The limit is counted again while the body arrives.
  const length = meta.headers.get("content-length");
  if (length !== null && !/^\d{1,12}$/.test(length)) return fail(400, "bad_form");
  if (length !== null && Number(length) > MAX_UPLOAD_REQUEST_BYTES) return fail(413, "too_big");
  const boundary = uploadBoundary(meta.headers.get("content-type") ?? "");
  if (!boundary) return fail(400, "bad_form");
  // The game is in the URL too, so the board row is checked before the body.
  const appId = new URL(meta.url).searchParams.get(UPLOAD_QUERY.appId);
  if (appId === null) return fail(400, "bad_form");
  if (!isLeaderboardClipGame(appId)) return fail(400, "bad_game");

  let slotId: string;
  try {
    const slot = await deps.store.claimUploadSlot(userId, deps.now());
    if (!slot.ok) {
      console.warn(`${LOG} upload refused: ${slot.code}`);
      return fail(429, slot.code, { headers: { "Retry-After": String(slot.retryAfterSec) } });
    }
    slotId = slot.slotId;
  } catch (error) {
    // The account of the session is gone (deleted while the session lives).
    if (isForeignKeyViolation(error)) return fail(401, "sign_in");
    console.error(`${LOG} upload slot failed:`, describeError(error));
    return fail(500, "server_error");
  }

  const client = deps.clientIp(meta);
  let counts = false;
  let entered = false;
  try {
    // The player must be on the game's board (spec section 1). The board row
    // also means the gaming profile exists: an upload never makes one. It is
    // checked before the gate, so an account with no board row never takes
    // a place and sends no body.
    let board: BoardSlot | null;
    try {
      board = await deps.store.boardSlot(userId, appId);
    } catch (error) {
      console.error(`${LOG} upload board lookup failed: game=${appId}`, describeError(error));
      return fail(500, "server_error");
    }
    if (!board) {
      console.warn(`${LOG} upload rejected: game=${appId} no_board_entry`);
      counts = true;
      return fail(409, "no_board_entry");
    }

    entered = deps.uploadGate.tryEnter(client);
    if (!entered) {
      // Not the player's fault: it does not count toward the daily limit.
      console.warn(
        `${LOG} upload refused: server_busy active=${deps.uploadGate.active} sameClient=${deps.uploadGate.activeFor(client)}`
      );
      return fail(503, "server_busy", { headers: { "Retry-After": String(SERVER_BUSY_RETRY_SEC) } });
    }
    const outcome = await storeUpload(readUpload, deps, config.bucket, { appId, boundary, board });
    counts = outcome.counts;
    return outcome.response;
  } catch (error) {
    console.error(`${LOG} upload failed:`, describeError(error));
    return fail(500, "server_error");
  } finally {
    if (entered) deps.uploadGate.leave(client);
    try {
      if (counts) await deps.store.finishUploadSlot(slotId, deps.now());
      else await deps.store.releaseUploadSlot(slotId);
    } catch (error) {
      // The slot goes stale after UPLOAD_STALE_MS, so the player is not locked out.
      console.error(`${LOG} upload slot end failed:`, describeError(error));
    }
  }
}

/** What handleUpload checked before the body. */
interface UploadTarget {
  /** A clip game (isLeaderboardClipGame passed). */
  appId: ValidAppId;
  boundary: string;
  board: BoardSlot;
}

async function storeUpload(
  readUpload: ClipBodyReader,
  deps: ClipDeps,
  settings: BucketSettings,
  { appId, boundary, board: slot }: UploadTarget
): Promise<UploadOutcome> {
  const rejected = (response: Response): UploadOutcome => ({ response, counts: true });
  const failed = (response: Response): UploadOutcome => ({ response, counts: false });

  const raw = await readUpload();
  if (!raw.ok) {
    if (raw.why === "too_big") return rejected(fail(413, "too_big"));
    if (raw.why === "timeout" || raw.why === "too_slow") {
      console.warn(`${LOG} upload refused: body ${raw.why}`);
      return rejected(fail(408, "timeout"));
    }
    return rejected(fail(400, "bad_form"));
  }
  const fieldCount = Object.keys(UPLOAD_FIELDS).length;
  if (boundaryMarks(raw.bytes, boundary, fieldCount + 1) > fieldCount + 1) return rejected(fail(400, "bad_form"));
  let form: FormData;
  try {
    // The parser gets the boundary that was checked and counted, never the client's header.
    const type = `multipart/form-data; boundary=${boundary}`;
    form = await new Response(raw.bytes as BodyInit, { headers: { "content-type": type } }).formData();
  } catch {
    return rejected(fail(400, "bad_form"));
  }
  const formAppId = form.get(UPLOAD_FIELDS.appId);
  const rawScore = form.get(UPLOAD_FIELDS.runScore);
  const video = form.get(UPLOAD_FIELDS.video);
  const poster = form.get(UPLOAD_FIELDS.poster);
  if (typeof formAppId !== "string" || typeof rawScore !== "string" || !(video instanceof Blob) || !(poster instanceof Blob)) {
    return rejected(fail(400, "bad_form"));
  }
  // The form names the same game as the URL (the board row was checked for that one).
  if (formAppId !== appId) return rejected(fail(400, "bad_form"));
  const runScore = normalizeRunScore(appId, rawScore);
  if (runScore === null) return rejected(fail(400, "bad_score"));
  if (video.size > LEADERBOARD_CLIP_LIMITS.maxVideoBytes || poster.size > LEADERBOARD_CLIP_LIMITS.maxPosterBytes) {
    return rejected(fail(413, "too_big"));
  }

  const videoBytes = new Uint8Array(await video.arrayBuffer());
  const mp4 = inspectClipMp4(videoBytes);
  if (!mp4.ok) {
    console.warn(`${LOG} upload rejected: game=${appId} video=${mp4.reason} bytes=${videoBytes.length}`);
    return rejected(fail(400, "bad_video", { reason: mp4.reason }));
  }
  const cleaned = cleanPoster(new Uint8Array(await poster.arrayBuffer()));
  if (!cleaned.ok) {
    console.warn(`${LOG} upload rejected: game=${appId} poster=${cleaned.reason} bytes=${poster.size}`);
    return rejected(fail(400, "bad_poster", { reason: cleaned.reason }));
  }

  // Every check passed. Store the objects, then the row.
  const bucket = deps.bucket(settings);
  const id = newClipId();
  const keys = [videoKey(id), posterKey(id)];
  const stored = await Promise.allSettled([
    bucket.put(keys[0], videoBytes, "video/mp4"),
    bucket.put(keys[1], cleaned.jpeg, "image/jpeg"),
  ]);
  const putError = stored.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (putError) {
    const cleanupFailures = await deleteQuietly(bucket, keys);
    console.error(
      `${LOG} upload store failed: game=${appId} cleanup failures=${cleanupFailures}`,
      describeError(putError.reason)
    );
    return failed(fail(502, "storage_failed"));
  }

  const createdAt = deps.now();
  const row = {
    id,
    gamingProfileId: slot.profileId,
    appId,
    runScore,
    durationMs: mp4.info.durationMs,
    width: mp4.info.width,
    height: mp4.info.height,
    bytes: mp4.info.bytes,
    hasAudio: mp4.info.hasAudio,
    status: "public" as const,
    createdAt,
    hiddenAt: null,
  };
  let replacedId: string | null;
  try {
    ({ replacedId } = await deps.store.replaceClip(row));
  } catch (error) {
    // An error does not prove that the transaction did not commit (the
    // connection can drop after COMMIT and before its answer). Ask the
    // database: never delete the objects of a row that exists.
    const outcome = await afterReplaceError(deps, id, slot.currentClipId);
    if (outcome.committed === true) {
      replacedId = outcome.replacedId;
      console.warn(`${LOG} upload row error after commit: game=${appId} kept`, describeError(error));
    } else {
      // committed false: no row, so delete the objects now. Unknown: keep
      // them; with no row they are orphans, and the sweeper deletes them.
      const cleanupFailures = outcome.committed === false ? await deleteQuietly(bucket, keys) : 0;
      console.error(
        `${LOG} upload row failed: game=${appId} committed=${outcome.committed === false ? "no" : "unknown"} ` +
          `cleanup failures=${cleanupFailures}`,
        describeError(error)
      );
      return failed(fail(500, "server_error"));
    }
  }

  if (replacedId) {
    const oldFailures = await deleteQuietly(bucket, [videoKey(replacedId), posterKey(replacedId)]);
    // The sweeper deletes what is left (no row points at it any more).
    if (oldFailures > 0) console.warn(`${LOG} old clip objects not deleted: game=${appId} failures=${oldFailures}`);
  }
  console.log(
    `${LOG} upload stored: game=${appId} bytes=${mp4.info.bytes} durationMs=${mp4.info.durationMs} ` +
      `size=${mp4.info.width}x${mp4.info.height} audio=${mp4.info.hasAudio} replaced=${replacedId !== null}`
  );
  const body: UploadLeaderboardClipResponse = {
    clip: { ...myClipOf(row), status: "public" },
    replaced: replacedId !== null,
  };
  return { response: json(body, 201), counts: true };
}

/**
 * After replaceClip threw: did its transaction commit? Reads the database.
 * committed: true (the new row is there), false (it is not), or null (the
 * read failed too). replacedId is the old clip when the new row is there
 * and the old row is gone (the same transaction deleted it).
 */
async function afterReplaceError(
  deps: ClipDeps,
  id: string,
  currentClipId: string | null
): Promise<{ committed: boolean | null; replacedId: string | null }> {
  try {
    const existing = await deps.store.existingClipIds(currentClipId ? [id, currentClipId] : [id]);
    if (!existing.has(id)) return { committed: false, replacedId: null };
    return { committed: true, replacedId: currentClipId && !existing.has(currentClipId) ? currentClipId : null };
  } catch (error) {
    console.error(`${LOG} upload row check failed:`, describeError(error));
    return { committed: null, replacedId: null };
  }
}

// ---------------------------------------------------------------------------
// GET /api/leaderboard-clips/[id]/video and /poster
// ---------------------------------------------------------------------------

/**
 * True when anybody may see the clip: public, of a player who shows on the
 * leaderboards and has a row on the game's board (where a viewer can see
 * the clip, and report it).
 */
function visibleToAll(found: ClipWithOwner): boolean {
  return found.clip.status === "public" && found.showOnLeaderboards && found.onBoard;
}

export async function handleMedia(
  id: string,
  kind: "video" | "poster",
  deps: ClipDeps
): Promise<Response> {
  const config = deps.config();
  if (!config.enabled) return fail(503, "clips_off");
  if (!isClipId(id)) return fail(404, "not_found");
  let found: ClipWithOwner | null;
  try {
    found = await deps.store.findClip(id);
  } catch (error) {
    console.error(`${LOG} ${kind} lookup failed:`, describeError(error));
    return fail(500, "server_error");
  }
  if (!found) return fail(404, "not_found");
  if (!visibleToAll(found)) {
    // Only the owner sees a clip that is not on the leaderboard. An admin
    // (ADMIN_USER_IDS) can only delete any clip (D8), so an admin gets the
    // same 404 as everybody else here.
    const userId = await deps.userId();
    if (!userId || userId !== found.ownerUserId) return fail(404, "not_found");
  }
  let location: string;
  try {
    const key = kind === "video" ? videoKey(found.clip.id) : posterKey(found.clip.id);
    location = await deps.bucket(config.bucket).signedGetUrl(key, LEADERBOARD_CLIP_LIMITS.signedLinkSeconds);
  } catch (error) {
    console.error(`${LOG} ${kind} link failed: game=${found.clip.appId}`, describeError(error));
    return fail(502, "storage_failed");
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      // A hidden clip answers only its owner, so the answer depends on the cookie.
      // (The site-wide Referrer-Policy, strict-origin-when-cross-origin, sends
      // the bucket only this site's origin.)
      "Cache-Control": "private, max-age=60",
      Vary: "Cookie",
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/leaderboard-clips/[id]/report
// ---------------------------------------------------------------------------

export async function handleReport(meta: ClipRequestMeta, id: string, deps: ClipDeps): Promise<Response> {
  if (!isSameOriginRequest(meta)) return fail(403, "wrong_origin");
  if (!deps.config().enabled) return fail(503, "clips_off");
  const limit = deps.reportLimit(deps.clientIp(meta));
  if (!limit.success) {
    console.warn(`${LOG} report refused: too many reports`);
    return fail(429, "too_many_reports", { headers: { "Retry-After": String(limit.resetIn) } });
  }
  if (!isClipId(id)) return fail(404, "not_found");
  try {
    const { result, appId } = await deps.store.hideClip(id, deps.now());
    if (result === "missing") return fail(404, "not_found");
    if (result === "hidden") console.log(`${LOG} report hid a clip: game=${appId}`);
    const body: ReportLeaderboardClipResponse = { hidden: true };
    return json(body);
  } catch (error) {
    console.error(`${LOG} report failed:`, describeError(error));
    return fail(500, "server_error");
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/leaderboard-clips/[id]
// ---------------------------------------------------------------------------

async function readDeleteBody(meta: ClipRequestMeta, readDelete: ClipBodyReader): Promise<{ keepForLegalReport: boolean } | null> {
  const length = meta.headers.get("content-length");
  if (length && !/^\d{1,12}$/.test(length)) return null;
  // Counted while it arrives: a chunked body with no Content-Length stops at the limit.
  const raw = await readDelete();
  if (!raw.ok) return null;
  const text = new TextDecoder().decode(raw.bytes);
  if (text.trim() === "") return { keepForLegalReport: false };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.some((key) => key !== "keepForLegalReport")) return null;
  const keep = (body as { keepForLegalReport?: unknown }).keepForLegalReport;
  if (keep !== undefined && typeof keep !== "boolean") return null;
  return { keepForLegalReport: keep === true };
}

/**
 * The legal hold (section 7): copy the video and the poster to legal-hold/
 * and write what a report to NCMEC needs (18 U.S.C. 2258A: the account and
 * the time). The prefix has no public link; the sweeper never touches it.
 * The objects stay until a grown-up deletes them by hand, after the law's
 * one-year hold.
 */
async function keepForLegalReport(bucket: ClipBucket, found: ClipWithOwner, now: Date): Promise<void> {
  const { clip } = found;
  await bucket.copy(videoKey(clip.id), legalHoldKey(clip.id, "mp4"));
  await bucket.copy(posterKey(clip.id), legalHoldKey(clip.id, "jpg"));
  const record = {
    clipId: clip.id,
    appId: clip.appId,
    userId: found.ownerUserId,
    gamingProfileId: clip.gamingProfileId,
    runScore: clip.runScore,
    durationMs: clip.durationMs,
    width: clip.width,
    height: clip.height,
    bytes: clip.bytes,
    hasAudio: clip.hasAudio,
    status: clip.status,
    createdAt: clip.createdAt.toISOString(),
    hiddenAt: clip.hiddenAt ? clip.hiddenAt.toISOString() : null,
    keptAt: now.toISOString(),
  };
  await bucket.put(legalHoldKey(clip.id, "json"), new TextEncoder().encode(JSON.stringify(record, null, 2)), "application/json");
}

export async function handleDelete(meta: ClipRequestMeta, readDelete: ClipBodyReader, id: string, deps: ClipDeps): Promise<Response> {
  if (!isSameOriginRequest(meta)) return fail(403, "wrong_origin");
  // Deleting works while the kill switch is on: a player (or a parent) can
  // always take a video off. It needs only valid bucket settings.
  const config = deps.config();
  if (!config.bucket) return fail(503, "clips_off");
  const userId = await deps.userId();
  if (!userId) return fail(401, "sign_in");
  const body = await readDeleteBody(meta, readDelete).catch(() => null);
  if (!body) return fail(400, "bad_request");
  if (!isClipId(id)) return fail(404, "not_found");

  let found: ClipWithOwner | null;
  try {
    found = await deps.store.findClip(id);
  } catch (error) {
    console.error(`${LOG} delete lookup failed:`, describeError(error));
    return fail(500, "server_error");
  }
  if (!found) return fail(404, "not_found");
  const admin = isClipAdmin(config, userId);
  const owner = found.ownerUserId === userId;
  if (!owner && !admin) return visibleToAll(found) ? fail(403, "not_allowed") : fail(404, "not_found");
  if (body.keepForLegalReport && !admin) return fail(403, "not_allowed");

  const bucket = deps.bucket(config.bucket);
  if (body.keepForLegalReport) {
    try {
      await keepForLegalReport(bucket, found, deps.now());
    } catch (error) {
      // Nothing is deleted when the copy fails.
      console.error(`${LOG} legal hold failed: game=${found.clip.appId}`, describeError(error));
      return fail(502, "storage_failed");
    }
  }
  try {
    await deps.store.deleteClip(found.clip.id);
  } catch (error) {
    console.error(`${LOG} delete row failed: game=${found.clip.appId}`, describeError(error));
    return fail(500, "server_error");
  }
  // The row is gone, so no link can point at the objects; a failed delete
  // leaves an orphan that the sweeper deletes.
  const failures = await deleteQuietly(bucket, [videoKey(found.clip.id), posterKey(found.clip.id)]);
  console.log(
    `${LOG} clip deleted: game=${found.clip.appId} by=${owner ? "owner" : "admin"} ` +
      `legalHold=${body.keepForLegalReport} objectFailures=${failures}`
  );
  const response: DeleteLeaderboardClipResponse = { deleted: true, keptForLegalReport: body.keepForLegalReport };
  return json(response);
}
