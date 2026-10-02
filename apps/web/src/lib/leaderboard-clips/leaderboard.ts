/**
 * The clip fields of GET /api/leaderboards/[appId]
 * (design/LEADERBOARD_CLIPS.html, section 5):
 * - each entry gets clip: { id, runScore, durationMs, width, height } for a
 *   PUBLIC clip of a profile that shows on the leaderboards, else null;
 * - myEntry gets clipStatus ("none", "public" or "hidden") and the player's
 *   own clip; the same fields are in myClip at the top of the answer, for
 *   every period and also when the player has no row (myEntry null).
 *
 * When the feature is off but the bucket settings are valid (the kill
 * switch, or a CSP that does not allow the bucket), the entries get no
 * clip, but the player still gets their OWN clip. DELETE works then
 * (section 7: the owner can take the video off at any time), and the
 * player needs the clip id to do it.
 *
 * A clip lookup never breaks the leaderboard: when the bucket is not set
 * up, when the game has no clips, or when the lookup fails (for example
 * before the migration has run), every clip is null and clipStatus is "none".
 */
import { describeError } from "@/lib/describe-error";

import type { LeaderboardApiMyClip, LeaderboardClipSummary } from "./contract";
import type { LeaderboardClipsConfig } from "./config";
import { isLeaderboardClipGame } from "./games";
import { myClipOf } from "./handlers";
import type { ClipRow, ClipStore } from "./store";

export interface LeaderboardClipDeps {
  config: () => LeaderboardClipsConfig;
  store: ClipStore;
}

export interface LeaderboardClips {
  /** The public clip of each listed profile (by gaming profile id). */
  byProfile: Map<string, LeaderboardClipSummary>;
}

/** The player's own clip fields (myEntry and myClip of the leaderboard answer). */
export type MyClipFields = LeaderboardApiMyClip;

export const NO_CLIP: MyClipFields = Object.freeze({ clipStatus: "none", clip: null });

function summaryOf(row: ClipRow): LeaderboardClipSummary {
  return { id: row.id, runScore: row.runScore, durationMs: row.durationMs, width: row.width, height: row.height };
}

/** True when anybody can see clips of the game (the public list). */
function clipsOn(deps: LeaderboardClipDeps, appId: string): boolean {
  return deps.config().enabled && isLeaderboardClipGame(appId);
}

/**
 * True when the owner can see (and delete) their own clip of the game: the
 * bucket settings are valid, also while the feature is off. The same rule
 * as handleDelete, which needs only config.bucket.
 */
function ownClipsOn(deps: LeaderboardClipDeps, appId: string): boolean {
  return deps.config().bucket !== null && isLeaderboardClipGame(appId);
}

/** A failed lookup is logged at most once in this time, so a missing table cannot flood the log. */
const WARN_INTERVAL_MS = 10 * 60 * 1000;
let lastWarnAt = Number.NEGATIVE_INFINITY;

function warnOnce(error: unknown): void {
  const now = Date.now();
  if (now - lastWarnAt < WARN_INTERVAL_MS) return;
  lastWarnAt = now;
  console.error("[leaderboard-clips] leaderboard clip lookup failed; showing no clips:", describeError(error));
}

/**
 * The public clips of the listed profiles. The caller lists only profiles
 * that show on the leaderboards; the store also needs each profile's row on
 * the game's board.
 */
export async function clipsForEntries(
  deps: LeaderboardClipDeps,
  appId: string,
  shownProfileIds: readonly string[]
): Promise<LeaderboardClips> {
  const byProfile = new Map<string, LeaderboardClipSummary>();
  if (shownProfileIds.length === 0 || !clipsOn(deps, appId)) return { byProfile };
  try {
    for (const row of await deps.store.publicClipsFor(appId, shownProfileIds)) {
      byProfile.set(row.gamingProfileId, summaryOf(row));
    }
  } catch (error) {
    warnOnce(error);
  }
  return { byProfile };
}

/** The player's own clip status for the game (also while the feature is off; see ownClipsOn). */
export async function myClipFields(
  deps: LeaderboardClipDeps,
  appId: string,
  profileId: string
): Promise<MyClipFields> {
  if (!ownClipsOn(deps, appId)) return NO_CLIP;
  try {
    const row = await deps.store.clipOf(profileId, appId);
    return row ? { clipStatus: row.status, clip: myClipOf(row) } : NO_CLIP;
  } catch (error) {
    warnOnce(error);
    return NO_CLIP;
  }
}
