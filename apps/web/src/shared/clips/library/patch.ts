/**
 * Checks for the "update" command (protocol IoCmd). The patch comes from the main
 * thread, so every field is checked before it reaches a row. Pure functions.
 */

import type { ClipRecordPatch, MomentMark } from "../protocol";
import { InvalidInputError } from "./errors";
import { GUEST_OWNER_KEY, isOwnerKey } from "./ownerKey";

/** Longest moment label or emoji that a row keeps. */
export const MAX_MOMENT_TEXT = 255;
/** Most moments that a row keeps. */
export const MAX_MOMENTS = 200;

const MOMENT_KINDS: ReadonlySet<MomentMark["kind"]> = new Set(["new-best", "win", "level-clear", "combo", "custom"]);
const PRIORITIES: ReadonlySet<MomentMark["priority"]> = new Set(["featured", "standard"]);
const PATCH_KEYS: ReadonlySet<string> = new Set(["kept", "watched", "moments", "challengeScore", "ownerKey"]);

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_MOMENT_TEXT;
}

function checkMoment(value: unknown, index: number): MomentMark {
  const moment = value as Partial<MomentMark> | null;
  if (
    typeof moment !== "object" ||
    moment === null ||
    !MOMENT_KINDS.has(moment.kind as MomentMark["kind"]) ||
    !isText(moment.label) ||
    !isText(moment.emoji) ||
    !PRIORITIES.has(moment.priority as MomentMark["priority"]) ||
    typeof moment.offsetSec !== "number" ||
    !Number.isFinite(moment.offsetSec)
  ) {
    throw new InvalidInputError(`moment ${index} is not a valid moment`);
  }
  return {
    kind: moment.kind as MomentMark["kind"],
    label: moment.label,
    emoji: moment.emoji,
    priority: moment.priority as MomentMark["priority"],
    offsetSec: moment.offsetSec,
  };
}

/**
 * Returns a clean copy of a patch. Throws InvalidInputError (a TypeError) for an
 * unknown field or a field of the wrong type, so a bad patch never changes a row.
 */
export function sanitizePatch(value: unknown): ClipRecordPatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidInputError("the patch is not an object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!PATCH_KEYS.has(key)) throw new InvalidInputError(`"${key}" is not a field that the UI can change`);
  }
  const patch: ClipRecordPatch = {};
  if ("kept" in input) {
    if (typeof input.kept !== "boolean") throw new InvalidInputError("kept must be true or false");
    patch.kept = input.kept;
  }
  if ("watched" in input) {
    if (typeof input.watched !== "boolean") throw new InvalidInputError("watched must be true or false");
    patch.watched = input.watched;
  }
  if ("moments" in input) {
    if (!Array.isArray(input.moments) || input.moments.length > MAX_MOMENTS) {
      throw new InvalidInputError(`moments must be a list of at most ${MAX_MOMENTS} moments`);
    }
    patch.moments = input.moments.map(checkMoment);
  }
  if ("challengeScore" in input) {
    const score = input.challengeScore;
    if (score !== undefined && (typeof score !== "number" || !Number.isFinite(score))) {
      throw new InvalidInputError("challengeScore must be a number");
    }
    patch.challengeScore = score as number | undefined;
  }
  if ("ownerKey" in input) {
    if (!isOwnerKey(input.ownerKey)) throw new InvalidInputError(`"${String(input.ownerKey)}" is not a valid owner key`);
    patch.ownerKey = input.ownerKey;
  }
  return patch;
}

/**
 * Plan 8.1 has two owner changes: a player claims guest clips ("Which of these are
 * yours?"), and a player gives a clip back to guest. A direct move from one player to
 * another is never a flow, so it is refused: it would show one kid's clip to another.
 */
export function checkOwnerChange(from: string, to: string): void {
  if (from === to) return;
  if (from !== GUEST_OWNER_KEY && to !== GUEST_OWNER_KEY) {
    throw new InvalidInputError("an owner change must go from guest or to guest");
  }
}
