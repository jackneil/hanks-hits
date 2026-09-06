// Start-screen instruction strings, branched by pointer type.
// The single source of truth for the runner's control hints: the shared
// GameStartOverlay reads them from here, so touch viewports never see
// keyboard-only copy. Kid-readable: one action per line, emoji first.

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
      jump: "👆 Tap the top to jump",
      duck: "👇 Tap the bottom to duck",
    };
  }
  return {
    jump: "⌨️ Space to jump",
    duck: "⬇️ Hold the down arrow to duck",
  };
}

/** Both hint lines as an ordered list, ready for GameStartOverlay. */
export function getInstructionLines(isCoarse: boolean): string[] {
  const { jump, duck } = getInstructions(isCoarse);
  return [jump, duck];
}
