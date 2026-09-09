import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(80)
  .refine(
    (value) => !Object.hasOwn(Object.prototype, value) && value !== "prototype",
    "Reserved identifier",
  );
const count = z.number().int().min(0).max(1_000_000);
const money = z.number().min(0).max(1e12);
const position = z
  .object({
    x: z.number().min(-10000).max(10000),
    y: z.number().min(-1000).max(10000),
    z: z.number().min(-10000).max(10000),
  })
  .strict();
const record = <T extends z.ZodType>(value: T, limit = 500) =>
  z
    .record(id, value)
    .refine((v) => Object.keys(v).length <= limit, "Too many saved entries");
export const MAX_FLEET_VEHICLES = 500;
export const MAX_SPEED_UPGRADE = 1000;
export const fleetVehicleSchema = z
  .object({
    id,
    type: id,
    position,
    heading: z.number().min(-100000).max(100000),
    paint: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    speedUpgrade: z.number().min(-1000).max(MAX_SPEED_UPGRADE),
    mud: z.number().min(0).max(1),
    cargo: z.array(id).max(12),
    hitch: id.nullable(),
    parked: z.boolean(),
    purchasePrice: money,
    cornLoad: count,
    capacity: z.number().int().min(0).max(12),
  })
  .strict();
const task = z
  .object({ id, offerId: id, remainingSeconds: z.number().min(0).max(60) })
  .strict();

/** One bounded, versioned save contract, shared by client migration and the API. */
export const adventureSchema = z
  .object({
    rider: z
      .object({
        mode: z.enum(["vehicle", "foot", "boat", "aircraft"]),
        position,
        heading: z.number().min(-100000).max(100000),
      })
      .strict()
      .nullable(),
    activities: z
      .object({
        mowerOn: z.boolean(),
        cutGrass: record(
          z
            .number()
            .min(0)
            .max(2 ** 48 - 1),
          20000,
        ).refine(
          (cells) =>
            Object.entries(cells).every(([key, value]) =>
              key === "@epoch"
                ? Number.isInteger(value) && value <= 1_000_000
                : key.startsWith("b:")
                  ? Number.isInteger(value)
                  : value <= 100_000_000,
            ),
          "Invalid grass mask or clock",
        ),
        plowVehicleId: id.nullable(),
        plowDown: z.boolean(),
        plowLoad: z.number().min(0).max(5),
        snowPiles: z
          .array(
            z
              .object({
                x: z.number().min(-10000).max(10000),
                z: z.number().min(-10000).max(10000),
                size: z.number().min(0).max(5),
              })
              .strict(),
          )
          .max(1000),
        brokenProps: z.array(id).max(5000),
        goals: count,
      })
      .strict(),
    version: z.literal(1),
    nextId: count,
    fleet: record(fleetVehicleSchema, MAX_FLEET_VEHICLES),
    activeVehicleId: id.nullable(),
    inventory: record(count),
    plots: record(
      z
        .object({
          id,
          owned: z.boolean(),
          sizeLevel: z.number().int().min(0).max(4),
          buildings: z
            .array(
              z
                .object({
                  slot: z.union([z.literal(0), z.literal(1)]),
                  type: z.enum([
                    "garage",
                    "trophy",
                    "house-small",
                    "house-medium",
                    "house-huge",
                  ]),
                  doorOpen: z.boolean(),
                  parkedVehicleIds: z.array(id).max(100),
                })
                .strict(),
            )
            .max(2),
        })
        .strict(),
      6,
    ),
    dog: z
      .object({ hungerHours: z.number().min(0).max(24), alive: z.boolean() })
      .strict(),
    collectedBones: z.array(id).max(56),
    feeders: z
      .array(
        z
          .object({
            id,
            position,
            label: z.string().max(14),
            corn: z.number().min(0).max(18),
            scented: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    stands: z
      .array(
        z.object({ id, position, type: z.enum(["tree", "ground"]) }).strict(),
      )
      .max(100),
    heldKills: record(count),
    trophyCounts: record(count),
    collectedSkulls: count,
    outfit: z
      .object({
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        text: z.string().max(10),
      })
      .strict(),
    horses: z
      .array(
        z
          .object({
            id,
            position,
            heading: z.number(),
            color: id,
            saddle: id.nullable(),
          })
          .strict(),
      )
      .max(50),
    bucket: z
      .object({
        color: id,
        colorName: id,
        fill: z.number().min(0).max(1),
        uses: count,
      })
      .strict()
      .nullable(),
    hunting: z
      .object({
        worldSeed: count,
        removedAnimalIds: z.array(id).max(2000),
        carcasses: z
          .array(
            z.object({ id, type: id, position, heading: z.number() }).strict(),
          )
          .max(50),
        looseSkulls: z.array(z.object({ id, position }).strict()).max(1000),
        cornHours: z.number().min(0).max(4),
        camoOn: z.boolean(),
        useBow: z.boolean(),
        gruntUses: count,
        activeBait: id.nullable(),
        rainbowBaitUses: count,
        carryingCorn: z.boolean(),
      })
      .strict(),
    aircraftOwned: z.boolean(),
    trainOwned: z.boolean(),
    rocketOwned: z.boolean(),
    space: z
      .object({
        visited: z.array(id).max(4),
        gems: record(z.array(id).max(100), 4),
      })
      .strict(),
    delivery: task.nullable(),
    helperTask: z
      .object({
        id,
        kind: z.enum(["vehicle", "feeders"]),
        offerId: id.nullable(),
        remainingSeconds: z.number().min(0).max(60),
      })
      .strict()
      .nullable(),
    fireWater: z.number().min(0).max(100),
    ladderRaised: z.boolean(),
    garageDoorOpen: z.boolean(),
  })
  .strict();
