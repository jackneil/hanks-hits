"use client";
import { useOregonTrailStore } from "../lib/store";
import { LANDMARKS, TOTAL_DISTANCE } from "../lib/constants";
import { calculateScore, checkGameOver } from "../lib/gameLogic";
import { ResultChip } from "@/shared/components/ResultChip";
import { MAIN_ACTION, Screen } from "./Screen";

/** The end of a journey, read out loud first by the result chip. */
export function journeyText({
  victory,
  reason,
  score,
  days,
  miles,
  saved,
}: {
  victory: boolean;
  reason?: string;
  score: number;
  days: number;
  miles: number;
  saved: number;
}): string {
  if (victory) {
    return `You made it to Oregon in ${days} days! ${saved} of your family made it with you. Your score is ${score}.`;
  }
  return `${reason ?? "Your journey has ended."} You went ${miles} miles. Your score is ${score}.`;
}

export function GameUI() {
  const st = useOregonTrailStore();

  if (st.gamePhase === "landmark") {
    const lm = LANDMARKS[st.currentLandmarkIndex];
    return (
      <Screen
        testId="oregon-landmark"
        title={`📍 ${lm?.name}`}
        speak={`${lm?.name}. ${lm?.description}${lm?.hasStore ? " There is a store here." : ""}`}
        actions={
          <button type="button" onClick={st.continueFromLandmark} className={MAIN_ACTION}>
            {lm?.hasStore ? "🏪 Visit the store" : "Continue ▶"}
          </button>
        }
      >
        <div className="flex min-h-full flex-col items-center justify-center text-center">
          <p className="text-2xl short:text-xl">{lm?.description}</p>
          <p className="mt-2 text-lg">
            {st.milesTraveled} of {TOTAL_DISTANCE.toLocaleString("en-US")} miles
          </p>
        </div>
      </Screen>
    );
  }

  if (st.gamePhase === "victory" || st.gamePhase === "game_over") {
    const victory = st.gamePhase === "victory";
    const score = calculateScore(st);
    const saved = st.party.filter((m) => !m.leftBehind).length;
    const reason = victory ? undefined : checkGameOver(st).reason;
    const stat = "flex flex-col items-center rounded-lg bg-black/25 px-2 py-2 leading-tight";
    return (
      <Screen testId={victory ? "oregon-victory" : "oregon-game-over"} tone={victory ? "green" : "red"}>
        <div className="flex flex-col items-center pt-2 text-center">
          <h2 className="text-3xl font-bold short:text-2xl">{victory ? "🎉 You made it to Oregon!" : "🪦 Game over"}</h2>
          <p className="mt-1 text-lg">{victory ? "Welcome to the Willamette Valley!" : reason ?? "Your journey has ended."}</p>
          <div className="mt-3 grid w-full max-w-md grid-cols-4 gap-2">
            <div className={stat}>
              <span className="text-2xl font-bold text-amber-300">{score}</span>
              <span className="text-sm">score</span>
            </div>
            <div className={stat}>
              <span className="text-2xl font-bold">{st.currentDay}</span>
              <span className="text-sm">days</span>
            </div>
            <div className={stat}>
              <span className="text-2xl font-bold">{st.milesTraveled}</span>
              <span className="text-sm">miles</span>
            </div>
            <div className={stat}>
              <span className="text-2xl font-bold">{saved}</span>
              <span className="text-sm">family</span>
            </div>
          </div>
        </div>
        {/* The result chip: read it to me, Play again (a new journey with the
            same names), the leaderboard. */}
        <ResultChip
          resultText={journeyText({ victory, reason, score, days: st.currentDay, miles: st.milesTraveled, saved })}
          appId="oregon-trail"
          onRestart={st.newJourney}
        />
      </Screen>
    );
  }
  return null;
}
