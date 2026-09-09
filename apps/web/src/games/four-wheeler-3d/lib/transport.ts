import type { ControlValues } from "./controls";
import { SHORE_RADIUS } from "./terrain";
import type { AdventureProgress, FleetVehicle } from "./adventureTypes";
import { adventureSchema, MAX_FLEET_VEHICLES } from "./adventureSchema";
import { findOffer, isWaterVehicle } from "./catalog";

export const BOAT_TYPES = [
  "boat",
  "pontoon",
  "jetski",
  "canoe",
  "sailboat",
  "tugboat",
  "minifishingboat",
  "fishingboat",
  "yacht",
] as const;
export const AIRCRAFT_TYPES = [
  "plane",
  "biplane",
  "jet",
  "heli",
  "chopper",
] as const;
type TransportTuning = {
  maxSpeed: number;
  acceleration: number;
  turnRate: number;
  length: number;
  width: number;
  deckHeight: number;
  helicopter?: boolean;
};
export const TRANSPORT_TUNING: Record<string, TransportTuning> = {
  boat: {
    maxSpeed: 14,
    acceleration: 4,
    turnRate: 0.8,
    length: 6.8,
    width: 2.2,
    deckHeight: 0.55,
  },
  pontoon: {
    maxSpeed: 8,
    acceleration: 2.4,
    turnRate: 0.5,
    length: 8,
    width: 3.1,
    deckHeight: 0.65,
  },
  jetski: {
    maxSpeed: 16,
    acceleration: 5,
    turnRate: 1.2,
    length: 2.6,
    width: 0.95,
    deckHeight: 0.4,
  },
  canoe: {
    maxSpeed: 4,
    acceleration: 1.5,
    turnRate: 1,
    length: 4.5,
    width: 0.9,
    deckHeight: 0.25,
  },
  sailboat: {
    maxSpeed: 7,
    acceleration: 1.8,
    turnRate: 0.5,
    length: 8,
    width: 2.8,
    deckHeight: 0.6,
  },
  tugboat: {
    maxSpeed: 6,
    acceleration: 1.5,
    turnRate: 0.35,
    length: 12,
    width: 4.8,
    deckHeight: 0.9,
  },
  minifishingboat: {
    maxSpeed: 10,
    acceleration: 3,
    turnRate: 0.7,
    length: 6.3,
    width: 2.3,
    deckHeight: 0.6,
  },
  fishingboat: {
    maxSpeed: 8,
    acceleration: 2,
    turnRate: 0.4,
    length: 13,
    width: 4.6,
    deckHeight: 1,
  },
  yacht: {
    maxSpeed: 9,
    acceleration: 1.7,
    turnRate: 0.28,
    length: 30,
    width: 8,
    deckHeight: 1.5,
  },
  plane: {
    maxSpeed: 32,
    acceleration: 5,
    turnRate: 0.6,
    length: 8,
    width: 12,
    deckHeight: 0.9,
  },
  biplane: {
    maxSpeed: 24,
    acceleration: 4,
    turnRate: 0.7,
    length: 6.5,
    width: 9,
    deckHeight: 0.85,
  },
  jet: {
    maxSpeed: 110,
    acceleration: 18,
    turnRate: 0.4,
    length: 12,
    width: 8,
    deckHeight: 1,
  },
  heli: {
    maxSpeed: 24,
    acceleration: 4,
    turnRate: 0.9,
    length: 8,
    width: 10,
    deckHeight: 0.8,
    helicopter: true,
  },
  chopper: {
    maxSpeed: 32,
    acceleration: 5,
    turnRate: 1,
    length: 10,
    width: 12,
    deckHeight: 0.9,
    helicopter: true,
  },
};
export type TransportState = {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  pitch: number;
  bank: number;
  verticalSpeed: number;
  climb: number;
  rollRemaining: number;
  roll: number;
  anchorDown: boolean;
  time: number;
  autoTakeoff: boolean;
  boostActive: boolean;
  waveIn: number;
  waveHeight: number;
  waveVelocity: number;
};
export function isWatercraft(type: string) {
  return (BOAT_TYPES as readonly string[]).includes(type);
}
export function transportTuning(type: string) {
  return TRANSPORT_TUNING[type] ?? TRANSPORT_TUNING.boat;
}
export function createTransportState(
  x: number,
  y: number,
  z: number,
  heading: number,
): TransportState {
  return {
    x,
    y,
    z,
    heading,
    speed: 0,
    pitch: 0,
    bank: 0,
    verticalSpeed: 0,
    climb: 0,
    rollRemaining: 0,
    roll: 0,
    anchorDown: false,
    time: 0,
    autoTakeoff: true,
    boostActive: false,
    waveIn: 1.5,
    waveHeight: 0,
    waveVelocity: 0,
  };
}

/** Mutates one simulation state; rendering and save writes are kept outside this kernel. */
export function stepTransport(
  state: TransportState,
  type: string,
  input: ControlValues,
  dt: number,
  groundAt: (x: number, z: number) => number,
  speedUpgrade = 0,
  boost = false,
  random = Math.random,
): void {
  const tune = transportTuning(type);
  const water = isWatercraft(type);
  state.time += dt;
  const maxSpeed =
    Math.max(2, tune.maxSpeed + speedUpgrade / 2.237) * (boost ? 2 : 1);
  if (boost && !state.boostActive && !state.anchorDown) state.speed *= 2;
  state.boostActive = boost;
  const target =
    state.anchorDown && water
      ? 0
      : input.throttle *
        (input.throttle < 0
          ? maxSpeed * (water || tune.helicopter ? 0.25 : 0)
          : maxSpeed);
  const slowing =
    input.brake > 0 || input.handbrake || (state.anchorDown && water);
  const requested = slowing ? 0 : target;
  const change = tune.acceleration * (slowing ? 2.5 : boost ? 2 : 1) * dt;
  state.speed += Math.max(-change, Math.min(change, requested - state.speed));
  const turning = water
    ? Math.min(1, Math.abs(state.speed) / 2) * Math.sign(state.speed)
    : tune.helicopter
      ? 1
      : Math.min(1, state.speed / 5);
  state.heading -= input.steer * tune.turnRate * turning * dt;
  state.heading = Math.atan2(Math.sin(state.heading), Math.cos(state.heading));
  let nextX = state.x + Math.sin(state.heading) * state.speed * dt;
  let nextZ = state.z + Math.cos(state.heading) * state.speed * dt;
  if (water) {
    // Keep the whole hull afloat, including its bow and stern when turning at the shore.
    const limit = SHORE_RADIUS - tune.length / 2 - 2;
    const reach = Math.hypot(nextX, nextZ);
    if (reach > limit) {
      nextX *= limit / reach;
      nextZ *= limit / reach;
      state.speed *= Math.exp(-8 * dt);
    }
    state.waveIn -= dt;
    if (state.waveIn <= 0) {
      state.waveIn = 1 + random() * 1.6;
      if (
        random() < 0.45 &&
        Math.abs(state.speed) > 2 &&
        state.waveHeight <= 0 &&
        !state.anchorDown
      )
        state.waveVelocity = 3.2 + random() * 1.3;
    }
    if (state.waveHeight > 0 || state.waveVelocity > 0) {
      state.waveVelocity -= 9.81 * dt;
      state.waveHeight = Math.max(
        0,
        state.waveHeight + state.waveVelocity * dt,
      );
      if (!state.waveHeight) state.waveVelocity = 0;
    }
    state.y =
      state.waveHeight + Math.sin(state.time * 1.7 + nextX * 0.03) * 0.045;
    state.pitch =
      Math.sin(state.time * 1.3) * 0.008 -
      Math.min(0.04, Math.abs(state.speed) * 0.003);
    state.bank +=
      (input.steer * Math.min(0.08, Math.abs(state.speed) * 0.006) -
        state.bank) *
      (1 - Math.exp(-4 * dt));
  } else {
    const floor = Math.max(0, groundAt(nextX, nextZ)) + tune.deckHeight;
    const liftReady = tune.helicopter || state.speed > maxSpeed * 0.28;
    const automaticLift =
      state.autoTakeoff && input.throttle > 0 && state.y < floor + 25 ? 0.6 : 0;
    const lift = state.climb || automaticLift;
    const desiredVertical = liftReady ? lift * (tune.helicopter ? 8 : 12) : -5;
    state.verticalSpeed +=
      (desiredVertical - state.verticalSpeed) * (1 - Math.exp(-3 * dt));
    state.y = Math.max(
      floor,
      Math.min(350, state.y + state.verticalSpeed * dt),
    );
    if (state.y <= floor + 0.01 || state.y >= 350) state.verticalSpeed = 0;
    state.pitch +=
      (-Math.atan2(state.verticalSpeed, Math.max(8, state.speed)) -
        state.pitch) *
      (1 - Math.exp(-4 * dt));
    state.bank +=
      (input.steer * (state.y > floor + 1 ? 0.4 : 0) - state.bank) *
      (1 - Math.exp(-3 * dt));
    if (state.rollRemaining > 0) {
      state.rollRemaining = Math.max(0, state.rollRemaining - dt);
      state.roll = (1 - state.rollRemaining / 0.7) * Math.PI * 2;
    } else state.roll = 0;
  }
  state.x = Math.max(-1950, Math.min(1950, nextX));
  state.z = Math.max(-1950, Math.min(1950, nextZ));
}

export function canWalkDeck(type: string): boolean {
  return ["fishingboat", "minifishingboat", "yacht"].includes(type);
}
export function canBailOut(state: TransportState, ground: number): boolean {
  return state.y - Math.max(0, ground) > 4;
}

type ToyResult =
  | { ok: true; adventure: AdventureProgress; vehicle: FleetVehicle }
  | { ok: false; message: string };
export function launchYachtToy(
  progress: AdventureProgress,
  yachtId: string,
  type: string,
  groundAt: (x: number, z: number) => number,
): ToyResult {
  const yacht = progress.fleet[yachtId];
  if (
    !yacht ||
    yacht.type !== "yacht" ||
    !["minifishingboat", "jetski", "utv", "heli"].includes(type)
  )
    return { ok: false, message: "This extra belongs to the Mega Yacht." };
  const radius = Math.hypot(yacht.position.x, yacht.position.z);
  if (type === "utv" && radius < SHORE_RADIUS - 40)
    return {
      ok: false,
      message: "Bring the yacht close to shore to unload the UTV.",
    };
  const id = yachtToyId(yachtId, type);
  const issued = `yacht-issued:${id}`;
  const existing = progress.fleet[id];
  if (existing && !yacht.cargo.includes(id))
    return {
      ok: false,
      message: "That yacht extra is already out. Bring it back to load it.",
    };
  if (!existing && progress.inventory[issued])
    return { ok: false, message: "That yacht extra was sold." };
  if (
    !existing &&
    Object.keys(progress.fleet).length + reservedFleetSlots(progress) >=
      MAX_FLEET_VEHICLES
  )
    return {
      ok: false,
      message: `Your fleet is full (${MAX_FLEET_VEHICLES}, including deliveries). Sell a ride before launching another extra.`,
    };
  const adventure = structuredClone(progress);
  const heading =
    type === "utv"
      ? Math.atan2(yacht.position.x, yacht.position.z)
      : yacht.heading;
  const x =
    type === "utv"
      ? Math.sin(heading) * (SHORE_RADIUS + 8)
      : yacht.position.x - Math.sin(heading) * 19;
  const z =
    type === "utv"
      ? Math.cos(heading) * (SHORE_RADIUS + 8)
      : yacht.position.z - Math.cos(heading) * 19;
  const vehicle: FleetVehicle = {
    ...yacht,
    id,
    type,
    position: {
      x,
      z,
      y: type === "heli" ? 6 : type === "utv" ? groundAt(x, z) + 1 : 0,
    },
    heading,
    parked: false,
    purchasePrice: 0,
    cargo: [],
    hitch: null,
    capacity: 0,
    cornLoad: 0,
  };
  adventure.fleet[yachtId].parked = true;
  adventure.fleet[yachtId].cargo = adventure.fleet[yachtId].cargo.filter(
    (key) => key !== id,
  );
  adventure.fleet[id] = vehicle;
  adventure.inventory[issued] = 1;
  adventure.activeVehicleId = id;
  if (type === "heli") adventure.aircraftOwned = true;
  if (!adventureSchema.safeParse(adventure).success)
    return {
      ok: false,
      message:
        "This extra cannot launch until there is room in your saved inventory.",
    };
  return { ok: true, adventure, vehicle };
}

export function loadYachtToy(
  progress: AdventureProgress,
  vehicleId: string,
): ToyResult {
  const vehicle = progress.fleet[vehicleId];
  const yacht = Object.values(progress.fleet).find(
    (v) =>
      v.type === "yacht" &&
      ["minifishingboat", "jetski", "utv", "heli"].some(
        (type) => yachtToyId(v.id, type) === vehicleId,
      ),
  );
  const parentId = yacht?.id ?? "";
  if (!vehicle || !yacht || yacht.type !== "yacht")
    return { ok: false, message: "This ride is not a yacht extra." };
  if (
    Math.hypot(
      vehicle.position.x - yacht.position.x,
      vehicle.position.z - yacht.position.z,
    ) > 35 ||
    vehicle.position.y > 12
  )
    return {
      ok: false,
      message:
        "Return beside the yacht first, and fly low if you are in the helicopter.",
    };
  const adventure = structuredClone(progress);
  adventure.fleet[vehicleId].parked = false;
  adventure.fleet[vehicleId].position = { ...yacht.position };
  adventure.fleet[parentId].cargo = [...new Set([...yacht.cargo, vehicleId])];
  adventure.fleet[parentId].parked = false;
  adventure.activeVehicleId = parentId;
  if (!adventureSchema.safeParse(adventure).success)
    return { ok: false, message: "The yacht cannot hold another extra." };
  return { ok: true, adventure, vehicle: adventure.fleet[parentId] };
}

/** Keep both the fleet key and its issued-item ledger key within 80 characters. */
export function yachtToyId(yachtId: string, type: string): string {
  const original = `${yachtId}:toy:${type}`;
  if (original.length <= 67) return original;
  let left = 2166136261,
    right = 5381;
  for (const c of yachtId) {
    left = Math.imul(left ^ c.charCodeAt(0), 16777619);
    right = Math.imul(right, 33) ^ c.charCodeAt(0);
  }
  return `yacht-${(left >>> 0).toString(36)}-${(right >>> 0).toString(36)}:toy:${type}`;
}
function reservedFleetSlots(a: AdventureProgress): number {
  return [a.delivery?.offerId, a.helperTask?.offerId].reduce<number>(
    (count, id) => {
      const offer = id ? findOffer(id) : undefined;
      if (!offer) return count;
      if (offer.kind === "aircraft-package")
        return (
          count +
          ["plane", "heli"].filter(
            (type) => !Object.values(a.fleet).some((v) => v.type === type),
          ).length
        );
      return (
        count +
        Number(
          ["vehicle", "trailer", "plow"].includes(offer.kind) ||
            isWaterVehicle(offer.key),
        )
      );
    },
    0,
  );
}

export const AIR_EFFECT_LIMITS = {
  bombs: 24,
  particles: 224,
  scorches: 70,
} as const;
export type AirImpact = {
  x: number;
  y: number;
  z: number;
  treeRadius: number;
  animalRadius: number;
};
export type ToyBomb = {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
};
export type AirParticle = {
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fire: boolean;
};
export type AirEffectsState = {
  bombs: ToyBomb[];
  particles: AirParticle[];
  scorches: { x: number; y: number; z: number; radius: number }[];
  nextBomb: number;
  nextParticle: number;
};
export function createAirEffects(): AirEffectsState {
  return {
    bombs: Array.from({ length: AIR_EFFECT_LIMITS.bombs }, () => ({
      active: false,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vz: 0,
    })),
    particles: Array.from({ length: AIR_EFFECT_LIMITS.particles }, () => ({
      life: 0,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      fire: false,
    })),
    scorches: [],
    nextBomb: 0,
    nextParticle: 0,
  };
}
export function dropToyBomb(
  effects: AirEffectsState,
  pose: { x: number; y: number; z: number; heading: number; speed: number },
): void {
  const bomb = effects.bombs[effects.nextBomb++ % effects.bombs.length];
  Object.assign(bomb, {
    active: true,
    x: pose.x,
    y: pose.y + 20 / 18,
    z: pose.z,
    vx: Math.sin(pose.heading) * pose.speed * 0.5,
    vz: Math.cos(pose.heading) * pose.speed * 0.5,
  });
}
export function parseAirImpact(payload?: string): AirImpact | null {
  try {
    const p = JSON.parse(payload ?? "null");
    if (
      !p ||
      ![p.x, p.y, p.z].every(Number.isFinite) ||
      Math.abs(p.x) > 10000 ||
      Math.abs(p.z) > 10000 ||
      p.y < -1000 ||
      p.y > 10000
    )
      return null;
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      treeRadius: 95 / 18,
      animalRadius: 130 / 18,
    };
  } catch {
    return null;
  }
}
/** Bounded, reversible toy effects: a bright poof and tag event, no graphic injury. */
export function stepAirEffects(
  effects: AirEffectsState,
  dt: number,
  groundAt: (x: number, z: number) => number,
  impact: (p: AirImpact) => void,
  random = Math.random,
): void {
  for (const p of effects.particles)
    if (p.life > 0) {
      p.life = Math.max(0, p.life - dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy += dt * 0.4;
    }
  for (const b of effects.bombs)
    if (b.active) {
      b.x = Math.max(-1950, Math.min(1950, b.x + b.vx * dt));
      b.z = Math.max(-1950, Math.min(1950, b.z + b.vz * dt));
      b.y -= 20 * dt;
      const floor = Math.max(0, groundAt(b.x, b.z));
      if (b.y > floor) continue;
      b.active = false;
      b.y = floor;
      const hit = {
        x: b.x,
        y: floor,
        z: b.z,
        treeRadius: 95 / 18,
        animalRadius: 130 / 18,
      };
      effects.scorches.push({
        ...hit,
        y: floor + 0.025,
        radius: (46 + random() * 16) / 18,
      });
      if (effects.scorches.length > AIR_EFFECT_LIMITS.scorches)
        effects.scorches.shift();
      for (let i = 0; i < 28; i++) {
        const p =
            effects.particles[
              effects.nextParticle++ % effects.particles.length
            ],
          angle = random() * Math.PI * 2,
          speed = 1 + random() * 4.5;
        Object.assign(p, {
          life: 1,
          x: b.x,
          y: floor + 0.4,
          z: b.z,
          vx: Math.cos(angle) * speed,
          vy: 1 + random() * 3,
          vz: Math.sin(angle) * speed,
          fire: i < 17,
        });
      }
      impact(hit);
    }
}
