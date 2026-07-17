// Canvas-overlay instruction strings, branched by pointer type.
// Touch viewports (coarse pointer) must never see keyboard-only copy
// (2026-07-11 mobile audit: game over said "Press Space to Play Again"
// to phone kids, who have no Space - a tap already restarts, the text
// just never said so).

export type OverlayCopy = {
  resume: string;
  playAgain: string;
  nextWave: string;
};

export function getOverlayCopy(isCoarse: boolean): OverlayCopy {
  if (isCoarse) {
    return {
      resume: "Tap to Resume",
      playAgain: "Tap to Play Again",
      nextWave: "Tap for Next Wave",
    };
  }
  return {
    resume: "Press Escape or Click to Resume",
    playAgain: "Press Space to Play Again",
    nextWave: "Press Space for Next Wave",
  };
}
