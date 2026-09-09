import { FISH_TYPES } from "./constants";
export type FishType = (typeof FISH_TYPES)[number];

export const FISH = {
  little: { label: "Little", value: 1000, color: "#9ac0e0", size: 0.4 },
  middle: { label: "Middle", value: 10000, color: "#5fae7f", size: 0.62 },
  big: { label: "Big", value: 15000, color: "#caa050", size: 0.9 },
  huge: { label: "Huge", value: 30000, color: "#c8643c", size: 1.3 },
  rainbow: { label: "Rainbow", value: 1000000, color: "#ee75b5", size: 0.8 },
} as const;
const chances = (values: number[]) =>
  Object.fromEntries(FISH_TYPES.map((key, i) => [key, values[i]])) as Record<
    FishType,
    number
  >;
export const BAITS: Record<
  string,
  { label: string; price: number; chances: Record<FishType, number> }
> = {
  cheap: {
    label: "Cheap bait",
    price: 100,
    chances: chances([0.9, 0.3, 0.15, 0.08, 0.03]),
  },
  bad: { label: "Bad bait", price: 400, chances: chances([0.85, 0, 0, 0, 0]) },
  good: {
    label: "Good bait",
    price: 1000,
    chances: chances([0.72, 0.62, 0.42, 0.22, 0.05]),
  },
  mediocre: {
    label: "Mediocre bait",
    price: 4000,
    chances: chances([0.5, 0.72, 0.64, 0.34, 0.06]),
  },
  pro: {
    label: "Pro bait",
    price: 10000,
    chances: chances([0.72, 0.74, 0.68, 0.54, 0.1]),
  },
  ace: {
    label: "Ace bait",
    price: 20000,
    chances: chances([0.46, 0.46, 0.46, 0.46, 0.16]),
  },
  rainbow: {
    label: "Rainbow bait",
    price: 100000,
    chances: chances([0.98, 0.98, 0.98, 0.98, 0.98]),
  },
};
export const BASE_CHANCE = chances([0.55, 0.45, 0.35, 0.25, 0.12]);
export type LakeFish = {
  id: number;
  type: FishType;
  x: number;
  z: number;
  heading: number;
  speed: number;
  alive: boolean;
  respawnIn: number;
};
export type FishingSession = {
  phase: "idle" | "casting" | "bite" | "reeling" | "caught" | "escaped";
  fishId: string | null;
  species: FishType | null;
  wait: number;
  rainbowCelebration: number;
  tension: number;
  reelProgress: number;
  reeling: boolean;
  message: string;
};
export function createFishingSession(): FishingSession {
  return {
    rainbowCelebration: 0,
    phase: "idle",
    fishId: null,
    species: null,
    wait: 0,
    tension: 0.25,
    reelProgress: 0,
    reeling: false,
    message: "Cast near a school of fish.",
  };
}
export function createLakeFish(random = Math.random): LakeFish[] {
  const fish: LakeFish[] = [];
  for (let i = 0; i < 902; i++) {
    const heading = random() * Math.PI * 2;
    const radius = i >= 900 ? random() * 11 : random() * 355;
    const roll = random();
    const type =
      i >= 900
        ? "rainbow"
        : roll < 0.55
          ? "little"
          : roll < 0.8
            ? "middle"
            : roll < 0.93
              ? "big"
              : "huge";
    fish.push({
      id: i,
      type,
      x: Math.sin(heading) * radius,
      z: Math.cos(heading) * radius,
      heading,
      speed: 0.6 + random() * 0.7,
      alive: true,
      respawnIn: 0,
    });
  }
  return fish;
}
export function advanceFish(fish: LakeFish[], dt: number): void {
  for (const f of fish) {
    if (!f.alive) {
      f.respawnIn -= dt;
      if (f.respawnIn <= 0) {
        f.alive = true;
        if (f.type === "rainbow") {
          f.x = 0;
          f.z = 0;
        }
      }
      continue;
    }
    f.heading += Math.sin(f.id * 2.1 + f.x * 0.05) * 0.18 * dt;
    const x = f.x + Math.sin(f.heading) * f.speed * dt;
    const z = f.z + Math.cos(f.heading) * f.speed * dt;
    if (Math.hypot(x, z) > 357) f.heading += Math.PI;
    else {
      f.x = x;
      f.z = z;
    }
  }
}
export function nearbyFish(
  fish: LakeFish[],
  x: number,
  z: number,
  radius: number,
  limit: number,
): LakeFish[] {
  return fish
    .filter((f) => f.alive && Math.hypot(f.x - x, f.z - z) <= radius)
    .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))
    .slice(0, limit);
}
/** The original per-species odds, including bad bait's zero chance for larger fish. */
export function biteChance(species: FishType, bait: string | null): number {
  return (bait && BAITS[bait] ? BAITS[bait].chances : BASE_CHANCE)[species];
}
export function catchLakeFish(fish: LakeFish): void {
  if (fish.type === "rainbow") {
    fish.alive = true;
    fish.respawnIn = 0;
    fish.x = 0;
    fish.z = 0;
  } else {
    fish.alive = false;
    fish.respawnIn = 90;
  }
}
export function rollCastTargets(
  population: LakeFish[],
  x: number,
  z: number,
  rods: number,
  bait: string | null,
  rainbowUses: number,
  random = Math.random,
): LakeFish[] {
  const targets = nearbyFish(
    population,
    x,
    z,
    360 / 18,
    Math.max(0, Math.floor(rods)),
  );
  const hooked: LakeFish[] = [];
  let uses = rainbowUses;
  for (const fish of targets) {
    const active = bait === "rainbow" && uses <= 0 ? null : bait;
    if (random() < biteChance(fish.type, active)) {
      hooked.push(fish);
      if (active === "rainbow") uses--;
    }
  }
  return hooked;
}
export function netFish(
  population: LakeFish[],
  x: number,
  z: number,
): LakeFish[] {
  const caught = nearbyFish(population, x, z, 480 / 18, population.length)
    .filter((f) => f.type !== "rainbow")
    .slice(0, 16);
  caught.forEach(catchLakeFish);
  return caught;
}
/** Pull in short bursts. Releasing cools the line while the fish gives back a little distance. */
export function advanceReel(session: FishingSession, dt: number): void {
  if (session.phase !== "bite" && session.phase !== "reeling") return;
  const difficulty = session.species ? FISH_TYPES.indexOf(session.species) : 0;
  session.wait += dt;
  if (session.phase === "bite" && !session.reeling) {
    if (session.wait > 5) {
      session.phase = "escaped";
      session.message = "The fish slipped away. Cast again.";
    }
    return;
  }
  session.phase = "reeling";
  session.tension = Math.max(
    0.05,
    Math.min(
      1.05,
      session.tension +
        (session.reeling ? 0.22 + difficulty * 0.025 : -0.48) * dt,
    ),
  );
  session.reelProgress = Math.max(
    0,
    Math.min(
      1,
      session.reelProgress +
        (session.reeling ? 0.2 - difficulty * 0.015 : -0.025) * dt,
    ),
  );
  if (session.tension >= 1) {
    session.phase = "escaped";
    session.message = "The line snapped. Release sooner next time.";
  } else if (session.reelProgress >= 1) {
    session.phase = "caught";
    session.message = "Fish landed!";
  }
}
export function fishSaleValue(counts: Record<string, number>): number {
  return FISH_TYPES.filter((t) => t !== "rainbow").reduce(
    (sum, t) => sum + Math.max(0, counts[t] ?? 0) * FISH[t].value,
    0,
  );
}
