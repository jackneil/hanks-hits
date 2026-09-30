"use client";
import { useOregonTrailStore } from "../lib/store";

export function Event() {
  const { currentEvent, dismissEvent } = useOregonTrailStore();
  if (!currentEvent) return null;
  const bg = currentEvent.category === "positive" ? "bg-green-700" : currentEvent.category === "severe" ? "bg-red-700" : "bg-amber-700";
  return (
    <div className="min-h-full flex items-center justify-center bg-amber-900 p-4">
      <div className={bg + " p-8 rounded-lg text-white text-center max-w-md"}>
        <h2 className="text-3xl mb-4">{currentEvent.title}</h2>
        <p className="text-xl mb-6">{currentEvent.message}</p>
        <button onClick={dismissEvent} className="btn btn-primary btn-lg">Continue</button>
      </div>
    </div>
  );
}
