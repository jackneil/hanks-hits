/**
 * The production wiring of the leaderboard clip routes: the real database,
 * the real bucket client, the session, the clock and the report limit.
 * Tests give handlers.ts their own deps instead.
 */
import { db } from "@hank-neil/db";

import { auth } from "@/lib/auth";
import { processSingleton } from "@/lib/in-flight";
import { checkClipReportRateLimit, getClientIP } from "@/lib/rate-limit";

import { createClipBucket, type ClipBucket } from "./bucket";
import { leaderboardClipsConfig, type BucketSettings } from "./config";
import { UploadGate, type ClipDeps } from "./handlers";
import { createDbClipStore, type ClipStore } from "./store";
import type { SweepDeps } from "./sweeper";

let store: ClipStore | null = null;
/**
 * One gate for the whole process: every upload request shares it. It is on
 * globalThis (processSingleton), because the server can load this module
 * once for each bundle (the routes and instrumentation.ts), and a gate in
 * module state would then be one gate for each bundle.
 */
const uploadGate = processSingleton("leaderboard-clips-upload-gate", () => new UploadGate());
let cachedBucket: { key: string; bucket: ClipBucket } | null = null;

/** One bucket client for the current settings (a settings change makes a new one). */
export function bucketFor(settings: BucketSettings): ClipBucket {
  const key = [
    settings.endpoint,
    settings.bucket,
    settings.region,
    settings.urlStyle,
    settings.accessKeyId,
    settings.secretAccessKey,
  ].join("\n");
  if (cachedBucket?.key !== key) cachedBucket = { key, bucket: createClipBucket(settings) };
  return cachedBucket.bucket;
}

function defaultStore(): ClipStore {
  store ??= createDbClipStore(db);
  return store;
}

/** The deps of the daily sweeper (instrumentation.ts). */
export function defaultSweepDeps(): SweepDeps {
  return { config: leaderboardClipsConfig, store: defaultStore(), bucket: bucketFor, now: () => new Date() };
}

export function defaultClipDeps(): ClipDeps {
  return {
    config: leaderboardClipsConfig,
    store: defaultStore(),
    bucket: bucketFor,
    userId: async () => (await auth())?.user?.id ?? null,
    now: () => new Date(),
    clientIp: getClientIP,
    reportLimit: checkClipReportRateLimit,
    uploadGate,
  };
}
