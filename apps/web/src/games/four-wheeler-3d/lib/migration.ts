import {
  createAdventureProgress,
  type AdventureProgress,
  type SavedRider,
} from "./adventureTypes";
import {
  adventureSchema,
  fleetVehicleSchema,
  MAX_FLEET_VEHICLES,
} from "./adventureSchema";
import {
  findOffer,
  isAirVehicle,
  isLandVehicle,
  isWaterVehicle,
  OFFERS,
} from "./catalog";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** A bad ride must never discard the other independently valid purchases. */
export function migrateAdventure(value: unknown): AdventureProgress {
  const defaults = createAdventureProgress(),
    raw = object(value);
  const merged: Record<string, unknown> = { ...defaults, ...raw };
  for (const key of [
    "activities",
    "hunting",
    "dog",
    "outfit",
    "space",
  ] as const)
    merged[key] = { ...defaults[key], ...object(raw[key]) };
  if (raw.fleet !== undefined) {
    const entries = Object.entries(object(raw.fleet)).flatMap(([id, value]) => {
      const parsed = fleetVehicleSchema.safeParse({
        cornLoad: 0,
        ...object(value),
        id,
      });
      return id.length <= 80 && parsed.success
        ? [[id, parsed.data] as const]
        : [];
    });
    // Prioritize the active ride if an oversized old save needs trimming.
    entries.sort(
      ([a], [b]) =>
        Number(b === raw.activeVehicleId) - Number(a === raw.activeVehicleId),
    );
    merged.fleet = Object.fromEntries(entries.slice(0, MAX_FLEET_VEHICLES));
  }
  const result: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(adventureSchema.shape)) {
    const parsed = schema.safeParse(merged[key]);
    result[key] = parsed.success
      ? parsed.data
      : defaults[key as keyof AdventureProgress];
  }
  const adventure = result as AdventureProgress;
  for (const v of Object.values(adventure.fleet)) {
    v.cargo = v.cargo.filter(
      (id) => id !== v.id && Object.hasOwn(adventure.fleet, id),
    );
    if (v.hitch && !Object.hasOwn(adventure.fleet, v.hitch)) v.hitch = null;
  }
  for (const plot of Object.values(adventure.plots))
    for (const building of plot.buildings)
      building.parkedVehicleIds = building.parkedVehicleIds.filter((id) =>
        Object.hasOwn(adventure.fleet, id),
      );
  if (
    adventure.activeVehicleId &&
    !Object.hasOwn(adventure.fleet, adventure.activeVehicleId)
  )
    adventure.activeVehicleId = null;
  if (adventure.delivery && !findOffer(adventure.delivery.offerId))
    adventure.delivery = null;
  if (
    adventure.helperTask?.kind === "vehicle" &&
    !findOffer(adventure.helperTask.offerId ?? "")
  )
    adventure.helperTask = null;
  return adventure;
}

type MigratedProgress<T> = {
  [Key in keyof T]: Key extends "adventure" ? AdventureProgress : T[Key];
} & { adventure: AdventureProgress };

/** Translate the original 3D ownership fields before the first new-format save. */
export function migrateProgress<
  T extends {
    adventure?: unknown;
    ownedVehicles?: unknown;
    currentVehicle?: unknown;
    paint?: unknown;
    land?: unknown;
  },
>(progress: T): MigratedProgress<T> {
  if (progress.adventure !== undefined && progress.adventure !== null)
    return {
      ...progress,
      adventure: migrateAdventure(progress.adventure),
    } as MigratedProgress<T>;
  const adventure = createAdventureProgress();
  const types = new Set(
    Array.isArray(progress.ownedVehicles)
      ? progress.ownedVehicles.filter((v): v is string => typeof v === "string")
      : [],
  );
  if (typeof progress.currentVehicle === "string")
    types.add(progress.currentVehicle);
  for (const type of types) {
    if (!isLandVehicle(type) && !isAirVehicle(type) && !isWaterVehicle(type))
      continue;
    let vehicle = Object.values(adventure.fleet).find((v) => v.type === type);
    if (!vehicle) {
      const offer = OFFERS.find((o) => o.key === type && o.kind === "vehicle");
      const template = adventure.fleet["starter-atv"];
      const id = `legacy-${adventure.nextId++}`;
      vehicle = {
        ...template,
        id,
        type,
        position: {
          ...template.position,
          x: template.position.x + adventure.nextId * 4,
        },
        cargo: [],
        parked: true,
        purchasePrice: offer?.price ?? 0,
      };
      if (isWaterVehicle(type))
        vehicle.position = { ...adventure.fleet["starter-boat"].position };
      if (isAirVehicle(type))
        vehicle.position = { ...adventure.fleet["starter-plane"].position };
      adventure.fleet[id] = vehicle;
    }
    if (isAirVehicle(type)) adventure.aircraftOwned = true;
    if (type === progress.currentVehicle) {
      adventure.activeVehicleId = vehicle.id;
      vehicle.parked = false;
      if (
        typeof progress.paint === "string" &&
        /^#[0-9a-f]{6}$/i.test(progress.paint)
      )
        vehicle.paint = progress.paint;
    }
  }
  for (const [id, value] of Object.entries(object(progress.land))) {
    const plot = Object.hasOwn(adventure.plots, id)
      ? adventure.plots[id]
      : undefined;
    if (!plot) continue;
    const old = object(value);
    plot.owned = true;
    plot.sizeLevel =
      typeof old.size === "number" && Number.isFinite(old.size)
        ? Math.max(0, Math.min(4, Math.floor(old.size)))
        : 0;
    if (Array.isArray(old.slots))
      old.slots.slice(0, 2).forEach((type, slot) => {
        const normalized =
          typeof type === "string" ? type.replaceAll("_", "-") : "";
        const building = normalized === "house" ? "house-small" : normalized;
        if (
          [
            "garage",
            "trophy",
            "house-small",
            "house-medium",
            "house-huge",
          ].includes(building)
        )
          plot.buildings.push({
            slot: slot as 0 | 1,
            type: building as (typeof plot.buildings)[number]["type"],
            doorOpen: false,
            parkedVehicleIds: [],
          });
      });
  }
  return {
    ...progress,
    adventure: migrateAdventure(adventure),
  } as MigratedProgress<T>;
}

/** Shared startup pose for local hydration, cloud hydration and world mounting. */
export function savedRider(adventure: AdventureProgress): SavedRider {
  const rider = adventure.rider;
  const active = adventure.fleet[adventure.activeVehicleId ?? ""];
  if (rider?.mode === "foot") return rider;
  if (!active)
    return {
      mode: "foot",
      position: rider?.position ?? { x: -400, y: 1, z: 14 },
      heading: rider?.heading ?? 0,
    };
  const mode = isWaterVehicle(active.type)
    ? "boat"
    : isAirVehicle(active.type)
      ? "aircraft"
      : "vehicle";
  return {
    mode,
    position: rider?.mode === mode ? rider.position : active.position,
    heading: rider?.mode === mode ? rider.heading : active.heading,
  };
}
