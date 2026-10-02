/**
 * Leaderboard clips settings (design/LEADERBOARD_CLIPS.html, D6 and D8).
 *
 * The feature is OFF unless it is set up: all four bucket settings must be
 * present and valid. LEADERBOARD_CLIPS=off is the kill switch. A kid clone
 * that is put online with no bucket shows no upload button and no player.
 *
 * Variables (each is in .railway/railway.ts with preserve()):
 * - LEADERBOARD_CLIPS: "off" turns the feature off. Empty or "on" leaves it
 *   on when the bucket is set up. Any other value turns it off (fail closed).
 * - LEADERBOARD_CLIPS_S3_ENDPOINT: the S3 endpoint, for example
 *   https://t3.storageapi.dev (http only for a server on this computer).
 * - LEADERBOARD_CLIPS_S3_BUCKET: the bucket name.
 * - LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID, LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY.
 * - LEADERBOARD_CLIPS_S3_REGION: optional, default "auto".
 * - LEADERBOARD_CLIPS_S3_URL_STYLE: optional, "path" (default) or "virtual".
 *   Path style (https://t3.storageapi.dev/<bucket>/<key>) works on Railway
 *   buckets: on 2026-10-02 the ROM bucket of the same storage project
 *   (made 2026-09-04) served a path-style signed link (HTTP 206). It keeps
 *   every link on one host (the CSP lists it exactly), works with a bucket
 *   name that has a dot, and works with a local MinIO. Railway's docs call
 *   virtual-hosted style the standard (https://<bucket>.t3.storageapi.dev,
 *   docs.railway.com/storage-buckets#url-style), so "virtual" is here for
 *   a bucket whose Credentials tab asks for it. The CSP allows both.
 * - ADMIN_USER_IDS: optional. User ids (comma or space separated) that can
 *   remove any clip, for an emergency only.
 *
 * Logs name a setting, never its value.
 */
import { processSingleton } from "../in-flight";
import { clipMediaSources, endpointOrigin, sourcesAllow } from "./csp";

export type BucketUrlStyle = "virtual" | "path";

export interface BucketSettings {
  /** The endpoint origin, for example https://t3.storageapi.dev. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  urlStyle: BucketUrlStyle;
}

/** The raw settings. Tests build this object; production reads the environment (readLeaderboardClipsEnv). */
export interface LeaderboardClipsEnv {
  LEADERBOARD_CLIPS?: string;
  LEADERBOARD_CLIPS_S3_ENDPOINT?: string;
  LEADERBOARD_CLIPS_S3_BUCKET?: string;
  LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID?: string;
  LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY?: string;
  LEADERBOARD_CLIPS_S3_REGION?: string;
  LEADERBOARD_CLIPS_S3_URL_STYLE?: string;
  ADMIN_USER_IDS?: string;
  /**
   * The media sources that the build put in the CSP header (next.config.ts
   * inlines this value at build time). Undefined outside a Next.js build
   * (tests): then the sources are computed from the endpoint here.
   */
  LEADERBOARD_CLIPS_CSP_MEDIA_SOURCES?: string;
}

/** Why the feature is off. Values-free. */
export type ClipsOffReason =
  /** No bucket setting is present (a kid clone, or not set up yet). */
  | "not_set_up"
  /** Some bucket settings are present and some are missing or not valid. */
  | "incomplete"
  /** LEADERBOARD_CLIPS is "off" or an unknown value. */
  | "killed"
  /** The bucket host is not in the CSP that the build made. */
  | "csp";

export type LeaderboardClipsConfig =
  | { enabled: true; bucket: BucketSettings; adminUserIds: ReadonlySet<string> }
  | {
      enabled: false;
      reason: ClipsOffReason;
      /** The bucket, when its settings are valid (the sweeper still needs it). */
      bucket: BucketSettings | null;
      adminUserIds: ReadonlySet<string>;
      /** For "incomplete": the names of the settings that are missing or not valid. */
      problems?: string[];
    };

/** The ids in ADMIN_USER_IDS (comma or white space separated). */
export function parseAdminUserIds(raw: string | undefined): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const part of (raw ?? "").split(/[\s,]+/)) if (part) ids.add(part);
  return ids;
}

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION = /^[a-z0-9-]{1,32}$/;

/** The origin that object links have: the endpoint (path style) or <bucket>.<endpoint host> (virtual-hosted style). */
export function objectOrigin(settings: BucketSettings): string {
  if (settings.urlStyle === "path") return settings.endpoint;
  const url = new URL(settings.endpoint);
  url.hostname = `${settings.bucket}.${url.hostname}`;
  return url.origin;
}

/** Resolve the settings. Pure: tests pass an object. */
export function resolveLeaderboardClipsConfig(env: LeaderboardClipsEnv): LeaderboardClipsConfig {
  const adminUserIds = parseAdminUserIds(env.ADMIN_USER_IDS);
  const raw = {
    endpoint: (env.LEADERBOARD_CLIPS_S3_ENDPOINT ?? "").trim(),
    bucket: (env.LEADERBOARD_CLIPS_S3_BUCKET ?? "").trim(),
    accessKeyId: (env.LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID ?? "").trim(),
    secretAccessKey: (env.LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY ?? "").trim(),
  };
  const region = (env.LEADERBOARD_CLIPS_S3_REGION ?? "").trim() || "auto";
  const style = (env.LEADERBOARD_CLIPS_S3_URL_STYLE ?? "").trim().toLowerCase() || "path";

  const anySet = Object.values(raw).some(Boolean);
  if (!anySet) return { enabled: false, reason: "not_set_up", bucket: null, adminUserIds };

  const problems: string[] = [];
  const endpoint = endpointOrigin(raw.endpoint);
  if (!endpoint) problems.push("LEADERBOARD_CLIPS_S3_ENDPOINT");
  if (!BUCKET_NAME.test(raw.bucket)) problems.push("LEADERBOARD_CLIPS_S3_BUCKET");
  if (!raw.accessKeyId) problems.push("LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID");
  if (!raw.secretAccessKey) problems.push("LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY");
  if (!REGION.test(region)) problems.push("LEADERBOARD_CLIPS_S3_REGION");
  if (style !== "virtual" && style !== "path") problems.push("LEADERBOARD_CLIPS_S3_URL_STYLE");
  else if (style === "virtual" && raw.bucket.includes(".")) problems.push("LEADERBOARD_CLIPS_S3_URL_STYLE");
  if (problems.length > 0 || !endpoint) {
    return { enabled: false, reason: "incomplete", bucket: null, adminUserIds, problems };
  }

  const bucket: BucketSettings = {
    endpoint,
    bucket: raw.bucket,
    accessKeyId: raw.accessKeyId,
    secretAccessKey: raw.secretAccessKey,
    region,
    urlStyle: style as BucketUrlStyle,
  };

  const kill = (env.LEADERBOARD_CLIPS ?? "").trim().toLowerCase();
  if (kill !== "" && kill !== "on") return { enabled: false, reason: "killed", bucket, adminUserIds };

  const built = env.LEADERBOARD_CLIPS_CSP_MEDIA_SOURCES;
  const sources = built === undefined ? clipMediaSources(endpoint) : built.split(/\s+/).filter(Boolean);
  if (!sourcesAllow(sources, objectOrigin(bucket))) {
    return { enabled: false, reason: "csp", bucket, adminUserIds };
  }
  return { enabled: true, bucket, adminUserIds };
}

/**
 * Read the settings from the environment. Every name is read with a plain
 * dot read of its own name, so platform-config.test.ts can check that
 * railway.ts declares each one.
 */
export function readLeaderboardClipsEnv(): LeaderboardClipsEnv {
  return {
    LEADERBOARD_CLIPS: process.env.LEADERBOARD_CLIPS,
    LEADERBOARD_CLIPS_S3_ENDPOINT: process.env.LEADERBOARD_CLIPS_S3_ENDPOINT,
    LEADERBOARD_CLIPS_S3_BUCKET: process.env.LEADERBOARD_CLIPS_S3_BUCKET,
    LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID: process.env.LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID,
    LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY: process.env.LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY,
    LEADERBOARD_CLIPS_S3_REGION: process.env.LEADERBOARD_CLIPS_S3_REGION,
    LEADERBOARD_CLIPS_S3_URL_STYLE: process.env.LEADERBOARD_CLIPS_S3_URL_STYLE,
    ADMIN_USER_IDS: process.env.ADMIN_USER_IDS,
    // Inlined by next.config.ts (env) at build time; not a Railway variable.
    LEADERBOARD_CLIPS_CSP_MEDIA_SOURCES: process.env.LEADERBOARD_CLIPS_CSP_MEDIA_SOURCES,
  };
}

/**
 * The setting problems that this process has logged. On globalThis
 * (processSingleton): the server loads this module once for each bundle
 * (the routes and instrumentation.ts), and a Set in module state would log
 * each problem once for each bundle.
 */
const warned = processSingleton("leaderboard-clips-config-warned", () => new Set<string>());

/**
 * The settings for this request. Settings are read on each call, so the
 * kill switch works at the next request. A setting problem is logged once
 * per process, with the setting names only.
 */
export function leaderboardClipsConfig(): LeaderboardClipsConfig {
  const config = resolveLeaderboardClipsConfig(readLeaderboardClipsEnv());
  if (!config.enabled && config.reason !== "not_set_up") {
    const key = `${config.reason}:${(config.problems ?? []).join(",")}`;
    if (!warned.has(key)) {
      warned.add(key);
      const detail = config.problems?.length ? ` (${config.problems.join(", ")})` : "";
      console.warn(`[leaderboard-clips] off: ${config.reason}${detail}`);
    }
  }
  return config;
}

/** True when the user id is on ADMIN_USER_IDS. */
export function isClipAdmin(config: LeaderboardClipsConfig, userId: string | undefined | null): boolean {
  return !!userId && config.adminUserIds.has(userId);
}
