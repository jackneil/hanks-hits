/**
 * Requests for the leaderboard clip handler tests, built the way a browser
 * sends them: a multipart body with its Content-Length, and the
 * Sec-Fetch-Site header of a page on this site.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { LEADERBOARD_CLIPS_API, UPLOAD_FIELDS } from "../contract";

export const FIXTURES = path.join(__dirname, "fixtures");
export const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

/** A real iPhone SE clip (2 s, 1280x720, AAC), muxed by the clip engine. */
export const GOOD_VIDEO = fixture("real-1280x720.mp4");
/** ffmpeg's output: it always writes a udta/meta box, so the check rejects it. */
export const UDTA_VIDEO = fixture("ffmpeg-faststart-udta.mp4");
/** ffmpeg's JPEG, which has a COM segment that the server must remove. */
export const POSTER_WITH_COMMENT = fixture("poster-ffmpeg-com.jpg");

export const SITE = "https://hankshits.com";
/** The headers of a fetch() from a page of this site. */
export const SAME_SITE = { "sec-fetch-site": "same-origin", origin: SITE, host: "hankshits.com" } as const;
/** The headers of a fetch() from another site. */
export const OTHER_SITE = { "sec-fetch-site": "cross-site", origin: "https://evil.example", host: "hankshits.com" } as const;

export interface UploadParts {
  video?: Uint8Array | string | null;
  poster?: Uint8Array | string | null;
  appId?: string | null;
  runScore?: string | null;
  headers?: Record<string, string>;
  /** Leave out the Content-Length header. */
  noLength?: boolean;
  /** Send this Content-Length instead of the real one. */
  length?: string;
  /**
   * The game in the URL (?appId=). Not set: the form's game, or "asteroids"
   * when the form has none. Null: no appId in the URL.
   */
  queryAppId?: string | null;
}

/** The upload URL for a game (LEADERBOARD_CLIPS_API.upload); null: no ?appId=. */
export function uploadUrl(appId: string | null = "asteroids", base = SITE): URL {
  return new URL(appId === null ? "/api/leaderboard-clips" : LEADERBOARD_CLIPS_API.upload(appId), base);
}

/** A multipart upload request, as a browser sends it (with Content-Length). */
export async function uploadRequest(parts: UploadParts = {}, base = SITE): Promise<Request> {
  const form = new FormData();
  const video = parts.video === undefined ? GOOD_VIDEO : parts.video;
  const poster = parts.poster === undefined ? POSTER_WITH_COMMENT : parts.poster;
  if (typeof video === "string") form.append(UPLOAD_FIELDS.video, video);
  else if (video) form.append(UPLOAD_FIELDS.video, new Blob([video as BlobPart], { type: "video/mp4" }), "clip.mp4");
  if (typeof poster === "string") form.append(UPLOAD_FIELDS.poster, poster);
  else if (poster) form.append(UPLOAD_FIELDS.poster, new Blob([poster as BlobPart], { type: "image/jpeg" }), "poster.jpg");
  if (parts.appId !== null) form.append(UPLOAD_FIELDS.appId, parts.appId ?? "asteroids");
  if (parts.runScore !== null) form.append(UPLOAD_FIELDS.runScore, parts.runScore ?? "1790");
  // Serialize the form the way fetch() does, to know the length and the boundary.
  const encoded = new Response(form);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const headers: Record<string, string> = {
    ...SAME_SITE,
    "content-type": encoded.headers.get("content-type")!,
    ...(parts.noLength ? {} : { "content-length": parts.length ?? String(body.length) }),
    ...parts.headers,
  };
  const queryAppId = parts.queryAppId === undefined ? (parts.appId ?? "asteroids") : parts.queryAppId;
  return new Request(uploadUrl(queryAppId, base), { method: "POST", headers, body });
}

export function reportRequest(id: string, headers: Record<string, string> = SAME_SITE, base = SITE): Request {
  return new Request(new URL(LEADERBOARD_CLIPS_API.report(id), base), { method: "POST", headers });
}

export function deleteRequest(
  id: string,
  body?: unknown,
  headers: Record<string, string> = SAME_SITE,
  base = SITE
): Request {
  const text = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  return new Request(new URL(LEADERBOARD_CLIPS_API.remove(id), base), {
    method: "DELETE",
    headers: text === undefined ? headers : { ...headers, "content-type": "application/json" },
    body: text,
  });
}
