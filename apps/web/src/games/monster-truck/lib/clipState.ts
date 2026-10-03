import type { RunClipState } from "@/shared/clips/useRunClips";

export function monsterTruckClipState(state: {
  hasStarted: boolean; isPaused: boolean; showGarage: boolean; showChallenges: boolean; sessionCoins: number;
}, held: boolean, canvasReady: boolean): RunClipState {
  return {
    phase: !canvasReady || !state.hasStarted ? "idle" : state.isPaused || held || state.showGarage || state.showChallenges ? "hold" : "playing",
    score: state.sessionCoins,
    best: 0,
  };
}
