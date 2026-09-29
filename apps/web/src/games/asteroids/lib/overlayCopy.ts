// Canvas-overlay instruction strings, branched by pointer type.
// Touch viewports (coarse pointer) must never see keyboard-only copy
// (2026-07-11 mobile audit: game over said "Press Space to Play Again"
// to phone kids, who have no Space - a tap already restarts, the text
// just never said so).

//
// Game over has no "play again" line: the shared result chip under the card
// has a real Play again button (and Space still restarts on a keyboard).

export type OverlayCopy = {
  resume: string;
  nextWave: string;
};

export function getOverlayCopy(isCoarse: boolean): OverlayCopy {
  if (isCoarse) {
    return {
      resume: "Tap to Resume",
      nextWave: "Tap for Next Wave",
    };
  }
  return {
    resume: "Press Escape or Click to Resume",
    nextWave: "Press Space for Next Wave",
  };
}

/** The canvas card's line for a new best (the card is arcade text in capitals, like GAME OVER). */
export const NEW_BEST_LINE = "NEW BEST!";

/**
 * The sound switch in the result chip at game over (the chip covers the
 * switch under the canvas). The words say what the kid hears now.
 */
export const SOUND_LABELS = { on: "Sound on", off: "Sound off" } as const;

/**
 * The result chip's words at game over, read out loud first: the score,
 * the wave, and the best. Short sentences for a kid who cannot read yet.
 */
export function gameOverText({ score, wave, best, newBest }: { score: number; wave: number; best: number; newBest: boolean }): string {
  const words = [`Game over! Your score is ${score}.`, `You got to wave ${wave}.`];
  if (newBest) words.push("That is a new best!");
  else if (best > 0) words.push(`Your best is ${best}.`);
  return words.join(" ");
}
