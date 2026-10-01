// Canvas-overlay instruction strings, branched by pointer type.
// Touch viewports (coarse pointer) must never see keyboard-only copy
// (2026-07-11 mobile audit: game over said "Press Space to Play Again"
// to phone kids, who have no Space - a tap already restarts, the text
// just never said so).

//
// Game over and wave complete have no instruction line: the shared result
// chip under the card has the real buttons (Play again, Next wave), and
// Space still works on a keyboard.

export type OverlayCopy = {
  resume: string;
};

export function getOverlayCopy(isCoarse: boolean): OverlayCopy {
  if (isCoarse) {
    return {
      resume: "Tap to Resume",
    };
  }
  return {
    resume: "Press Escape or Click to Resume",
  };
}

/** The sound switch: the words say what the kid hears now. */
export const SOUND_LABELS = { on: "Sound on", off: "Sound off" } as const;

/** The pad buttons' accessible names (the voice and the tests use them). */
export const PAD_LABELS = {
  turnLeft: "Turn left",
  turnRight: "Turn right",
  thrust: "Thrust",
  fire: "Fire",
} as const;

/** The one button of the wave-complete chip. */
export const NEXT_WAVE_LABEL = "Next wave";

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

/** The wave-complete chip's words, read out loud first. */
export function waveCompleteText({ wave, score }: { wave: number; score: number }): string {
  return `Wave ${wave} done! Your score is ${score}.`;
}
