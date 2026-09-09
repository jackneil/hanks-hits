import type {
  AdventurePosition,
  AdventureProgress,
  FleetVehicle,
  PlotBuilding,
} from "./adventureTypes";
import {
  AIR_VEHICLES,
  AMAZON_STORES,
  BUILD_PRICES,
  findOffer,
  isAirVehicle,
  isLandVehicle,
  isTrailer,
  isWaterVehicle,
  LAND_PRICE,
  LAND_UPGRADE_PRICES,
  resalePrice,
  type StoreOffer,
} from "./catalog";
import { LAKE, LANDMARKS } from "./landmarks";
import { tuningFor } from "./vehicles";
import {
  adventureSchema,
  MAX_FLEET_VEHICLES,
  MAX_SPEED_UPGRADE,
} from "./adventureSchema";

export type EconomyProgress = {
  money: number;
  totalEarned: number;
  ownedVehicles: string[];
  adventure: AdventureProgress;
};
export type EconomyPatch = EconomyProgress & {
  land: Record<string, { size: number; slots: string[] }>;
};
export type TransactionResult =
  | { ok: true; patch: EconomyPatch; message: string }
  | { ok: false; message: string };
const fail = (message: string): TransactionResult => ({ ok: false, message });
const validPosition = (p: AdventurePosition) =>
  [p.x, p.y, p.z].every(Number.isFinite);
const canAfford = (p: EconomyProgress, price: number) =>
  Number.isFinite(p.money) && p.money >= price;
const clone = (p: EconomyProgress) => structuredClone(p.adventure);
const numberLabel = (n: number) => `$${n.toLocaleString("en-US")}`;

function finish(
  p: EconomyProgress,
  adventure: AdventureProgress,
  delta: number,
  message: string,
): TransactionResult {
  const validation = adventureSchema.safeParse(adventure);
  if (!validation.success)
    return fail(
      "This change exceeds the saved world limits. Sell or use an item first.",
    );
  if (
    !Number.isFinite(p.money + delta) ||
    p.money + delta < 0 ||
    p.money + delta > 1e12 ||
    p.totalEarned + Math.max(0, delta) > 1e12
  )
    return fail("Your cash has reached the saved world limit.");
  return {
    ok: true,
    message,
    patch: {
      money: Math.round((p.money + delta) * 100) / 100,
      totalEarned: p.totalEarned + Math.max(0, delta),
      ownedVehicles: [
        ...new Set(
          Object.values(adventure.fleet)
            .filter((v) => !isTrailer(v.type))
            .map((v) => v.type),
        ),
      ],
      adventure,
      land: Object.fromEntries(
        Object.values(adventure.plots)
          .filter((p) => p.owned)
          .map((p) => [
            p.id,
            {
              size: p.sizeLevel,
              slots: [...p.buildings]
                .sort((a, b) => a.slot - b.slot)
                .map((b) => b.type),
            },
          ]),
      ),
    },
  };
}

function nextId(a: AdventureProgress, prefix: string): string {
  let id: string;
  do {
    id = `${prefix}-${a.nextId++}`;
  } while (a.fleet[id] || a.delivery?.id === id || a.helperTask?.id === id);
  return id;
}
function spawn(
  a: AdventureProgress,
  item: StoreOffer,
  position: AdventurePosition,
): FleetVehicle {
  const id = nextId(a, "vehicle");
  const vehicle: FleetVehicle = {
    id,
    type: item.key,
    position: { x: position.x, y: position.y, z: position.z },
    heading: 0,
    paint: item.color ?? "#e63946",
    speedUpgrade: 0,
    mud: 0,
    cargo: [],
    hitch: null,
    parked: true,
    purchasePrice: item.price,
    capacity: item.capacity ?? 0,
    cornLoad: 0,
  };
  a.fleet[id] = vehicle;
  return vehicle;
}
/** Water delivery goes to the nearby lake, or the dock when the player is inland. */
export function waterDeliveryPosition(
  player: AdventurePosition,
): AdventurePosition {
  const dx = player.x - LAKE.x,
    dz = player.z - LAKE.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= LAKE.r + 700 / 18) return { ...LANDMARKS.dockWater, y: 0 };
  const radius = Math.min(distance, LAKE.r - 150 / 18);
  return {
    x: LAKE.x + (distance ? dx / distance : 1) * radius,
    y: 0,
    z: LAKE.z + (distance ? dz / distance : 0) * radius,
  };
}

/** One grant implementation is shared by the physical shop, plane and helper. */
function grant(
  a: AdventureProgress,
  item: StoreOffer,
  position: AdventurePosition,
  delivered: boolean,
) {
  const bump = (key: string) => {
    a.inventory[key] = (a.inventory[key] ?? 0) + 1;
  };
  const at = {
    x: position.x + 5 + (a.nextId % 5) * 2,
    y: position.y,
    z: position.z + 7,
  };
  switch (item.kind) {
    case "vehicle": {
      const water = isWaterVehicle(item.key);
      const v = spawn(
        a,
        item,
        water && delivered ? waterDeliveryPosition(position) : at,
      );
      if (isAirVehicle(item.key)) a.aircraftOwned = true;
      if (water && !delivered) {
        const trailer = spawn(
          a,
          { ...item, key: "boattrailer", price: 5000, capacity: 1 },
          at,
        );
        trailer.cargo.push(v.id);
        v.parked = false;
      }
      break;
    }
    case "trailer":
    case "plow":
      spawn(a, item, at);
      break;
    case "gear":
      bump(item.key);
      if (item.key === "decoy") bump("feeder");
      if (item.key === "call") a.hunting.gruntUses += 10;
      break;
    case "feeder":
      bump("feeder");
      break;
    case "stand":
      bump(`stand-${item.key}`);
      break;
    case "corn":
      bump("corn");
      break;
    case "saddle":
      bump(item.key);
      break;
    case "bait":
      a.hunting.activeBait = item.key;
      a.hunting.rainbowBaitUses = item.key === "rainbow" ? 2 : 0;
      break;
    case "bucket":
      a.bucket = {
        color: item.color!,
        colorName: item.label.replace(/ Bucket$/, ""),
        fill: 0,
        uses: 0,
      };
      break;
    case "aircraft-package": {
      a.aircraftOwned = true;
      // A sold starter aircraft must not make a later package purchase empty.
      for (const type of ["plane", "heli"])
        if (!Object.values(a.fleet).some((v) => v.type === type)) {
          spawn(a, { ...item, key: type, price: resalePrice(type) }, at);
        }
      break;
    }
    case "train":
      a.trainOwned = true;
      break;
    case "rocket":
      a.rocketOwned = true;
      break;
  }
}

function alreadyUnlocked(a: AdventureProgress, item: StoreOffer): boolean {
  return (
    (item.kind === "train" && a.trainOwned) ||
    (item.kind === "rocket" && a.rocketOwned) ||
    (item.kind === "aircraft-package" && a.aircraftOwned)
  );
}

function vehicleSlots(
  a: AdventureProgress,
  item: StoreOffer,
  delivered: boolean,
): number {
  if (item.kind === "aircraft-package")
    return ["plane", "heli"].filter(
      (type) => !Object.values(a.fleet).some((v) => v.type === type),
    ).length;
  if (item.kind === "vehicle")
    return isWaterVehicle(item.key) && !delivered ? 2 : 1;
  return item.kind === "trailer" || item.kind === "plow" ? 1 : 0;
}
function fleetRoom(
  a: AdventureProgress,
  item: StoreOffer,
  delivered: boolean,
): boolean {
  const pending = [a.delivery?.offerId, a.helperTask?.offerId].reduce<number>(
    (n, id) => {
      const order = id ? findOffer(id) : undefined;
      return n + (order ? vehicleSlots(a, order, true) : 0);
    },
    0,
  );
  return (
    Object.keys(a.fleet).length + pending + vehicleSlots(a, item, delivered) <=
    MAX_FLEET_VEHICLES
  );
}
const fleetFull = () =>
  fail(
    `Your fleet has room for ${MAX_FLEET_VEHICLES} rides and trailers, including pending deliveries. Sell a ride first.`,
  );

export function buyOffer(
  p: EconomyProgress,
  offerId: string,
  position: AdventurePosition,
): TransactionResult {
  const item = findOffer(offerId);
  if (!item || !validPosition(position))
    return fail("That item is not available here.");
  if (alreadyUnlocked(p.adventure, item)) return fail("You already own this.");
  if (!canAfford(p, item.price))
    return fail(`You need ${numberLabel(item.price)} for ${item.label}.`);
  if (!fleetRoom(p.adventure, item, false)) return fleetFull();
  const adventure = clone(p);
  grant(adventure, item, position, false);
  return finish(p, adventure, -item.price, `Bought ${item.label}!`);
}

/** Selling never deletes cargo silently: it parks cargo and detaches all references. */
export function sellVehicle(
  p: EconomyProgress,
  vehicleId: string,
): TransactionResult {
  const vehicle = Object.hasOwn(p.adventure.fleet, vehicleId)
    ? p.adventure.fleet[vehicleId]
    : undefined;
  if (!vehicle) return fail("That ride has already been sold.");
  const price = resalePrice(vehicle.type);
  if (price <= 0) return fail("This item cannot be sold.");
  const adventure = clone(p);
  for (const id of vehicle.cargo) {
    const cargo = Object.hasOwn(adventure.fleet, id)
      ? adventure.fleet[id]
      : undefined;
    if (cargo) {
      cargo.parked = true;
      cargo.position = { ...vehicle.position, x: vehicle.position.x + 5 };
    }
  }
  for (const v of Object.values(adventure.fleet)) {
    v.cargo = v.cargo.filter((id) => id !== vehicleId);
    if (v.hitch === vehicleId) v.hitch = null;
  }
  for (const plot of Object.values(adventure.plots))
    for (const building of plot.buildings)
      building.parkedVehicleIds = building.parkedVehicleIds.filter(
        (id) => id !== vehicleId,
      );
  delete adventure.fleet[vehicleId];
  if (adventure.activeVehicleId === vehicleId) adventure.activeVehicleId = null;
  return finish(p, adventure, price, `Sold it for ${numberLabel(price)}.`);
}

export function sellMilk(p: EconomyProgress): TransactionResult {
  const fill = p.adventure.bucket?.fill;
  if (!fill || !Number.isFinite(fill) || fill < 0 || fill > 1)
    return fail("Your bucket has no milk to sell.");
  const adventure = clone(p);
  adventure.bucket = null;
  const price = Math.round(200 * fill);
  return finish(
    p,
    adventure,
    price,
    `Sold your milk for ${numberLabel(price)}.`,
  );
}

export function customizeVehicle(
  p: EconomyProgress,
  id: string,
  change: { paint?: string; speedDelta?: number },
): TransactionResult {
  const vehicle = p.adventure.fleet[id];
  if (!vehicle || !isLandVehicle(vehicle.type))
    return fail("Bring a land vehicle to the paint shop.");
  if (change.paint !== undefined && !/^#[0-9a-f]{6}$/i.test(change.paint))
    return fail("Pick a paint color.");
  if (
    change.speedDelta !== undefined &&
    change.speedDelta !== 10 &&
    change.speedDelta !== -10
  )
    return fail("Change the top speed by 10 mph at a time.");
  if (change.paint === undefined && change.speedDelta === undefined)
    return fail("Pick a paint color or speed change.");
  const baseMph = tuningFor(vehicle.type).maxSpeed * 2.2369362921;
  const nextSpeed =
    change.speedDelta === undefined
      ? vehicle.speedUpgrade
      : Math.max(
          -MAX_SPEED_UPGRADE,
          5 - baseMph,
          vehicle.speedUpgrade + change.speedDelta,
        );
  if (nextSpeed > MAX_SPEED_UPGRADE)
    return fail(
      `This ride has reached its +${MAX_SPEED_UPGRADE} mph upgrade limit.`,
    );
  const cost = Math.round((nextSpeed - vehicle.speedUpgrade) * 100) / 100;
  if (change.speedDelta && cost === 0)
    return fail("This ride is already at its slowest speed.");
  if (cost > 0 && !canAfford(p, cost))
    return fail(`You need ${numberLabel(cost)} to tune this ride.`);
  const adventure = clone(p);
  adventure.fleet[id].speedUpgrade = nextSpeed;
  if (change.paint !== undefined) adventure.fleet[id].paint = change.paint;
  return finish(
    p,
    adventure,
    -cost,
    change.speedDelta ? "Top speed updated!" : "New paint is ready!",
  );
}

export function orderDelivery(
  p: EconomyProgress,
  offerId: string,
): TransactionResult {
  if (p.adventure.delivery) return fail("Your delivery is still on the way.");
  const item = findOffer(offerId);
  if (!item || !AMAZON_STORES.includes(item.storeId))
    return fail("That item cannot be delivered.");
  if (alreadyUnlocked(p.adventure, item)) return fail("You already own this.");
  if (!canAfford(p, item.price))
    return fail(`You need ${numberLabel(item.price)} for ${item.label}.`);
  if (!fleetRoom(p.adventure, item, true)) return fleetFull();
  const adventure = clone(p);
  adventure.delivery = {
    id: nextId(adventure, "order"),
    offerId,
    remainingSeconds: 38,
  };
  return finish(p, adventure, -item.price, `${item.label} is on the way!`);
}

/** Applies to the latest state. A completed order is removed, so ticks cannot grant it twice. */
export function advanceDelivery(
  p: EconomyProgress,
  seconds: number,
  position: AdventurePosition,
): TransactionResult {
  const delivery = p.adventure.delivery;
  if (!delivery) return fail("There is no delivery on the way.");
  if (!Number.isFinite(seconds) || seconds < 0 || !validPosition(position))
    return fail("The delivery could not move yet.");
  const item = findOffer(delivery.offerId);
  if (!item) return fail("This saved order is no longer available.");
  const adventure = clone(p);
  adventure.delivery!.remainingSeconds = Math.max(
    0,
    delivery.remainingSeconds - seconds,
  );
  if (adventure.delivery!.remainingSeconds > 0)
    return finish(p, adventure, 0, "Your delivery is on the way.");
  grant(adventure, item, position, true);
  adventure.delivery = null;
  return finish(p, adventure, 0, `${item.label} has arrived!`);
}

export function requestHelper(
  p: EconomyProgress,
  request: string,
): TransactionResult {
  if (p.adventure.helperTask)
    return fail("Your helper is finishing an errand.");
  const text = request.toLowerCase();
  const corn = /corn|feeder|fill/.test(text);
  const aliases: [string[], string][] = [
    [["pontoon"], "pontoon"],
    [["jet ski", "jetski"], "jetski"],
    [["speedboat", "speed boat"], "boat"],
    [["mini fishing", "mini-fishing"], "minifishingboat"],
    [["fishing boat", "big fishing"], "fishingboat"],
    [["yacht"], "yacht"],
    [["four wheeler", "four-wheeler", "quad", "atv"], "atv"],
    [["side by side", "side-by-side", "utv"], "utv"],
    [["18 wheeler", "18-wheeler", "semi"], "semi"],
    [["truck", "f250"], "truck"],
    [["motorcycle", "moto", "bike"], "moto"],
    [["ferrari", "lambo", "lamborghini"], "lambo"],
  ];
  const key =
    aliases.find(([words]) => words.some((w) => text.includes(w)))?.[1] ??
    (text.includes("boat") ? "pontoon" : null);
  const item = key ? findOffer(`anyStore:${key}`) : undefined;
  if (!corn && !item)
    return fail("Ask for a ride, like a truck, or ask to fill your feeders.");
  if (
    corn &&
    (!p.adventure.feeders.length ||
      p.adventure.feeders.every((f) => f.corn >= 18))
  )
    return fail("Your feeders do not need corn yet.");
  const price = corn ? p.adventure.feeders.length * 200 : item!.price;
  if (!canAfford(p, price))
    return fail(`Your helper needs ${numberLabel(price)} for this errand.`);
  if (!corn && !fleetRoom(p.adventure, item!, true)) return fleetFull();
  const adventure = clone(p);
  adventure.helperTask = {
    id: nextId(adventure, "helper"),
    kind: corn ? "feeders" : "vehicle",
    offerId: corn ? null : item!.id,
    remainingSeconds: 4,
  };
  return finish(p, adventure, -price, "Your helper is on the way!");
}

export function advanceHelper(
  p: EconomyProgress,
  seconds: number,
  position: AdventurePosition,
): TransactionResult {
  const task = p.adventure.helperTask;
  if (!task) return fail("Your helper is ready for an errand.");
  if (!Number.isFinite(seconds) || seconds < 0 || !validPosition(position))
    return fail("Your helper could not move yet.");
  const item = task.offerId ? findOffer(task.offerId) : undefined;
  if (task.kind === "vehicle" && !item)
    return fail("This saved errand is no longer available.");
  const adventure = clone(p);
  adventure.helperTask!.remainingSeconds = Math.max(
    0,
    task.remainingSeconds - seconds,
  );
  if (adventure.helperTask!.remainingSeconds > 0)
    return finish(p, adventure, 0, "Your helper is on the way.");
  if (task.kind === "feeders")
    adventure.feeders.forEach((f) => {
      f.corn = 18;
    });
  else grant(adventure, item!, position, true);
  adventure.helperTask = null;
  return finish(
    p,
    adventure,
    0,
    task.kind === "feeders"
      ? "Every feeder is full!"
      : "Your new ride is here!",
  );
}

export function buyLand(p: EconomyProgress, id: string): TransactionResult {
  const plot = Object.hasOwn(p.adventure.plots, id)
    ? p.adventure.plots[id]
    : undefined;
  if (!plot || plot.owned) return fail("This land is not for sale.");
  if (!canAfford(p, LAND_PRICE))
    return fail(`You need ${numberLabel(LAND_PRICE)} to buy this land.`);
  const adventure = clone(p);
  adventure.plots[id].owned = true;
  return finish(p, adventure, -LAND_PRICE, "This land is yours!");
}
export function upgradeLand(p: EconomyProgress, id: string): TransactionResult {
  const plot = Object.hasOwn(p.adventure.plots, id)
    ? p.adventure.plots[id]
    : undefined;
  if (!plot?.owned) return fail("Buy this land first.");
  const price = LAND_UPGRADE_PRICES[plot.sizeLevel];
  if (price === undefined)
    return fail("Your land is already its biggest size.");
  if (!canAfford(p, price))
    return fail(`You need ${numberLabel(price)} for bigger land.`);
  const adventure = clone(p);
  adventure.plots[id].sizeLevel++;
  return finish(p, adventure, -price, "Your land is bigger!");
}
export function constructBuilding(
  p: EconomyProgress,
  id: string,
  slot: 0 | 1,
  type: PlotBuilding["type"],
): TransactionResult {
  const plot = Object.hasOwn(p.adventure.plots, id)
    ? p.adventure.plots[id]
    : undefined;
  if (!plot?.owned) return fail("Buy this land first.");
  if (
    (slot !== 0 && slot !== 1) ||
    plot.buildings.some((b) => b.slot === slot) ||
    (slot === 1 && !plot.buildings.some((b) => b.slot === 0))
  )
    return fail("Build in the first open spot.");
  const price = BUILD_PRICES[type];
  if (typeof price !== "number" || !canAfford(p, price))
    return fail("You need more money for this building.");
  const adventure = clone(p);
  adventure.plots[id].buildings.push({
    slot,
    type,
    doorOpen: false,
    parkedVehicleIds: [],
  });
  return finish(p, adventure, -price, "Your building is ready!");
}

/** Used by the UI to keep locked starter aircraft from being boarded. */
export function canBoardFleetVehicle(
  a: AdventureProgress,
  id: string,
): boolean {
  const v = a.fleet[id];
  return (
    !!v &&
    !isTrailer(v.type) &&
    !Object.values(a.fleet).some((other) => other.cargo.includes(id)) &&
    (!(AIR_VEHICLES as readonly string[]).includes(v.type) || a.aircraftOwned)
  );
}
