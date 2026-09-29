/**
 * The score to beat during one run, fixed when the run starts.
 *
 * Why: several games write the new high score into their saved progress
 * DURING the run (Breakout at each level, Blitz Bomber at each landing,
 * Space Invaders on every frame). At game over they then asked "is the
 * score higher than the saved best?" and got the wrong answer: a tie
 * looked like a record, and a record from an earlier level was missed.
 * The fix is to remember the best from BEFORE the run and compare against
 * that snapshot only.
 *
 * Rules:
 * - A new best must be strictly better. A tie is not a new best.
 * - A first-ever score above zero is a new best (the card can say "NEW
 *   BEST!"). It is not a broken record, because there was no record
 *   (`brokeRecord` is false). Brag moments use `brokeRecord`.
 * - A cloud sync can deliver a better best from another device during the
 *   run. `noteCloudBest` raises the score to beat, and never lowers it.
 * - Bad saved values (missing, NaN, negative) count as "no best yet".
 *
 * Usage in a store:
 *   startGame: () => set({ run: startRun(get().progress.highScore), ... })
 *   setProgress: (data) => { get().run.noteCloudBest(data.highScore); ... }
 *   endGame: () => { const isNewBest = get().run.isNewBest(score); ... }
 *
 * Games where lower is better (a race time) pass { lowerIsBetter: true }.
 */

export interface RunBestOptions {
  /** True when a smaller number is better, for example a race time. */
  lowerIsBetter?: boolean;
}

export interface RunBest {
  /** The score to beat. 0 means there is no best yet. */
  best(): number;
  /** True when there is a best to beat. */
  hasBest(): boolean;
  /** True when `score` is strictly better than the score to beat. A tie is false. */
  isNewBest(score: number): boolean;
  /**
   * True when `score` beats a best that really existed. A first-ever score
   * is a new best but not a broken record.
   */
  brokeRecord(score: number): boolean;
  /** Merge in a best that a cloud sync delivered during the run. */
  noteCloudBest(cloudBest: number | null | undefined): void;
}

/** A usable result: a finite number above zero. Anything else means "none". */
function isRealResult(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Take the best from before the run and return the run's tracker. */
export function startRun(
  prevBest: number | null | undefined,
  options: RunBestOptions = {}
): RunBest {
  const lowerIsBetter = options.lowerIsBetter === true;
  let best = isRealResult(prevBest) ? prevBest : 0;

  const better = (a: number, b: number) => (lowerIsBetter ? a < b : a > b);

  const isNewBest = (score: number): boolean => {
    if (!isRealResult(score)) return false;
    return best === 0 || better(score, best);
  };

  return {
    best: () => best,
    hasBest: () => best > 0,
    isNewBest,
    brokeRecord: (score) => best > 0 && isNewBest(score),
    noteCloudBest(cloudBest) {
      if (!isRealResult(cloudBest)) return;
      if (best === 0 || better(cloudBest, best)) best = cloudBest;
    },
  };
}
