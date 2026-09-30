"use client";

import { useWordleStore } from "../lib/store";
import { LETTER_COLORS } from "../lib/constants";
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";

// Example tiles for demonstration
const ExampleTile = ({
  letter,
  status,
}: {
  letter: string;
  status: "correct" | "present" | "absent" | "empty";
}) => (
  <div
    className={`
      w-10 h-10 sm:w-12 sm:h-12
      flex items-center justify-center font-bold text-lg sm:text-xl uppercase
      border-2 rounded
      ${LETTER_COLORS[status]}
    `}
  >
    {letter}
  </div>
);

export function TutorialModal() {
  const { showTutorial, closeTutorial } = useWordleStore();
  const isCoarse = useCoarsePointer();

  if (!showTutorial) return null;

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={closeTutorial}
      />

      {/* Modal */}
      <div className="relative bg-slate-800 rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-700">
        <h2 className="text-2xl font-bold text-center mb-6">How To Play</h2>

        {/* Goal */}
        <div className="mb-6">
          <p className="text-lg text-center text-slate-300">
            Guess the secret word in 6 tries!
          </p>
        </div>

        {/* Color meanings */}
        <div className="space-y-4 mb-6">
          <h3 className="font-bold text-lg">What the colors mean:</h3>

          {/* Green example */}
          <div className="flex items-center gap-3">
            <ExampleTile letter="H" status="correct" />
            <span className="text-slate-300">
              <span className="text-green-400 font-bold">Green</span> = Right
              letter, right spot!
            </span>
          </div>

          {/* Yellow example */}
          <div className="flex items-center gap-3">
            <ExampleTile letter="A" status="present" />
            <span className="text-slate-300">
              <span className="text-yellow-400 font-bold">Yellow</span> = Right
              letter, wrong spot
            </span>
          </div>

          {/* Gray example */}
          <div className="flex items-center gap-3">
            <ExampleTile letter="N" status="absent" />
            <span className="text-slate-300">
              <span className="text-gray-400 font-bold">Gray</span> = Letter not
              in the word
            </span>
          </div>
        </div>

        {/* Example word */}
        <div className="mb-6">
          <h3 className="font-bold text-lg mb-3">Example:</h3>
          <div className="flex gap-1 justify-center mb-2">
            <ExampleTile letter="H" status="correct" />
            <ExampleTile letter="A" status="present" />
            <ExampleTile letter="P" status="absent" />
            <ExampleTile letter="P" status="absent" />
            <ExampleTile letter="Y" status="correct" />
          </div>
          <p className="text-sm text-slate-400 text-center">
            H and Y are correct. A is in the word but wrong spot. P is not in
            the word.
          </p>
        </div>

        {/* Shake explanation */}
        <div className="mb-6 p-4 bg-red-900/30 rounded-xl border border-red-700/50">
          <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
            <span className="animate-pulse">📳</span> Row Shakes?
          </h3>
          <p className="text-slate-300">
            If the row <span className="font-bold text-red-400">shakes</span>{" "}
            {isCoarse ? "after you tap ENTER" : "after you press Enter"}, it
            means that word isn&apos;t recognized. Try a different real word!
          </p>
        </div>

        {/* Tips */}
        <div className="mb-6">
          <h3 className="font-bold text-lg mb-2">Tips:</h3>
          <ul className="text-slate-300 space-y-1 text-sm">
            <li>• Start with common letters like E, A, R, T, O</li>
            <li>• Use the hint button if you get stuck!</li>
            <li>• The keyboard shows which letters you&apos;ve tried</li>
          </ul>
        </div>

        {/* Close button */}
        <button
          onClick={closeTutorial}
          className="w-full btn btn-primary btn-lg text-xl rounded-full"
        >
          Got it!
        </button>
      </div>
    </div>
  );
}
