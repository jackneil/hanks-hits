import type { RunClipState } from "@/shared/clips/useRunClips";

export function adventureClipState(state: { hasStarted: boolean; isPaused: boolean }, held: boolean, canvasReady: boolean, panelOpen: boolean, generation: number): RunClipState {
  return {
    phase: !canvasReady || !state.hasStarted ? "idle" : state.isPaused || held || panelOpen ? "hold" : "playing",
    runId: generation,
    score: 0,
    best: 0,
  };
}
