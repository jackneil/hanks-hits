/**
 * Which games can put a clip on the leaderboard, and the run score rules
 * (design/LEADERBOARD_CLIPS.html, sections 5 and 6).
 *
 * A game takes leaderboard clips when all three are true:
 * - its id is in VALID_APP_IDS (packages/db);
 * - it has a leaderboard extractor (src/lib/leaderboard-extractors.ts);
 * - its metadata literal says clips: true (the generated lookup,
 *   src/shared/lib/gameMetadata.generated.ts, the same source that
 *   GameShell uses to record clips).
 * A DOM game that gets clips later (GAMEPLAY_CLIPS.html Phase 4) takes
 * leaderboard clips with no change here.
 *
 * The run score is the run's own score as the game reported it. It must be
 * a finite number from 0 to the bound that the game's progress schema puts
 * on its board field (for example flappy-bird highScore: 1,000,000), and it
 * is made a whole number the same way as a board score (toBoardScore: down
 * for a score, up for a time).
 */
import { VALID_APP_IDS, type ValidAppId } from "@hank-neil/db/schema";

import {
  LEADERBOARD_EXTRACTORS,
  getGameScoreType,
  hasLeaderboardSupport,
  toBoardScore,
} from "@/lib/leaderboard-extractors";
import { MAX_BOARD_SCORE } from "@/lib/leaderboard-schemas";
import { PROGRESS_SCHEMAS } from "@/lib/progress-schemas";
import { getGameMetadata } from "@/shared/lib/gameMetadata.generated";

/** True when the game can put a clip on its leaderboard. */
export function isLeaderboardClipGame(appId: unknown): appId is ValidAppId {
  return (
    typeof appId === "string" &&
    (VALID_APP_IDS as readonly string[]).includes(appId) &&
    hasLeaderboardSupport(appId) &&
    getGameMetadata(appId).clips === true
  );
}

/** Every game that takes leaderboard clips today. */
export function leaderboardClipGames(): ValidAppId[] {
  return VALID_APP_IDS.filter((appId) => isLeaderboardClipGame(appId));
}

interface ZodLike {
  _zod?: { def?: { type?: string; innerType?: unknown; shape?: Record<string, unknown> } };
  maxValue?: number;
}

/** The schema under optional(), default(), nullable() and similar wrappers. */
function unwrap(schema: unknown): ZodLike | undefined {
  let current = schema as ZodLike | undefined;
  for (let depth = 0; depth < 8 && current?._zod?.def?.innerType; depth++) {
    current = current._zod.def.innerType as ZodLike;
  }
  return current;
}

/**
 * The progress-schema field that the game's board score comes from, found
 * by running the extractor on a probe blob: each number field of the schema
 * gets a different value, and the value that comes back names the field.
 * Null when the extractor does not return one top-level number field.
 */
export function boardScoreField(appId: ValidAppId): { field: string; max: number } | null {
  const extractor = LEADERBOARD_EXTRACTORS[appId];
  const schema = PROGRESS_SCHEMAS[appId] as ZodLike | undefined;
  const shape = schema?._zod?.def?.shape;
  if (!extractor || !shape) return null;
  const probe: Record<string, number> = {};
  const fields = new Map<number, { field: string; max: number }>();
  let marker = 1_000_003;
  for (const [field, fieldSchema] of Object.entries(shape)) {
    const inner = unwrap(fieldSchema);
    if (inner?._zod?.def?.type !== "number") continue;
    marker += 2;
    probe[field] = marker;
    fields.set(marker, { field, max: inner.maxValue ?? Number.POSITIVE_INFINITY });
  }
  let score: unknown;
  try {
    score = extractor(probe)?.score;
  } catch {
    return null;
  }
  return typeof score === "number" ? fields.get(score) ?? null : null;
}

const limits = new Map<ValidAppId, number>();

/**
 * The largest run score the game can send: the bound of its board field in
 * the progress schema, never more than MAX_BOARD_SCORE. A game whose field
 * the probe cannot name gets MAX_BOARD_SCORE (a test fails for a clip game).
 */
export function runScoreLimit(appId: ValidAppId): number {
  let limit = limits.get(appId);
  if (limit === undefined) {
    const found = boardScoreField(appId);
    limit = Math.min(MAX_BOARD_SCORE, found && Number.isFinite(found.max) ? found.max : MAX_BOARD_SCORE);
    limits.set(appId, limit);
  }
  return limit;
}

/** A plain decimal: digits, with an optional fraction. No sign, exponent or spaces. */
const DECIMAL = /^\d{1,16}(?:\.\d{1,9})?$/;

/**
 * The run score of an upload, as a whole number the board column can hold,
 * or null when it is not a plain decimal from 0 to the game's limit.
 */
export function normalizeRunScore(appId: ValidAppId, raw: unknown): number | null {
  if (typeof raw !== "string" || !DECIMAL.test(raw)) return null;
  const value = Number(raw);
  const limit = runScoreLimit(appId);
  if (!Number.isFinite(value) || value < 0 || value > limit) return null;
  const whole = toBoardScore(value, getGameScoreType(appId));
  return whole !== null && whole <= limit ? whole : null;
}
