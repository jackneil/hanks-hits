/**
 * The tuning table for every ground vehicle, derived from the 2D game.
 *
 * Source of truth: the `SPEEDS` table in
 * `apps/web/public/games/four-wheeler-adventure/index.html` (lines 697-725)
 * and the `FOR_SALE` price lists beside it.
 *
 * SPEED. The 2D game runs in units per frame. `SCALE.SPEED` (0.38) turns a 2D
 * `max` into meters per second and keeps the ORDER and the RATIOS of the whole
 * roster, which is what the design doc settled on. See `lib/constants.ts`.
 *
 * STEERING. The 2D `turn` is radians per frame of yaw. The 3D game needs a
 * maximum wheel ANGLE instead, so one factor converts the whole column:
 * `STEER_SCALE = 0.55 / 0.062`, which puts the ATV at 0.55 rad (about 31
 * degrees) and the 18-wheeler at 0.30 rad. Every other row keeps its place
 * between them.
 *
 * FORCE. Engine and brake force are per wheel. They scale with the vehicle
 * mass and the 2D `accel` / `brake` column, so a heavy truck needs more force
 * for the same push and the roster keeps the 2D feel.
 *
 * REVERSE. The 2D `rev` column is a reverse speed cap in units per frame, and
 * a literal port makes reverse a 1.9 m/s crawl. A kid needs to back away from
 * a tree, so `reverseFactor` has a documented floor of 0.25: reverse tops out
 * at a quarter of the forward speed when the 2D ratio is lower than that.
 */

import { SCALE } from "./constants";

/** Every id the 3D game can drive or walk as. */
export const VEHICLE_IDS = [
  "foot",
  "atv",
  "utv",
  "truck",
  "moto",
  "lambo",
  "semi",
  "firetruck",
  "monster",
  "racecar",
  "muscle",
  "tractor",
  "rv",
  "bike",
] as const;

export type VehicleId = (typeof VEHICLE_IDS)[number];

export type ChassisDims = {
  /** Along the driving direction (local +Z), in meters. */
  length: number;
  /** Across the vehicle (local X), in meters. */
  width: number;
  /** Top to bottom (local Y), in meters. */
  height: number;
};

export type SuspensionTuning = {
  /** How far the wheel hangs below its mount when nothing pushes on it. */
  restLength: number;
  /** Spring rate. Higher is stiffer. */
  stiffness: number;
  /** Damping while the spring squashes. */
  compression: number;
  /** Damping while the spring pushes back out. */
  relaxation: number;
  /** The furthest the spring may move from rest. */
  maxTravel: number;
};

export type VehicleTuning = {
  id: VehicleId;
  /** Kid-level name shown in the game. */
  label: string;
  emoji: string;
  /** Top speed in meters per second. */
  maxSpeed: number;
  /** Engine force per wheel, in newtons. */
  engineForce: number;
  /** Brake force per wheel. */
  brakeForce: number;
  /** Share of the forward speed and force used when backing up. */
  reverseFactor: number;
  /** Largest front wheel angle, in radians. */
  maxSteer: number;
  /** Chassis mass in kilograms. */
  mass: number;
  chassis: ChassisDims;
  wheelRadius: number;
  /** Four mount points in chassis space: front left, front right, rear left, rear right. */
  wheelPositions: [number, number, number][];
  suspension: SuspensionTuning;
  /** Forward grip. The ice rule lowers this. */
  frictionSlip: number;
  /** Sideways grip. The ice rule lowers this too. */
  sideFrictionStiffness: number;
  /** What it costs at the dealer, in dollars. 0 means you already have it. */
  price: number;
};

/** Turns a 2D `turn` value into a maximum front wheel angle in radians. */
export const STEER_SCALE = 0.55 / 0.062;

/** Turns mass times the 2D `accel` column into engine force per wheel. */
const ACCEL_SCALE = 10;

/** Turns mass times the 2D `brake` column into brake force per wheel. */
const BRAKE_SCALE = 20;

/** The slowest reverse a kid should ever have to live with. */
const MIN_REVERSE_FACTOR = 0.25;

/** Meters per second to miles per hour. */
export function mphFromMs(metersPerSecond: number): number {
  return metersPerSecond * 2.237;
}

/**
 * Four wheel mounts from the chassis box.
 *
 * The mounts sit at the bottom corners of the chassis, pulled in by `inset`
 * so the wheels tuck under the body instead of poking out of it. Local +Z is
 * the driving direction, which is the forward axis Rapier derives from a
 * direction of (0, -1, 0) and an axle of (-1, 0, 0).
 */
function wheelsFor(
  chassis: ChassisDims,
  inset: number
): [number, number, number][] {
  const x = chassis.width / 2 - inset;
  const z = chassis.length / 2 - inset;
  const y = -chassis.height / 2;
  return [
    [x, y, z], // 0 front left
    [-x, y, z], // 1 front right
    [x, y, -z], // 2 rear left
    [-x, y, -z], // 3 rear right
  ];
}

/**
 * A spring that settles instead of bouncing.
 *
 * Critical damping for a spring is `2 * sqrt(stiffness)`. A vehicle wants a
 * little less than that going down (so a bump still feels like a bump) and
 * more than that coming back up (so it does not pogo), which is where the two
 * ratios come from.
 */
function suspensionFor(
  stiffness: number,
  restLength: number,
  maxTravel: number
): SuspensionTuning {
  const critical = 2 * Math.sqrt(stiffness);
  return {
    restLength,
    stiffness,
    compression: critical * 0.28,
    relaxation: critical * 0.45,
    maxTravel,
  };
}

type Row = {
  id: VehicleId;
  label: string;
  emoji: string;
  /** The 2D `max`, in units per frame. */
  max2d: number;
  /** The 2D `accel`. */
  accel2d: number;
  /** The 2D `brake`. */
  brake2d: number;
  /** The 2D `rev`, a reverse speed cap in units per frame. */
  rev2d: number;
  /** The 2D `turn`, in radians per frame. */
  turn2d: number;
  mass: number;
  chassis: ChassisDims;
  wheelRadius: number;
  /** How far the wheel mounts pull in from the chassis corners. */
  inset: number;
  stiffness: number;
  restLength: number;
  maxTravel: number;
  frictionSlip: number;
  sideFrictionStiffness: number;
  price: number;
};

function tune(row: Row): VehicleTuning {
  const maxSpeed = row.max2d * SCALE.SPEED;
  const reverseSpeed = Math.abs(row.rev2d) * SCALE.SPEED;
  return {
    id: row.id,
    label: row.label,
    emoji: row.emoji,
    maxSpeed,
    engineForce: (row.mass * row.accel2d * ACCEL_SCALE) / 4,
    brakeForce: (row.mass * row.brake2d * BRAKE_SCALE) / 4,
    reverseFactor: Math.max(MIN_REVERSE_FACTOR, reverseSpeed / maxSpeed),
    maxSteer: row.turn2d * STEER_SCALE,
    mass: row.mass,
    chassis: row.chassis,
    wheelRadius: row.wheelRadius,
    wheelPositions: wheelsFor(row.chassis, row.inset),
    suspension: suspensionFor(row.stiffness, row.restLength, row.maxTravel),
    frictionSlip: row.frictionSlip,
    sideFrictionStiffness: row.sideFrictionStiffness,
    price: row.price,
  };
}

/**
 * On foot does not use the 2D number.
 *
 * The 2D `foot.max` is 2.8 units per frame, which the speed factor would turn
 * into a 1.06 m/s crawl: slower than a real walk and painful in third person.
 * Walking is fixed at 3 m/s and running at 5 m/s instead, which the design doc
 * settled on. The `foot` row below carries the walk speed so every part of the
 * game can read one table.
 */
export const FOOT_SPEEDS = { walk: 3, run: 5 } as const;

const ROWS: Row[] = [
  {
    id: "atv", label: "Quad", emoji: "🏍️",
    max2d: 57.6, accel2d: 0.9, brake2d: 0.46, rev2d: -5, turn2d: 0.062,
    mass: 320, chassis: { length: 1.9, width: 1.1, height: 0.6 },
    wheelRadius: 0.35, inset: 0.16,
    stiffness: 26, restLength: 0.3, maxTravel: 0.4,
    frictionSlip: 11, sideFrictionStiffness: 1, price: 20000,
  },
  {
    id: "utv", label: "Side-by-Side", emoji: "🛺",
    max2d: 64.8, accel2d: 1, brake2d: 0.5, rev2d: -5.2, turn2d: 0.068,
    mass: 700, chassis: { length: 2.6, width: 1.5, height: 0.8 },
    wheelRadius: 0.38, inset: 0.2,
    stiffness: 26, restLength: 0.3, maxTravel: 0.4,
    frictionSlip: 11, sideFrictionStiffness: 1, price: 20000,
  },
  {
    id: "truck", label: "Truck", emoji: "🛻",
    max2d: 51.6, accel2d: 0.7, brake2d: 0.52, rev2d: -4.4, turn2d: 0.046,
    mass: 2600, chassis: { length: 5.6, width: 2, height: 1.4 },
    wheelRadius: 0.45, inset: 0.28,
    stiffness: 24, restLength: 0.32, maxTravel: 0.4,
    frictionSlip: 10.5, sideFrictionStiffness: 1, price: 20000,
  },
  {
    id: "moto", label: "Motorcycle", emoji: "🏍️",
    max2d: 75, accel2d: 1.2, brake2d: 0.48, rev2d: -4.4, turn2d: 0.084,
    mass: 200, chassis: { length: 2.1, width: 0.5, height: 0.6 },
    wheelRadius: 0.33, inset: 0.1,
    stiffness: 26, restLength: 0.28, maxTravel: 0.35,
    frictionSlip: 11.5, sideFrictionStiffness: 1.1, price: 20000,
  },
  {
    id: "lambo", label: "Super Car", emoji: "🏎️",
    max2d: 93, accel2d: 1.5, brake2d: 0.62, rev2d: -5, turn2d: 0.072,
    mass: 1600, chassis: { length: 4.5, width: 2, height: 1.1 },
    wheelRadius: 0.35, inset: 0.24,
    stiffness: 32, restLength: 0.24, maxTravel: 0.28,
    frictionSlip: 12, sideFrictionStiffness: 1.2, price: 50000,
  },
  {
    id: "semi", label: "18-Wheeler", emoji: "🚛",
    max2d: 45, accel2d: 0.55, brake2d: 0.4, rev2d: -3.4, turn2d: 0.034,
    mass: 9000, chassis: { length: 7.5, width: 2.5, height: 3 },
    wheelRadius: 0.55, inset: 0.35,
    stiffness: 22, restLength: 0.34, maxTravel: 0.4,
    frictionSlip: 10, sideFrictionStiffness: 0.9, price: 20000,
  },
  {
    id: "firetruck", label: "Fire Truck", emoji: "🚒",
    max2d: 46, accel2d: 0.5, brake2d: 0.5, rev2d: -3.6, turn2d: 0.036,
    mass: 12000, chassis: { length: 8, width: 2.5, height: 3.2 },
    wheelRadius: 0.58, inset: 0.35,
    stiffness: 22, restLength: 0.34, maxTravel: 0.4,
    frictionSlip: 10, sideFrictionStiffness: 0.9, price: 150000,
  },
  {
    id: "monster", label: "Monster Truck", emoji: "🚙",
    max2d: 56, accel2d: 0.64, brake2d: 0.5, rev2d: -4, turn2d: 0.044,
    mass: 3500, chassis: { length: 4.5, width: 2.6, height: 2.4 },
    wheelRadius: 0.9, inset: 0.4,
    stiffness: 20, restLength: 0.5, maxTravel: 0.7,
    frictionSlip: 11, sideFrictionStiffness: 1, price: 40000,
  },
  {
    id: "racecar", label: "Race Car", emoji: "🏎️",
    max2d: 112, accel2d: 1.7, brake2d: 0.66, rev2d: -4, turn2d: 0.078,
    mass: 800, chassis: { length: 4.6, width: 1.9, height: 1 },
    wheelRadius: 0.36, inset: 0.22,
    stiffness: 34, restLength: 0.22, maxTravel: 0.25,
    frictionSlip: 12.5, sideFrictionStiffness: 1.3, price: 80000,
  },
  {
    id: "muscle", label: "Muscle Car", emoji: "🚗",
    max2d: 90, accel2d: 1.35, brake2d: 0.6, rev2d: -5, turn2d: 0.068,
    mass: 1700, chassis: { length: 4.9, width: 1.9, height: 1.3 },
    wheelRadius: 0.4, inset: 0.24,
    stiffness: 28, restLength: 0.28, maxTravel: 0.32,
    frictionSlip: 11.5, sideFrictionStiffness: 1.1, price: 45000,
  },
  {
    id: "tractor", label: "Tractor", emoji: "🚜",
    max2d: 7.142857, accel2d: 0.16, brake2d: 0.22, rev2d: -2.5, turn2d: 0.05,
    mass: 3000, chassis: { length: 3.5, width: 1.8, height: 2.2 },
    wheelRadius: 0.75, inset: 0.3,
    stiffness: 20, restLength: 0.4, maxTravel: 0.5,
    frictionSlip: 12, sideFrictionStiffness: 1, price: 25000,
  },
  {
    id: "rv", label: "Camper", emoji: "🚐",
    max2d: 50, accel2d: 0.42, brake2d: 0.46, rev2d: -3.4, turn2d: 0.034,
    mass: 7000, chassis: { length: 8, width: 2.4, height: 3 },
    wheelRadius: 0.5, inset: 0.32,
    stiffness: 22, restLength: 0.34, maxTravel: 0.4,
    frictionSlip: 10, sideFrictionStiffness: 0.9, price: 45000,
  },
  {
    /*
     * One row stands for the whole bike shop. The 2D game builds eight bikes
     * from `mph / 14 * 8`, and the mountain bike at 44 mph sits in the middle
     * of them. The bike shop in milestone 6 gives every bike its own speed
     * from that same formula.
     */
    id: "bike", label: "Bike", emoji: "🚲",
    max2d: (44 / 14) * 8, accel2d: 0.4, brake2d: 0.45, rev2d: -1.5, turn2d: 0.062,
    mass: 100, chassis: { length: 1.7, width: 0.5, height: 0.6 },
    wheelRadius: 0.34, inset: 0.08,
    stiffness: 24, restLength: 0.24, maxTravel: 0.3,
    frictionSlip: 11, sideFrictionStiffness: 1.1, price: 3400,
  },
  {
    id: "foot", label: "On Foot", emoji: "🦶",
    max2d: FOOT_SPEEDS.walk / SCALE.SPEED, accel2d: 0.6, brake2d: 0.6,
    rev2d: -FOOT_SPEEDS.walk / SCALE.SPEED, turn2d: 0.075,
    mass: 70, chassis: { length: 0.5, width: 0.5, height: 1.7 },
    wheelRadius: 0.2, inset: 0.1,
    stiffness: 24, restLength: 0.2, maxTravel: 0.2,
    frictionSlip: 12, sideFrictionStiffness: 1.2, price: 0,
  },
];

export const VEHICLE_TUNING: Record<VehicleId, VehicleTuning> = Object.fromEntries(
  ROWS.map((row) => [row.id, tune(row)])
) as Record<VehicleId, VehicleTuning>;

/** The tuning for one id, falling back to the ATV. */
export function tuningFor(id: string): VehicleTuning {
  return VEHICLE_TUNING[id as VehicleId] ?? VEHICLE_TUNING.atv;
}

/** Top speed in miles per hour, for the speedometer and the store cards. */
export function topSpeedMph(id: string): number {
  return mphFromMs(tuningFor(id).maxSpeed);
}
