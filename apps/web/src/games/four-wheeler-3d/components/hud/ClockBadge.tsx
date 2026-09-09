"use client";

/**
 * The clock badge. It sits below the shell header, not behind it, and reads
 * at a glance: a big emoji for the weather, then the time in numbers that
 * never jump around, because the digits are all the same width.
 */

import { clockIcon, formatClock, type Weather } from "../../lib/dayNight";
import { HUD_TOP } from "./layout";

export function ClockBadge({
  timeOfDay,
  day,
  weather,
}: {
  timeOfDay: number;
  day: number;
  weather: Weather;
}) {
  return (
    <div
      className={`pointer-events-none absolute left-3 ${HUD_TOP} z-20 select-none`}
    >
      <div className="flex items-center gap-2 rounded-2xl bg-black/55 px-4 py-2 text-white shadow-lg backdrop-blur-sm">
        <span className="text-2xl" aria-hidden="true">
          {clockIcon(timeOfDay, weather)}
        </span>
        <div className="leading-tight">
          <div className="text-xl font-bold tabular-nums">
            {formatClock(timeOfDay)}
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide opacity-80">
            Day {day}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClockBadge;
