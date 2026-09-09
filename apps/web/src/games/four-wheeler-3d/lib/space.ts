import type { AdventurePosition, AdventureProgress } from "./adventureTypes";
import type { ControlValues } from "./controls";

export const SPACE_HEIGHT = 10000;
export const PLANET_RADIUS = 2600 / 18;
export const GEM_REWARD = 5000;
export const PLANETS = [
  {
    id: "mars",
    name: "Mars",
    x: 1700 / 18,
    z: -1300 / 18,
    radius: 520 / 18,
    color: "#c1542f",
    dark: "#8f3a1c",
    ring: false,
  },
  {
    id: "neptune",
    name: "Neptune",
    x: -2100 / 18,
    z: 1500 / 18,
    radius: 600 / 18,
    color: "#3a6ee0",
    dark: "#274fb0",
    ring: false,
  },
  {
    id: "saturn",
    name: "Saturn",
    x: 2500 / 18,
    z: 2050 / 18,
    radius: 540 / 18,
    color: "#d9b56a",
    dark: "#b8924a",
    ring: true,
  },
  {
    id: "moon",
    name: "Moon",
    x: -2400 / 18,
    z: -1700 / 18,
    radius: 430 / 18,
    color: "#c2c2cc",
    dark: "#9a9aa6",
    ring: false,
  },
] as const;
export type PlanetId = (typeof PLANETS)[number]["id"];
export type Meteor = {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  spin: number;
  spinV: number;
};
export type SpaceSession = {
  phase: "flight" | "surface";
  planet: PlanetId | null;
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  grace: number;
  nearPlanet: PlanetId | null;
  nearRocket: boolean;
  speed: number;
};
export type PlanetSurface = {
  gems: { id: string; x: number; z: number }[];
  rocks: { id: string; x: number; z: number; radius: number }[];
  aliens: { id: string; x: number; z: number; phase: number }[];
};
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSpaceSession(): SpaceSession {
  return {
    phase: "flight",
    planet: null,
    x: 0,
    z: -200 / 18,
    vx: 0,
    vz: -10,
    heading: Math.PI,
    grace: 1.2,
    nearPlanet: null,
    nearRocket: false,
    speed: 10,
  };
}
export function createMeteors(): Meteor[] {
  const random = rng(2026);
  return Array.from({ length: 16 }, (_, i) => {
    const a = random() * Math.PI * 2,
      d = (950 + random() * 3250) / 18;
    return {
      id: `meteor-${i}`,
      x: Math.cos(a) * d,
      z: Math.sin(a) * d,
      vx: (random() - 0.5) * 16,
      vz: (random() - 0.5) * 16,
      radius: (26 + random() * 32) / 18,
      spin: random() * Math.PI * 2,
      spinV: (random() - 0.5) * 6,
    };
  });
}
export function createPlanetSurface(id: PlanetId): PlanetSurface {
  const random = rng(9000 + PLANETS.findIndex((p) => p.id === id) * 9127);
  const point = (min: number, max: number) => {
    const a = random() * Math.PI * 2,
      d = min + random() * (max - min);
    return { x: Math.cos(a) * d, z: Math.sin(a) * d };
  };
  return {
    gems: Array.from({ length: 14 }, (_, i) => ({
      id: `${id}-gem-${i}`,
      ...point(250 / 18, PLANET_RADIUS * 0.85),
    })),
    rocks: Array.from({ length: 22 }, (_, i) => ({
      id: `${id}-rock-${i}`,
      ...point(250 / 18, PLANET_RADIUS * 0.9),
      radius: (18 + random() * 34) / 18,
    })),
    aliens: Array.from({ length: 5 }, (_, i) => ({
      id: `${id}-alien-${i}`,
      ...point(350 / 18, PLANET_RADIUS * 0.7),
      phase: random() * Math.PI * 2,
    })),
  };
}
export function surfaceHeight(x: number, z: number): number {
  const edge = Math.min(1, Math.hypot(x, z) / 24);
  return (
    (Math.sin(x * 0.04) * Math.sin(z * 0.055) * 2 +
      Math.sin(x * 0.13 + z * 0.08) * 0.45) *
    edge
  );
}
export function landOnPlanet(id: PlanetId): SpaceSession {
  return {
    ...createSpaceSession(),
    phase: "surface",
    planet: id,
    x: 0,
    z: PLANET_RADIUS * 0.55,
    vx: 0,
    vz: 0,
    speed: 0,
    nearRocket: false,
  };
}
export function leavePlanet(state: SpaceSession): SpaceSession | null {
  if (
    state.phase !== "surface" ||
    !state.planet ||
    Math.hypot(state.x, state.z - PLANET_RADIUS * 0.6) >= 120 / 18
  )
    return null;
  const planet = PLANETS.find((p) => p.id === state.planet)!;
  return {
    ...createSpaceSession(),
    x: planet.x,
    z: planet.z - planet.radius - 70 / 18,
  };
}

/** Swept segment distance prevents a fast rocket crossing a small meteor between frames. */
function segmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax,
    dz = bz - az,
    len = dx * dx + dz * dz;
  const t =
    len > 0
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len))
      : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

export function stepSpace(
  state: SpaceSession,
  meteors: Meteor[],
  controls: Pick<ControlValues, "throttle" | "steer" | "brake">,
  dt: number,
): { state: SpaceSession; crash: boolean; landed: PlanetId | null } {
  const delta = Math.max(0, Math.min(0.05, dt)),
    next = { ...state };
  if (next.phase === "surface") {
    let dx = controls.steer,
      dz = Math.min(1, controls.brake - controls.throttle),
      length = Math.hypot(dx, dz);
    if (length > 1) {
      dx /= length;
      dz /= length;
      length = 1;
    }
    next.x += dx * 30 * delta;
    next.z += dz * 30 * delta;
    next.speed = length * 30;
    if (length) next.heading = Math.atan2(dx, dz);
    const r = Math.hypot(next.x, next.z),
      max = PLANET_RADIUS - 30 / 18;
    if (r > max) {
      next.x *= max / r;
      next.z *= max / r;
    }
    next.nearRocket =
      Math.hypot(next.x, next.z - PLANET_RADIUS * 0.6) < 120 / 18;
    return { state: next, crash: false, landed: null };
  }
  next.heading -= controls.steer * 2.7 * delta;
  const thrust = Math.max(0, controls.throttle) * 90 * delta;
  next.vx += Math.sin(next.heading) * thrust;
  next.vz += Math.cos(next.heading) * thrust;
  const drag = Math.exp(
    -(0.482 + controls.brake * 3 + (controls.throttle < 0 ? 3 : 0)) * delta,
  );
  next.vx *= drag;
  next.vz *= drag;
  const speed = Math.hypot(next.vx, next.vz);
  if (speed > 80) {
    next.vx *= 80 / speed;
    next.vz *= 80 / speed;
  }
  next.speed = Math.hypot(next.vx, next.vz);
  next.x += next.vx * delta;
  next.z += next.vz * delta;
  next.grace = Math.max(0, next.grace - delta);
  for (const m of meteors) {
    const oldX = m.x,
      oldZ = m.z;
    m.x += m.vx * delta;
    m.z += m.vz * delta;
    m.spin += m.spinV * delta;
    const bound = 4600 / 18;
    if (m.x > bound) m.x = -bound;
    else if (m.x < -bound) m.x = bound;
    if (m.z > bound) m.z = -bound;
    else if (m.z < -bound) m.z = bound;
    const wrapped =
      Math.abs(m.x - oldX) > bound || Math.abs(m.z - oldZ) > bound;
    if (
      next.grace === 0 &&
      segmentDistance(
        0,
        0,
        state.x - oldX,
        state.z - oldZ,
        next.x - (wrapped ? oldX : m.x),
        next.z - (wrapped ? oldZ : m.z),
      ) <
        m.radius + 14 / 18
    )
      return { state: next, crash: true, landed: null };
  }
  next.nearPlanet = null;
  let nearest = Infinity;
  for (const p of PLANETS) {
    const d = Math.hypot(next.x - p.x, next.z - p.z);
    if (
      segmentDistance(p.x, p.z, state.x, state.z, next.x, next.z) <
      p.radius + 28 / 18
    )
      return { state: landOnPlanet(p.id), crash: false, landed: p.id };
    if (d < p.radius + 300 / 18 && d < nearest) {
      nearest = d;
      next.nearPlanet = p.id;
    }
  }
  return { state: next, crash: false, landed: null };
}

/** Validate proximity and collection identity against generated terrain before granting money. */
export function collectSpaceGems(
  adventure: AdventureProgress,
  state: SpaceSession,
): { adventure: AdventureProgress; reward: number; collected: string[] } {
  if (state.phase !== "surface" || !state.planet)
    return { adventure, reward: 0, collected: [] };
  const previous = adventure.space.gems[state.planet] ?? [];
  const collected = createPlanetSurface(state.planet)
    .gems.filter(
      (g) =>
        !previous.includes(g.id) &&
        Math.hypot(state.x - g.x, state.z - g.z) < 55 / 18,
    )
    .map((g) => g.id);
  if (!collected.length) return { adventure, reward: 0, collected };
  return {
    adventure: {
      ...adventure,
      space: {
        ...adventure.space,
        gems: {
          ...adventure.space.gems,
          [state.planet]: [...previous, ...collected],
        },
      },
    },
    reward: GEM_REWARD * collected.length,
    collected,
  };
}

export function spacePosition(state: SpaceSession): AdventurePosition {
  return {
    x: state.x,
    y:
      SPACE_HEIGHT +
      (state.phase === "surface" ? surfaceHeight(state.x, state.z) : 0),
    z: state.z,
  };
}
