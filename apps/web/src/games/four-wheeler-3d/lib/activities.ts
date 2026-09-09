import type {
  AdventureProgress,
  AdventurePosition,
  FleetVehicle,
} from "./adventureTypes";
import { isLandVehicle, isWaterVehicle, isTrailer } from "./catalog";
import { LANDMARKS, WONDERLAND } from "./landmarks";
import { tuningFor } from "./vehicles";

export type ActivitiesProgress = {
  mowerOn: boolean;
  cutGrass: Record<string, number>;
  plowVehicleId: string | null;
  plowDown: boolean;
  plowLoad: number;
  snowPiles: { x: number; z: number; size: number }[];
  brokenProps: string[];
  goals: number;
};
export const createActivitiesProgress = (): ActivitiesProgress => ({
  mowerOn: false,
  cutGrass: {},
  plowVehicleId: null,
  plowDown: false,
  plowLoad: 0,
  snowPiles: [],
  brokenProps: [],
  goals: 0,
});
export const GRASS_CELL = 110 / 18;
export type ActivityLocation = {
  id: string;
  x: number;
  z: number;
  kind: string;
};
const YARD_NAMES = [
  "trampoline",
  "hoop",
  "goal",
  "slide",
  "seesaw",
  "castle",
  "sandbox",
  "campfire",
  "bbq",
  "picnic",
  "umbrella",
  "lemonade",
  "fountain",
  "statue",
  "windmill",
  "garden",
  "pumpkins",
  "hay",
  "scarecrow",
  "coop",
  "swings",
  "treehouse",
];
// A dedicated recreation lawn south of the hub keeps physical toys clear of all shop doors.
export const YARD_PROPS: ActivityLocation[] = YARD_NAMES.map((kind, i) => ({
  id: `yard-${kind}`,
  kind,
  x: -504 + (i % 6) * 10,
  z: 22 + Math.floor(i / 6) * 11,
}));
export const WINTER_SLIDE = {
  id: "winter-slide",
  kind: "slide",
  x: WONDERLAND.x + 5,
  z: WONDERLAND.z,
};
export const WINTER_SWINGS = {
  id: "winter-swings",
  kind: "swings",
  x: WONDERLAND.x - 5,
  z: WONDERLAND.z,
};
export const PLAY_LOCATIONS = [...YARD_PROPS, WINTER_SLIDE, WINTER_SWINGS];
export const NOZZLE = {
  x: LANDMARKS.carWash.x - 3.2,
  z: LANDMARKS.carWash.z + 3.1,
};
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);
export function trailerLength(t: FleetVehicle) {
  return t.type === "megatrailer"
    ? 21.1
    : t.type === "trailer" && t.capacity > 1
      ? 7.33
      : t.type === "camper"
        ? 3.56
        : t.type === "boattrailer"
          ? 2.78
          : 2.45;
}
export function hitchPosition(v: FleetVehicle) {
  const l = tuningFor(v.type).chassis.length / 2 + 0.45;
  return {
    x: v.position.x - Math.sin(v.heading) * l,
    z: v.position.z - Math.cos(v.heading) * l,
  };
}
function trailerReach(v: FleetVehicle, p: AdventurePosition) {
  const l = trailerLength(v) / 2;
  return Math.min(
    distance(v.position, p),
    ...[-1, 1].map((s) =>
      distance(
        {
          x: v.position.x + s * Math.sin(v.heading) * l,
          z: v.position.z + s * Math.cos(v.heading) * l,
        },
        p,
      ),
    ),
  );
}
export type ActivityResult = {
  adventure: AdventureProgress;
  message: string;
  exitVehicle?: boolean;
};
export function toggleHitch(
  a: AdventureProgress,
  activeId: string | null,
): ActivityResult {
  const car = activeId ? a.fleet[activeId] : null;
  if (!car || !isLandVehicle(car.type))
    return {
      adventure: a,
      message: "Enter a land vehicle to hitch equipment.",
    };
  if (car.hitch)
    return {
      adventure: {
        ...a,
        fleet: { ...a.fleet, [car.id]: { ...car, hitch: null } },
      },
      message: "Trailer detached.",
    };
  const plow = Object.values(a.fleet).find(
    (v) => v.type === "plow" && distance(v.position, car.position) < 13.34,
  );
  if (plow && a.activities.plowVehicleId !== car.id)
    return {
      adventure: {
        ...a,
        activities: { ...a.activities, plowVehicleId: car.id, plowDown: false },
        fleet: { ...a.fleet, [plow.id]: { ...plow, parked: false } },
      },
      message: "Snow plow attached. Lower it to clear snow.",
    };
  const trailer = Object.values(a.fleet)
    .filter(
      (v) =>
        isTrailer(v.type) &&
        v.type !== "plow" &&
        !Object.values(a.fleet).some((c) => c.hitch === v.id) &&
        trailerReach(v, car.position) < 13.34,
    )
    .sort(
      (l, r) => trailerReach(l, car.position) - trailerReach(r, car.position),
    )[0];
  if (!trailer)
    return {
      adventure: a,
      message: "Park within 44 feet of a trailer to hitch.",
    };
  const ball = hitchPosition(car),
    gap = trailerLength(trailer) / 2 + 0.35;
  const position = {
    ...trailer.position,
    x: ball.x - Math.sin(car.heading) * gap,
    z: ball.z - Math.cos(car.heading) * gap,
  };
  return {
    adventure: {
      ...a,
      fleet: {
        ...a.fleet,
        [car.id]: { ...car, hitch: trailer.id },
        [trailer.id]: { ...trailer, position, heading: car.heading },
      },
    },
    message: "Trailer hitched. Press T to detach.",
  };
}
export function loadOrUnload(
  a: AdventureProgress,
  position: AdventurePosition,
  activeId: string | null,
): ActivityResult {
  const car = activeId ? a.fleet[activeId] : null;
  const trailers = Object.values(a.fleet)
    .filter((v) => v.capacity > 0 && trailerReach(v, position) < 9)
    .sort((l, r) => trailerReach(l, position) - trailerReach(r, position));
  if (car) {
    const trailer = trailers.find((t) =>
      isWaterVehicle(car.type)
        ? t.type === "boattrailer"
        : isLandVehicle(car.type) && t.type !== "boattrailer",
    );
    if (!trailer)
      return {
        adventure: a,
        message: "Bring the vehicle beside a compatible trailer.",
      };
    if (
      car.hitch ||
      car.id === trailer.id ||
      Object.values(a.fleet).some((v) => v.cargo.includes(car.id))
    )
      return { adventure: a, message: "Detach your trailer before loading." };
    if (trailer.cargo.length >= trailer.capacity)
      return { adventure: a, message: "That trailer is full." };
    return {
      adventure: {
        ...a,
        activeVehicleId: null,
        fleet: {
          ...a.fleet,
          [trailer.id]: { ...trailer, cargo: [...trailer.cargo, car.id] },
          [car.id]: { ...car, parked: true },
        },
      },
      message: "Vehicle loaded. Step alongside to unload.",
      exitVehicle: true,
    };
  }
  const trailer = trailers.find((t) => t.cargo.length);
  if (!trailer) return { adventure: a, message: "No loaded trailer nearby." };
  const id = trailer.cargo.at(-1)!,
    cargo = a.fleet[id];
  if (!cargo) return { adventure: a, message: "Cargo is unavailable." };
  const at = {
    x: trailer.position.x + Math.cos(trailer.heading) * 5.12,
    y: trailer.position.y,
    z: trailer.position.z - Math.sin(trailer.heading) * 5.12,
  };
  return {
    adventure: {
      ...a,
      fleet: {
        ...a.fleet,
        [trailer.id]: { ...trailer, cargo: trailer.cargo.slice(0, -1) },
        [id]: {
          ...cargo,
          position: at,
          heading: trailer.heading,
          parked: true,
        },
      },
    },
    message: "Vehicle unloaded beside the trailer.",
  };
}
export function advanceTrailer(
  car: FleetVehicle,
  trailer: FleetVehicle,
  dt: number,
): FleetVehicle {
  const ball = hitchPosition(car),
    heading = Math.atan2(
      ball.x - trailer.position.x,
      ball.z - trailer.position.z,
    ),
    l = trailerLength(trailer) / 2 + 0.35;
  const wrap = Math.atan2(
    Math.sin(heading - trailer.heading),
    Math.cos(heading - trailer.heading),
  );
  const angle = trailer.heading + wrap * (1 - Math.exp(-8 * dt));
  return {
    ...trailer,
    heading: angle,
    position: {
      ...trailer.position,
      x: ball.x - Math.sin(angle) * l,
      z: ball.z - Math.cos(angle) * l,
    },
  };
}
/** Original grassClock resets the entire lawn every 96 game hours. Compact 8x6 tiles use exact 48-bit integer masks. */
export function regrowGrass(cells: Record<string, number>, gameHours: number) {
  if (cells["@epoch"] !== undefined)
    return Math.floor(gameHours / 96) > cells["@epoch"] ? {} : cells;
  return Object.fromEntries(
    Object.entries(cells).filter(([, cut]) => gameHours - cut < 96),
  );
}
function grassAddress(x: number, z: number) {
  const cx = Math.floor(x / GRASS_CELL),
    cz = Math.floor(z / GRASS_CELL);
  return {
    legacy: `${cx},${cz}`,
    key: `b:${Math.floor(cx / 8)},${Math.floor(cz / 6)}`,
    bit: 2 ** ((((cz % 6) + 6) % 6) * 8 + (((cx % 8) + 8) % 8)),
  };
}
export function isGrassCut(
  cells: Record<string, number>,
  x: number,
  z: number,
) {
  const a = grassAddress(x, z);
  return (
    cells[a.legacy] !== undefined ||
    Math.floor((cells[a.key] ?? 0) / a.bit) % 2 === 1
  );
}
export function cutGrassCount(cells: Record<string, number>) {
  let count = 0;
  for (const [key, value] of Object.entries(cells)) {
    if (key === "@epoch") continue;
    if (!key.startsWith("b:")) {
      count++;
      continue;
    }
    let bits = value;
    while (bits > 0) {
      count += bits % 2;
      bits = Math.floor(bits / 2);
    }
  }
  return count;
}
export function mowSwath(
  cells: Record<string, number>,
  trailer: FleetVehicle,
  gameHours: number,
) {
  const next: Record<string, number> = {
    ...regrowGrass(cells, gameHours),
    "@epoch": Math.floor(gameHours / 96),
  };
  for (let o = -1.5; o <= 1.5; o += 0.75) {
    const x = trailer.position.x + Math.cos(trailer.heading) * o * GRASS_CELL,
      z = trailer.position.z - Math.sin(trailer.heading) * o * GRASS_CELL;
    if (Math.hypot(x, z) <= 365 || Math.abs(x) > 2000 || Math.abs(z) > 2000)
      continue;
    const a = grassAddress(x, z),
      old = next[a.key] ?? 0;
    if (Math.floor(old / a.bit) % 2 === 0) next[a.key] = old + a.bit;
  }
  return next;
}
export type MudPatch = { x: number; z: number; radius: number };
export const MUD_PATCHES: MudPatch[] = Array.from({ length: 26 }, (_, i) => {
  const a = i * 2.39996323,
    r = 440 + (i % 7) * 55;
  return { x: Math.sin(a) * r, z: Math.cos(a) * r, radius: 8 + (i % 4) * 2 };
});
export function inMud(x: number, z: number) {
  return MUD_PATCHES.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius);
}
export function surfaceFactorAt(
  x: number,
  z: number,
  progress: AdventureProgress,
  snow = 0,
) {
  void snow;
  const s = progress.activities ?? createActivitiesProgress();
  const plow =
    s.plowDown && s.plowVehicleId === progress.activeVehicleId
      ? Math.max(0, 1 - s.plowLoad / 5)
      : 1;
  const winter = distance({ x, z }, WONDERLAND) < WONDERLAND.r ? 1.7 : 1;
  return (inMud(x, z) ? 0.55 : 1) * plow * winter;
}
export function scrapeSnow(
  s: ActivitiesProgress,
  position: AdventurePosition,
  heading: number,
  dt: number,
  snow: number,
) {
  const x = position.x + Math.sin(heading) * 3,
    z = position.z + Math.cos(heading) * 3,
    piles = s.snowPiles.map((p) => ({ ...p }));
  const near = piles.find((p) => Math.hypot(x - p.x, z - p.z) < 4.45);
  if (near) near.size = Math.min(2.78, near.size + dt * 0.4);
  else if (piles.length < 150) piles.push({ x, z, size: 0.5 });
  return {
    ...s,
    plowLoad: Math.min(5, s.plowLoad + dt * snow * 1.3),
    snowPiles: piles,
  };
}

export function sceneryId(kind: string, p: { x: number; z: number }) {
  return `${kind}:${p.x.toFixed(3)}:${p.z.toFixed(3)}`;
}

/** Concurrent contacts and ball goals must survive a delayed equipment snapshot. */
export function mergeActivitiesSnapshot(
  latest: ActivitiesProgress,
  pending: ActivitiesProgress,
): ActivitiesProgress {
  return {
    ...pending,
    goals: Math.max(latest.goals, pending.goals),
    brokenProps: Array.from(
      new Set([...latest.brokenProps, ...pending.brokenProps]),
    ),
  };
}
