"use client";

import { useOregonTrailStore } from "../lib/store";
import { LANDMARKS, TOTAL_DISTANCE } from "../lib/constants";

/**
 * The trail from Independence to Oregon: a bar with a dot for each stop
 * (green passed, amber next, a blue ring for a river), the wagon on it, and
 * the next stop in words. Every word is 14 px or more (the legend was 12 px
 * at 70% opacity), and nothing on it moves on its own.
 */
export function ProgressMap() {
  const milesTraveled = useOregonTrailStore((s) => s.milesTraveled);
  const currentLandmarkIndex = useOregonTrailStore((s) => s.currentLandmarkIndex);
  const progress = Math.min(100, (milesTraveled / TOTAL_DISTANCE) * 100);
  const next = LANDMARKS[currentLandmarkIndex + 1];

  return (
    <div data-testid="oregon-progress" className="rounded-lg bg-black/25 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-base leading-tight">
        {next && (
          <p>
            Next: <span className="font-bold text-amber-200">{next.name}</span> · {next.milesFromStart - milesTraveled} mi
            {next.hasRiver && <span className="ml-1">🌊</span>}
          </p>
        )}
        <p className="text-sm">
          {milesTraveled}/{TOTAL_DISTANCE.toLocaleString("en-US")} mi
        </p>
      </div>
      <div className="relative mt-1.5 h-6" aria-label={`${milesTraveled} of ${TOTAL_DISTANCE} miles to Oregon`} role="img">
        <div className="absolute inset-x-0 top-2.5 h-1.5 rounded-full bg-black/40" />
        <div className="absolute left-0 top-2.5 h-1.5 rounded-full bg-amber-400" style={{ width: `${progress}%` }} />
        {LANDMARKS.map((lm, idx) => (
          <div
            key={lm.id}
            className={`absolute top-1.5 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 ${
              idx <= currentLandmarkIndex
                ? "border-green-200 bg-green-500"
                : idx === currentLandmarkIndex + 1
                  ? "border-amber-100 bg-amber-500"
                  : "border-gray-300 bg-gray-600"
            } ${lm.hasRiver ? "ring-2 ring-sky-400" : ""}`}
            style={{ left: `${(lm.milesFromStart / TOTAL_DISTANCE) * 100}%` }}
          />
        ))}
        <div className="absolute -top-1 -translate-x-1/2 text-xl transition-[left] duration-500" style={{ left: `${progress}%` }}>
          🐂
        </div>
      </div>
    </div>
  );
}
