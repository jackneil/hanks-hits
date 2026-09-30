"use client";
import { useOregonTrailStore } from "../lib/store";
import { LANDMARKS } from "../lib/constants";
import { calculateScore } from "../lib/gameLogic";

export function GameUI() {
  const st = useOregonTrailStore();
  if (st.gamePhase === "landmark") {
    const lm = LANDMARKS[st.currentLandmarkIndex];
    return (
      <div className="min-h-full flex items-center justify-center bg-amber-900">
        <div className="bg-amber-700 p-8 rounded text-white text-center">
          <h2 className="text-3xl mb-4">{lm?.name}</h2>
          <p className="text-xl mb-4">{lm?.description}</p>
          <button onClick={st.continueFromLandmark} className="btn btn-primary btn-lg">Continue</button>
        </div>
      </div>
    );
  }
  if (st.gamePhase === "victory") {
    return (
      <div className="min-h-full flex items-center justify-center bg-green-900">
        <div className="bg-green-700 p-8 rounded text-white text-center">
          <h2 className="text-4xl mb-4">You Made It!</h2>
          <p className="text-2xl mb-2">Welcome to Oregon!</p>
          <p className="text-xl mb-4">Score: {calculateScore(st)}</p>
          <button onClick={st.resetGame} className="btn btn-primary btn-lg">Play Again</button>
        </div>
      </div>
    );
  }
  if (st.gamePhase === "game_over") {
    return (
      <div className="min-h-full flex items-center justify-center bg-red-900">
        <div className="bg-red-700 p-8 rounded text-white text-center">
          <h2 className="text-4xl mb-4">Game Over</h2>
          <p className="text-xl mb-4">Your journey has ended.</p>
          <button onClick={st.resetGame} className="btn btn-primary btn-lg">Try Again</button>
        </div>
      </div>
    );
  }
  return null;
}
