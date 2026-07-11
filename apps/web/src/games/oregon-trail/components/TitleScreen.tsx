"use client";
import { useState } from "react";
import { useOregonTrailStore } from "../lib/store";
import { OCCUPATIONS, MONTH_NAMES } from "../lib/constants";
import type { OccupationType, Month } from "../types";

export function TitleScreen() {
  const { setPhase, startGame, gamePhase } = useOregonTrailStore();
  const [name, setName] = useState("");
  const [occ, setOcc] = useState<OccupationType>("banker");
  const [party, setParty] = useState(["", "", "", ""]);
  const [month, setMonth] = useState<Month>("march");

  if (gamePhase === "title") {
    return (
      // start-overlay layer: the title may render once here (measured by the battery)
      <div
        data-testid="game-start-overlay"
        className="flex flex-col items-center justify-center min-h-screen bg-amber-900 text-amber-100 p-4"
      >
        <h1 className="text-5xl font-bold mb-4">The Oregon Trail</h1>
        <p className="text-xl mb-8">Adventure awaits on the trail to Oregon!</p>
        <button onClick={() => setPhase("setup_name")} className="btn btn-primary btn-lg text-xl">Start Journey!</button>
      </div>
    );
  }

  if (gamePhase === "setup_name") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-amber-900 text-amber-100 p-4">
        <h2 className="text-2xl md:text-3xl mb-6 text-center">What is your name, wagon leader?</h2>
        <input type="text" value={name} onChange={e => setName(e.target.value)} className="input input-bordered text-black text-xl w-full max-w-xs mb-4" placeholder="Enter your name" />
        <h3 className="text-xl mb-2">Choose your job:</h3>
        <div className="flex flex-wrap justify-center gap-2 mb-6 max-w-md">
          {OCCUPATIONS.map(o => (
            <button key={o.id} onClick={() => setOcc(o.id)} className={"btn btn-md " + (occ === o.id ? "btn-primary" : "btn-ghost")}>{o.name}<br/><small>{o.description}</small></button>
          ))}
        </div>
        <button onClick={() => name && setPhase("setup_party")} className="btn btn-primary btn-lg" disabled={!name}>Next</button>
      </div>
    );
  }

  if (gamePhase === "setup_party") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-amber-900 text-amber-100 p-4">
        <h2 className="text-2xl md:text-3xl mb-6 text-center">Name your party members!</h2>
        {party.map((p, i) => (
          <input key={i} type="text" value={p} onChange={e => { const np = [...party]; np[i] = e.target.value; setParty(np); }} className="input input-bordered text-black mb-2 w-full max-w-xs" placeholder={"Member " + (i+1)} />
        ))}
        <button onClick={() => setPhase("setup_month")} className="btn btn-primary btn-lg mt-4">Next</button>
      </div>
    );
  }

  if (gamePhase === "setup_month") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-amber-900 text-amber-100 p-4">
        <h2 className="text-2xl md:text-3xl mb-6 text-center">When will you leave?</h2>
        <div className="flex flex-wrap justify-center gap-2 mb-6 max-w-sm">
          {(Object.keys(MONTH_NAMES) as Month[]).map(m => (
            <button key={m} onClick={() => setMonth(m)} className={"btn btn-md " + (month === m ? "btn-primary" : "btn-ghost")}>{MONTH_NAMES[m]}</button>
          ))}
        </div>
        <button onClick={() => startGame(name, occ, party, month)} className="btn btn-primary btn-lg">Start the Journey!</button>
      </div>
    );
  }
  return null;
}
