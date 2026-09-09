import type {
  AdventurePosition,
  AdventureProgress,
  PlotBuilding,
} from "./adventureTypes";
import { LAND_PLOTS } from "./landmarks";
import { LAND_SIZE_MULTIPLIERS, isLandVehicle, isTrailer } from "./catalog";
import {
  buyLand,
  constructBuilding,
  upgradeLand,
  type EconomyProgress,
  type TransactionResult,
} from "./economy";
import type { Interaction, TravelMode } from "./adventureSession";
import { heightAt } from "./terrain";
import { tuningFor } from "./vehicles";

export const PROPERTY_RANGE = 220 / 18;
export const GARAGE_BAYS = 6;
export const BUILDING_LABELS: Record<PlotBuilding["type"], string> = {
  garage: "Garage",
  trophy: "Trophy Room",
  "house-small": "Small House",
  "house-medium": "Medium House",
  "house-huge": "Huge House",
};
export function propertySize(a: AdventureProgress, id: string): number {
  const plot = LAND_PLOTS.find((p) => p.id === id);
  return plot
    ? plot.size * LAND_SIZE_MULTIPLIERS[a.plots[id]?.sizeLevel ?? 0]
    : 0;
}
export function propertySlot(
  a: AdventureProgress,
  id: string,
  slot: number,
): { x: number; z: number } | null {
  const plot = LAND_PLOTS.find((p) => p.id === id);
  if (!plot || (slot !== 0 && slot !== 1)) return null;
  return {
    x: plot.x + (slot === 1 ? propertySize(a, id) * 0.55 : 0),
    z: plot.z,
  };
}
export function buildingDimensions(type: PlotBuilding["type"]) {
  switch (type) {
    case "garage":
      return { width: 22, depth: 26, height: 5.5, rooms: 1, doorWidth: 8 };
    case "trophy":
      return { width: 16, depth: 14, height: 4.2, rooms: 1, doorWidth: 2.3 };
    case "house-small":
      return { width: 13, depth: 12, height: 4.2, rooms: 1, doorWidth: 1.6 };
    case "house-medium":
      return { width: 20, depth: 15, height: 4.6, rooms: 2, doorWidth: 1.8 };
    case "house-huge":
      return { width: 28, depth: 18, height: 6.8, rooms: 3, doorWidth: 2 };
  }
}
export function propertyDoor(a: AdventureProgress, id: string, slot: number) {
  const center = propertySlot(a, id, slot),
    building = a.plots[id]?.buildings.find((b) => b.slot === slot);
  if (!center || !building) return null;
  return {
    x: center.x,
    z: center.z + buildingDimensions(building.type).depth / 2 + 0.8,
  };
}
export function propertyElevation(
  a: AdventureProgress,
  id: string,
  slot: number,
): number {
  const center = propertySlot(a, id, slot),
    b = a.plots[id]?.buildings.find((b) => b.slot === slot);
  if (!center || !b) return 0;
  const d = buildingDimensions(b.type);
  let top = -Infinity;
  for (const x of [-1, 0, 1])
    for (const z of [-1, 0, 1])
      top = Math.max(
        top,
        heightAt(center.x + (x * d.width) / 2, center.z + (z * d.depth) / 2),
      );
  return top + 0.12;
}
const vehicleRestHeight = (type: string) => {
  const t = tuningFor(type);
  return t.wheelRadius + t.suspension.restLength;
};
const near = (
  a: { x: number; z: number },
  b: { x: number; z: number },
  range = PROPERTY_RANGE,
) => Math.hypot(a.x - b.x, a.z - b.z) <= range;
const fail = (message: string) => ({ ok: false as const, message });
export type PropertyChange =
  | {
      ok: true;
      adventure: AdventureProgress;
      message: string;
      position?: AdventurePosition;
      vehicleId?: string;
    }
  | { ok: false; message: string };

export function canManageProperty(
  a: AdventureProgress,
  id: string,
  player: AdventurePosition,
): boolean {
  const plot = LAND_PLOTS.find((p) => p.id === id);
  if (!plot) return false;
  const size = propertySize(a, id),
    center = propertySlot(a, id, 1)!;
  return (
    Math.abs(player.z - plot.z) < size / 2 + PROPERTY_RANGE &&
    player.x >= plot.x - size * 0.55 - PROPERTY_RANGE &&
    player.x <= center.x + PROPERTY_RANGE
  );
}

export function propertyCommerce(
  p: EconomyProgress,
  id: string,
  command: "buy" | "upgrade" | "build",
  player: AdventurePosition,
  mode: TravelMode,
  slot: 0 | 1 = 0,
  type: PlotBuilding["type"] = "garage",
): TransactionResult {
  if (mode !== "foot" || !canManageProperty(p.adventure, id, player))
    return fail("Walk onto this property before buying or building.");
  const previous = propertySlot(p.adventure, id, 1);
  const result =
    command === "buy"
      ? buyLand(p, id)
      : command === "upgrade"
        ? upgradeLand(p, id)
        : constructBuilding(p, id, slot, type);
  if (result.ok && command === "upgrade" && previous) {
    const next = propertySlot(result.patch.adventure, id, 1)!;
    const garage = result.patch.adventure.plots[id].buildings.find(
      (b) => b.slot === 1,
    );
    for (const vehicleId of garage?.parkedVehicleIds ?? []) {
      const v = result.patch.adventure.fleet[vehicleId];
      if (v)
        v.position = {
          ...v.position,
          x: v.position.x + next.x - previous.x,
          z: v.position.z + next.z - previous.z,
          y:
            propertyElevation(result.patch.adventure, id, 1) +
            vehicleRestHeight(v.type),
        };
    }
  }
  return result;
}

export function propertyGarageForVehicle(
  a: AdventureProgress,
  vehicleId: string,
): { plotId: string; building: PlotBuilding } | null {
  for (const plot of Object.values(a.plots))
    for (const building of plot.buildings)
      if (
        building.type === "garage" &&
        building.parkedVehicleIds.includes(vehicleId)
      )
        return { plotId: plot.id, building };
  return null;
}
export function removePropertyParking(
  a: AdventureProgress,
  vehicleId: string,
): AdventureProgress {
  const next = structuredClone(a);
  for (const plot of Object.values(next.plots))
    for (const b of plot.buildings)
      b.parkedVehicleIds = b.parkedVehicleIds.filter((id) => id !== vehicleId);
  return next;
}
export function canBoardPropertyVehicle(
  a: AdventureProgress,
  vehicleId: string,
): boolean {
  const garage = propertyGarageForVehicle(a, vehicleId);
  return !garage || garage.building.doorOpen;
}

export function togglePropertyDoor(
  a: AdventureProgress,
  id: string,
  slot: number,
  player: AdventurePosition,
  mode: TravelMode,
): PropertyChange {
  const building = a.plots[id]?.buildings.find((b) => b.slot === slot),
    door = propertyDoor(a, id, slot);
  if (!a.plots[id]?.owned || building?.type !== "garage" || !door)
    return fail("There is no garage here.");
  if (mode !== "foot" || !near(player, door))
    return fail("Walk up to the garage door first.");
  // Do not lower a physical door through the player standing in its opening.
  if (
    building.doorOpen &&
    Math.abs(player.x - door.x) < buildingDimensions("garage").doorWidth / 2 &&
    Math.abs(player.z - (door.z - 0.8)) < 1.2
  )
    return fail("Step clear of the doorway before closing it.");
  if (
    building.doorOpen &&
    Object.values(a.fleet).some(
      (v) =>
        Math.abs(v.position.x - door.x) < 5 &&
        Math.abs(v.position.z - (door.z - 0.8)) <
          tuningFor(v.type).chassis.length / 2 + 0.5,
    )
  )
    return fail("Move the vehicle out of the doorway before closing it.");
  const next = structuredClone(a),
    changed = next.plots[id].buildings.find((b) => b.slot === slot)!;
  changed.doorOpen = !building.doorOpen;
  return {
    ok: true,
    adventure: next,
    message: changed.doorOpen
      ? "Garage open. Drive inside and park your ride."
      : "Garage door closed.",
  };
}

export function parkPropertyVehicle(
  a: AdventureProgress,
  id: string,
  slot: number,
  player: AdventurePosition,
  mode: TravelMode,
  speed: number,
): PropertyChange {
  const building = a.plots[id]?.buildings.find((b) => b.slot === slot),
    door = propertyDoor(a, id, slot),
    center = propertySlot(a, id, slot),
    vehicleId = a.activeVehicleId,
    vehicle = vehicleId ? a.fleet[vehicleId] : null;
  if (!a.plots[id]?.owned || building?.type !== "garage" || !center || !door)
    return fail("There is no garage here.");
  if (!building.doorOpen) return fail("Open the garage door on foot first.");
  if (
    mode !== "vehicle" ||
    !vehicle ||
    !isLandVehicle(vehicle.type) ||
    isTrailer(vehicle.type)
  )
    return fail("Drive a land vehicle into the garage first.");
  if (!near(player, door) && !near(player, center))
    return fail("Drive closer to your garage.");
  if (Math.abs(speed) > 3) return fail("Slow down before parking.");
  if (building.parkedVehicleIds.includes(vehicle.id))
    return fail("This ride is already parked here.");
  const occupants = building.parkedVehicleIds.filter((id) => a.fleet[id]);
  if (occupants.length >= GARAGE_BAYS)
    return fail("All six bays are full. Retrieve a ride to make room.");
  const next = removePropertyParking(a, vehicle.id),
    changed = next.plots[id].buildings.find((b) => b.slot === slot)!;
  const occupied = new Set(
    occupants.map((id) => {
      const p = a.fleet[id].position;
      return `${Math.round((p.x - center.x) / 6)}:${p.z < center.z ? 0 : 1}`;
    }),
  );
  let bay = 0;
  while (
    bay < GARAGE_BAYS &&
    occupied.has(`${(bay % 3) - 1}:${Math.floor(bay / 3)}`)
  )
    bay++;
  if (bay === GARAGE_BAYS) return fail("The parking bays are occupied.");
  const parked = next.fleet[vehicle.id];
  parked.position = {
    x: center.x + ((bay % 3) - 1) * 6,
    y: propertyElevation(a, id, slot) + vehicleRestHeight(vehicle.type),
    z: center.z + (Math.floor(bay / 3) === 0 ? -6 : 5),
  };
  parked.heading = Math.PI;
  parked.parked = true;
  parked.hitch = null;
  changed.parkedVehicleIds = [...occupants, vehicle.id];
  next.activeVehicleId = null;
  const exitX = door.x + 5.5,
    exitZ = door.z + 9;
  return {
    ok: true,
    adventure: next,
    vehicleId: vehicle.id,
    position: { x: exitX, y: heightAt(exitX, exitZ) + 0.2, z: exitZ },
    message:
      "Parked safely in your garage. Your paint, upgrades and cargo are saved.",
  };
}

export function retrievePropertyVehicle(
  a: AdventureProgress,
  id: string,
  slot: number,
  vehicleId: string,
  player: AdventurePosition,
  mode: TravelMode,
  interiorId?: string,
): PropertyChange {
  const b = a.plots[id]?.buildings.find((b) => b.slot === slot),
    door = propertyDoor(a, id, slot),
    vehicle = a.fleet[vehicleId];
  if (
    !a.plots[id]?.owned ||
    b?.type !== "garage" ||
    !b.parkedVehicleIds.includes(vehicleId) ||
    !vehicle ||
    !door
  )
    return fail("That ride is not stored in this garage.");
  const inside = mode === "interior" && interiorId === `${id}:${slot}`;
  if ((!inside && mode !== "foot") || (!inside && !near(player, door)))
    return fail("Visit this garage to retrieve your ride.");
  if (!b.doorOpen) return fail("Open this garage door first.");
  const offset = [0, 6, -6, 12, -12, 18, -18].find(
    (x) =>
      !Object.values(a.fleet).some(
        (v) =>
          v.id !== vehicleId &&
          Math.hypot(v.position.x - door.x - x, v.position.z - door.z - 12) < 5,
      ),
  );
  if (offset === undefined)
    return fail("The driveway is full. Move a ride before retrieving another.");
  const next = removePropertyParking(a, vehicleId),
    position = {
      x: door.x + offset,
      y:
        heightAt(door.x + offset, door.z + 12) +
        vehicleRestHeight(vehicle.type),
      z: door.z + 12,
    };
  next.fleet[vehicleId] = {
    ...next.fleet[vehicleId],
    position,
    heading: 0,
    parked: false,
  };
  next.activeVehicleId = vehicleId;
  return {
    ok: true,
    adventure: next,
    vehicleId,
    position,
    message: "Your ride is out front. Ready to go!",
  };
}

export function canEnterProperty(
  a: AdventureProgress,
  id: string,
  slot: number,
  player: AdventurePosition,
  mode: TravelMode,
): boolean {
  const building = a.plots[id]?.buildings.find((b) => b.slot === slot),
    door = propertyDoor(a, id, slot);
  return !!(
    a.plots[id]?.owned &&
    building &&
    door &&
    mode === "foot" &&
    near(player, door, 5) &&
    (building.type !== "garage" || building.doorOpen)
  );
}

/** Root interaction resolver can prioritize these moving, upgraded property markers. */
export function nearbyPropertyInteraction(
  a: AdventureProgress,
  player: AdventurePosition,
  mode: TravelMode,
): Interaction | null {
  if (mode !== "foot" && mode !== "vehicle") return null;
  const choices: Interaction[] = [];
  const add = (
    id: string,
    label: string,
    point: { x: number; z: number },
    range = PROPERTY_RANGE,
  ) => {
    const distance = Math.hypot(player.x - point.x, player.z - point.z);
    if (distance <= range)
      choices.push({
        id,
        label,
        kind: "property",
        icon: "⌂",
        distance,
        ready: true,
      });
  };
  for (const plot of LAND_PLOTS) {
    const saved = a.plots[plot.id];
    if (!saved) continue;
    if (!saved.owned) {
      if (mode === "foot")
        add(`property:manage:${plot.id}`, "Buy this land", plot);
      continue;
    }
    for (const slot of [0, 1] as const) {
      if (slot === 1 && !saved.buildings.some((b) => b.slot === 0)) continue;
      const b = saved.buildings.find((b) => b.slot === slot),
        p = propertySlot(a, plot.id, slot)!;
      if (!b) {
        if (mode === "foot")
          add(`property:manage:${plot.id}`, `Build in spot ${slot + 1}`, p);
        continue;
      }
      const door = propertyDoor(a, plot.id, slot)!;
      if (b.type === "garage") {
        add(
          `property:${mode === "vehicle" ? "park" : "manage"}:${plot.id}:${slot}`,
          mode === "vehicle" ? "Park in your garage" : "Your garage",
          door,
        );
        if (mode === "vehicle")
          add(`property:park:${plot.id}:${slot}`, "Park in your garage", p);
      } else if (mode === "foot")
        add(
          `property:enter:${plot.id}:${slot}`,
          `Enter ${BUILDING_LABELS[b.type]}`,
          door,
          5,
        );
    }
    if (mode === "foot")
      add(`property:manage:${plot.id}`, "Expand your land", {
        x: plot.x - propertySize(a, plot.id) * 0.55,
        z: plot.z,
      });
  }
  return choices.sort((a, b) => a.distance - b.distance)[0] ?? null;
}
