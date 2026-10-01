"use client";
import { useOregonTrailStore } from "../lib/store";
import { MAIN_ACTION, Screen, type ScreenTone } from "./Screen";

const TONE: Record<string, ScreenTone> = { positive: "green", neutral: "amber", negative: "amber", severe: "red" };

export function Event() {
  const currentEvent = useOregonTrailStore((s) => s.currentEvent);
  const dismissEvent = useOregonTrailStore((s) => s.dismissEvent);
  if (!currentEvent) return null;
  return (
    <Screen
      testId="oregon-event"
      tone={TONE[currentEvent.category] ?? "amber"}
      speak={`${currentEvent.title} ${currentEvent.message}`}
      actions={
        <button type="button" onClick={dismissEvent} className={MAIN_ACTION}>
          Continue ▶
        </button>
      }
    >
      <div className="flex min-h-full flex-col items-center justify-center py-2 text-center">
        <h2 className="mb-3 text-3xl font-bold short:mb-1 short:text-2xl">{currentEvent.title}</h2>
        <p className="max-w-md text-xl short:text-lg">{currentEvent.message}</p>
      </div>
    </Screen>
  );
}
