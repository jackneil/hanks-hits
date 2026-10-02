/**
 * Leaderboard clips: the API contract (design/LEADERBOARD_CLIPS.html).
 *
 * This module is the single source of the routes, limits, request fields,
 * response shapes and error codes. The server routes and the kid UI (PR B)
 * import it. It has no imports and no server code, so it is safe in a
 * browser bundle.
 *
 * Routes (every state change needs a same-origin request, see
 * src/lib/same-origin.ts):
 * - GET    /api/leaderboard-clips              -> 200 LeaderboardClipConfigResponse
 * - POST   /api/leaderboard-clips?appId=<game> multipart (UPLOAD_FIELDS)
 *                                              -> 201 UploadLeaderboardClipResponse
 * - GET    /api/leaderboard-clips/[id]/video   -> 302 to a signed bucket link (10 minutes)
 * - GET    /api/leaderboard-clips/[id]/poster  -> 302 to a signed bucket link (10 minutes)
 * - POST   /api/leaderboard-clips/[id]/report  -> 200 ReportLeaderboardClipResponse
 * - DELETE /api/leaderboard-clips/[id]         optional JSON body DeleteLeaderboardClipRequest
 *                                              -> 200 DeleteLeaderboardClipResponse
 * - GET    /api/leaderboards/[appId]           -> 200 LeaderboardApiResponse
 *                                              (entry.clip, myEntry.clip, myEntry.clipStatus,
 *                                              myClip)
 *
 * Who can do what:
 * - Upload: a signed-in player who has a row on the game's leaderboard
 *   (spec section 1: "A player who is on a leaderboard can attach a video").
 *   With no row the answer is 409 no_board_entry, before the server reads
 *   the body (the game is in the URL: LEADERBOARD_CLIPS_API.upload). The
 *   board row comes from the progress sync, so the kid UI saves the
 *   progress (and waits for the answer) before it uploads. One clip for each player and game; the
 *   newest upload replaces the old one (D2). The clip is public at once (D3).
 * - Video and poster: anybody for a public clip of a player who shows on
 *   the leaderboards and still has a row on the game's board (so every
 *   clip that anybody can watch is on a board, where a viewer can report
 *   it); the owner also for their own clip that does not show (a report
 *   hid it, the player hides from the leaderboards, or the row is gone).
 *   Anything else is 404, also for an admin.
 * - The kill switch (LEADERBOARD_CLIPS=off) turns off the upload, the video,
 *   the poster and the report (503 clips_off), and every entry's clip is
 *   null. Delete still works, so a player can always take a video off: for
 *   that, myClip (and myEntry) still give the player their OWN clip while
 *   the bucket settings are valid. Show a player for it only when GET
 *   /api/leaderboard-clips says enabled; else show only "Take my video off".
 * - Report: anybody, rate limited by network address. The clip is hidden at
 *   once (D8). A second report of a hidden clip is also 200.
 * - Delete: the owner, or an admin (ADMIN_USER_IDS, optional; it gives
 *   the power to delete any clip and nothing more). Only an admin can set
 *   keepForLegalReport (section 7).
 *
 * The kid UI shows the upload button only when GET /api/leaderboard-clips
 * says enabled, the game clip is an MP4 (a WebM clip from a tier V browser
 * fails the check: bad_video/not_mp4), the player is signed in, and the game
 * has a board. The player's own clip (with its status) is in
 * LeaderboardApiResponse.myClip for any period, also when the player has no
 * row in that period: the "Take my video off" button and the "Your video
 * was hidden" note read it from there.
 *
 * The signed link in the 302 works for 10 minutes. A player that is paused
 * for longer and then seeks gets an error from the bucket: load the route
 * URL again (it is a new link each time).
 *
 * Every error is JSON: LeaderboardClipErrorResponse. Show the kid a message
 * that you choose from `code`; the `error` text is for grown-ups and logs.
 */

/** The paths of the routes. */
export const LEADERBOARD_CLIPS_API = {
  config: "/api/leaderboard-clips",
  /**
   * The game is in the URL as well as in the form (the two must be the
   * same), so the server checks the player's board row before it reads the
   * body: a player who is not on the board sends no video for nothing.
   */
  upload: (appId: string) => `/api/leaderboard-clips?${UPLOAD_QUERY.appId}=${encodeURIComponent(appId)}`,
  video: (id: string) => `/api/leaderboard-clips/${encodeURIComponent(id)}/video`,
  poster: (id: string) => `/api/leaderboard-clips/${encodeURIComponent(id)}/poster`,
  report: (id: string) => `/api/leaderboard-clips/${encodeURIComponent(id)}/report`,
  remove: (id: string) => `/api/leaderboard-clips/${encodeURIComponent(id)}`,
} as const;

/** A clip id: 24 random URL-safe characters. */
export const CLIP_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;

/** A frame size that the clip engine can make (src/shared/clips/runtime). */
export interface ClipFrameSize {
  width: number;
  height: number;
}

/**
 * The frame sizes the server accepts: exactly the sizes the clip engine can
 * make. PRESETS (protocol.ts, the hardware encoder and MediaRecorder MP4) and
 * SOFTWARE_PRESETS (capabilities.ts, the software encoder), in landscape and
 * portrait. A tall picture on an encoder with no portrait support is
 * letterboxed into a wide frame (engineHost.ts), so it has a landscape
 * size, never a rotation. A test keeps this list equal to the engine's
 * presets.
 */
export const LEADERBOARD_CLIP_SIZES: readonly ClipFrameSize[] = [
  { width: 1280, height: 720 },
  { width: 720, height: 1280 },
  { width: 960, height: 544 },
  { width: 544, height: 960 },
];

export const LEADERBOARD_CLIP_LIMITS = {
  /** The largest video, in bytes (16 MiB). */
  maxVideoBytes: 16 * 1024 * 1024,
  /** The largest poster JPEG, in bytes (64 KiB). */
  maxPosterBytes: 64 * 1024,
  /** Room for the multipart boundaries, headers and the two text fields. */
  maxFormOverheadBytes: 16 * 1024,
  /** The largest width or height of a poster, in pixels. */
  maxPosterSide: 1280,
  /** The shortest video, in milliseconds. */
  minDurationMs: 1_000,
  /** The longest video, in milliseconds (a 60 s ring plus one second of slack). */
  maxDurationMs: 61_000,
  /** Uploads that one account can start in 24 hours. */
  uploadsPerDay: 10,
  /** Uploads that one account can run at the same time. */
  uploadsAtOnce: 1,
  /** How long a signed video or poster link works, in seconds. */
  signedLinkSeconds: 600,
  /** Reports that one network address can send in one hour. */
  reportsPerHour: 20,
} as const;

/** The largest request body of an upload: video, poster and form overhead. */
export const MAX_UPLOAD_REQUEST_BYTES =
  LEADERBOARD_CLIP_LIMITS.maxVideoBytes +
  LEADERBOARD_CLIP_LIMITS.maxPosterBytes +
  LEADERBOARD_CLIP_LIMITS.maxFormOverheadBytes;

/** The query parameter of POST /api/leaderboard-clips (LEADERBOARD_CLIPS_API.upload). */
export const UPLOAD_QUERY = {
  /** The game id. It must be the same as the form's appId field. */
  appId: "appId",
} as const;

/**
 * The multipart field names of POST /api/leaderboard-clips. Send the form as
 * fetch() sends a FormData body: Content-Type
 * "multipart/form-data; boundary=<token>" and nothing more. Any other shape
 * of the Content-Type is bad_form.
 */
export const UPLOAD_FIELDS = {
  /** The MP4 (File or Blob, type video/mp4), at most maxVideoBytes. */
  video: "video",
  /** The poster JPEG (File or Blob, type image/jpeg), at most maxPosterBytes. */
  poster: "poster",
  /** The game id, for example "asteroids". */
  appId: "appId",
  /** The run's own score as the game reported it (a decimal number, for example "1790" or "523.7"). */
  runScore: "runScore",
} as const;

/** GET /api/leaderboard-clips. `enabled` is false when the bucket is not set up or the kill switch is on. */
export interface LeaderboardClipConfigResponse {
  enabled: boolean;
  limits: typeof LEADERBOARD_CLIP_LIMITS;
  sizes: readonly ClipFrameSize[];
}

/** What the leaderboard shows for a public clip. */
export interface LeaderboardClipSummary {
  id: string;
  /** The run's own score (not the board score). */
  runScore: number;
  durationMs: number;
  width: number;
  height: number;
}

/** "none": the player has no clip for this game (or clips are off). */
export type LeaderboardClipStatus = "none" | "public" | "hidden";

/** The player's own clip, in myEntry (public, or hidden by a report). */
export interface MyLeaderboardClip extends LeaderboardClipSummary {
  status: "public" | "hidden";
  hasAudio: boolean;
  /** ISO time of the upload. */
  createdAt: string;
  /** ISO time a report hid the clip, or null. */
  hiddenAt: string | null;
}

/** POST /api/leaderboard-clips, status 201. */
export interface UploadLeaderboardClipResponse {
  clip: MyLeaderboardClip & { status: "public" };
  /** True when this upload replaced the player's older clip for the game. */
  replaced: boolean;
}

/** POST /api/leaderboard-clips/[id]/report. */
export interface ReportLeaderboardClipResponse {
  hidden: true;
}

/** DELETE /api/leaderboard-clips/[id]: the optional JSON body. Only an admin may set keepForLegalReport. */
export interface DeleteLeaderboardClipRequest {
  keepForLegalReport?: boolean;
}

/** DELETE /api/leaderboard-clips/[id]. */
export interface DeleteLeaderboardClipResponse {
  deleted: true;
  keptForLegalReport: boolean;
}

/** The machine codes of every error response. */
export type LeaderboardClipErrorCode =
  /** 503: the feature is not set up, or LEADERBOARD_CLIPS=off. */
  | "clips_off"
  /** 403: the request did not come from this site. */
  | "wrong_origin"
  /** 401: the player must sign in. */
  | "sign_in"
  /** 413: the upload, the video or the poster is larger than the limits. */
  | "too_big"
  /** 408: the upload body did not arrive in time. */
  | "timeout"
  /** 429: 10 uploads in 24 hours (Retry-After: seconds). */
  | "daily_limit"
  /** 429: another upload of this account is still running (Retry-After: seconds). */
  | "busy"
  /** 503: the server takes only a few uploads at the same time (Retry-After: seconds). It does not count toward the daily limit. */
  | "server_busy"
  /** 429: too many reports from this network (Retry-After: seconds). */
  | "too_many_reports"
  /** 400: the form is not multipart, or a field is missing. */
  | "bad_form"
  /** 400: the game has no clips or no leaderboard. */
  | "bad_game"
  /** 409: the player has no row on the game's leaderboard yet. Save the progress, then try again. */
  | "no_board_entry"
  /** 400: the run score is not a number from 0 to the game's limit. */
  | "bad_score"
  /** 400: the video failed the MP4 checks (reason: Mp4RejectReason). */
  | "bad_video"
  /** 400: the poster is not a small complete JPEG (reason: PosterRejectReason). */
  | "bad_poster"
  /** 400: the DELETE body is not valid JSON of the right shape. */
  | "bad_request"
  /** 403: the clip is not the player's own, or keepForLegalReport without admin. */
  | "not_allowed"
  /** 404: no such clip, or not visible to this viewer. */
  | "not_found"
  /** 502: the bucket did not answer. Try again. */
  | "storage_failed"
  /** 500: something else failed. Try again. */
  | "server_error";

export interface LeaderboardClipErrorResponse {
  error: string;
  code: LeaderboardClipErrorCode;
  /** For bad_video and bad_poster: which check failed (values-free). */
  reason?: string;
}

// ---------------------------------------------------------------------------
// GET /api/leaderboards/[appId]. The clip fields are new; every older field
// is the same, so an older client keeps working.
// ---------------------------------------------------------------------------

export interface LeaderboardApiEntry {
  rank: number;
  handle: string;
  score: number;
  additionalStats: unknown;
  achievedAt: string | null;
  /** The public clip of this entry, or null. Always null when clips are off. */
  clip: LeaderboardClipSummary | null;
}

/** The player's own clip for the game. */
export interface LeaderboardApiMyClip {
  /**
   * "none" when the player has no clip for the game, or when the bucket is
   * not set up. While the kill switch is on, the player still sees their
   * own clip here (so they can delete it).
   */
  clipStatus: LeaderboardClipStatus;
  /** The player's own clip (also when a report hid it), or null. */
  clip: MyLeaderboardClip | null;
}

export interface LeaderboardApiMyEntry extends LeaderboardApiMyClip {
  rank: number;
  handle: string;
  score: number;
}

export interface LeaderboardApiResponse {
  leaderboard: LeaderboardApiEntry[];
  /** The player's row in this period, or null (also when the player has a clip but no row in the period). */
  myEntry: LeaderboardApiMyEntry | null;
  /**
   * The player's own clip for the game, for every period and also when
   * myEntry is null. Null only when nobody is signed in or includeMe is
   * not true.
   */
  myClip: LeaderboardApiMyClip | null;
  totalPlayers: number;
  period: "all" | "week" | "month";
  scoreType: "high_score" | "wins" | "fastest_time";
}
