"use client";

import { useOregonTrailStore } from "../lib/store";
import { LANDMARKS, PACES, WEATHER_CONDITIONS } from "../lib/constants";
import type { HealthStatus, PaceType } from "../types";
import { TravelScene } from "./TravelScene";
import { ProgressMap } from "./ProgressMap";
import { Screen } from "./Screen";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";
import { money } from "./Store";
import { useShortViewport } from "@/shared/hooks/useShortViewport";

const HEALTH_EMOJI: Record<HealthStatus, string> = {
  good: "💚",
  fair: "💛",
  poor: "🧡",
  very_poor: "❤️",
};

const HEALTH_WORDS: Record<HealthStatus, string> = {
  good: "feeling great",
  fair: "a little tired",
  poor: "not so good",
  very_poor: "really sick",
};

const PACE_EMOJI: Record<PaceType, string> = { steady: "🐢", strenuous: "🚶", grueling: "🏃" };

/** Upright the parts stack; held sideways the wagon and the pace are on the left, the rest beside them. */
const AREAS_UPRIGHT = '"scene" "progress" "supplies" "party" "pace"';
const AREAS_SIDEWAYS = '"scene progress" "scene supplies" "pace party"';

/**
 * One day on the trail: the wagon (with the day, the weather and the read
 * aloud button on it), how far it is to the next stop, the supplies, the
 * family and the pace, with Continue, Rest and Hunt always on screen at the
 * bottom. All of it fits an iPhone SE either way up with no scrolling.
 *
 * Why: the family was five cards in one column, so the page was 1580 px
 * (three screens) and Continue Trail was under the fold on most days
 * (phone UX audit 2026-09-29).
 */
export function Travel({ onCaptureCanvas }: { onCaptureCanvas?: (canvas: HTMLCanvasElement | null) => void } = {}) {
  const st = useOregonTrailStore();
  const nextLm = LANDMARKS[st.currentLandmarkIndex + 1];
  const toNext = nextLm ? nextLm.milesFromStart - st.milesTraveled : 0;
  const weather = WEATHER_CONDITIONS[st.weather] ?? WEATHER_CONDITIONS.clear;
  const members = st.party.filter((m) => !m.leftBehind);

  const speak = () =>
    `Day ${st.currentDay}. ${weather.name}. ${nextLm ? `${toNext} miles to ${nextLm.name}.` : ""} ` +
    `You have ${st.supplies.food} pounds of food, ${st.supplies.oxen} oxen, ${st.supplies.ammunition} bullets and ${money(st.supplies.money)}. ` +
    members.map((m) => `${m.name} is ${m.isSick ? "sick" : HEALTH_WORDS[m.health]}.`).join(" ") +
    " Tap Continue to travel, Rest to get better, or Hunt for food.";

  const chip = "flex flex-col items-center justify-center rounded-lg bg-black/25 px-1 py-1 text-center leading-tight";
  const short = useShortViewport();
  const action = "btn h-12 min-h-12 flex-1 gap-1 px-2 text-base short:h-11 short:min-h-11";

  return (
    <Screen
      testId="oregon-travel"
      tone="green"
      actions={
        <div className="flex gap-2">
          <button type="button" onClick={st.travel} className={`${action} btn-primary flex-[2] text-lg`}>
            🐂 Continue
          </button>
          <button type="button" onClick={st.rest} className={action}>
            ⛺ Rest
          </button>
          <button
            type="button"
            onClick={() => st.setPhase("hunting")}
            disabled={st.supplies.ammunition <= 0}
            className={`${action} btn-accent`}
          >
            🎯 Hunt
          </button>
        </div>
      }
    >
      <div
        className="grid gap-2"
        style={{
          gridTemplateAreas: short ? AREAS_SIDEWAYS : AREAS_UPRIGHT,
          gridTemplateColumns: short ? "minmax(0, 5fr) minmax(0, 6fr)" : "minmax(0, 1fr)",
        }}
      >
        <div className="relative" style={{ gridArea: "scene" }}>
          <TravelScene onCaptureCanvas={onCaptureCanvas} />
          <div className="absolute left-2 top-2 flex items-center gap-2">
            <ReadAloudButton text={speak} variant="icon" />
            <span className="rounded bg-black/45 px-2 py-1 text-lg font-bold text-white">Day {st.currentDay}</span>
          </div>
        </div>

        <div style={{ gridArea: "progress" }}>
          <ProgressMap />
        </div>

          <div data-testid="oregon-supplies" className="grid grid-cols-4 gap-1.5" style={{ gridArea: "supplies" }}>
            <div className={chip} aria-label={`${st.supplies.food} pounds of food`}>
              <span className="whitespace-nowrap text-base font-bold">
                <span aria-hidden="true">🍖</span> {st.supplies.food}
              </span>
              <span className="text-sm">lbs</span>
            </div>
            <div className={chip} aria-label={`${st.supplies.oxen} oxen`}>
              <span className="whitespace-nowrap text-base font-bold">
                <span aria-hidden="true">🐂</span> {st.supplies.oxen}
              </span>
              <span className="text-sm">oxen</span>
            </div>
            <div className={chip} aria-label={`${st.supplies.ammunition} bullets`}>
              <span className="whitespace-nowrap text-base font-bold">
                <span aria-hidden="true">🎯</span> {st.supplies.ammunition}
              </span>
              <span className="text-sm">bullets</span>
            </div>
            <div className={chip} aria-label={`${money(st.supplies.money)} cash`}>
              <span className="whitespace-nowrap text-base font-bold">
                <span aria-hidden="true">💰</span> {money(Math.floor(st.supplies.money))}
              </span>
              <span className="text-sm">cash</span>
            </div>
          </div>

          {/* The family: one row, each with a heart for how they feel. */}
          <div
            data-testid="oregon-party"
            className="grid gap-1"
            style={{ gridArea: "party", gridTemplateColumns: `repeat(${Math.max(1, st.party.length)}, minmax(0, 1fr))` }}
          >
            {st.party.map((m, idx) => (
              <div
                key={m.id}
                aria-label={`${m.name}: ${m.leftBehind ? "left behind" : m.isSick ? "sick" : HEALTH_WORDS[m.health]}`}
                className={`${chip} short:flex-row short:gap-1 ${m.leftBehind ? "opacity-50" : m.isSick ? "bg-red-900/70" : ""}`}
              >
                <span aria-hidden="true" className="whitespace-nowrap text-lg leading-none">
                  {m.leftBehind ? "🪦" : m.isSick ? "🤒" : idx === 0 ? "🤠" : idx % 2 === 0 ? "👨" : "👩"}
                  {m.leftBehind ? "" : HEALTH_EMOJI[m.health]}
                </span>
                <span className="w-full truncate text-sm font-bold">{m.name}</span>
              </div>
            ))}
          </div>

          {/* The pace: a segmented control, the miles a day under each name. */}
          <div role="radiogroup" aria-label="Travel pace" className="grid grid-cols-3 gap-1.5" style={{ gridArea: "pace" }}>
            {(["steady", "strenuous", "grueling"] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={st.pace === p}
                aria-label={`${PACES[p].name}, about ${PACES[p].milesPerDay} miles a day`}
                onClick={() => st.setPace(p)}
                className={`btn h-auto min-h-11 flex-col gap-0 border-0 px-1 py-1 text-base normal-case leading-tight ${
                  st.pace === p ? "bg-amber-300 text-amber-950" : "bg-black/25 text-green-50"
                }`}
              >
                <span>
                  {PACE_EMOJI[p]} {PACES[p].name}
                </span>
                <span className="text-sm font-normal short:hidden">~{PACES[p].milesPerDay} mi a day</span>
              </button>
            ))}
          </div>
      </div>
    </Screen>
  );
}
