"use client";
import { useState } from "react";
import { useOregonTrailStore } from "../lib/store";
import { STORE_PRICES, LANDMARKS } from "../lib/constants";
import type { Supplies } from "../types";
import { MAIN_ACTION, Screen } from "./Screen";

type ItemId = keyof typeof STORE_PRICES;

interface StoreItem {
  id: ItemId;
  emoji: string;
  name: string;
  /** How many one tap buys. */
  unit: number;
  /** The words for what you have. */
  have: (s: Supplies) => string;
}

export const STORE_ITEMS: StoreItem[] = [
  { id: "oxen", emoji: "🐂", name: "Oxen", unit: 1, have: (s) => `${s.oxen} oxen` },
  { id: "food", emoji: "🍖", name: "Food", unit: 50, have: (s) => `${s.food} lbs` },
  { id: "clothing", emoji: "🧥", name: "Clothes", unit: 1, have: (s) => `${s.clothing} sets` },
  { id: "ammunition", emoji: "🎯", name: "Bullets", unit: 20, have: (s) => `${s.ammunition} bullets` },
  { id: "wheel", emoji: "🛞", name: "Spare wheel", unit: 1, have: (s) => `${s.spareParts.wheels}` },
  { id: "axle", emoji: "🔩", name: "Spare axle", unit: 1, have: (s) => `${s.spareParts.axles}` },
  { id: "tongue", emoji: "🪵", name: "Spare tongue", unit: 1, have: (s) => `${s.spareParts.tongues}` },
];

/** Dollars as a kid reads them: $1,600 or $0.20. */
export function money(amount: number): string {
  return amount % 1 === 0 ? `$${amount.toLocaleString("en-US")}` : `$${amount.toFixed(2)}`;
}

export function Store() {
  const supplies = useOregonTrailStore((s) => s.supplies);
  const currentLandmarkIndex = useOregonTrailStore((s) => s.currentLandmarkIndex);
  const buySupply = useOregonTrailStore((s) => s.buySupply);
  const sellSupply = useOregonTrailStore((s) => s.sellSupply);
  const leaveStore = useOregonTrailStore((s) => s.leaveStore);
  // What was bought on this visit: a mis-tapped Buy can be taken back, but
  // only what was bought here (never the supplies the wagon came in with).
  const [basket, setBasket] = useState<Partial<Record<ItemId, number>>>({});
  const lm = LANDMARKS[currentLandmarkIndex];

  // A wagon with no oxen cannot move: while the kid can still pay for one,
  // the store does not let them leave without it.
  const needsOxen = supplies.oxen <= 0 && supplies.money >= STORE_PRICES.oxen;

  const buy = (item: StoreItem) => {
    if (supplies.money < STORE_PRICES[item.id] * item.unit) return;
    buySupply(item.id, item.unit);
    setBasket((b) => ({ ...b, [item.id]: (b[item.id] ?? 0) + 1 }));
  };
  const undo = (item: StoreItem) => {
    if (!basket[item.id]) return;
    sellSupply(item.id, item.unit);
    setBasket((b) => ({ ...b, [item.id]: (b[item.id] ?? 1) - 1 }));
  };

  return (
    <Screen
      testId="oregon-store"
      title={
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span>🏪 {lm?.name || "Independence"} store</span>
          <span data-testid="oregon-money" className="text-amber-300">
            💰 {money(supplies.money)}
          </span>
        </span>
      }
      speak={() =>
        `The store at ${lm?.name || "Independence"}. You have ${money(supplies.money)}. ` +
        STORE_ITEMS.map((i) => `${i.name}: ${money(STORE_PRICES[i.id] * i.unit)} for ${i.unit}.`).join(" ") +
        (needsOxen ? " You need oxen to pull your wagon." : "")
      }
      actions={
        <div className="flex flex-col gap-1">
          {needsOxen && (
            <p data-testid="oregon-needs-oxen" className="text-center text-base font-bold text-amber-200">
              🐂 Buy oxen to pull your wagon!
            </p>
          )}
          <button type="button" onClick={leaveStore} disabled={needsOxen} className={MAIN_ACTION}>
            🐂 Leave the store
          </button>
        </div>
      }
    >
      <ul className="grid gap-2 short:grid-cols-2">
        {STORE_ITEMS.map((item) => {
          const cost = STORE_PRICES[item.id] * item.unit;
          const canBuy = supplies.money >= cost;
          const bought = basket[item.id] ?? 0;
          return (
            <li
              key={item.id}
              data-testid={`oregon-item-${item.id}`}
              className="flex items-center gap-2 rounded-lg bg-amber-800 px-3 py-1.5"
            >
              <span aria-hidden="true" className="text-2xl">
                {item.emoji}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-base font-bold">
                  {item.name} <span className="font-normal">· {money(cost)}{item.unit > 1 ? ` for ${item.unit}` : ""}</span>
                </div>
                <div className="text-sm">You have {item.have(supplies)}</div>
              </div>
              <button
                type="button"
                onClick={() => undo(item)}
                disabled={bought === 0}
                aria-label={`Put back ${item.unit > 1 ? item.unit : "one"} ${item.name}`}
                className="btn h-11 min-h-11 w-11 border-0 bg-amber-950 p-0 text-xl text-amber-50 disabled:bg-amber-900 disabled:text-amber-700"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => buy(item)}
                disabled={!canBuy}
                aria-label={`Buy ${item.unit > 1 ? item.unit : "one"} ${item.name} for ${money(cost)}`}
                className="btn btn-primary h-11 min-h-11 px-3 text-base"
              >
                +{item.unit > 1 ? item.unit : ""} Buy
              </button>
            </li>
          );
        })}
      </ul>
    </Screen>
  );
}
