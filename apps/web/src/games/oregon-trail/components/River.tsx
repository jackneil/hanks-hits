"use client";
import { useOregonTrailStore } from "../lib/store";

export function River() {
  const { currentRiver, supplies, crossRiver } = useOregonTrailStore();
  if (!currentRiver) return null;
  return (
    <div className="min-h-full flex items-center justify-center bg-blue-900 p-4">
      <div className="bg-blue-700 p-8 rounded-lg text-white text-center max-w-md">
        <h2 className="text-3xl mb-4">{currentRiver.name}</h2>
        <p className="text-xl mb-2">Depth: {currentRiver.depth} feet</p>
        <p className="mb-6">How will you cross?</p>
        <div className="flex flex-col gap-2">
          <button onClick={() => crossRiver("ford")} className="btn btn-primary">Ford (free, risky if deep)</button>
          <button onClick={() => crossRiver("caulk")} className="btn btn-secondary">Float across (risky)</button>
          <button onClick={() => crossRiver("ferry")} disabled={supplies.money < 20} className="btn btn-accent">Ferry ($20)</button>
        </div>
      </div>
    </div>
  );
}
