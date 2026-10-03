/**
 * Shared game videos: one current video per player and game. Any signed-in
 * player can publish a run, including a first run without a score-board row.
 * Public runs are discoverable via GET ?appId=; hidden/private profiles are
 * visible only to their owner. Numeric boards also attach matching clips.
 * POST and DELETE require x-hh-expected-owner matching the current session.
 * Disabled deployments serve no public media or uploads; owner removal works.
 */

/** The paths of the routes. */
export const LEADERBOARD_CLIPS_API = {
  config: "/api/leaderboard-clips",
  /** The game is checked before reading a potentially large multipart body. */
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
  /** Optional run score reported by the game. Omit unknown scores; never invent zero. */
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
  /** The run's own score, or null when the game/run has no numeric score. */
  runScore: number | null;
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
  /** Whether the publisher currently allows their runs in public listings. */
  publicListing: boolean;
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
  /** 409: the active account differs from the account that opened the action. */
  | "owner_changed"
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
  /** 400: not a supported recording game. */
  | "bad_game"
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

/** A bounded newest-first list of public runs, independent of score rankings. */
export interface SharedGameRunsResponse {
  enabled: boolean;
  runs: { handle: string; clip: LeaderboardClipSummary }[];
  myClip: LeaderboardApiMyClip | null;
}
