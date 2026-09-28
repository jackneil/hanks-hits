/**
 * Clips lab switches (plan 15.3).
 *
 * The lab route exists only when the server has CLIPS_LAB=1 at run time.
 * The page reads the variable for each request (a dynamic route), never at
 * build time, so a production build with no variable answers 404.
 *
 * Query parameters (all optional):
 *   gl=2        draw with WebGL2 (capture path E) instead of a 2D canvas (path P)
 *   fps=30|60   capture target for registerCanvas (default 60)
 *   hold=N      display frames that each flash stays white, 1-12 (default:
 *               the stride of the lowest capture rung, so that every rung
 *               captures the flash; see labSchedule.ts)
 */

export interface ClipsLabOptions {
  /** Draw with WebGL2 (path E). */
  gl: boolean;
  targetFps: 30 | 60;
  /** A fixed flash length in display frames, or null for the stride of the lowest capture rung. */
  hold: number | null;
}

export const DEFAULT_LAB_OPTIONS: ClipsLabOptions = Object.freeze({ gl: false, targetFps: 60, hold: null }) as ClipsLabOptions;

/** The largest ?hold value. Longer flashes stop being one event per beep. */
export const MAX_HOLD_FRAMES = 12;

/** True only when CLIPS_LAB is exactly "1". Any other value, or none, keeps the lab off. */
export function isClipsLabEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.CLIPS_LAB === "1";
}

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The lab options from the page's search parameters. Unknown or bad values give the defaults. */
export function parseLabParams(params: SearchParams): ClipsLabOptions {
  const gl = first(params.gl) === "2";
  const targetFps = first(params.fps) === "30" ? 30 : 60;
  const rawHold = first(params.hold);
  const holdNumber = rawHold !== undefined && /^\d+$/.test(rawHold) ? Number(rawHold) : NaN;
  const hold = holdNumber >= 1 && holdNumber <= MAX_HOLD_FRAMES ? holdNumber : null;
  return { gl, targetFps, hold };
}
