/**
 * Small pure helpers for the clip surfaces: time and size text, and the
 * game name and picture of a clip.
 */

import { GAME_METADATA } from "@/shared/lib/gameMetadata.generated";

import { VIEWER_COPY } from "./copy";

/** "0:07", "1:05", "12:40". Negative and non-finite values show "0:00". */
export function formatDuration(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/** "0 MB", "3 MB", "1.2 GB". Rounds up so a small clip never says 0. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${Math.max(1, Math.ceil(mb))} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** The game name and picture of a clip's game. */
export interface ClipGameInfo {
  name: string;
  emoji: string;
  /** False for "unknown" (a file the library re-indexed without its row) and removed games. */
  known: boolean;
}

/** The generic picture for a clip whose game is not known. */
export const UNKNOWN_GAME_EMOJI = "🎮";

/**
 * The name and picture of a clip's game. It never throws: a clip whose
 * gameId is "unknown", empty, or not a game on this site gets a generic
 * name and picture. Object.hasOwn keeps an id like "constructor" from
 * reading an inherited key.
 */
export function clipGameInfo(gameId: string | null | undefined): ClipGameInfo {
  if (typeof gameId === "string" && gameId !== "unknown" && Object.hasOwn(GAME_METADATA, gameId)) {
    const meta = GAME_METADATA[gameId];
    return { name: meta.name, emoji: meta.icon, known: true };
  }
  return { name: VIEWER_COPY.unknownGame, emoji: UNKNOWN_GAME_EMOJI, known: false };
}
