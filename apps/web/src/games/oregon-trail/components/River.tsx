"use client";
import { useOregonTrailStore } from "../lib/store";
import { Screen } from "./Screen";

export const FERRY_PRICE = 20;

export function River() {
  const currentRiver = useOregonTrailStore((s) => s.currentRiver);
  const money = useOregonTrailStore((s) => s.supplies.money);
  const crossRiver = useOregonTrailStore((s) => s.crossRiver);
  if (!currentRiver) return null;
  const choice = "btn h-12 min-h-12 w-full text-lg short:h-11 short:min-h-11";
  return (
    <Screen
      testId="oregon-river"
      tone="blue"
      title={`🌊 ${currentRiver.name}`}
      speak={`${currentRiver.name}. The river is ${currentRiver.depth} feet deep. How will you cross? Ford: walk the wagon across, free, risky if it is deep. Float: float the wagon across, risky. Ferry: a boat takes you, it costs ${FERRY_PRICE} dollars.`}
      actions={
        <div className="grid gap-2 short:grid-cols-3">
          <button type="button" onClick={() => crossRiver("ford")} className={`${choice} btn-primary`}>
            🚶 Ford (free)
          </button>
          <button type="button" onClick={() => crossRiver("caulk")} className={`${choice} btn-secondary`}>
            🛶 Float across
          </button>
          <button type="button" onClick={() => crossRiver("ferry")} disabled={money < FERRY_PRICE} className={`${choice} btn-accent`}>
            ⛴️ Ferry (${FERRY_PRICE})
          </button>
        </div>
      }
    >
      <div className="flex min-h-full flex-col items-center justify-center text-center">
        <p className="text-2xl font-bold">{currentRiver.depth} feet deep</p>
        <p className="mt-1 text-lg">
          {currentRiver.depth > 4 ? "It is deep! Fording is risky." : "It is not too deep."} How will you cross?
        </p>
      </div>
    </Screen>
  );
}
