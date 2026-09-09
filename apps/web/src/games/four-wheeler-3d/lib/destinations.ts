import {
  CABINS,
  LANDMARKS,
  LAND_PLOTS,
  RACE_START,
  TRAIN_SPUR_END,
  TREESTANDS,
} from "./landmarks";
import { STORE_LABELS, type StoreId } from "./catalog";

export type Destination = {
  id: string;
  label: string;
  x: number;
  z: number;
  kind:
    | "shop"
    | "home"
    | "garage"
    | "trophies"
    | "race"
    | "train"
    | "land"
    | "fishing"
    | "stand"
    | "dog"
    | "wash"
    | "sell"
    | "launch"
    | "activities";
  icon: string;
  radius: number;
};
export const DESTINATIONS: readonly Destination[] = [
  {
    id: "yard",
    label: "Adventure Yard",
    x: -479,
    z: 38,
    kind: "activities",
    icon: "✦",
    radius: 30,
  },
  ...Object.entries(STORE_LABELS).map(([id, label]) => ({
    id,
    label,
    ...LANDMARKS[id as StoreId],
    kind: "shop" as const,
    icon: "▦",
    radius: 10,
  })),
  {
    id: "house",
    label: "Home",
    ...LANDMARKS.house,
    kind: "home",
    icon: "⌂",
    radius: 11,
  },
  {
    id: "garage",
    label: "Your Garage",
    ...LANDMARKS.garage,
    kind: "garage",
    icon: "▤",
    radius: 13,
  },
  {
    id: "customGarage",
    label: "Paint & Performance",
    ...LANDMARKS.customGarage,
    kind: "garage",
    icon: "◈",
    radius: 10,
  },
  {
    id: "trophyRoom",
    label: "Trophy Room",
    ...LANDMARKS.trophyRoom,
    kind: "trophies",
    icon: "♜",
    radius: 10,
  },
  {
    id: "lake",
    label: "Lake & Fishing",
    ...LANDMARKS.dockLand,
    kind: "fishing",
    icon: "≈",
    radius: 16,
  },
  {
    id: "race",
    label: "County Raceway",
    ...RACE_START,
    kind: "race",
    icon: "⚑",
    radius: 25,
  },
  {
    id: "train",
    label: "Home Station",
    ...TRAIN_SPUR_END,
    kind: "train",
    icon: "▥",
    radius: 15,
  },
  {
    id: "dogHouse",
    label: "Dog House",
    ...LANDMARKS.dogHouse,
    kind: "dog",
    icon: "♧",
    radius: 7,
  },
  {
    id: "carWash",
    label: "Car Wash",
    ...LANDMARKS.carWash,
    kind: "wash",
    icon: "✦",
    radius: 10,
  },
  {
    id: "sellBox",
    label: "Sell Box",
    ...LANDMARKS.sellBox,
    kind: "sell",
    icon: "$",
    radius: 6,
  },
  {
    id: "launchPad",
    label: "Space Launch",
    ...LANDMARKS.launchPad,
    kind: "launch",
    icon: "↑",
    radius: 10,
  },
  ...TREESTANDS.map((p, i) => ({
    id: `stand-${i}`,
    label: `Hunting Stand ${i + 1}`,
    ...p,
    kind: "stand" as const,
    icon: "⌖",
    radius: 7,
  })),
  ...LAND_PLOTS.map((p, i) => ({
    ...p,
    label: `Land Plot ${i + 1}`,
    kind: "land" as const,
    icon: "◇",
    radius: p.size / 2,
  })),
  ...CABINS.map((p, i) => ({
    id: `cabin-${i}`,
    label: `Trail Cabin ${i + 1}`,
    ...p,
    kind: "home" as const,
    icon: "⌂",
    radius: 10,
  })),
];

export function distanceTo(
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
export function nearbyDestination(position: {
  x: number;
  z: number;
}): Destination | undefined {
  return DESTINATIONS.filter((d) => distanceTo(position, d) <= d.radius).sort(
    (a, b) => distanceTo(position, a) - distanceTo(position, b),
  )[0];
}

/** Route along the lake shore when a direct land route would cross water. */
export function routeTo(
  from: { x: number; z: number },
  to: { x: number; z: number },
): { x: number; z: number }[] {
  const radius = 390;
  const dx = to.x - from.x,
    dz = to.z - from.z,
    length2 = dx * dx + dz * dz;
  if (!length2) return [from, to];
  const t = Math.max(0, Math.min(1, -(from.x * dx + from.z * dz) / length2));
  if (
    Math.hypot(from.x + t * dx, from.z + t * dz) > radius ||
    Math.hypot(from.x, from.z) < 372 ||
    Math.hypot(to.x, to.z) < 372
  )
    return [from, to];
  const start = Math.atan2(from.z, from.x),
    end = Math.atan2(to.z, to.x);
  const sweep = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  const points = [from];
  for (let i = 0; i <= 16; i++) {
    const angle = start + (sweep * i) / 16;
    points.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
  }
  return [...points, to];
}
