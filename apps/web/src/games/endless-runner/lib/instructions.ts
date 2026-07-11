// Start-screen instruction strings, branched by pointer type.
// Touch viewports (coarse pointer) must never see keyboard-only copy.

export type RunnerInstructions = {
  jump: string;
  duck: string;
};

/**
 * Pick the kid-friendly control hints for the start screen.
 * @param isCoarse true when the primary pointer is a finger (touchscreen)
 */
export function getInstructions(isCoarse: boolean): RunnerInstructions {
  if (isCoarse) {
    return {
      jump: "Tap to Jump!",
      duck: "Tap the Bottom to Duck",
    };
  }
  return {
    jump: "Tap or Press Space to Jump!",
    duck: "Hold Down Arrow to Duck",
  };
}
