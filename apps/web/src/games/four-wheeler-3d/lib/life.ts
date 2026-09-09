import {
  createAdventureProgress,
  type AdventureProgress,
} from "./adventureTypes";
import type { FourWheeler3dProgress } from "./store";

export function eatMeal(
  p: FourWheeler3dProgress,
): FourWheeler3dProgress | null {
  return p.money < 100 ? null : { ...p, money: p.money - 100, hunger: 0 };
}
export function feedDog(
  p: FourWheeler3dProgress,
): FourWheeler3dProgress | null {
  return p.money < 10
    ? null
    : {
        ...p,
        money: p.money - 10,
        adventure: { ...p.adventure, dog: { hungerHours: 0, alive: true } },
      };
}
/** Starvation follows the original reset policy; purchased land remains yours. */
export function hungerReset(p: FourWheeler3dProgress): FourWheeler3dProgress {
  const a = createAdventureProgress();
  return {
    ...p,
    money: 20000,
    currentVehicle: "atv",
    paint: "#e63946",
    ownedVehicles: ["atv"],
    trophies: 0,
    fishCaught: { little: 0, middle: 0, big: 0, huge: 0, rainbow: 0 },
    hunger: 0,
    adventure: {
      ...a,
      plots: p.adventure.plots,
      rocketOwned: p.adventure.rocketOwned,
    },
  };
}
export function saddleHorse(
  a: AdventureProgress,
  id: string,
): AdventureProgress | null {
  const horse = a.horses.find((h) => h.id === id),
    key = Object.keys(a.inventory).find(
      (k) => k.startsWith("saddle-") && a.inventory[k] > 0,
    );
  if (!horse || horse.saddle || !key) return null;
  return {
    ...a,
    inventory: { ...a.inventory, [key]: a.inventory[key] - 1 },
    horses: a.horses.map((h) => (h.id === id ? { ...h, saddle: key } : h)),
  };
}
