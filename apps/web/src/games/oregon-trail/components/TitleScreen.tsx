"use client";
import { useState } from "react";
import { useOregonTrailStore } from "../lib/store";
import { OCCUPATIONS, MONTH_NAMES } from "../lib/constants";
import type { OccupationType, Month } from "../types";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { MAIN_ACTION, MainAction, Screen, choiceClass } from "./Screen";

/** A name a kid types: a first name or a nickname, never a whole address. */
export const NAME_MAX = 20;

/** The four family members' names when a kid leaves a box empty (shown in the empty box). */
export const DEFAULT_MEMBER_NAMES = ["Ezra", "Mae", "Jed", "Rose"];

/** 18 px text and 48 px tall: iOS zooms the page into a smaller field. */
// 44 px on a phone held sideways (48 took height the job buttons needed).
const INPUT = "input input-bordered input-lg w-full bg-white text-gray-900 short:h-11 short:min-h-11 short:text-base";

export function TitleScreen() {
  const gamePhase = useOregonTrailStore((s) => s.gamePhase);
  const setPhase = useOregonTrailStore((s) => s.setPhase);
  const startGame = useOregonTrailStore((s) => s.startGame);
  // A new journey starts with the last one's choices already filled in.
  const [name, setName] = useState(() => useOregonTrailStore.getState().leaderName);
  const [occ, setOcc] = useState<OccupationType>(() => useOregonTrailStore.getState().occupation);
  const [party, setParty] = useState(() => {
    const last = useOregonTrailStore.getState().party.map((m) => m.name);
    return [0, 1, 2, 3].map((i) => last[i] ?? "");
  });
  const [month, setMonth] = useState<Month>(() => useOregonTrailStore.getState().departureMonth);

  if (gamePhase === "title") {
    // The shared start screen. It covers the page on its own (it portals to
    // document.body); this container is the page behind it. Play moves to
    // the first setup step.
    return (
      <div className="relative h-full bg-amber-900 text-amber-100">
        <GameStartOverlay
          title="The Oregon Trail"
          emoji="🐂"
          subtitle="Take your wagon all the way to Oregon!"
          touchHints={[
            "🛒 Tap to pick your job and buy supplies",
            "🐂 Tap to travel, rest, and hunt",
            "🏔️ Keep your family well and reach Oregon",
          ]}
          keyboardHints={[
            "🖱️ Click to pick your job and buy supplies",
            "🐂 Click to travel, rest, and hunt",
            "🏔️ Keep your family well and reach Oregon",
          ]}
          startLabel="▶ Start Journey!"
          onStart={() => setPhase("setup_name")}
        />
      </div>
    );
  }

  if (gamePhase === "setup_name") {
    const ready = name.trim().length > 0;
    return (
      <Screen
        testId="oregon-setup-name"
        title="What is your name, wagon leader?"
        speak={`What is your name, wagon leader? Type your name. Then pick your job: ${OCCUPATIONS.map(
          (o) => `${o.name}. ${o.description}`
        ).join(" ")}`}
        actions={
          <MainAction hint={ready ? undefined : "✏️ Type your name to go on"}>
            <button type="button" onClick={() => ready && setPhase("setup_party")} className={MAIN_ACTION} disabled={!ready}>
              Next ▶
            </button>
          </MainAction>
        }
      >
        <input
          type="text"
          aria-label="Your name"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="off"
          enterKeyHint="next"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={INPUT}
          placeholder="Your first name"
        />
        <h3 className="mb-2 mt-4 text-lg font-bold short:mb-1 short:mt-2 short:text-base">Choose your job:</h3>
        <div data-testid="oregon-jobs" className="grid gap-2 short:grid-cols-3">
          {OCCUPATIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={occ === o.id}
              onClick={() => setOcc(o.id)}
              className={choiceClass(occ === o.id)}
            >
              <span className="flex flex-col items-start">
                <span className="text-lg font-bold short:text-base">
                  {occ === o.id ? "✓ " : ""}
                  {o.name} · ${o.startingMoney}
                </span>
                <span className="text-base font-normal short:text-sm">{o.description}</span>
              </span>
            </button>
          ))}
        </div>
      </Screen>
    );
  }

  if (gamePhase === "setup_party") {
    return (
      <Screen
        testId="oregon-setup-party"
        title="Name your family!"
        speak={`Name your family. Four people ride in your wagon. Type a name in each box. An empty box keeps its name: ${DEFAULT_MEMBER_NAMES.join(", ")}.`}
        actions={
          <div className="flex gap-2">
            <button type="button" onClick={() => setPhase("setup_name")} className="btn h-12 min-h-12 short:h-11 short:min-h-11">
              ◀ Back
            </button>
            <div className="flex-1">
              <button type="button" onClick={() => setPhase("setup_month")} className={MAIN_ACTION}>
                Next ▶
              </button>
            </div>
          </div>
        }
      >
        <div className="grid gap-2 short:grid-cols-2">
          {party.map((p, i) => (
            <input
              key={i}
              type="text"
              aria-label={`Family member ${i + 1}`}
              value={p}
              maxLength={NAME_MAX}
              autoComplete="off"
              enterKeyHint={i < 3 ? "next" : "done"}
              onChange={(e) => setParty(party.map((old, j) => (j === i ? e.target.value : old)))}
              className={INPUT}
              placeholder={DEFAULT_MEMBER_NAMES[i]}
            />
          ))}
        </div>
      </Screen>
    );
  }

  if (gamePhase === "setup_month") {
    return (
      <Screen
        testId="oregon-setup-month"
        title="When will you leave?"
        speak={`When will you leave? Pick a month: ${Object.values(MONTH_NAMES).join(", ")}. Then start the journey.`}
        actions={
          <div className="flex gap-2">
            <button type="button" onClick={() => setPhase("setup_party")} className="btn h-12 min-h-12 short:h-11 short:min-h-11">
              ◀ Back
            </button>
            <div className="flex-1">
              <button
                type="button"
                onClick={() =>
                  startGame(
                    name.trim(),
                    occ,
                    party.map((p, i) => p.trim() || DEFAULT_MEMBER_NAMES[i]),
                    month
                  )
                }
                className={MAIN_ACTION}
              >
                🐂 Start the journey!
              </button>
            </div>
          </div>
        }
      >
        <div data-testid="oregon-months" className="grid grid-cols-2 gap-2 short:grid-cols-5">
          {(Object.keys(MONTH_NAMES) as Month[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={month === m}
              onClick={() => setMonth(m)}
              className={`${choiceClass(month === m)} justify-center text-lg font-bold`}
            >
              {month === m ? "✓ " : ""}
              {MONTH_NAMES[m]}
            </button>
          ))}
        </div>
      </Screen>
    );
  }
  return null;
}
