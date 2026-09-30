"use client";

import { useOregonTrailStore } from "../lib/store";
import { LANDMARKS, PACES } from "../lib/constants";
import { TravelScene } from "./TravelScene";
import { ProgressMap } from "./ProgressMap";

// Health emoji based on status
const HEALTH_EMOJI: Record<string, string> = {
  good: "💚",
  fair: "💛",
  poor: "🧡",
  very_poor: "❤️",
};

export function Travel() {
  const st = useOregonTrailStore();
  const nextLm = LANDMARKS[st.currentLandmarkIndex + 1];
  const toNext = nextLm ? nextLm.milesFromStart - st.milesTraveled : 0;

  return (
    <div className="min-h-full bg-gradient-to-b from-green-900 via-green-800 to-green-900 text-green-100 p-2 md:p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Day header */}
        <div className="text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-amber-200">
            Day {st.currentDay}
          </h2>
        </div>

        {/* Animated travel scene */}
        <TravelScene />

        {/* Progress map */}
        <ProgressMap />

        {/* Status cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
          {/* Supplies */}
          <div className="bg-green-700/50 backdrop-blur rounded-lg p-3 text-center">
            <div className="text-2xl mb-1">🍖</div>
            <div className="text-lg font-bold">{st.supplies.food}</div>
            <div className="text-xs text-green-300">lbs food</div>
          </div>

          <div className="bg-green-700/50 backdrop-blur rounded-lg p-3 text-center">
            <div className="text-2xl mb-1">🐂</div>
            <div className="text-lg font-bold">{st.supplies.oxen}</div>
            <div className="text-xs text-green-300">oxen</div>
          </div>

          <div className="bg-green-700/50 backdrop-blur rounded-lg p-3 text-center">
            <div className="text-2xl mb-1">🎯</div>
            <div className="text-lg font-bold">{st.supplies.ammunition}</div>
            <div className="text-xs text-green-300">bullets</div>
          </div>

          <div className="bg-green-700/50 backdrop-blur rounded-lg p-3 text-center">
            <div className="text-2xl mb-1">💰</div>
            <div className="text-lg font-bold">${st.supplies.money}</div>
            <div className="text-xs text-green-300">cash</div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap justify-center gap-2 md:gap-4">
          <button
            onClick={st.travel}
            className="btn btn-primary btn-lg text-lg px-8 shadow-lg hover:shadow-xl transition-all"
          >
            🚗 Continue Trail
          </button>
          <button
            onClick={st.rest}
            className="btn btn-secondary btn-lg shadow-lg"
          >
            ⛺ Rest
          </button>
          <button
            onClick={() => st.setPhase("hunting")}
            className="btn btn-accent btn-lg shadow-lg"
            disabled={st.supplies.ammunition <= 0}
          >
            🎯 Hunt
          </button>
        </div>

        {/* Pace selector */}
        <div className="bg-green-700/30 backdrop-blur rounded-lg p-3">
          <div className="text-center mb-2 text-sm text-green-300">Travel Pace</div>
          <div className="flex justify-center gap-2">
            {(["steady", "strenuous", "grueling"] as const).map((p) => (
              <button
                key={p}
                onClick={() => st.setPace(p)}
                className={`
                  px-4 py-2 rounded-lg font-medium transition-all
                  ${st.pace === p
                    ? "bg-amber-600 text-white shadow-lg"
                    : "bg-green-600/50 text-green-200 hover:bg-green-600"
                  }
                `}
              >
                {PACES[p].name}
                <div className="text-xs opacity-70">
                  {p === "steady" && "~15 mi/day"}
                  {p === "strenuous" && "~20 mi/day"}
                  {p === "grueling" && "~25 mi/day"}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Party status */}
        <div className="bg-green-700/30 backdrop-blur rounded-lg p-3">
          <h3 className="text-lg font-bold mb-3 text-center text-amber-200">
            👨‍👩‍👧‍👦 Party Health
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            {st.party.map((m, idx) => (
              <div
                key={m.id}
                className={`
                  p-3 rounded-lg text-center transition-all
                  ${m.isSick
                    ? "bg-red-800/50 border border-red-500/50 animate-pulse"
                    : m.health === "good"
                      ? "bg-green-600/30"
                      : m.health === "fair"
                        ? "bg-yellow-600/30"
                        : m.health === "poor"
                          ? "bg-orange-600/30"
                          : "bg-red-600/30"
                  }
                `}
              >
                {/* Character icon */}
                <div className="text-2xl mb-1">
                  {idx === 0 ? "🤠" : idx % 2 === 0 ? "👨" : "👩"}
                </div>

                {/* Name */}
                <div className="font-bold text-sm truncate">{m.name}</div>

                {/* Health indicator */}
                <div className="flex items-center justify-center gap-1 mt-1">
                  <span className="text-lg">{HEALTH_EMOJI[m.health]}</span>
                  <span className="text-xs capitalize">{m.health.replace("_", " ")}</span>
                </div>

                {/* Sick indicator */}
                {m.isSick && (
                  <div className="mt-1 text-xs text-red-300 flex items-center justify-center gap-1">
                    <span className="animate-pulse">🤒</span> Sick
                  </div>
                )}

                {/* Health bar */}
                <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      m.health === "good"
                        ? "bg-green-500 w-full"
                        : m.health === "fair"
                          ? "bg-yellow-500 w-3/4"
                          : m.health === "poor"
                            ? "bg-orange-500 w-1/2"
                            : "bg-red-500 w-1/4"
                    }`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Next destination reminder */}
        {nextLm && (
          <div className="text-center text-green-300 text-sm">
            <span className="opacity-70">Next stop:</span>{" "}
            <span className="font-bold text-amber-200">{nextLm.name}</span>{" "}
            <span className="opacity-70">({toNext} miles)</span>
          </div>
        )}
      </div>
    </div>
  );
}
